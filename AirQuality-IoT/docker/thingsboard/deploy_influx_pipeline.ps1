# Setup script to link existing InfluxDB, generate write token, start influx-writer, and upgrade Root Rule Chain
$ErrorActionPreference = "Continue"

Write-Host "=== 1. Dam bao InfluxDB ket noi voi Docker network cua ThingsBoard ==="
docker network connect airquality-iot_default influxdb 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Host "[OK] Da ket noi influxdb vao network airquality-iot_default"
} else {
    Write-Host "[INFO] InfluxDB da o trong network airquality-iot_default (bo qua)"
}

Write-Host "`n=== 2. Tao bucket 'airquality' neu chua co ==="
docker exec influxdb influx bucket create -n airquality -o ctu-iot -t ctu_iot_token_2026_secret_key 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "[OK] Da tao bucket airquality"
} else {
    Write-Host "[INFO] Bucket airquality da ton tai"
}

Write-Host "`n=== 3. Tao InfluxDB write-only token cho bucket airquality ==="
$env:INFLUX_URL = "http://127.0.0.1:8086"
$env:INFLUXDB_ADMIN_TOKEN = "ctu_iot_token_2026_secret_key"
$env:INFLUXDB_ORG = "ctu-iot"
$env:INFLUXDB_BUCKET = "airquality"

$output = node create_influx_write_token.mjs 2>&1
Write-Host $output

# Token la dong cuoi cung in ra sau khi bo cac dong mo ta
$lines = ($output -split "`n") | Where-Object { $_.Trim() -ne "" }
$writeToken = $lines[-1].Trim()
if (-not $writeToken -or $writeToken.Length -lt 10) {
    Write-Host "[WARN] Khong lay duoc write token, su dung admin token lam fallback..."
    $writeToken = "ctu_iot_token_2026_secret_key"
}

# Cap nhat vao file .env
$envContent = Get-Content .env
$envContent = $envContent | Where-Object { $_ -notmatch "^INFLUXDB_WRITE_TOKEN=" }
$envContent += "INFLUXDB_WRITE_TOKEN=$writeToken"
$envContent | Set-Content .env
Write-Host "[OK] Da cap nhat INFLUXDB_WRITE_TOKEN vao .env"

Write-Host "`n=== 4. Khoi dong dich vu influx-writer ==="
docker compose -p airquality-iot --profile influx up -d influx-writer

Write-Host "`n=== 5. Sao luu va Update Root Rule Chain tren ThingsBoard ==="
$env:TB_URL = "http://127.0.0.1:8080"
$env:TB_USERNAME = "tenant@thingsboard.org"
$env:TB_PASSWORD = "tenant"
$env:WRITER_API_TOKEN = "writer_secret_api_token_2026"
$env:RULE_CHAIN_BACKUP = "root_rule_chain_backup_before_influx.json"

Write-Host "--- Backup hien tai ---"
node upgrade_root_rule_chain.mjs --backup-only

Write-Host "--- Apply 2 nhanh raw & processed ---"
node upgrade_root_rule_chain.mjs --apply

Write-Host "`n=== HOAN TAT! DANG KIEM TRA HEALTHCHECK ==="
docker compose -p airquality-iot ps influx-writer
