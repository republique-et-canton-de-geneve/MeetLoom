#!/usr/bin/env bash
# Local/CI smoke check. No published ports or external network access.
set -euo pipefail
image=${1:?Usage: bash scripts/verify-container.sh IMAGE}
container="meetloom-smoke-$$-$RANDOM"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT
export BOOTSTRAP_TOKEN
BOOTSTRAP_TOKEN=$(openssl rand -hex 32)
docker run --detach --name "$container" --user 1000730000:0 \
  --network none --read-only --cap-drop=ALL --security-opt no-new-privileges \
  --tmpfs /tmp --tmpfs /app/data:rw,uid=1000730000,gid=0,mode=0770 \
  --env BOOTSTRAP_TOKEN --env APP_ORIGIN=https://meetloom.invalid "$image" >/dev/null
for attempt in $(seq 1 30); do
  if docker exec "$container" node -e "fetch('http://127.0.0.1:3000/api/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    echo 'PASS: container ready with arbitrary UID, read-only root and no external network.'
    exit 0
  fi
  sleep 1
done
docker logs "$container"
exit 1
