# usage: datacloak install-shell --shell fish | source
function datacloak_preexec --on-event fish_preexec
  if set -q DATACLOAK_OFF; return 0; end
  printf '%s' $argv[1] | datacloak scan --quiet 2>/dev/null
  if test $status -eq 2
    echo "datacloak: secret in command line — blocked" >&2
    return 1
  end
end
