#!/usr/bin/env bash
set -euo pipefail

UNIT="hkerbot-api-http.service"
HEALTH_URL="http://127.0.0.1:8771/healthz"
CMD_MARKER="/home/molt/ota-computer-use-gateway/dist/index.js --config /home/molt/ota-computer-use-gateway/config/hkerbot.api.local.yaml"

main() {
  print_status
  verify_health
  verify_systemd_owner
}

print_status() {
  systemctl --user --no-pager status "$UNIT" | sed -n '1,80p'
}

verify_health() {
  curl -fsS "$HEALTH_URL" | python3 -m json.tool
}

verify_systemd_owner() {
  local pid
  pid="$(pgrep -x node -a | grep "$CMD_MARKER" | awk '{print $1}' | head -1 || true)"
  if [[ -z "$pid" ]]; then
    echo "ERROR: no HKerBot API gateway process found" >&2
    return 1
  fi
  if ! grep -q "$UNIT" "/proc/$pid/cgroup"; then
    echo "ERROR: HKerBot API gateway is not owned by $UNIT" >&2
    cat "/proc/$pid/cgroup" >&2
    return 1
  fi
  echo "OK: HKerBot API gateway is owned by $UNIT (pid=$pid)"
}

main "$@"
