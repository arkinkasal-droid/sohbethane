#!/bin/sh
cd "$(dirname "$0")"
if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared kurulu degil."
  echo "  macOS : brew install cloudflared"
  echo "  Linux : https://github.com/cloudflare/cloudflared/releases/latest"
  exit 1
fi
echo "Tunel aciliyor. Cikan https://...trycloudflare.com adresini davet ekranina yapistirin."
exec cloudflared tunnel --url http://localhost:3000
