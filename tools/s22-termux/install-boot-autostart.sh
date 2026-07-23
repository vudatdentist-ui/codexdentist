#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

TERMUX_PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PREFIX="$TERMUX_PREFIX"

TERMUX_HOME="$(cd "$TERMUX_PREFIX/../home" && pwd)"
BOOT_DIR="$TERMUX_HOME/.termux/boot"
BOOT_SCRIPT="$BOOT_DIR/start-codexmed"

mkdir -p "$BOOT_DIR"
cat > "$BOOT_SCRIPT" <<'EOF'
#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PREFIX
export PATH="$PREFIX/bin:$PATH"
HOME="${HOME:-/data/data/com.termux/files/home}"
APP_DIR="$HOME/codexmed-os"
LOG="$HOME/s22-autostart.log"

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG"
}

termux-wake-lock >/dev/null 2>&1 || true
log "CodexMed boot autostart begin."

sleep "${CODEXMED_BOOT_DELAY_SECONDS:-30}"

if [ -x "$APP_DIR/tools/s22-termux/keep-codexmed-alive.sh" ]; then
  bash "$APP_DIR/tools/s22-termux/keep-codexmed-alive.sh" >> "$LOG" 2>&1 || true
else
  log "CodexMed OS watchdog launcher missing."
fi

if [ -x "$APP_DIR/tools/s22-termux/keep-named-tunnel-alive.sh" ]; then
  bash "$APP_DIR/tools/s22-termux/keep-named-tunnel-alive.sh" >> "$LOG" 2>&1 || true
else
  log "Cloudflare named tunnel watchdog launcher missing."
fi

log "CodexMed boot autostart finished."
EOF

chmod 700 "$BOOT_SCRIPT"

cat <<EOF
Termux:Boot autostart script installed:
  $BOOT_SCRIPT

Install and open Termux:Boot once, then Android can run this script after reboot.
EOF
