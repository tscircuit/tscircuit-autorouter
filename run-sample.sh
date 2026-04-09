#!/usr/bin/env bash
set -euo pipefail

exec bun run scripts/run-sample.ts "$@"
