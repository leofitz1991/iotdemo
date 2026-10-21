"""
MOCK DATA GENERATOR FOR IOT AIR QUALITY MONITORING (MEKONG MTP)
Author: Khiêm (CTH619 - CTTG32)
Purpose:
- Sinh dữ liệu chuỗi thời gian (Time-series) cho 5 trạm quan trắc Mekong Innovation Technology Park:
  1. Temperature (°C)
  2. Humidity (%)
  3. CO2 (ppm)
  4. PM2.5 (µg/m³)
  5. Air Quality / AQI (Air Quality Index)
  6. Seq (Packet sequence)
- Hỗ trợ 2 chế độ:
  1. Backfill dữ liệu lịch sử (1 giờ, 24 giờ, 7 ngày)
  2. Stream dữ liệu thời gian thực (mỗi 3 - 5 giây)
- Hỗ trợ kích hoạt kịch bản bất thường (Anomaly/Spike) để test Alerting.
- Sử dụng trực tiếp HTTP REST API của InfluxDB v2 (chuẩn Line Protocol), 
  không bắt buộc cài thêm thư viện ngoài (dùng chuẩn urllib của Python).
"""

import sys
import time
import math
import random
import argparse
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta

# Đảm bảo UTF-8 cho console Windows
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

# Cấu hình mặc định InfluxDB v2
DEFAULT_INFLUX_URL = "http://localhost:8086"
DEFAULT_ORG = "ctu-iot"
DEFAULT_BUCKET = "airquality"
DEFAULT_TOKEN = "ctu_iot_token_2026_secret_key"

# 5 Trạm quan trắc thực tế tại Công viên phần mềm Mekong (Mekong MTP)
DEVICES = [
    {
        "id": "aq-node-01",
        "location": "mtp-block-a-datacenter",
        "zone": "Toa_nha_A_Data_Center",
        "base_co2": 850,
        "base_pm25": 20,
        "base_temp": 28.5,
        "base_hum": 65.0
    },
    {
        "id": "aq-node-02",
        "location": "mtp-block-b-software-hub",
        "zone": "Toa_nha_B_Phan_Mem",
        "base_co2": 760,
        "base_pm25": 12,
        "base_temp": 27.0,
        "base_hum": 60.0
    },
    {
        "id": "aq-node-03",
        "location": "mtp-block-c-iot-incubator",
        "zone": "Toa_nha_C_IoT_Lab",
        "base_co2": 1030,
        "base_pm25": 26,
        "base_temp": 29.5,
        "base_hum": 70.0
    },
    {
        "id": "aq-node-04",
        "location": "mtp-hall-convention-center",
        "zone": "Hoi_truong_600_cho",
        "base_co2": 670,
        "base_pm25": 9,
        "base_temp": 26.0,
        "base_hum": 55.0
    },
    {
        "id": "aq-node-05",
        "location": "mtp-gate-ambient-ql50",
        "zone": "Cong_chinh_QL50",
        "base_co2": 1210,
        "base_pm25": 35,
        "base_temp": 30.5,
        "base_hum": 72.0
    },
]

def calculate_aqi(pm25, co2):
    """Tính toán AQI xấp xỉ dựa trên tiêu chuẩn US EPA 2024 cho PM2.5"""
    if pm25 <= 9.0:
        aqi_pm = (50 - 0) / (9.0 - 0.0) * pm25
    elif pm25 <= 35.4:
        aqi_pm = (100 - 51) / (35.4 - 9.1) * (pm25 - 9.1) + 51
    elif pm25 <= 55.4:
        aqi_pm = (150 - 101) / (55.4 - 35.5) * (pm25 - 35.5) + 101
    elif pm25 <= 125.4:
        aqi_pm = (200 - 151) / (125.4 - 55.5) * (pm25 - 55.5) + 151
    elif pm25 <= 225.4:
        aqi_pm = (300 - 201) / (225.4 - 125.5) * (pm25 - 125.5) + 201
    else:
        aqi_pm = 350

    co2_penalty = 0
    if co2 > 1000:
        co2_penalty = min(50, (co2 - 1000) * 0.05)
        
    return round(min(500, aqi_pm + co2_penalty), 1)

_seq_counter = 0

def generate_telemetry(device, timestamp, is_abnormal=False):
    """Tạo bộ thông số 5 đại lượng tại một thời điểm timestamp"""
    global _seq_counter
    _seq_counter += 1

    # Mô phỏng nhiệt độ theo chu kỳ hình sin trong ngày
    hour = timestamp.hour + timestamp.minute / 60.0
    temp_variation = 3.0 * math.sin((hour - 8) * math.pi / 12)
    temp = round(device["base_temp"] + temp_variation + random.uniform(-0.4, 0.4), 1)
    humidity = round(device["base_hum"] - (temp_variation * 2.0) + random.uniform(-1.0, 1.0), 1)

    base_co2 = device["base_co2"]
    base_pm25 = device["base_pm25"]

    if is_abnormal:
        co2 = round(base_co2 + random.uniform(600, 1100), 1)
        pm25 = round(base_pm25 + random.uniform(50, 95), 1)
    else:
        co2 = round(base_co2 + random.uniform(-25, 30), 1)
        pm25 = round(max(2.0, base_pm25 + random.uniform(-3, 4)), 1)

    aqi = calculate_aqi(pm25, co2)

    return {
        "device_id": device["id"],
        "location": device["location"],
        "zone": device["zone"],
        "temperature": temp,
        "humidity": humidity,
        "co2": co2,
        "pm25": pm25,
        "aqi": aqi,
        "air_quality": int(aqi),
        "seq": _seq_counter,
        "timestamp_ns": int(timestamp.timestamp() * 1e9)
    }

def format_line_protocol(measurement, point):
    """
    Chuyển đổi dữ liệu sang định dạng InfluxDB Line Protocol:
    air_quality,device_id=aq-node-01,location=mtp-block-a-datacenter,zone=Toa_nha_A temperature=28.5,humidity=65.0,co2=850.0,pm25=20.0,aqi=69.0,air_quality=69,seq=42 1697400000000000000
    """
    tags = f"device={point['device_id']},device_id={point['device_id']},location={point['location']},zone={point['zone']}"
    fields = (f"temperature={point['temperature']},"
              f"humidity={point['humidity']},"
              f"co2={point['co2']},"
              f"pm25={point['pm25']},"
              f"aqi={point['aqi']},"
              f"air_quality={point['air_quality']},"
              f"seq={point['seq']}")
    return f"{measurement},{tags} {fields} {point['timestamp_ns']}"

def write_to_influx(url, org, bucket, token, lines):
    """Gửi batch Line Protocol tới InfluxDB REST API v2"""
    endpoint = f"{url}/api/v2/write?org={org}&bucket={bucket}&precision=ns"
    data = "\n".join(lines).encode("utf-8")
    
    req = urllib.request.Request(endpoint, data=data, method="POST")
    req.add_header("Authorization", f"Token {token}")
    req.add_header("Content-Type", "text/plain; charset=utf-8")
    
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return response.status in (200, 204)
    except urllib.error.HTTPError as e:
        print(f"[-] HTTP Error {e.code}: {e.read().decode('utf-8', errors='ignore')}")
        return False
    except Exception as e:
        print(f"[-] Kết nối thất bại đến {url}: {e}")
        return False

def run_backfill(args):
    """Sinh dữ liệu lịch sử lùi về quá khứ"""
    print(f"[*] Bắt đầu Backfill dữ liệu lịch sử ({args.hours} giờ qua)...")
    end_time = datetime.now(timezone.utc)
    start_time = end_time - timedelta(hours=args.hours)
    
    step = timedelta(seconds=args.interval)
    current = start_time
    total_records = 0
    batch = []
    
    while current <= end_time:
        for dev in DEVICES:
            is_spike = random.random() < 0.05
            point = generate_telemetry(dev, current, is_abnormal=is_spike)
            batch.append(format_line_protocol("air_quality_raw", point))
            total_records += 1
            
            if len(batch) >= 500:
                success = write_to_influx(args.url, args.org, args.bucket, args.token, batch)
                if not success:
                    print("[-] Lỗi khi ghi batch vào InfluxDB.")
                    return
                batch = []
        current += step

    if batch:
        write_to_influx(args.url, args.org, args.bucket, args.token, batch)
        
    print(f"[+] Hoàn tất! Đã nạp thành công {total_records} bản ghi vào InfluxDB (Bucket: {args.bucket}).")

def run_stream(args):
    """Sinh dữ liệu thời gian thực liên tục"""
    print(f"[*] Bắt đầu Stream dữ liệu thời gian thực (Chu kỳ {args.interval}s)...")
    print("    Nhấn Ctrl+C để dừng.")
    
    spike_counter = 0
    try:
        while True:
            now = datetime.now(timezone.utc)
            lines = []
            
            is_spike = args.abnormal or (args.auto_spike and spike_counter >= 10)
            if is_spike and args.auto_spike:
                spike_counter = 0
            else:
                spike_counter += 1

            for dev in DEVICES:
                dev_spike = is_spike and (dev["id"] == "aq-node-01")
                point = generate_telemetry(dev, now, is_abnormal=dev_spike)
                lines.append(format_line_protocol("air_quality_raw", point))
                
                status_note = "[CẢNH BÁO VƯỢT NGƯỠNG!]" if dev_spike else "[Bình thường]"
                print(f"[{now.strftime('%H:%M:%S')}] {dev['id']} ({dev['location']}) | "
                      f"T: {point['temperature']}°C | H: {point['humidity']}% | "
                      f"CO2: {point['co2']}ppm | PM2.5: {point['pm25']}µg/m³ | "
                      f"AQI: {point['aqi']} {status_note}")

            write_to_influx(args.url, args.org, args.bucket, args.token, lines)
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("\n[*] Đã dừng streaming.")

def main():
    parser = argparse.ArgumentParser(description="IoT Air Quality Mock Data Generator for InfluxDB (Mekong MTP)")
    parser.add_argument("--url", default=DEFAULT_INFLUX_URL, help="InfluxDB URL (default: http://localhost:8186)")
    parser.add_argument("--org", default=DEFAULT_ORG, help="InfluxDB Organization")
    parser.add_argument("--bucket", default=DEFAULT_BUCKET, help="InfluxDB Bucket")
    parser.add_argument("--token", default=DEFAULT_TOKEN, help="InfluxDB API Token")
    parser.add_argument("--mode", choices=["backfill", "stream"], default="stream", help="Chế độ chạy")
    parser.add_argument("--hours", type=int, default=24, help="Số giờ backfill (cho mode backfill)")
    parser.add_argument("--interval", type=int, default=5, help="Khoảng cách giữa các bản ghi (giây)")
    parser.add_argument("--abnormal", action="store_true", help="Cố tình tạo dữ liệu bất thường liên tục để test cảnh báo")
    parser.add_argument("--auto-spike", action="store_true", help="Tự động tạo spike cảnh báo định kỳ mỗi 10 chu kỳ")

    args = parser.parse_args()

    print("=============================================================")
    print("   CTH619 - AIR QUALITY TELEMETRY GENERATOR (MEKONG MTP)     ")
    print("=============================================================")
    print(f"Target: {args.url} | Org: {args.org} | Bucket: {args.bucket}")
    print(f"Mode:   {args.mode.upper()}")
    print("-------------------------------------------------------------")

    if args.mode == "backfill":
        run_backfill(args)
    else:
        run_stream(args)

if __name__ == "__main__":
    main()
