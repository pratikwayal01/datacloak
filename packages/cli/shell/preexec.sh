# usage: eval "$(datacloak install-shell --shell bash)"
_datacloak_preexec() {
  [ -n "$DATACLOAK_OFF" ] && return 0
  printf '%s' "$BASH_COMMAND" | datacloak scan --quiet 2>/dev/null || {
    echo "datacloak: secret in command line — blocked" >&2
    return 1
  }
}
