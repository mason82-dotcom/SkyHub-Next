#!/usr/bin/env python3
"""Read-only inventory of existing MinIO Docker containers and storage mounts.

No container start/stop; no secrets, image configuration, or environment output.
Mount Source paths can reveal usernames or directory names; redact before sharing.
"""
from __future__ import annotations

from collections import defaultdict
import json
import subprocess
import sys


def identify_minio(line: str) -> bool:
    # docker ps format: id TAB name TAB image; do not resolve arbitrary image configs.
    columns = line.split("\t")
    return len(columns) == 3 and ("minio" in columns[1].lower()
                                  or "minio" in columns[2].lower()
                                  or "aistor" in columns[2].lower())


def records(inspects: list[dict]) -> list[dict]:
    results = []
    for container in inspects:
        name = str(container.get("Name", "")).lstrip("/")
        config = container.get("Config") or {}
        state = container.get("State") or {}
        labels = config.get("Labels") or {}
        mounts = []
        for mount in container.get("Mounts") or []:
            entry = {
                "type": mount.get("Type", "unknown"),
                "destination": mount.get("Destination", "unknown"),
                "source": mount.get("Source") or mount.get("Name") or "(unknown)",
                "rw": bool(mount.get("RW", False)),
            }
            mounts.append(entry)
        results.append({
            "name": name,
            "image": config.get("Image", "(unknown)"),
            "state": state.get("Status", "(unknown)"),
            "exit_code": state.get("ExitCode"),
            "project": labels.get("com.docker.compose.project", "(none)"),
            "service": labels.get("com.docker.compose.service", "(none)"),
            "mounts": mounts,
            "networks": sorted((container.get("NetworkSettings") or {}).get("Networks") or {}),
        })
    return sorted(results, key=lambda row: row["name"])


def report(rows: list[dict]) -> str:
    out = ["=== MinIO storage inventory (read-only) ==="]
    if not rows:
        return "\n".join(out + ["No MinIO Docker container found."])
    sources: dict[str, list[str]] = defaultdict(list)
    for item in rows:
        out.extend([
            "",
            f"Container: {item['name']}",
            f"  State: {item['state']} (exit={item['exit_code']})",
            f"  Image: {item['image']}",
            f"  Compose: {item['project']}/{item['service']}",
            f"  Networks: {', '.join(item['networks']) or '(none)'}",
        ])
        if not item["mounts"]:
            out.append("  Mounts: NONE (inspect before any startup)")
        for m in item["mounts"]:
            out.append(f"  Mount: {m['type']} {m['source']} -> {m['destination']} "
                       f"({'rw' if m['rw'] else 'ro'})")
            # Ignore one-shot minio-init sidecars in server-versus-server
            # overlap detection; an init container may intentionally use the
            # same volume as its *stopped* storage service.
            if "minio-init" not in item["name"].lower():
                sources[m["source"]].append(item["name"])
    overlaps = {src: sorted(set(names)) for src, names in sources.items()
                if len(set(names)) > 1 and src != "(unknown)"}
    if overlaps:
        out.append("")
        out.append("CAUTION: storage source used by multiple containers:")
        for src, names in sorted(overlaps.items()):
            out.append(f"  {src}: {', '.join(names)}")
        out.append("Do NOT start two MinIO servers against a shared data source.")
    stopped = [r["name"] for r in rows
               if "minio-init" not in r["name"].lower() and r["state"] != "running"]
    if stopped:
        out.append("")
        out.append(f"INFO: {len(stopped)} non-running MinIO container(s); adopt requires a running, reviewed server.")
    out.extend([
        "",
        "No container, volume, bucket or Docker network was modified.",
        "Mount source paths may reveal private directory names; redact before sharing."
    ])
    return "\n".join(out)


def main() -> int:
    if len(sys.argv) > 1:
        print("Usage: python3 scripts/pi-minio-audit.py", file=sys.stderr)
        return 2
    try:
        inventory = subprocess.run(
            ["docker", "ps", "-a", "--format", "{{.ID}}\t{{.Names}}\t{{.Image}}"],
            capture_output=True, text=True, check=True,
        )
        ids = [line.split("\t", 1)[0] for line in inventory.stdout.splitlines()
               if identify_minio(line)]
        if not ids:
            print(report([]))
            return 0
        inspected = subprocess.run(
            ["docker", "inspect", *ids],
            capture_output=True, text=True, check=True,
        )
        parsed = json.loads(inspected.stdout)
        print(report(records(parsed)))
        return 0
    except (subprocess.CalledProcessError, OSError, ValueError) as exc:
        # Deliberately avoid printing potentially sensitive raw Docker responses.
        print(f"ERROR: MinIO inventory failed ({type(exc).__name__}); no Docker changes made.",
              file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
