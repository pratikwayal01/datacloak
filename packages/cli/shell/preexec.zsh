# usage: eval "$(datacloak install-shell --shell zsh)"
datacloak_preexec() {
  [ -n "$DATACLOAK_OFF" ] && return 0
  printf '%s' "$1" | datacloak scan --quiet 2>/dev/null
  if [ $? -eq 2 ]; then
    echo "datacloak: secret in command line — blocked" >&2
    return 1
  fi
}
autoload -Uz add-zsh-hook
add-zsh-hook preexec datacloak_preexec
