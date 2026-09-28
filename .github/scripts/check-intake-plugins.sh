#!/usr/bin/env bash
# check-intake-plugins.sh <base-sha> <head-sha>
#
# The store's own intake rule on plugin names, run after Desk's validator
# passes a data pull request. Every facts file the pull request adds or
# modifies must carry `refs.private.plugins`, which only a Desk client that
# withholds privately sourced plugin names writes, and may name only plugins
# listed in `public_plugins` in this checkout's `intake.json` (the base,
# never the candidate). A modified file is checked too, because an older
# Desk re-sends files already on main, with every plugin name, as
# modifications. Files the pull request leaves alone are not checked again.
#
# The candidate's files are read as Git blobs and parsed as data with jq;
# nothing from them is executed or echoed. Output is one stable code per
# line and nothing else; the exit status is 0 when every added or modified
# file passes.
#   private_plugins_missing  a new facts file version has no refs.private.plugins
#   plugin_not_public        a new facts file version names a plugin not listed
#   intake_config_invalid    intake.json has no valid public_plugins list
#   intake_check_unavailable the two commits or a blob could not be read
set -uo pipefail

base="${1:-}"
head="${2:-}"
if ! printf '%s' "$base" | grep -Eq '^[0-9a-f]{40}$' || ! printf '%s' "$head" | grep -Eq '^[0-9a-f]{40}$'; then
  echo intake_check_unavailable
  exit 1
fi

if ! public=$(jq -ce '.public_plugins | select(type == "array" and length > 0 and all(.[]; type == "string"))' intake.json 2> /dev/null); then
  echo intake_config_invalid
  exit 1
fi

if ! added=$(git diff --no-renames --name-only --diff-filter=AM -z "$base...$head" -- facts/ 2> /dev/null | tr '\0' '\n'); then
  echo intake_check_unavailable
  exit 1
fi

codes=""
while IFS= read -r path; do
  [ -n "$path" ] || continue
  if ! blob=$(git cat-file blob "$head:$path" 2> /dev/null); then
    codes+=$'intake_check_unavailable\n'
    continue
  fi
  if ! jq -e '(.refs.private | type) == "object" and (.refs.private | has("plugins"))' <<< "$blob" > /dev/null 2>&1; then
    codes+=$'private_plugins_missing\n'
  fi
  if ! jq -e --argjson public "$public" '(.plugins // []) | type == "array" and all(.[]; (.name | type) == "string" and (.name as $name | $public | index($name)) != null)' <<< "$blob" > /dev/null 2>&1; then
    codes+=$'plugin_not_public\n'
  fi
done <<< "$added"

if [ -n "$codes" ]; then
  printf '%s' "$codes" | sort -u
  exit 1
fi
exit 0
