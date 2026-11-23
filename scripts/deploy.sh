#!/usr/bin/env bash
set -euo pipefail

IMAGE="$1"
NAME=bookstore

docker pull "$IMAGE"
docker rm -f "$NAME" 2>/dev/null || true
docker run -d --name "$NAME" --restart unless-stopped \
  -p 80:3000 \
  -v bookstore_data:/app/data \
  "$IMAGE"

for i in $(seq 1 10); do
  if curl -fsS http://localhost/health > /dev/null; then
    echo "Deployed $IMAGE"
    docker image prune -f
    exit 0
  fi
  sleep 3
done

echo "App did not respond after deploy"
docker logs --tail 50 "$NAME"
exit 1