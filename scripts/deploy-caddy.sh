#!/usr/bin/env bash
set -euo pipefail

SRC_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)/build"
DEST_DIR="/var/www/remon-web"
OWNER="caddy:caddy"

if [[ "$(uname -s)" != "Linux" ]]; then
    echo "deploy-caddy: must run on Linux." >&2
    exit 1
fi

if [[ $EUID -ne 0 ]]; then
    echo "deploy-caddy: must run as root (sudo)." >&2
    exit 1
fi

# Guard against obviously dangerous destination paths
case "$DEST_DIR" in
    "" | / | /bin | /boot | /etc | /home | /lib* | /root | /tmp | /usr | /var)
        echo "deploy-caddy: refusing dangerous destination: $DEST_DIR" >&2
        exit 1
        ;;
esac

if [ ! -d "$SRC_DIR" ]; then
    echo "deploy-caddy: build directory missing at $SRC_DIR — run \`bun run build\` first." >&2
    exit 1
fi

if [ ! -d "$DEST_DIR" ]; then
    echo "deploy-caddy: destination $DEST_DIR does not exist — check Caddy config." >&2
    exit 1
fi

if ! command -v rsync &>/dev/null; then
    echo "deploy-caddy: rsync not found — apt install rsync" >&2
    exit 1
fi

rsync -a --delete "$SRC_DIR/" "$DEST_DIR/"
chown -R "$OWNER" "$DEST_DIR"

echo "deploy-caddy: synced $SRC_DIR → $DEST_DIR (owner=$OWNER)"
