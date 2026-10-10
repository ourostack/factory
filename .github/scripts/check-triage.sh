#!/usr/bin/env bash
# Trusted base code only. Third argument comes from the workflow's independent
# PR actor/head and repository permission API reads, never candidate metadata.
set -uo pipefail
if ! node "$(dirname "$0")/triage-values.mjs" --check-change "${1:-}" "${2:-}" "${3:-unknown}"; then
  # A missing/crashing Node checker must hold intake, not reject its contributor.
  # Valid stable refusal codes are printed by the checker itself.
  exit 1
fi
