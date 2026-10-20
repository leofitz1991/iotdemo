#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
q="${1:-SELECT * FROM environment ORDER BY time DESC LIMIT 10}"
curl -fsSG 'http://127.0.0.1:8181/api/v3/query_sql'   -H "Authorization: Bearer ${INFLUX_TOKEN}"   -H 'Accept: application/json'   --data-urlencode 'db=iot_environment'   --data-urlencode "q=$q"
echo
