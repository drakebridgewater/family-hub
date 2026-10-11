#!/bin/sh
set -e
# First run: drop the example services.yaml into the (empty) config volume.
if [ ! -f /app/config/services.yaml ] && [ -w /app/config ]; then
  cp /app/config.default/services.yaml /app/config/services.yaml
  echo "[family-hub] Wrote example /app/config/services.yaml - edit it to list your services."
fi
exec "$@"
