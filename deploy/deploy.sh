#!/usr/bin/env bash
# Quantum Rarity: one-command deploy for a fresh Ubuntu/Debian VPS.
#
#   1. Point your domain's A record at this server's IP (see README).
#   2. Copy this folder to the server, then run as root:
#        bash deploy/deploy.sh yourdomain.xyz
#
# Installs Caddy (automatic HTTPS from Let's Encrypt), copies the site to
# /var/www/quantum-rarity and serves it. Safe to run again to update.
set -euo pipefail

DOMAIN="${1:-}"
if [[ -z "$DOMAIN" ]]; then echo "usage: bash deploy/deploy.sh yourdomain.xyz"; exit 1; fi
if [[ $EUID -ne 0 ]]; then echo "run as root (or with sudo)"; exit 1; fi
HERE="$(cd "$(dirname "$0")/.." && pwd)"
WEB=/var/www/quantum-rarity

if ! command -v caddy >/dev/null; then
  echo "→ installing Caddy"
  apt-get update -y
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi

echo "→ copying site to $WEB"
mkdir -p "$WEB"
rm -rf "$WEB"/{index.html,web,src,data,assets}
cp -r "$HERE"/index.html "$HERE"/web "$HERE"/src "$HERE"/data "$HERE"/assets "$WEB"/
# link previews need an absolute image URL
sed -i "s#content=\"assets/og.png\"#content=\"https://$DOMAIN/assets/og.png\"#" "$WEB/index.html"
chown -R caddy:caddy "$WEB" 2>/dev/null || true

echo "→ writing Caddy config for $DOMAIN"
sed "s/{DOMAIN}/$DOMAIN/g" "$HERE/deploy/Caddyfile" > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile
systemctl enable caddy >/dev/null 2>&1 || true
systemctl reload caddy || systemctl restart caddy

if command -v ufw >/dev/null && ufw status | grep -q active; then ufw allow 80/tcp; ufw allow 443/tcp; fi
echo
echo "✓ live at https://$DOMAIN  (the first visit can take ~30 s while the HTTPS certificate is issued)"
