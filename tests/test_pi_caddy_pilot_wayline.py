"""Static checks for scripts/pi-caddy-pilot-wayline.sh (print mode on a synthetic Caddyfile; no Docker, no Pi)."""
from pathlib import Path
import os
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/pi-caddy-pilot-wayline.sh"
FIXTURE = """{
\tadmin 127.0.0.1:2019
}

rpi5.fritz.box {
    @skyhub_pilot {
        path /pilot-login /api/pilot/*
    }
    handle @skyhub_pilot {
        reverse_proxy 127.0.0.1:4001
    }

    # SKYHUB-NEXT PILOT MEDIA ROUTES
    @skyhub_pilot_media {
        path /storage/api/v1/workspaces/* /media/api/v1/workspaces/*
    }
    handle @skyhub_pilot_media {
        reverse_proxy 127.0.0.1:4001
    }

\ttls internal
\tlog {
\t\tformat filter {
\t\t    wrap json
\t\t    fields {
\t\t        request>headers>X-Auth-Token delete
\t\t        request>headers>Authorization delete
\t\t    }
\t\t}
\t}
\treverse_proxy 127.0.0.1:11000
}

rpi5.fritz.box:9446, 192.168.178.63:9446 {
\ttls internal
\t@upload {
\t\tremote_ip 192.168.178.0/24
\t\tmethod PUT POST HEAD
\t\tpath /dji-cloud/*
\t}
\thandle @upload {
\t\treverse_proxy 127.0.0.1:4002
\t}
\thandle {
\t\trespond "Forbidden" 403
\t}
}
"""


def render(text: str) -> subprocess.CompletedProcess:
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "Caddyfile"
        path.write_text(text, encoding="utf-8")
        env = {**os.environ, "SKYHUB_CADDYFILE": str(path)}
        return subprocess.run(["bash", str(SCRIPT), "print"], env=env, capture_output=True, text=True)


class PilotWaylineCaddyTest(unittest.TestCase):
    def test_routes_are_added_inside_the_right_sites(self):
        result = render(FIXTURE)
        self.assertEqual(result.returncode, 0, result.stderr)
        out = result.stdout
        main = out[out.index("rpi5.fritz.box {"):out.index("rpi5.fritz.box:9446")]
        s3 = out[out.index("rpi5.fritz.box:9446"):]
        self.assertIn("path /wayline/api/v1/workspaces/*", main)
        self.assertLess(main.index("@skyhub_pilot_media"), main.index("@skyhub_pilot_wayline"))
        self.assertLess(main.index("@skyhub_pilot_wayline"), main.index("reverse_proxy 127.0.0.1:11000"))
        # Download only from the home LAN, read methods only, before the catch-all 403.
        block = s3[s3.index("@wayline_download {"):s3.index("handle @wayline_download")]
        self.assertIn("remote_ip 192.168.178.0/24", block)
        self.assertIn("method GET HEAD", block)
        self.assertIn("path /skyhub-wpml/missions/*", block)
        self.assertLess(s3.index("handle @wayline_download"), s3.index('respond "Forbidden" 403'))
        self.assertNotIn("PUT", block)
        # The 302 Location header (presigned link) is dropped from the main site's access log.
        self.assertIn("resp_headers>Location delete", main)
        self.assertEqual(out.count("resp_headers>Location delete"), 1)
        # Everything else stays byte-identical.
        removed = [l for l in FIXTURE.split("\n") if l not in out.split("\n")]
        self.assertEqual(removed, [])

    def test_idempotent_and_requires_media_routes(self):
        once = render(FIXTURE).stdout
        again = render(once)
        self.assertNotEqual(again.returncode, 0)
        self.assertIn("Already applied", again.stderr)
        without_media = FIXTURE.replace("handle @skyhub_pilot_media {", "handle @other {")
        result = render(without_media)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("pi-caddy-pilot-media.sh", result.stderr)

    def test_partial_state_gets_only_the_missing_log_filter(self):
        full = render(FIXTURE).stdout
        old = full.replace("\t\t        resp_headers>Location delete\n", "")
        self.assertNotIn("resp_headers>Location", old)
        result = render(old)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, full)

    def test_apply_validates_and_restores(self):
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertIn("caddy validate", source)
        self.assertIn('restore "$backup"', source)
        self.assertIn("before-skyhub-wayline-", source)


if __name__ == "__main__":
    unittest.main()
