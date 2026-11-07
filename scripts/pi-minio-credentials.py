#!/usr/bin/env python3
"""Safely prepare local MinIO env_file from the retired AeroNexus container.

check (default) prints ONLY environment variable names, never values.
export writes a 0600 local file; nothing is published or changed in Docker.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import subprocess
import sys

ORIGINAL = "aeronexusadvanced-cloud-minio-1"
ENV_NAME = "minio-shared.env"
ROOT_KEYS = ("MINIO_ROOT_USER", "MINIO_ROOT_PASSWORD")
UNSAFE_ENV_KEYS = {
    "MINIO_ROOT_USER_FILE", "MINIO_ROOT_PASSWORD_FILE",
    "MINIO_ACCESS_KEY", "MINIO_SECRET_KEY",
    "MINIO_CONFIG_ENV_FILE", "MINIO_SERVER_URL", "MINIO_BROWSER_REDIRECT_URL",
    "MINIO_DOMAIN", "MINIO_VOLUMES",
}
UNSAFE_PREFIXES = ("MINIO_KMS_", "MINIO_SSE_", "MINIO_IDENTITY_",
                   "MINIO_ETCD_", "MINIO_DISTRIBUTED_", "MINIO_STORAGE_CLASS_")


def parse_env(entries: list[str]) -> dict[str, str]:
    values = {}
    for entry in entries:
        if "=" not in entry:
            continue
        key, value = entry.split("=", 1)
        if not key.startswith("MINIO_"):
            continue
        if not re.fullmatch(r"[A-Z][A-Z0-9_]*", key) or key in values:
            raise ValueError("Invalid or repeated MinIO env key")
        if any(c in value for c in ("\x00", "\r", "\n")):
            raise ValueError("MinIO env value contains unsupported control character")
        values[key] = value
    if any(not values.get(key) for key in ROOT_KEYS):
        raise ValueError("MinIO root credentials absent: manual offline review required")
    special = sorted(key for key in values if key in UNSAFE_ENV_KEYS
                     or key.startswith(UNSAFE_PREFIXES))
    if special:
        # Only show keys; values must remain private. These may require
        # external volumes, encryption keys or service-specific configuration.
        raise ValueError("Advanced MinIO configuration requires manual review of keys: "
                         + ", ".join(special))
    return values


def get_original_env() -> dict[str, str]:
    result = subprocess.run(
        ["docker", "inspect", ORIGINAL], check=True, capture_output=True, text=True
    )
    obj = json.loads(result.stdout)
    if len(obj) != 1:
        raise ValueError("Expected exactly one stopped legacy container")
    if (obj[0].get("State") or {}).get("Running") is not False:
        raise ValueError("Original AeroNexus MinIO must remain stopped")
    return parse_env((obj[0].get("Config") or {}).get("Env") or [])


def export_file(values: dict[str, str], destination: Path) -> None:
    parent = destination.parent
    parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    # Avoid symlink/file overwrites. O_EXCL applies to the complete path.
    if parent.is_symlink():
        raise ValueError("Private credentials directory is a symlink")
    parent.chmod(0o700)
    fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
            for key, value in sorted(values.items()):
                stream.write(f"{key}={value}\n")
            stream.flush()
            os.fsync(stream.fileno())
    except Exception:
        destination.unlink(missing_ok=True)
        raise


def main() -> int:
    mode = sys.argv[1] if len(sys.argv) > 1 else "check"
    if len(sys.argv) > 2 or mode not in {"check", "export"}:
        print("Usage: python3 scripts/pi-minio-credentials.py [check|export]",
              file=sys.stderr)
        return 2
    try:
        values = get_original_env()
        keys = ", ".join(sorted(values))
        if mode == "check":
            print("Original MinIO environment keys (not values): " + keys)
            print("Existing root credentials: present. Nothing exported.")
        else:
            destination = Path.home() / ".config" / "skyhub" / ENV_NAME
            export_file(values, destination)
            print(f"Private MinIO env file created at {destination} (0600).")
            print("Credentials and values not printed. Do NOT commit this file.")
        return 0
    except (ValueError, OSError, subprocess.CalledProcessError,
            json.JSONDecodeError) as exc:
        # Do not leak raw stdout/stderr from docker or credential-bearing values.
        if isinstance(exc, ValueError):
            print("ERROR: " + str(exc), file=sys.stderr)
        else:
            print(f"ERROR: credential preparation failed ({type(exc).__name__}).",
                  file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
