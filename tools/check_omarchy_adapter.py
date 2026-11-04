"""Offline checks: python3 tools/check_omarchy_adapter.py."""

import contextlib
import io
import json
from pathlib import Path
import subprocess
import types
import unittest
from unittest.mock import patch

source = Path(__file__).with_name("codexbar-with-plugins")
adapter = types.ModuleType("codexbar_adapter")
exec(compile(source.read_text(), str(source), "exec"), adapter.__dict__)


def result(value, code=0):
    return subprocess.CompletedProcess([], code, json.dumps(value), "")


class AdapterChecks(unittest.TestCase):
    def merge(self, builtin, plugin, discovery=None):
        output = io.StringIO()
        with patch.object(adapter, "enabled_plugins", **(
                {"side_effect": discovery} if discovery else {"return_value": ["shanhe-cli"]})), \
                patch.object(adapter, "cli", return_value=builtin), \
                patch.object(adapter, "fetch_plugin", return_value=plugin), \
                contextlib.redirect_stdout(output):
            code = adapter.usage(["usage", "--format", "json"])
        return code, json.loads(output.getvalue())

    def test_only_enabled_installed_plugins(self):
        inventory = result([{"provider": "codex", "enabled": True},
                            {"provider": "shanhe-cli", "enabled": True},
                            {"provider": "disabled", "enabled": False}])
        installed = subprocess.CompletedProcess([], 0, "shanhe-cli\tShanhe CLI\t/path.js\ndisabled\tDisabled\t/other.js\n", "")
        with patch.object(adapter, "cli", side_effect=[inventory, installed]):
            self.assertEqual(adapter.enabled_plugins(), ["shanhe-cli"])

    def test_builtin_and_plugin_usage_are_merged(self):
        plugin = {"provider": "shanhe-cli", "source": "plugin", "usage": {"primary": {"usedPercent": 4}}}
        code, records = self.merge(result([{"provider": "codex", "usage": {}}]), plugin)
        self.assertEqual(code, 0)
        self.assertEqual([r["provider"] for r in records], ["codex", "shanhe-cli"])
        self.assertEqual(records[1], plugin)

    def test_failed_plugin_keeps_codex(self):
        code, records = self.merge(result([{"provider": "codex", "usage": {}}]), adapter.failure("shanhe-cli", "failed"))
        self.assertEqual(code, 1)
        self.assertEqual(records[0]["provider"], "codex")
        self.assertIn("error", records[1])

    def test_failed_builtin_keeps_plugin(self):
        code, records = self.merge(subprocess.CompletedProcess([], 1, "bad output", ""), {"provider": "shanhe-cli", "usage": {}})
        self.assertEqual(code, 1)
        self.assertEqual(records[1]["provider"], "shanhe-cli")

    def test_future_cli_plugins_are_not_duplicated(self):
        builtin = {"provider": "shanhe-cli", "usage": {"primary": {"usedPercent": 1}}}
        code, records = self.merge(result([builtin]), adapter.failure("shanhe-cli", "redundant fetch failed"))
        self.assertEqual(code, 0)
        self.assertEqual(records, [builtin])

    def test_discovery_failure_keeps_builtin(self):
        code, records = self.merge(result([{"provider": "codex"}]), {}, ValueError("bad metadata"))
        self.assertEqual(code, 1)
        self.assertEqual(records[0]["provider"], "codex")

    def test_plugin_errors_do_not_echo_stderr(self):
        for response in (result({}, 1), subprocess.CompletedProcess([], 1, "", "session=do-not-print")):
            with patch.object(adapter, "cli", return_value=response):
                record = adapter.fetch_plugin("shanhe-cli")
                self.assertIn("error", record)
                self.assertNotIn("do-not-print", json.dumps(record))

    def test_plugin_snapshot_becomes_usage_envelope(self):
        snapshot = {"primary": {"usedPercent": 0}, "secondary": {"usedPercent": 3}, "details": []}
        with patch.object(adapter, "cli", return_value=result(snapshot)):
            self.assertEqual(adapter.fetch_plugin("shanhe-cli"), {
                "provider": "shanhe-cli", "source": "plugin", "usage": snapshot})

    def test_cost_and_explicit_selection_pass_through(self):
        for args in (["--version"], ["cost", "--format", "json"],
                     ["usage", "--format", "json", "--provider", "codex"]):
            with patch.object(adapter.os, "execvp") as execute:
                adapter.main(args)
            execute.assert_called_once_with("codexbar", ["codexbar", *args])


if __name__ == "__main__":
    unittest.main()
