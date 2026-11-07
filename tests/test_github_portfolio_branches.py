"""Offline safety tests for the gh-backed portfolio cleanup helper (mock CLI, no GitHub writes)."""
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "github-portfolio-branches.sh"
MOCK_GH = r"""#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$AUDIT_LOG"
args="$*"
if [[ "$args" == "auth status -h github.com" ]]; then exit 0; fi
if [[ "$args" == *"repos/mason82-dotcom/SkyHub-Next/branches?per_page=100"* ]]; then
  printf 'main\tfalse\nfeature/merged\tfalse\nfeature/unique\tfalse\nfeature/in-pr\tfalse\ndocs/used-base\tfalse\nfeature/protected\ttrue\n'
  exit 0
fi
if [[ "$args" == *"repos/mason82-dotcom/SkyHub-Next/pulls?state=open&per_page=100"* ]]; then
  printf 'feature/in-pr\ndocs/used-base\n'
  exit 0
fi
if [[ "$args" == *"compare/main...feature/unique"* ]]; then
  printf '1\n'
  exit 0
fi
if [[ "$args" == *"compare/main...feature/merged"* ]]; then
  printf '0\n'
  exit 0
fi
if [[ "$args" == *"repos/mason82-dotcom/SkyHub-Next/git/ref/heads/feature/merged"* ]]; then
  printf '0123456789abcdef0123456789abcdef01234567\n'
  exit 0
fi
if [[ "$args" == *"repos/mason82-dotcom/SkyHub-Next --jq .default_branch"* ]]; then
  printf 'main\n'
  exit 0
fi
printf 'Unexpected mocked gh command: %s\n' "$args" >&2
exit 15
"""


class GithubPortfolioBranchSafetyTests(unittest.TestCase):
    def run_script(self, *args):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            mock = directory / "gh"
            mock.write_text(MOCK_GH, encoding="utf-8")
            mock.chmod(0o755)
            log = directory / "calls.txt"
            log.write_text("", encoding="utf-8")
            env = dict(os.environ)
            env["PATH"] = str(directory) + os.pathsep + env.get("PATH", "")
            env["AUDIT_LOG"] = str(log)
            result = subprocess.run(["bash", str(SCRIPT), *args],
                                    cwd=str(ROOT), env=env,
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                    text=True, check=False)
            return result, log.read_text(encoding="utf-8")

    def test_syntax(self):
        r = subprocess.run(["bash", "-n", str(SCRIPT)],
                           capture_output=True, text=True, check=False)
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_dry_run_does_not_delete_open_pr_or_unmerged_commits(self):
        r, log = self.run_script("--repo", "mason82-dotcom/SkyHub-Next")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("CANDIDATE_COUNT=1", r.stdout)
        self.assertIn("CANDIDATE integrated branch: feature/merged", r.stdout)
        self.assertIn("KEEP 1 unique commits: feature/unique", r.stdout)
        self.assertIn("KEEP open PR: feature/in-pr", r.stdout)
        self.assertIn("KEEP open PR: docs/used-base", r.stdout)
        self.assertIn("KEEP protected: feature/protected", r.stdout)
        self.assertIn("NO_CHANGES", r.stdout)
        self.assertNotIn("--method DELETE", log)

    def test_apply_without_repo_fails_before_network(self):
        r, log = self.run_script("--apply")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("--apply requires --repo", r.stderr)
        self.assertEqual(log, "")

    def test_apply_is_blocked_without_interactive_tty(self):
        r, log = self.run_script("--repo", "mason82-dotcom/SkyHub-Next", "--apply")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("Interactive terminal required", r.stderr)
        self.assertNotIn("--method DELETE", log)

    def test_invalid_repo_is_rejected_before_network(self):
        r, log = self.run_script("--repo", "mason82-dotcom/../SkyHub-Next")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("Invalid repo", r.stderr)
        self.assertEqual(log, "")


if __name__ == "__main__":
    unittest.main()
