# GitHub repository branch hygiene

This is a repository **metadata** check, not a deployment or Pi clean-up. It never touches local worktrees, MinIO volumes, DJI files, flight plans or any Docker resources.

## Safe default — read-only portfolio check

```bash
bash scripts/github-portfolio-branches.sh
# Or inspect one repository:
bash scripts/github-portfolio-branches.sh --repo mason82-dotcom/SkyHub-Next
```

Requirements: GitHub CLI `gh`, authenticated with `gh auth login`, and permission to read the selected repos. The helper fetches live metadata instead of using a stale branch list. It prints KEEP for protected/default/open-PR-dependent branches and branches with commits not in `main`. CANDIDATE means no unique commits against the *actual default branch* at the time of inspection. No files or branches are removed in this mode.

## Explicit deletion — one repository only

```bash
bash scripts/github-portfolio-branches.sh --repo mason82-dotcom/SkyHub-Next --apply
```

The script requires a terminal and exact confirmation `DELETE mason82-dotcom/SkyHub-Next`; there is **no** portfolio-wide apply. It restricts candidates to well-known temporary branch prefixes, requires zero unique commits in a GitHub ancestry compare, excludes all open PR heads *and bases*, excludes protected/default branches, and rechecks PR references, protected status, the branch commit SHA and ancestry immediately before deleting each remote ref.

GitHub REST ref deletion does not offer an atomic compare-and-delete lease. A concurrent push between final validation and deletion is still theoretically possible. Run it only during a quiet maintenance window and review candidates; keep repository backups if necessary. A squash merge often leaves unique old commits, so that branch deliberately remains KEEP until reviewed separately. The helper does not close PRs or archive/delete repositories.

## PR review gate

For each open PR, compare its head to the current default branch. Only PRs where the head is an ancestor of the default branch (`ahead_by=0`) can be closed automatically without losing unique commits. A unique-commit count above zero means **retain** even if the branch is old or the PR appears redundant. Chained PR bases require extra care: closing the lower PR does not delete its branch.

## Repository classification

Empty placeholder repositories, abandoned experiments, unmerged feature stacks, and deployed systems require separate human decisions. The GitHub connector does not support deleting or archiving repositories or deleting remote branches in this chat; this CLI is an explicit operator-controlled option.

Never use `git clean -fdx` or `docker volume prune` to tidy the production Raspberry Pi. Existing environment files and databases may be ignored yet critical.
