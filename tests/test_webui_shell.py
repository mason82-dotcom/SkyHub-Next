"""scripts/webui-shell.py: the shared app bar in frontend/public is up to date and the generator is idempotent."""
from pathlib import Path
import importlib.util
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/webui-shell.py"
spec = importlib.util.spec_from_file_location("webui_shell", SCRIPT)
shell = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shell)


class WebuiShellTest(unittest.TestCase):
    def test_pages_match_generator(self):
        r = subprocess.run([sys.executable, str(SCRIPT), "--check"], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_render_is_idempotent(self):
        for page in shell.PAGES:
            src = (shell.ROOT / page).read_text(encoding="utf-8")
            self.assertEqual(shell.render(src, page), src, page)

    def test_every_nav_target_is_a_page_and_marked_once(self):
        hrefs = [h for _, links in shell.NAV for h, _ in links]
        self.assertEqual(len(hrefs), len(set(hrefs)))
        for page, (_, current) in shell.PAGES.items():
            self.assertIn(current, hrefs, page)
            self.assertEqual(shell.appbar(current).count('aria-current="page"'), 1, page)
        self.assertNotIn("pilot-login.html", shell.PAGES, "Pilot 2 WebView keeps its compact frame")


if __name__ == "__main__":
    unittest.main()
