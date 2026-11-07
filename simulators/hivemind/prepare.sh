#!/usr/bin/env bash
# Prepare the separately licensed upstream simulator from an immutable commit.
# Not executed by CI or SkyHub's normal startup.
set -euo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SOURCE="$HERE/.upstream"
CACHE="$HERE/.m2-cache"
REPOSITORY="https://github.com/cdmiltd/hivemind-simulator.git"
REVISION="be269a3458ff6b2602d9a4dae14df278946cf7c1"

command -v git >/dev/null || { echo "git is required" >&2; exit 2; }
command -v docker >/dev/null || { echo "docker is required" >&2; exit 2; }
if [[ -e "$SOURCE" && ! -d "$SOURCE/.git" ]]; then
  echo "Refusing to replace a non-Git upstream directory: $SOURCE" >&2
  exit 2
fi
if [[ ! -d "$SOURCE/.git" ]]; then
  mkdir -p -- "$SOURCE"
  git -C "$SOURCE" init -q
  git -C "$SOURCE" remote add origin "$REPOSITORY"
fi
if [[ "$(git -C "$SOURCE" remote get-url origin)" != "$REPOSITORY" ]]; then
  echo "Unexpected upstream remote; refusing to continue" >&2
  exit 2
fi
current="$(git -C "$SOURCE" rev-parse HEAD 2>/dev/null || true)"
if [[ "$current" != "$REVISION" ]]; then
  if [[ -n "$(git -C "$SOURCE" status --porcelain)" ]]; then
    echo "Upstream directory has local changes; refusing to overwrite" >&2
    exit 2
  fi
  git -C "$SOURCE" fetch --depth 1 origin "$REVISION"
  git -C "$SOURCE" -c advice.detachedHead=false checkout --detach -q FETCH_HEAD
fi
if [[ "$(git -C "$SOURCE" rev-parse HEAD)" != "$REVISION" ]]; then
  echo "Upstream commit mismatch" >&2
  exit 2
fi
if [[ ! -f "$SOURCE/lib/dji-cloud-api-sdk-1.16.1.3.jar" ]]; then
  echo "Required bundled upstream SDK not found; refusing to build" >&2
  exit 2
fi

# Compile in an ephemeral Java 21 / Maven container; no local JDK required.
mkdir -p -- "$CACHE"
docker --host unix:///var/run/docker.sock run --rm \
  --user "$(id -u):$(id -g)" \
  --volume "$SOURCE:/workspace" \
  --volume "$CACHE:/m2" \
  --workdir /workspace \
  --env MAVEN_OPTS="-Xmx768m" \
  maven:3.9.11-eclipse-temurin-21 \
  mvn -B -ntp -Dmaven.repo.local=/m2 -DskipTests package

test -s "$SOURCE/target/dji-dock-simulator-1.4.10.jar" || {
  echo "Expected 1.4.10 jar missing after build" >&2
  exit 2
}
echo "Pinned HiveMind simulator v1.4.10 prepared. No SkyHub service was started."
