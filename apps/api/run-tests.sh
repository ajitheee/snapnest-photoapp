#!/usr/bin/env sh
# Run memories tests inside the photoapp-api container.
# Usage: ./run-tests.sh [unit|e2e|all]

set -e

MODE=${1:-all}
JEST=/tmp/test-deps/node_modules/.bin/jest
NODE_OPTS="NODE_PATH=/tmp/test-deps/node_modules:/app/node_modules"

install_deps() {
  if [ ! -f "$JEST" ]; then
    echo "Installing test tools to /tmp/test-deps..."
    docker exec photoapp-api npm install --prefix /tmp/test-deps \
      jest@29 ts-jest@29 @types/jest typescript ts-node \
      supertest @types/supertest --legacy-peer-deps --silent
  fi
}

sync_files() {
  docker exec photoapp-api mkdir -p /app/src/memories /app/src/prisma
  docker cp "$(dirname "$0")/src/memories/memories.service.ts" photoapp-api:/app/src/memories/
  docker cp "$(dirname "$0")/src/memories/memories.service.spec.ts" photoapp-api:/app/src/memories/
  docker cp "$(dirname "$0")/src/memories/memories.e2e.spec.ts" photoapp-api:/app/src/memories/
  docker cp "$(dirname "$0")/src/prisma" photoapp-api:/app/src/
  docker cp "$(dirname "$0")/tsconfig.json" photoapp-api:/app/tsconfig.json
  docker cp "$(dirname "$0")/jest.config.js" photoapp-api:/app/jest.config.js
  docker cp "$(dirname "$0")/jest.e2e.config.js" photoapp-api:/app/jest.e2e.config.js
}

run_unit() {
  echo "\n=== Unit Tests ==="
  docker exec photoapp-api sh -c \
    "cd /app && $NODE_OPTS $JEST --config jest.config.js --testPathPattern=memories.service.spec --no-coverage --verbose"
}

run_e2e() {
  echo "\n=== E2E Tests (live API) ==="
  docker exec photoapp-api sh -c \
    "cd /app && $NODE_OPTS $JEST --config jest.e2e.config.js --testPathPattern=memories.e2e.spec --no-coverage --verbose"
}

install_deps
sync_files

case "$MODE" in
  unit) run_unit ;;
  e2e)  run_e2e ;;
  *)    run_unit && run_e2e ;;
esac
