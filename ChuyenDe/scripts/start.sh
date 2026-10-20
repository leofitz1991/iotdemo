#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
command -v docker >/dev/null || { echo 'Docker required'; exit 1; }
docker compose version >/dev/null || { echo 'Docker Compose v2 required'; exit 1; }
if [[ ! -f .env ]]; then
  printf 'DEVICES=10\nINTERVAL=5\nGRAFANA_PASSWORD=admin123\n' > .env
fi
# Start only InfluxDB first; other services require the token.
docker compose up -d influxdb3
printf 'Waiting for InfluxDB 3 Core...\n'
ready=0
for i in $(seq 1 90); do
  status=$(curl -s -o /dev/null -w '%{http_code}' \
    http://127.0.0.1:8181/health || true)

  if [[ "$status" == "200" || "$status" == "401" ]]; then
    ready=1
    break
  fi

  sleep 2
done

if [[ $ready -eq 0 ]]; then echo 'InfluxDB startup timed out; docker compose logs influxdb3'; exit 1; fi
if ! grep -q '^INFLUX_TOKEN=' .env; then
  echo 'Creating initial operator token...'
  token=$(docker compose exec -T influxdb3 influxdb3 create token --admin --format text | tr -d '\r' | grep -oE 'apiv3_[A-Za-z0-9_-]+' | head -n1 || true)
  if [[ -z "$token" ]]; then
    echo 'Token creation failed (possibly existing data volume). See README recovery steps.'; exit 1
  fi
  printf 'INFLUX_TOKEN=%s\n' "$token" >> .env
  chmod 600 .env
fi
set -a; source .env; set +a
if ! docker compose exec -T influxdb3 influxdb3 show databases --token "$INFLUX_TOKEN" 2>/dev/null | grep -q 'iot_environment'; then
  docker compose exec -T influxdb3 influxdb3 create database --token "$INFLUX_TOKEN" iot_environment
fi
docker compose up -d --build
printf '\nReady. Grafana: http://localhost:3000  (admin / value of GRAFANA_PASSWORD)\nInfluxDB API: http://localhost:8181\n'
