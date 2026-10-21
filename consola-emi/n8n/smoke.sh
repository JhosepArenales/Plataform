#!/usr/bin/env bash
# Prueba de humo contra los webhooks reales de n8n (después de importar y activar los flujos).
# Uso:  N8N_URL=https://n8n.tu-dominio.com EMI_SECRET=xxxx ./n8n/smoke.sh  [documento] [operacion] [empresa]
set -euo pipefail
: "${N8N_URL:?Define N8N_URL}"; : "${EMI_SECRET:?Define EMI_SECRET}"
DOC="${1:-79378202}"; OP="${2:-6543}"; EMP="${3:-900333444}"
call() { echo "── $1"; curl -sS -m 20 -X POST "$N8N_URL/webhook/emi/$1" -H "Content-Type: application/json" -H "X-Emi-Secret: $EMI_SECRET" -d "$2"; echo; }
call client-lookup "{\"documento\":\"$DOC\"}"
call operation-lookup "{\"numero_operacion\":\"$OP\",\"empresa\":\"$EMP\"}"
echo "── sin secreto (debe responder 403)"; curl -sS -m 20 -o /dev/null -w "%{http_code}\n" -X POST "$N8N_URL/webhook/emi/client-lookup" -H "Content-Type: application/json" -d '{}'
echo "(escalate no se prueba aquí para no crear tickets reales; pruébalo desde el Playground en modo Remoto)"
