#!/usr/bin/env python3
"""Inspect/reconcile MinIO ROOT credentials from local AeroNexusAdvanced .env.

No environment file, password, fingerprint or key value is printed.
The default action is read-only. Only explicitly requested import writes.
Never use S3 READ-ONLY client credentials as the MinIO server's root keys.
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import time

BASE = Path.home() / "Projekte" / "AeroNexusAdvanced"
TARGET = Path.home() / ".config" / "skyhub" / "minio-shared.env"
NAMES = ("MINIO_ROOT_USER", "MINIO_ROOT_PASSWORD")
CANDIDATES = (
    ".env", "cloud-server/.env", "cloud-server/edge/.env",
    "cloud-server/cloud/.env", "edge/.env", "cloud/.env",
)
KEY_PATTERN = re.compile(r"[A-Za-z_][A-Za-z_0-9]*\Z")
PLACEHOLDER = re.compile(r"\$\{|^\$\(", re.ASCII)


class ConfigurationError(Exception):
    pass


def read_dotenv(path: Path) -> dict[str, str]:
    if path.is_symlink() or not path.is_file():
        raise ConfigurationError("Source must be a regular non-symlink .env file")
    if path.stat().st_mode & stat.S_IROTH:
        raise ConfigurationError("Source .env is world-readable; restrict its permissions locally")
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            continue
        key, val = line.split("=", 1)
        key = key.strip()
        if not KEY_PATTERN.fullmatch(key):
            continue
        if key in values:
            raise ConfigurationError("Repeated environment key: " + key)
        val = val.strip()
        if len(val) >= 2 and val[0] in {"'", '"'} and val[-1] == val[0]:
            val = val[1:-1]
        elif " #" in val:
            val = val.split(" #", 1)[0].rstrip()
        values[key] = val
    return values


def root_values(path: Path) -> dict[str, str]:
    env = read_dotenv(path)
    if any(not env.get(name) for name in NAMES):
        raise ConfigurationError(
            "The selected .env lacks MINIO_ROOT_USER or MINIO_ROOT_PASSWORD; "
            "AERONEXUS_MINIO_ACCESS_KEY/SECRET_KEY are S3 client keys, not root credentials"
        )
    root = {name: env[name] for name in NAMES}
    if any(PLACEHOLDER.search(value) for value in root.values()):
        raise ConfigurationError("Source .env contains unresolved credential interpolation")
    if any("\x00" in value or "\r" in value or "\n" in value
           for value in root.values()):
        raise ConfigurationError("Source .env contains unsupported control characters")
    return root


def find_sources() -> list[Path]:
    # Do not recurse into git worktrees, node_modules or .venv.
    return [BASE / relative for relative in CANDIDATES
            if (BASE / relative).is_file() and not (BASE / relative).is_symlink()]


def choose_source(explicit: Path | None) -> tuple[Path, dict[str, str]]:
    if explicit:
        path = explicit.expanduser().absolute()
        return path, root_values(path)
    matching: list[tuple[Path, dict[str, str]]] = []
    for path in find_sources():
        try:
            matching.append((path, root_values(path)))
        except ConfigurationError:
            continue
    if len(matching) != 1:
        raise ConfigurationError(
            f"Expected exactly one AeroNexusAdvanced .env with valid MinIO root keys, "
            f"found {len(matching)}. Run locate and pass the exact path with --source."
        )
    return matching[0]


def current_values() -> dict[str, str]:
    if TARGET.is_symlink() or not TARGET.is_file():
        raise ConfigurationError(
            "Private SkyHub MinIO env file missing; previous move/export must succeed"
        )
    if TARGET.stat().st_mode & 0o077:
        raise ConfigurationError("Private SkyHub MinIO env file permissions must be 0600")
    return read_dotenv(TARGET)


def assert_minio_stopped() -> None:
    # A changed root credential must never be injected into a running MinIO.
    daemon = subprocess.run(["docker", "info", "--format", "{{.ServerVersion}}"],
                            capture_output=True, text=True, check=False)
    if daemon.returncode != 0:
        raise ConfigurationError("Cannot verify Docker daemon state; credentials left unchanged")
    for name in ("aeronexusadvanced-cloud-minio-1",
                 "aeronexus-edge-minio-1", "skyhub-shared-minio"):
        proc = subprocess.run(
            ["docker", "inspect", "--format", "{{.State.Running}}", name],
            text=True, capture_output=True, check=False
        )
        if proc.returncode == 0 and proc.stdout.strip() == "true":
            raise ConfigurationError("Stop and review running MinIO before credential change: " + name)
        if proc.returncode not in (0, 1):
            raise ConfigurationError("Docker inspection failed for " + name)


def write_exclusive(path: Path, body: str) -> None:
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def make_env(values: dict[str, str]) -> str:
    for key, value in values.items():
        if not KEY_PATTERN.fullmatch(key) or any(x in value for x in ("\r", "\n", "\x00")):
            raise ConfigurationError("Invalid existing MinIO env key/value")
    return "".join(f"{k}={v}\n" for k, v in sorted(values.items()))


def import_from_project(source: Path, desired: dict[str, str],
                        accept_difference: bool) -> str:
    current = current_values()
    same = all(current.get(k) == v for k, v in desired.items())
    if same:
        return "MATCH: AeroNexusAdvanced root credentials already in SkyHub private env. No changes."
    if not accept_difference:
        raise ConfigurationError(
            "CREDENTIALS DIFFER; import blocked. Review intended root identity. "
            "To back up and replace, explicitly add --accept-different."
        )
    assert_minio_stopped()
    merged = current.copy()
    merged.update(desired)
    body = make_env(merged)
    # Keep existing local env under an additional timestamped, private backup.
    # This does not copy MinIO data; a few bytes of credentials are backed up.
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    backup = TARGET.with_name(TARGET.name + ".before-aeronexusadvanced-" + stamp)
    if TARGET.parent.is_symlink():
        raise ConfigurationError("Private credentials directory must not be a symlink")
    before = TARGET.read_text(encoding="utf-8")
    write_exclusive(backup, before)
    temporary = TARGET.with_name(TARGET.name + ".incoming-" + str(os.getpid()))
    try:
        write_exclusive(temporary, body)
        os.replace(temporary, TARGET)
    finally:
        temporary.unlink(missing_ok=True)
    return (
        "UPDATED: SkyHub MinIO private env now uses AeroNexusAdvanced root keys. "
        "Previous credentials saved privately at " + str(backup)
        + " (0600). No credentials printed."
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Use AeroNexusAdvanced local .env as MinIO credential source, without exposing values")
    parser.add_argument("mode", nargs="?", default="locate",
                        choices=("locate", "check", "import"))
    parser.add_argument("--source", type=Path,
                        help="Explicit local AeroNexusAdvanced .env file; never paste its content")
    parser.add_argument("--require-match", action="store_true",
                        help="For check only: fail unless project and SkyHub root credentials match")
    parser.add_argument("--accept-different", action="store_true",
                        help="For import only: back up and replace differing MINIO_ROOT credentials")
    args = parser.parse_args()
    try:
        if args.mode == "locate":
            print("Candidate AeroNexusAdvanced .env paths (file names only):")
            for path in find_sources():
                try:
                    keys = read_dotenv(path)
                    status = "ROOT keys present" if all(keys.get(x) for x in NAMES) else "no root pair"
                except ConfigurationError as exc:
                    status = "unusable (" + str(exc) + ")"
                print(f"  {path}: {status}")
            print("No passwords or values printed. No files changed.")
            return 0
        source, desired = choose_source(args.source)
        current = current_values()
        same = all(current.get(k) == value for k, value in desired.items())
        print("Source file: " + str(source))
        print("Source MINIO_ROOT_USER/PASSWORD: present (values hidden)")
        print("Comparison with existing SkyHub private env: " + ("MATCH" if same else "DIFFER"))
        if args.mode == "check":
            print("Read-only; no secrets, files or Docker containers changed.")
            return 0 if same or not args.require_match else 2
        print(import_from_project(source, desired, args.accept_different))
        return 0
    except (ConfigurationError, OSError, UnicodeError) as exc:
        # Avoid printing file content, Docker JSON, shell commands or secrets.
        print("ERROR: " + str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
