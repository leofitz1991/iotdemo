#!/usr/bin/env bash
# =============================================================================
# benchmark.sh — Kịch bản thử nghiệm IoT Pipeline (InfluxDB 3 Core)
# Môn: CTH619 | Stack: MQTT → Telegraf → InfluxDB 3 → Grafana
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

# ── Màu sắc ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'
PASS="${GREEN}[PASS]${RESET}"; FAIL="${RED}[FAIL]${RESET}"; INFO="${CYAN}[INFO]${RESET}"
WARN="${YELLOW}[WARN]${RESET}"

# ── Load token ────────────────────────────────────────────────────────────────
set -a; source .env; set +a
INFLUX_URL="http://127.0.0.1:8181"
GRAFANA_URL="http://127.0.0.1:3000"
GRAFANA_USER="${GF_SECURITY_ADMIN_USER:-admin}"
GRAFANA_PASS="${GF_SECURITY_ADMIN_PASSWORD:-admin123}"
DB="iot_environment"
MEASUREMENT="air_quality_raw"

# ── Kết quả tổng hợp ─────────────────────────────────────────────────────────
TOTAL=0; PASSED=0; FAILED=0
declare -A RESULTS  # tên test → PASS/FAIL
declare -A TIMINGS  # tên test → thời gian (ms)

pass() { ((PASSED++)) || true; ((TOTAL++)) || true; RESULTS["$1"]="PASS"; echo -e "${PASS} $1 ${YELLOW}(${2:-}ms)${RESET}"; }
fail() { ((FAILED++)) || true; ((TOTAL++)) || true; RESULTS["$1"]="FAIL"; echo -e "${FAIL} $1 — $2"; }

query_influx() {
  curl -sf -X POST "${INFLUX_URL}/api/v3/query_sql" \
    -H "Authorization: Bearer ${INFLUX_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"db\":\"${DB}\",\"q\":\"$1\"}" 2>/dev/null
}

ms_now() { date +%s%3N; }

separator() { echo -e "\n${BOLD}${CYAN}═══════════════════════════════════════════════════${RESET}"; }

# =============================================================================
# PHẦN 1: HEALTH CHECK — Kiểm tra tất cả services
# =============================================================================
separator
echo -e "${BOLD}📋 PHẦN 1: HEALTH CHECK — Kiểm tra services${RESET}"
separator

# TC-01: InfluxDB health
echo -e "\n${INFO} TC-01: InfluxDB 3 Core health..."
t0=$(ms_now)
http_code=$(curl -s -o /dev/null -w "%{http_code}" "${INFLUX_URL}/health" 2>/dev/null || echo "000")
t1=$(ms_now); dt=$((t1-t0))
# 200 = OK không auth | 401 = OK có auth | khác = lỗi thực sự
if [[ "$http_code" == "200" || "$http_code" == "401" ]]; then
  pass "TC-01 InfluxDB health" "$dt"
  [[ "$http_code" == "401" ]] && echo -e "   ${YELLOW}→ Auth enabled (401 = bình thường)${RESET}"
else
  fail "TC-01 InfluxDB health" "HTTP $http_code"
fi

# TC-02: MQTT port open
echo -e "${INFO} TC-02: MQTT broker port 1883..."
t0=$(ms_now)
if nc -z localhost 1883 2>/dev/null; then
  t1=$(ms_now); dt=$((t1-t0))
  pass "TC-02 MQTT port 1883" "$dt"
else
  fail "TC-02 MQTT port 1883" "Connection refused"
fi

# TC-03: Grafana health
echo -e "${INFO} TC-03: Grafana health..."
t0=$(ms_now)
http_code=$(curl -s -o /dev/null -w "%{http_code}" "${GRAFANA_URL}/api/health" 2>/dev/null || echo "000")
t1=$(ms_now); dt=$((t1-t0))
if [[ "$http_code" == "200" ]]; then
  pass "TC-03 Grafana health" "$dt"
else
  fail "TC-03 Grafana health" "HTTP $http_code"
fi

# TC-04: Telegraf container running
echo -e "${INFO} TC-04: Telegraf container running..."
t0=$(ms_now)
tele_status=$(docker compose ps telegraf --format json 2>/dev/null | python3 -c "import sys,json; data=sys.stdin.read(); objs=json.loads(data) if data.strip().startswith('[') else [json.loads(l) for l in data.strip().splitlines() if l]; print(objs[0].get('State','unknown'))" 2>/dev/null || echo "unknown")
t1=$(ms_now); dt=$((t1-t0))
if [[ "$tele_status" == "running" ]]; then
  pass "TC-04 Telegraf running" "$dt"
else
  fail "TC-04 Telegraf running" "State=$tele_status"
fi

# =============================================================================
# PHẦN 2: PIPELINE END-TO-END — MQTT → InfluxDB
# =============================================================================
separator
echo -e "${BOLD}🔄 PHẦN 2: END-TO-END PIPELINE TEST${RESET}"
separator

# TC-05: Kiểm tra có data trong InfluxDB không
echo -e "\n${INFO} TC-05: Kiểm tra data trong InfluxDB..."
t0=$(ms_now)
count_resp=$(query_influx "SELECT COUNT(*) AS total FROM ${MEASUREMENT}" || echo "")
t1=$(ms_now); dt=$((t1-t0))
count=$(echo "$count_resp" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['total'] if d else 0)" 2>/dev/null || echo "0")
if [[ "$count" -gt 0 ]]; then
  pass "TC-05 Data tồn tại trong InfluxDB" "$dt"
  echo -e "   ${YELLOW}→ Tổng records: ${count}${RESET}"
else
  fail "TC-05 Data tồn tại trong InfluxDB" "count=0, pipeline có thể bị lỗi"
fi

# TC-06: Kiểm tra data mới nhất (trong 5 phút gần đây)
echo -e "${INFO} TC-06: Kiểm tra data gần đây (≤5 phút)..."
t0=$(ms_now)
recent=$(query_influx "SELECT COUNT(*) AS cnt FROM ${MEASUREMENT} WHERE time > now() - INTERVAL '5 minutes'" || echo "")
t1=$(ms_now); dt=$((t1-t0))
rcnt=$(echo "$recent" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['cnt'] if d else 0)" 2>/dev/null || echo "0")
if [[ "$rcnt" -gt 0 ]]; then
  pass "TC-06 Data realtime (5 phút)" "$dt"
  echo -e "   ${YELLOW}→ Records trong 5 phút: ${rcnt}${RESET}"
else
  fail "TC-06 Data realtime (5 phút)" "Không có data mới — simulator có chạy không?"
fi

# TC-07: Kiểm tra số thiết bị đang gửi data
echo -e "${INFO} TC-07: Kiểm tra số device đang active..."
t0=$(ms_now)
dev_resp=$(query_influx "SELECT DISTINCT(device_id) FROM ${MEASUREMENT} WHERE time > now() - INTERVAL '5 minutes'" || echo "")
t1=$(ms_now); dt=$((t1-t0))
dev_count=$(echo "$dev_resp" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d))" 2>/dev/null || echo "0")
if [[ "$dev_count" -gt 0 ]]; then
  pass "TC-07 Active devices" "$dt"
  echo -e "   ${YELLOW}→ Devices active: ${dev_count}${RESET}"
  echo "$dev_resp" | python3 -c "
import sys,json
d=json.load(sys.stdin)
for row in d[:5]: print(f'     • {row.get(\"device_id\",\"?\")}')
if len(d)>5: print(f'     ... và {len(d)-5} device khác')
" 2>/dev/null || true
else
  fail "TC-07 Active devices" "Không có device active"
fi

# TC-08: Kiểm tra data integrity (các field bắt buộc)
echo -e "${INFO} TC-08: Data integrity — kiểm tra các field..."
t0=$(ms_now)
sample=$(query_influx "SELECT temperature, humidity, co2, pm25, air_quality, device_id FROM ${MEASUREMENT} ORDER BY time DESC LIMIT 1" || echo "")
t1=$(ms_now); dt=$((t1-t0))
fields_ok=$(echo "$sample" | python3 -c "
import sys,json
d=json.load(sys.stdin)
if not d: print('FAIL'); sys.exit()
r=d[0]
required=['temperature','humidity','co2','pm25','air_quality','device_id']
missing=[f for f in required if f not in r or r[f] is None]
print('FAIL:'+','.join(missing) if missing else 'OK')
" 2>/dev/null || echo "FAIL")
if [[ "$fields_ok" == "OK" ]]; then
  pass "TC-08 Data integrity (fields)" "$dt"
  echo "$sample" | python3 -c "
import sys,json
d=json.load(sys.stdin)
if d:
  r=d[0]
  print(f'   → device={r.get(\"device_id\",\"?\")} temp={r.get(\"temperature\",\"?\")}°C humi={r.get(\"humidity\",\"?\")}% co2={r.get(\"co2\",\"?\")}ppm pm25={r.get(\"pm25\",\"?\")} aqi={r.get(\"air_quality\",\"?\")}')
" 2>/dev/null || true
else
  fail "TC-08 Data integrity (fields)" "Missing fields: $fields_ok"
fi

# =============================================================================
# PHẦN 3: QUERY PERFORMANCE — Đo thời gian truy vấn
# =============================================================================
separator
echo -e "${BOLD}⏱️  PHẦN 3: QUERY PERFORMANCE — Đo thời gian query${RESET}"
separator

run_query_bench() {
  local tc_id="$1" label="$2" sql="$3" threshold_ms="${4:-500}"
  echo -e "\n${INFO} ${tc_id}: ${label}..."
  local t0 t1 dt
  t0=$(ms_now)
  result=$(query_influx "$sql" || echo "ERROR")
  t1=$(ms_now); dt=$((t1-t0))
  TIMINGS["$tc_id"]="$dt"
  if [[ "$result" == "ERROR" ]]; then
    fail "${tc_id} ${label}" "Query thất bại"
  elif [[ "$dt" -le "$threshold_ms" ]]; then
    pass "${tc_id} ${label}" "$dt"
  else
    echo -e "${WARN} ${tc_id} ${label} — ${dt}ms (vượt ngưỡng ${threshold_ms}ms)"
    RESULTS["${tc_id}"]="WARN"
    ((TOTAL++)) || true
  fi
  echo -e "   ${YELLOW}→ Thời gian: ${dt}ms | Ngưỡng: ${threshold_ms}ms${RESET}"
}

# TC-09: Simple SELECT
run_query_bench "TC-09" "Simple SELECT (LIMIT 10)" \
  "SELECT * FROM ${MEASUREMENT} ORDER BY time DESC LIMIT 10" 300

# TC-10: COUNT toàn bộ bảng
run_query_bench "TC-10" "COUNT(*) toàn bộ bảng" \
  "SELECT COUNT(*) AS total FROM ${MEASUREMENT}" 1000

# TC-11: AVG/MIN/MAX 1 giờ gần nhất
run_query_bench "TC-11" "AVG/MIN/MAX (1 giờ gần nhất)" \
  "SELECT AVG(temperature) AS avg_temp, MIN(temperature) AS min_temp, MAX(temperature) AS max_temp FROM ${MEASUREMENT} WHERE time > now() - INTERVAL '1 hour'" 500

# TC-12: GROUP BY device (1 giờ)
run_query_bench "TC-12" "GROUP BY device_id (1 giờ)" \
  "SELECT device_id, COUNT(*) AS samples, AVG(temperature) AS avg_temp, AVG(co2) AS avg_co2 FROM ${MEASUREMENT} WHERE time > now() - INTERVAL '1 hour' GROUP BY device_id ORDER BY samples DESC" 800

# TC-13: Time-bin aggregation (1 phút)
run_query_bench "TC-13" "Time-bin 1 phút (1 giờ qua)" \
  "SELECT date_bin(INTERVAL '1 minute', time) AS minute, AVG(temperature) AS avg_temp, AVG(humidity) AS avg_humi, AVG(co2) AS avg_co2 FROM ${MEASUREMENT} WHERE time > now() - INTERVAL '1 hour' GROUP BY 1 ORDER BY 1" 1000

# TC-14: Multi-field aggregation 24 giờ
run_query_bench "TC-14" "Multi-field 24 giờ (stress query)" \
  "SELECT AVG(temperature) AS avg_t, AVG(humidity) AS avg_h, AVG(co2) AS avg_c, AVG(pm25) AS avg_p, MAX(air_quality) AS max_aqi FROM ${MEASUREMENT} WHERE time > now() - INTERVAL '24 hours'" 2000

# TC-15: Lặp 5 lần query (đo consistency)
echo -e "\n${INFO} TC-15: Consistency — lặp 5 lần cùng query..."
latencies=()
for i in 1 2 3 4 5; do
  t0=$(ms_now)
  query_influx "SELECT COUNT(*) AS n FROM ${MEASUREMENT} WHERE time > now() - INTERVAL '1 hour'" > /dev/null
  t1=$(ms_now)
  latencies+=($((t1-t0)))
done
min_l=${latencies[0]}; max_l=${latencies[0]}; sum_l=0
for v in "${latencies[@]}"; do
  sum_l=$((sum_l+v))
  [[ $v -lt $min_l ]] && min_l=$v
  [[ $v -gt $max_l ]] && max_l=$v
done
avg_l=$((sum_l/5))
echo -e "   ${YELLOW}→ min=${min_l}ms avg=${avg_l}ms max=${max_l}ms (5 lần)${RESET}"
TIMINGS["TC-15"]="$avg_l"
if [[ "$max_l" -le 2000 ]]; then
  pass "TC-15 Query consistency (5 lần)" "$avg_l"
else
  fail "TC-15 Query consistency (5 lần)" "max=${max_l}ms quá cao"
fi

# =============================================================================
# PHẦN 4: SCALE TEST — Tải nhiều thiết bị
# =============================================================================
separator
echo -e "${BOLD}🚀 PHẦN 4: SCALE TEST — Mô phỏng nhiều thiết bị${RESET}"
separator

PYTHON_CMD=$(command -v python3 || echo "python")
SIM_DIR="./simulator"
SIM_SCRIPT="${SIM_DIR}/simulate.py"
VENV="${SIM_DIR}/.venv/bin/python"
if [[ -x "$VENV" ]]; then PYTHON_CMD="$VENV"; fi

run_scale_test() {
  local devices="$1" duration="$2" interval="${3:-1}"
  echo -e "\n${INFO} Scale test: ${devices} devices × ${duration}s (interval=${interval}s)..."

  # Lấy count trước
  before=$(query_influx "SELECT COUNT(*) AS n FROM ${MEASUREMENT}" | \
    python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['n'] if d else 0)" 2>/dev/null || echo "0")

  t0=$(ms_now)
  timeout "$duration" "$PYTHON_CMD" "$SIM_SCRIPT" \
    --devices "$devices" --interval "$interval" \
    --duration "$duration" --host localhost 2>/dev/null || true
  t1=$(ms_now); dt=$((t1-t0))

  # Chờ Telegraf flush (2-5s)
  sleep 6

  after=$(query_influx "SELECT COUNT(*) AS n FROM ${MEASUREMENT}" | \
    python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['n'] if d else 0)" 2>/dev/null || echo "0")

  expected=$(( devices * (duration / interval) ))
  written=$(( after - before ))
  rate=$(echo "scale=1; $written * 1000 / $dt" | bc 2>/dev/null || echo "?")

  echo -e "   ${YELLOW}→ Expected ≈${expected} | Written=${written} | Rate=${rate} msg/s | Elapsed=${dt}ms${RESET}"

  if [[ "$written" -ge $(( expected * 7 / 10 )) ]]; then
    pass "TC-SCALE-${devices}dev" "$dt"
  else
    fail "TC-SCALE-${devices}dev" "Chỉ ghi được ${written}/${expected} records"
  fi
}

echo -e "${WARN} Lưu ý: Scale test sẽ mất khoảng 2–3 phút..."

run_scale_test 10  10 1   # 10 devices, 10s
run_scale_test 50  10 1   # 50 devices, 10s
run_scale_test 100 10 1   # 100 devices, 10s

# =============================================================================
# PHẦN 5: GRAFANA API TEST
# =============================================================================
separator
echo -e "${BOLD}📊 PHẦN 5: GRAFANA API TEST${RESET}"
separator

# TC-16: Grafana login
echo -e "\n${INFO} TC-16: Grafana đăng nhập..."
t0=$(ms_now)
login_resp=$(curl -s -X POST "${GRAFANA_URL}/login" \
  -H "Content-Type: application/json" \
  -d "{\"user\":\"${GRAFANA_USER}\",\"password\":\"${GRAFANA_PASS}\"}" 2>/dev/null || echo "{}")
t1=$(ms_now); dt=$((t1-t0))
login_ok=$(echo "$login_resp" | python3 -c "import sys,json; d=json.load(sys.stdin); print('OK' if d.get('message')=='Logged in' else 'FAIL')" 2>/dev/null || echo "FAIL")
if [[ "$login_ok" == "OK" ]]; then
  pass "TC-16 Grafana login" "$dt"
else
  fail "TC-16 Grafana login" "Response: $login_resp"
fi

# TC-17: Datasource UID khớp
echo -e "${INFO} TC-17: Datasource UID P7206BD2ACDC63FCC tồn tại..."
t0=$(ms_now)
ds_resp=$(curl -s -u "${GRAFANA_USER}:${GRAFANA_PASS}" "${GRAFANA_URL}/api/datasources" 2>/dev/null || echo "[]")
t1=$(ms_now); dt=$((t1-t0))
ds_ok=$(echo "$ds_resp" | python3 -c "
import sys,json
d=json.load(sys.stdin)
uids=[x.get('uid') for x in d]
print('OK' if 'P7206BD2ACDC63FCC' in uids else 'FAIL:'+str(uids))
" 2>/dev/null || echo "FAIL")
if [[ "$ds_ok" == "OK" ]]; then
  pass "TC-17 Datasource UID" "$dt"
else
  fail "TC-17 Datasource UID" "$ds_ok"
fi

# TC-18: Dashboard tồn tại
echo -e "${INFO} TC-18: Dashboard IoT Monitoring tồn tại..."
t0=$(ms_now)
db_resp=$(curl -s -u "${GRAFANA_USER}:${GRAFANA_PASS}" "${GRAFANA_URL}/api/search?type=dash-db" 2>/dev/null || echo "[]")
t1=$(ms_now); dt=$((t1-t0))
db_count=$(echo "$db_resp" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d))" 2>/dev/null || echo "0")
if [[ "$db_count" -gt 0 ]]; then
  pass "TC-18 Dashboard tồn tại" "$dt"
  echo "$db_resp" | python3 -c "import sys,json; d=json.load(sys.stdin); [print(f'   • {x.get(\"title\",\"?\")}') for x in d]" 2>/dev/null || true
else
  fail "TC-18 Dashboard tồn tại" "Không tìm thấy dashboard nào"
fi

# =============================================================================
# BÁO CÁO TỔNG HỢP
# =============================================================================
separator
echo -e "\n${BOLD}📈 BÁO CÁO KẾT QUẢ THỬ NGHIỆM${RESET}"
separator

echo -e "\n${BOLD}Query Performance Summary:${RESET}"
printf "  %-40s %s\n" "Test Case" "Thời gian"
printf "  %-40s %s\n" "─────────────────────────────────────" "────────"
for tc in "TC-09" "TC-10" "TC-11" "TC-12" "TC-13" "TC-14" "TC-15"; do
  t=${TIMINGS[$tc]:-N/A}
  printf "  %-40s %sms\n" "$tc" "$t"
done

echo ""
echo -e "  ${BOLD}Tổng:   ${TOTAL}${RESET}"
echo -e "  ${GREEN}Pass:   ${PASSED}${RESET}"
echo -e "  ${RED}Fail:   ${FAILED}${RESET}"
warn_count=0
for v in "${RESULTS[@]}"; do [[ "$v" == "WARN" ]] && ((warn_count++)) || true; done
[[ "$warn_count" -gt 0 ]] && echo -e "  ${YELLOW}Warn:   ${warn_count}${RESET}"

echo ""
if [[ "$FAILED" -eq 0 ]]; then
  echo -e "${GREEN}${BOLD}✅ TẤT CẢ TEST ĐỀU PASSED!${RESET}"
else
  echo -e "${RED}${BOLD}❌ CÓ ${FAILED} TEST THẤT BẠI — xem log bên trên để biết chi tiết.${RESET}"
fi
separator
echo ""
