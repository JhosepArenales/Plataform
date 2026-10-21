#!/usr/bin/env bash
# Mac / Linux: ./iniciar-consola.sh
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Instala Node.js LTS desde https://nodejs.org"; exit 1; }
[ -z "$N8N_URL" ] && read -rp "URL de tu n8n: " N8N_URL
[ -z "$EMI_SECRET" ] && read -rsp "Secreto del webhook: " EMI_SECRET && echo
export N8N_URL EMI_SECRET
( sleep 2; (open http://localhost:8765 2>/dev/null || xdg-open http://localhost:8765 2>/dev/null) ) &
node tools/dev-server.js
