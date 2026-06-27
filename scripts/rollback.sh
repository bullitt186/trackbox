#!/bin/sh
# Rollback trackbox to a specific version tag
# Usage: ./rollback.sh <tag>
# Example: ./rollback.sh deploy-20260627-2273884

set -e

TAG="${1:?Usage: rollback.sh <tag>}"
IMAGE="git.stahmer.net/bullitt/trackbox:${TAG}"

echo "Rolling back to ${IMAGE}..."
docker pull "${IMAGE}"
docker stop trackbox 2>/dev/null || true
docker rm trackbox 2>/dev/null || true
docker tag "${IMAGE}" git.stahmer.lan/bullitt/trackbox:latest

# Trigger Komodo redeploy
KOMODO_KEY="${KOMODO_KEY:-K-cBpECfZkKV3pzkihlvVAX9done90lwmf}"
KOMODO_SECRET="${KOMODO_SECRET:-S-QwWNkT5UeHABlvuD1M7gsH7SiIagIbo4CmG4vrfP12c}"
curl -sf -X POST "http://192.168.0.2:9120/execute" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: ${KOMODO_KEY}" \
  -H "X-Api-Secret: ${KOMODO_SECRET}" \
  -d '{"type":"DeployStack","params":{"stack":"n8n"}}'

echo "Rollback triggered. Waiting for health..."
sleep 20
curl -sf http://192.168.0.50:8900/health && echo " OK" || echo " FAILED"
