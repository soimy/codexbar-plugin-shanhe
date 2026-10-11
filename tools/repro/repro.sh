#!/bin/sh
# Run a plugin through CodexBar's real plugin runtime (see README.md in this directory).
#
#   CODEXBAR_SOURCE=/path/to/CodexBar tools/repro/repro.sh [plugin.js] [mode] [body.html] [flags]
#
# SwiftPM sandboxes manifest evaluation, which cannot nest inside an outer sandbox (CI, agent
# sandboxes), so the sandbox is disabled here. The only package involved is the CodexBar checkout.
set -eu

directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

exec swift run --package-path "$directory" --disable-sandbox repro "$@"
