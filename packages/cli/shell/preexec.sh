# usage: eval "$(datacloak install-shell --shell bash)"
_datacloak_preexec() {
  [ -n "$DATACLOAK_OFF" ] && return 0
  printf '%s' "$BASH_COMMAND" | datacloak scan --quiet 2>/dev/null
  if [ $? -eq 2 ]; then
    echo "datacloak: secret in command line — blocked" >&2
    return 1
  fi
}
# DEBUG trap fires before each command; self-wire so eval alone enables blocking
trap '_datacloak_preexec "$BASH_COMMAND"' DEBUG
