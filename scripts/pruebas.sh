#!/bin/sh
# Batería completa de pruebas de SUSP.
#
# Corre dentro de un contenedor de Node, en la red de compose, para poder
# alcanzar Postgres y la app de referencia. Se invoca con `make test-all`.
#
# Ninguna prueba necesita una API key de Anthropic: el proveedor determinístico
# es el que usan todas.

set -e

VERDE='\033[32m'
ROJO='\033[31m'
GRIS='\033[90m'
FIN='\033[0m'

fallos=0

titulo() {
  printf "\n${GRIS}────────────────────────────────────────────────${FIN}\n"
  printf "  %s\n" "$1"
  printf "${GRIS}────────────────────────────────────────────────${FIN}\n"
}

correr() {
  nombre="$1"
  shift
  if "$@" > /tmp/salida.log 2>&1; then
    printf "  ${VERDE}✓${FIN} %s\n" "$nombre"
    grep -E "^(Tests:|# pass|Tests  )" /tmp/salida.log | sed 's/^/      /' || true
  else
    printf "  ${ROJO}✗${FIN} %s\n" "$nombre"
    tail -25 /tmp/salida.log | sed 's/^/      /'
    fallos=$((fallos + 1))
  fi
}

titulo "Chequeo de tipos"
for p in packages/usi-spec packages/usi-server packages/sdk packages/usi-conformance packages/personas apps/engine apps/dashboard; do
  correr "$p" sh -c "cd /app/$p && npx tsc --noEmit"
done

titulo "Pruebas unitarias"
correr "motor" sh -c "cd /app/apps/engine && npx jest"
correr "personas" sh -c "cd /app/packages/personas && node --test src/index.spec.ts"
correr "dashboard (renderizado)" sh -c "cd /app/apps/dashboard && npx vitest run"

titulo "Pruebas e2e (contra PostgreSQL real)"
correr "API del motor" sh -c "cd /app/apps/engine && \
  DATABASE_URL='postgresql://susp:susp_local_dev@postgres:5432/susp_test' \
  JWT_SECRET='secreto-de-pruebas-suficientemente-largo-1234567890' \
  npx jest --config ./test/jest-e2e.json --runInBand --forceExit"

titulo "Conformidad USI"
correr "app de referencia" sh -c "cd /app/packages/usi-conformance && \
  NO_COLOR=1 node src/cli.ts --url http://reference-app:55704/usi/v1 --token reference-token-dev"

printf "\n${GRIS}────────────────────────────────────────────────${FIN}\n"
if [ "$fallos" -eq 0 ]; then
  printf "  ${VERDE}Todo en verde.${FIN}\n\n"
  exit 0
fi
printf "  ${ROJO}%s bloque(s) con fallos.${FIN}\n\n" "$fallos"
exit 1
