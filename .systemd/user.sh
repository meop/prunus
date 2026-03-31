#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRUNUS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DENO_BIN="$(which deno)"
SERVICE_NAME="prunus"
SERVICE_TEMPLATE="$SCRIPT_DIR/prunus.service"
SERVICE_DIR="$HOME/.config/systemd/user"
SERVICE_FILE="$SERVICE_DIR/$SERVICE_NAME.service"

cmd="${1:-}"

case "$cmd" in
  up)
    mkdir -p "$SERVICE_DIR"
    sed "s|{PRUNUS_DIR}|$PRUNUS_DIR|g; s|{DENO_BIN}|$DENO_BIN|g" "$SERVICE_TEMPLATE" > "$SERVICE_FILE"
    sudo loginctl enable-linger "$USER"
    systemctl --user daemon-reload
    systemctl --user enable --now "$SERVICE_NAME"
    echo "$SERVICE_NAME service installed and started"
    echo "  template: $SERVICE_TEMPLATE"
    echo "  status: systemctl --user status $SERVICE_NAME"
    echo "  logs:   journalctl --user -u $SERVICE_NAME -f"
    ;;
  down)
    systemctl --user disable --now "$SERVICE_NAME" || true
    rm -f "$SERVICE_FILE"
    systemctl --user daemon-reload
    echo "$SERVICE_NAME service stopped and removed"
    ;;
  *)
    echo "usage: $0 <up|down>"
    exit 1
    ;;
esac
