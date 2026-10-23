#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
echo '[TC01] Wait 20 seconds for ingestion...'; sleep 20
./scripts/query.sh 'SELECT COUNT(*) AS total FROM air_quality_raw'
echo '[TC02] Aggregation last hour:'
./scripts/query.sh "SELECT AVG(temperature) AS avg_temp, MIN(temperature) AS min_temp, MAX(temperature) AS max_temp FROM air_quality_raw WHERE time > now() - INTERVAL '1 hour'"
echo 'To test scale: edit DEVICES=100 or 1000 in .env, then docker compose up -d --force-recreate simulator; observe docker stats.'
