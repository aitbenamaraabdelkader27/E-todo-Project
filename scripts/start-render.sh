#!/bin/sh
set -eu

: "${DATABASE_URL:?Set DATABASE_URL to the pooled application connection}"
: "${DIRECT_URL:?Set DIRECT_URL to the direct migration connection}"

# Give only the migration process the direct connection as its datasource.
DATABASE_URL="$DIRECT_URL" npm run db:migrate
unset DIRECT_URL
export NODE_ENV=production
exec node dist-server/index.js
