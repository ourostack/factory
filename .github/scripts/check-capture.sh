#!/usr/bin/env bash
# check-capture.sh <base-sha> <head-sha>
#
# The store's own rule on capture records, run after Desk's validator passes
# a pull request. It checks keys and values both, so the store never relies
# on Desk main's validator alone: a record that Desk checks less strictly
# still cannot carry a path, a date, a name or any other free text into this
# public repository. A capture record holds
# per-host session counts from one machine: no date, no path, no name.
#
# Every capture/ file the pull request adds or modifies is read as a Git
# blob and parsed as data with jq; nothing from it is executed or echoed.
# A deletion is not checked (Desk's validator allows it only to a
# maintainer). Output is one stable code per line and nothing else; the
# exit status is 0 when every added or modified record passes, and when the
# pull request touches no capture/ file.
#   capture_path              the path is not capture/<16 lowercase hex>.json
#   capture_size              the file is over 2,048 bytes
#   capture_keys              not a JSON object with exactly the known keys
#                             (schema, basis, hosts and an optional loop), an
#                             unknown host, or a host entry whose keys are not
#                             exactly the eight counts and flags
#   capture_values            a value is not what its key allows: schema and
#                             basis are their constants; every count is a
#                             whole number from 0 to 1,000,000 (not_in_a_desk
#                             may be null); unverified is true or false; the
#                             buckets add up to on_disk; the loop slot is
#                             loop_slot_v1 (v is 1, only its known keys, each
#                             count a whole number or null, headless a plain
#                             code or null, at most 512 bytes)
#   capture_many              more than one capture file in one pull request
#   capture_check_unavailable the two commits or a blob could not be read
set -uo pipefail

base="${1:-}"
head="${2:-}"
if ! printf '%s' "$base" | grep -Eq '^[0-9a-f]{40}$' || ! printf '%s' "$head" | grep -Eq '^[0-9a-f]{40}$'; then
  echo capture_check_unavailable
  exit 1
fi

if ! changed=$(git diff --no-renames --name-only --diff-filter=AM -z "$base...$head" -- capture/ 2> /dev/null | tr '\0' '\n'); then
  echo capture_check_unavailable
  exit 1
fi

codes=""
count=0
while IFS= read -r path; do
  [ -n "$path" ] || continue
  count=$((count + 1))
  if ! printf '%s' "$path" | grep -Eq '^capture/[0-9a-f]{16}\.json$'; then
    codes+=$'capture_path\n'
    continue
  fi
  if ! size=$(git cat-file -s "$head:$path" 2> /dev/null); then
    codes+=$'capture_check_unavailable\n'
    continue
  fi
  if [ "$size" -gt 2048 ]; then
    codes+=$'capture_size\n'
    continue
  fi
  if ! blob=$(git cat-file blob "$head:$path" 2> /dev/null); then
    codes+=$'capture_check_unavailable\n'
    continue
  fi
  if ! jq -e '
    type == "object"
    and (keys - ["basis", "hosts", "loop", "schema"] | length == 0)
    and has("schema") and has("basis") and has("hosts")
    and (.hosts | type == "object")
    and (.hosts | keys - ["claude-code", "codex-cli", "copilot-cli"] | length == 0)
    and ([.hosts[] | type == "object" and (keys == ["derived", "frozen", "held", "not_in_a_desk", "not_seen", "on_disk", "pending", "unverified"])] | all)
    and ((has("loop") | not) or (.loop | type == "object"))
  ' <<< "$blob" > /dev/null 2>&1; then
    codes+=$'capture_keys\n'
    continue
  fi
  if ! jq -e '
    def count: type == "number" and . == floor and . >= 0 and . <= 1000000;
    def code: type == "string" and test("^[a-z_]{1,32}$");
    .schema == "desk.factory.capture/1"
    and .basis == "still_on_disk"
    and ([.hosts[] |
      (.on_disk, .derived, .held, .frozen, .pending, .not_seen | count)
      and (.not_in_a_desk == null or (.not_in_a_desk | count))
      and (.unverified | type == "boolean")
      and (.derived + .held + .frozen + .pending + .not_seen + (.not_in_a_desk // 0) == .on_disk)
    ] | all)
    and ((has("loop") | not) or (.loop |
      .v == 1
      and (keys - ["v", "improvement_open", "improvement_claimed", "improvement_shipped", "improvement_verifying", "oldest_open_age_days", "closed_confirmed_month", "closed_unverified_month", "loop_alarms_open", "steps_stale", "headless"] | length == 0)
      and ([to_entries[] | select(.key != "v") |
        if .key == "headless" then (.value == null or (.value | code)) else (.value == null or (.value | count)) end
      ] | all)
      and (tojson | utf8bytelength <= 512)
    ))
  ' <<< "$blob" > /dev/null 2>&1; then
    codes+=$'capture_values\n'
  fi
done <<< "$changed"

if [ "$count" -gt 1 ]; then
  codes+=$'capture_many\n'
fi

if [ -n "$codes" ]; then
  printf '%s' "$codes" | sort -u
  exit 1
fi
exit 0
