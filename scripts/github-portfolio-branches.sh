#!/usr/bin/env bash
# Inventory remote GitHub branches. Read-only by default; no Pi/runtime mutation.
set -euo pipefail
owner=mason82-dotcom
repo=''
mode=dry-run
die(){ printf 'ERROR: %s\n' "$*" >&2; exit 1; }
usage(){ printf 'Usage: bash %s [--owner OWNER | --repo OWNER/REPO] [--dry-run | --apply]\n' "$0"; }
while (($#)); do
  case "$1" in
    --owner) (($#>=2)) || die 'Owner required'; owner="$2"; shift 2 ;;
    --repo) (($#>=2)) || die 'Repository required'; repo="$2"; shift 2 ;;
    --dry-run) mode=dry-run; shift ;;
    --apply) mode=apply; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "Unknown option: $1" ;;
  esac
done
[[ "$owner" =~ ^[A-Za-z0-9-]{1,39}$ ]] || die 'Invalid owner'
[[ -z "$repo" || "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || die 'Invalid repo'
[[ "$mode" != apply || -n "$repo" ]] || die '--apply requires --repo (portfolio deletion forbidden)'
command -v gh >/dev/null || die 'Install GitHub CLI (gh)'
gh auth status -h github.com >/dev/null 2>&1 || die 'Not authenticated with gh'
if [[ -n "$repo" ]]; then
  repositories="$repo"
else
  repositories="$(gh repo list "$owner" --limit 500 --json nameWithOwner,isArchived \
    --jq '.[] | select(.isArchived == false) | .nameWithOwner')"
  [[ -n "$repositories" ]] || die 'No repositories or GitHub error'
fi

inspect_repo(){
  local full="$1" default branches open_refs name protected ahead head_sha
  local -a candidates=() sha_before=()
  default="$(gh api "repos/$full" --jq '.default_branch')"
  if [[ -z "$default" || "$default" == null ]]; then
    printf 'SKIP empty repository: %s\n' "$full"; return
  fi
  branches="$(gh api --paginate "repos/$full/branches?per_page=100" \
    --jq '.[] | [.name, (.protected|tostring)] | @tsv')"
  # Protect both heads AND bases of all currently open PRs.
  open_refs="$(gh api --paginate "repos/$full/pulls?state=open&per_page=100" \
    --jq '.[] | .head.ref, .base.ref')"
  printf '\nRepository %s | default=%s | mode=%s\n' "$full" "$default" "$mode"
  while IFS=$'\t' read -r name protected; do
    [[ -n "$name" && "$name" != "$default" ]] || continue
    [[ "$protected" != true ]] || { printf 'KEEP protected: %s\n' "$name"; continue; }
    case "$name" in
      feat/*|feature/*|fix/*|chore/*|docs/*|test/*|research/*|experiment/*|ci/*|agent/*|codex/*) ;;
      *) printf 'KEEP other-prefix: %s\n' "$name"; continue ;;
    esac
    if grep -Fxq -- "$name" <<< "$open_refs"; then
      printf 'KEEP open PR: %s\n' "$name"; continue
    fi
    ahead="$(gh api "repos/$full/compare/$default...$name" --jq '.ahead_by')"
    [[ "$ahead" =~ ^[0-9]+$ ]] || die "Invalid ahead count for $full:$name"
    if ((ahead>0)); then printf 'KEEP %s unique commits: %s\n' "$ahead" "$name"; continue; fi
    head_sha="$(gh api "repos/$full/git/ref/heads/$name" --jq '.object.sha')"
    [[ "$head_sha" =~ ^[0-9a-f]{40}$ ]] || die "Invalid ref SHA: $full:$name"
    printf 'CANDIDATE integrated branch: %s\n' "$name"
    candidates+=("$name"); sha_before+=("$head_sha")
  done <<< "$branches"
  printf 'CANDIDATE_COUNT=%d REPO=%s\n' "${#candidates[@]}" "$full"
  if [[ "$mode" != apply || ${#candidates[@]} -eq 0 ]]; then
    printf 'NO_CHANGES: %s\n' "$full"; return
  fi
  [[ -t 0 ]] || die 'Interactive terminal required'
  local confirmation fresh_pr_refs refreshed compare_now sha_now i
  read -r -p "Type DELETE $full to delete integrated branches: " confirmation
  [[ "$confirmation" == "DELETE $full" ]] || die 'Confirmation rejected'
  for i in "${!candidates[@]}"; do
    name="${candidates[$i]}"
    fresh_pr_refs="$(gh api --paginate "repos/$full/pulls?state=open&per_page=100" \
      --jq '.[] | .head.ref, .base.ref')"
    if grep -Fxq -- "$name" <<< "$fresh_pr_refs"; then
      printf 'SKIP new PR dependency: %s\n' "$name"; continue
    fi
    refreshed="$(gh api --paginate "repos/$full/branches?per_page=100" \
      --jq '.[] | [.name, (.protected|tostring)] | @tsv')"
    if ! grep -Fxq -- "$name"$'\t'"false" <<< "$refreshed"; then
      printf 'SKIP protected or absent: %s\n' "$name"; continue
    fi
    compare_now="$(gh api "repos/$full/compare/$default...$name" --jq '.ahead_by')"
    sha_now="$(gh api "repos/$full/git/ref/heads/$name" --jq '.object.sha')"
    if [[ "$compare_now" != 0 || "$sha_now" != "${sha_before[$i]}" ]]; then
      printf 'SKIP ref changed: %s\n' "$name"; continue
    fi
    # REST deletion has no atomic ref lease; checked against current SHA immediately beforehand.
    gh api --method DELETE "repos/$full/git/refs/heads/$name" >/dev/null
    printf 'DELETED integrated remote branch: %s\n' "$name"
  done
}
while IFS= read -r item; do
  [[ -n "$item" ]] || continue
  inspect_repo "$item"
done <<< "$repositories"
