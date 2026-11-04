"""Offline checks for the optional importer: python3 tools/check_login.py."""

import contextlib
import http.cookiejar
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import types
import unittest
from unittest.mock import patch

source = Path(__file__).with_name("shanhe-login")
login = types.ModuleType("shanhe_login")
exec(compile(source.read_text(), str(source), "exec"), login.__dict__)


def cookie(name, domain="api.0ki.cn", path="/", expires=None, value="fixture"):
    return http.cookiejar.Cookie(
        0, name, value, None, False, domain, domain.startswith("."), domain.startswith("."),
        path, True, True, expires, expires is None, None, None, {"HttpOnly": None}, False)


class LoginChecks(unittest.TestCase):
    def test_request_cookie_scope_expiry_and_httponly(self):
        header = login.cookie_header([
            cookie("session"), cookie("expired", expires=int(time.time()) - 60),
            cookie("sibling", domain="other.0ki.cn"), cookie("lookalike", domain="api.0ki.cn.evil.test"),
            cookie("subdomain", domain="sub.api.0ki.cn"), cookie("other_path", path="/admin"),
        ])
        self.assertEqual(header, "session=fixture")
        self.assertEqual(login.cookie_header([cookie("session", domain=".api.0ki.cn")]), "session=fixture")

    def test_no_cookies_or_header_controls_fail(self):
        for cookies in ([], [cookie("expired", expires=1)], [cookie("bad", value="x\r\ny")]):
            with self.assertRaises(login.LoginError):
                login.cookie_header(cookies)

    def test_config_resolution(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            normal = home / ".config/codexbar/config.json"
            legacy = home / ".codexbar/config.json"
            self.assertEqual(login.config_path({}, home), normal)
            legacy.parent.mkdir(); legacy.write_text("{}")
            self.assertEqual(login.config_path({}, home), legacy)
            self.assertEqual(login.config_path({"XDG_CONFIG_HOME": "/xdg"}, home), Path("/xdg/codexbar/config.json"))
            self.assertEqual(login.config_path({"XDG_CONFIG_HOME": "relative"}, home), legacy)
            self.assertEqual(login.config_path({"CODEXBAR_CONFIG": "/custom.json"}, home), Path("/custom.json"))
            normal.parent.mkdir(parents=True); normal.write_text("{}")
            self.assertEqual(login.config_path({}, home), normal)

    def test_atomic_update_preserves_config_and_private_mode(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            original = {"version": 1, "future": {"keep": True}, "providers": [
                {"id": "codex", "enabled": True, "untouched": "value"},
                {"id": "shanhe-cli", "enabled": False, "pluginSettings": {"keep": "yes"},
                 "pluginSecrets": {"OTHER": "retain"}},
            ]}
            path.write_text(json.dumps(original)); path.chmod(0o644)
            login.save_cookie(path, "session=fixture")
            saved = json.loads(path.read_text())
            self.assertEqual(saved["future"], original["future"])
            self.assertEqual(saved["providers"][0], original["providers"][0])
            entry = saved["providers"][1]
            self.assertTrue(entry["enabled"])
            self.assertEqual(entry["pluginSettings"], {"keep": "yes"})
            self.assertEqual(entry["pluginSecrets"], {"OTHER": "retain", "COOKIE": "session=fixture"})
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertFalse(list(path.parent.glob(".shanhe-login-*")))

    def test_new_config_keeps_host_defaults(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "new/config.json"
            with patch.object(login, "default_config", return_value={"version": 1, "providers": [{"id": "codex"}]}):
                login.save_cookie(path, "session=fixture")
            saved = json.loads(path.read_text())
            self.assertEqual(saved["providers"][0], {"id": "codex"})
            self.assertEqual(saved["providers"][1]["id"], "shanhe-cli")

    def test_failed_publish_preserves_existing_config(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            original = '{"version":1,"providers":[]}'
            path.write_text(original)
            with patch.object(login.os, "replace", side_effect=OSError("publish failed")), self.assertRaises(OSError):
                login.save_cookie(path, "session=fixture")
            self.assertEqual(path.read_text(), original)
            self.assertFalse(list(path.parent.glob(".shanhe-login-*")))

    def test_invalid_config_remains_unchanged(self):
        cases = ["{bad json", '{"version":2}', '{"version":1,"providers":{}}',
                 '{"version":1,"providers":[{"id":"shanhe-cli","pluginSecrets":4}]}',
                 '{"version":1,"providers":[{"id":"shanhe-cli"},{"id":"shanhe-cli"}]}']
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            for raw in cases:
                path.write_text(raw)
                with self.assertRaises((login.LoginError, ValueError)):
                    login.save_cookie(path, "session=fixture")
                self.assertEqual(path.read_text(), raw)

    def test_validation_uses_host_secret_override_without_argv_cookie(self):
        result = subprocess.CompletedProcess([], 0, '{"primary":{"usedPercent":0},"secondary":{"usedPercent":1}}', "")
        with patch.object(login.subprocess, "run", return_value=result) as run:
            login.validate_cookie("session=fixture", Path("/config.json"))
        args, kwargs = run.call_args
        self.assertNotIn("session=fixture", " ".join(args[0]))
        self.assertEqual(kwargs["env"][login.SECRET_ENV], "session=fixture")
        self.assertEqual(kwargs["env"]["CODEXBAR_CONFIG"], "/config.json")

    def test_validation_failures_do_not_save_or_expose_errors(self):
        for error in (login.LoginError("会话已过期"), ValueError("session=do-not-print")):
            output, errors = io.StringIO(), io.StringIO()
            with patch.object(login, "read_cookie", return_value="session=do-not-print"), \
                    patch.object(login, "validate_cookie", side_effect=error), \
                    patch.object(login, "save_cookie") as save, \
                    contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
                self.assertEqual(login.main([]), 1)
            save.assert_not_called()
            self.assertNotIn("do-not-print", output.getvalue() + errors.getvalue())

    def test_incomplete_snapshot_rejected(self):
        for stdout in ("{}", "[]", "not json", '{"primary":{},"secondary":null}'):
            result = subprocess.CompletedProcess([], 0, stdout, "")
            with patch.object(login.subprocess, "run", return_value=result), self.assertRaises(login.LoginError):
                login.validate_cookie("session=fixture", Path("/config.json"))

    def test_profile_path_traversal_rejected(self):
        for profile in ("../Default", "..", ".", "/tmp/profile", ""):
            with self.assertRaises(login.LoginError):
                login.cookie_file("chrome", profile)


if __name__ == "__main__":
    unittest.main()
