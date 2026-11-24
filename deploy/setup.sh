#!/usr/bin/env bash
# One-time / idempotent Linux server setup.
# Usage: sudo XMAS_USER=youruser XMAS_CERT_SAN="IP:127.0.0.1,DNS:localhost" bash setup.sh
# Expects unpacked release at /tmp/xmas-tree-release (web/, server/, deploy/).
set -euo pipefail
SRC=${XMAS_SRC:-/tmp/xmas-tree-release}
DST=${XMAS_DST:-/var/www/xmas-tree}
OWNER=${XMAS_USER:-www-data}
CERT_SAN=${XMAS_CERT_SAN:-IP:127.0.0.1,DNS:localhost}

mkdir -p "$DST/data/photos" "$DST/data/rooms"
rm -rf "$DST/web" "$DST/server"
cp -r "$SRC/web" "$SRC/server" "$DST/"
rm -f "$DST/server/test_app.py"
chown -R "$OWNER:$OWNER" "$DST"
chmod -R a+rX "$DST"

# Admin moderation token (preserved across upgrades)
if [ ! -f /etc/xmas-tree.env ]; then
  TOKEN=$(python3 -c 'import secrets; print(secrets.token_urlsafe(9))')
  echo "XMAS_ADMIN_TOKEN=$TOKEN" > /etc/xmas-tree.env
  chmod 600 /etc/xmas-tree.env
fi

# Self-signed certificate for direct HTTPS (port 8444)
if [ ! -f /etc/nginx/ssl/xmas-tree.crt ]; then
  mkdir -p /etc/nginx/ssl
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
    -keyout /etc/nginx/ssl/xmas-tree.key -out /etc/nginx/ssl/xmas-tree.crt \
    -subj "/CN=xmas-tree" \
    -addext "subjectAltName=$CERT_SAN" 2>/dev/null
  chmod 600 /etc/nginx/ssl/xmas-tree.key
fi

sed "s/__XMAS_USER__/$OWNER/g" "$SRC/deploy/xmas-tree.service" > /etc/systemd/system/xmas-tree.service
cp "$SRC/deploy/nginx-xmas-tree.conf" /etc/nginx/sites-available/xmas-tree
ln -sf /etc/nginx/sites-available/xmas-tree /etc/nginx/sites-enabled/xmas-tree

systemctl daemon-reload
systemctl enable xmas-tree >/dev/null 2>&1
systemctl restart xmas-tree
nginx -t
systemctl reload nginx

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 8444/tcp >/dev/null
fi

sleep 1
systemctl is-active xmas-tree
echo "DEPLOY_OK"
