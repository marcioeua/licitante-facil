#!/bin/sh
# Volumes de hospedagem (ex.: Railway) costumam ser montados como root.
# Ajusta o dono de /data e roda a aplicação como o usuário comum "node".
set -e
if [ "$(id -u)" = "0" ]; then
  mkdir -p /data/uploads
  chown -R node:node /data
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
