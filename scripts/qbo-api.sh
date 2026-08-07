#!/bin/bash
# qbo-api.sh -- caller for the KVM2 n8n "QBO Live Proxy" rail.
#
# Mirrors scripts/mercury-api.sh (amos repo). This NEVER talks to Intuit
# directly: Intuit's production keys require a static whitelisted egress IP
# (72.60.226.53, KVM2), which this machine does not have. The rail on KVM2 makes
# the actual Intuit call from the whitelisted IP; this script only POSTs to the
# rail webhook with the shared x-proxy-secret.
#
# Use it to seed/re-run the rail by hand during setup (the daily pull is on an
# n8n schedule, not here). See docs/qbo/kvm2-rail.md.
#
# Env required (from mate-onboarding/.env.local or the shell):
#   QBO_RAIL_EXCHANGE_URL   e.g. https://n8n.auto-mate.business/webhook/qbo-exchange
#   QBO_RAIL_PULL_URL       e.g. https://n8n.auto-mate.business/webhook/qbo-pull   (optional)
#   QBO_PROXY_SECRET        shared secret, sent as x-proxy-secret
#
# Usage:
#   ./qbo-api.sh exchange '{"sessionId":"<uuid>","realmId":"<realm>","code":"<auth-code>","environment":"sandbox"}'
#   ./qbo-api.sh pull      '{"sessionId":"<uuid>"}'      # trigger a manual pull (if a pull webhook is wired)

set -euo pipefail

ACTION="${1:-}"
PAYLOAD="${2:-{}}"

if [[ -z "$ACTION" ]]; then
  echo "Usage: $0 <exchange|pull> '<json-payload>'" >&2
  exit 1
fi

if [[ -z "${QBO_PROXY_SECRET:-}" ]]; then
  echo "Error: QBO_PROXY_SECRET is not set (see mate-onboarding/.env.local)." >&2
  exit 1
fi

case "$ACTION" in
  exchange) URL="${QBO_RAIL_EXCHANGE_URL:-}" ;;
  pull)     URL="${QBO_RAIL_PULL_URL:-}" ;;
  *) echo "Unknown action '$ACTION' (expected exchange|pull)" >&2; exit 1 ;;
esac

if [[ -z "$URL" ]]; then
  echo "Error: rail URL for '$ACTION' is not set." >&2
  exit 1
fi

curl -sS -X POST "$URL" \
  -H "Content-Type: application/json" \
  -H "x-proxy-secret: $QBO_PROXY_SECRET" \
  --data "$PAYLOAD"
