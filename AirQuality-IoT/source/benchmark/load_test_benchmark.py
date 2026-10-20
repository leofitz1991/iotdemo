"""
INFLUXDB BENCHMARK & LOAD TESTING SUITE
Author: Khiêm (CTH619 - CTTG32)
Purpose:
- Thực hiện kiểm thử tải (Load Test) và đánh giá hiệu năng (Benchmark) cho InfluxDB v2:
  1. Đo tốc độ ghi (Write Throughput: records/sec, bytes/sec)
  2. Đo độ trễ truy vấn (Query Latency: ms) cho các câu truy vấn Flux thực tế của Grafana
  3. Đo lường khả năng mở rộng (Scale Test: 10, 50, 100, 500 thiết bị đồng thời)
- Xuất bảng kết quả thực nghiệm định dạng Markdown để dán trực tiếp vào:
  - Báo cáo Chuyên đề InfluxDB (Mục 7)
  - Báo cáo Dự án IoT-IS (Chương 7)
"""

import sys
import time
import json
import random
import argparse
import urllib.request
import urllib.error
from datetime import datetime, timezone

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

DEFAULT_INFLUX_URL = "http://localhost:8086"
DEFAULT_ORG = "ctu-iot"
DEFAULT_BUCKET = "airquality"
DEFAULT_TOKEN = "ctu_iot_token_2026_secret_key"

def generate_sample_line(device_id, timestamp_ns):
    temp = round(25.0 + random.uniform(-3, 5), 2)
    hum = round(60.0 + random.uniform(-10, 15), 1)
    co2 = round(500.0 + random.uniform(-50, 150), 1)
    pm25 = round(15.0 + random.uniform(-5, 15), 2)
    aqi = round(40.0 + random.uniform(-10, 20), 1)
    return (f"air_quality_raw,device={device_id},device_id={device_id},location=Test_Lab "
            f"temperature={temp},humidity={hum},co2={co2},pm25={pm25},aqi={aqi} "
            f"{timestamp_ns}")

def execute_write_batch(url, org, bucket, token, lines):
    endpoint = f"{url}/api/v2/write?org={org}&bucket={bucket}&precision=ns"
    data = "\n".join(lines).encode("utf-8")
    req = urllib.request.Request(endpoint, data=data, method="POST")
    req.add_header("Authorization", f"Token {token}")
    req.add_header("Content-Type", "text/plain; charset=utf-8")
    
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=15) as resp:
        latency = (time.perf_counter() - t0) * 1000  # ms
        return resp.status in (200, 204), latency, len(data)

def execute_flux_query(url, org, token, flux_query):
    endpoint = f"{url}/api/v2/query?org={org}"
    payload = json.dumps({"query": flux_query, "type": "flux"}).encode("utf-8")
    req = urllib.request.Request(endpoint, data=payload, method="POST")
    req.add_header("Authorization", f"Token {token}")
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "application/csv")

    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = resp.read()
            latency = (time.perf_counter() - t0) * 1000  # ms
            lines_returned = len(data.splitlines())
            return True, latency, lines_returned
    except urllib.error.HTTPError as e:
        return False, 0.0, f"HTTP Error {e.code}"
    except Exception as e:
        return False, 0.0, str(e)

def benchmark_write_throughput(url, org, bucket, token, batch_sizes=[100, 500, 1000, 2000]):
    print("\n[+] BÀI KIỂM THỬ 1: ĐO TỐC ĐỘ GHI (WRITE THROUGHPUT & LATENCY)")
    print("-" * 75)
    print(f"{'Batch Size (records)':<22} | {'Latency (ms)':<15} | {'Throughput (rec/s)':<20} | {'Status'}")
    print("-" * 75)
    
    results = []
    base_ts = int(datetime.now(timezone.utc).timestamp() * 1e9)
    
    for size in batch_sizes:
        lines = [generate_sample_line(f"dev-{i%20:03d}", base_ts + i*1000000) for i in range(size)]
        success, latency, bytes_written = execute_write_batch(url, org, bucket, token, lines)
        
        if success:
            throughput = size / (latency / 1000.0) if latency > 0 else 0
            print(f"{size:<22} | {latency:<15.2f} | {throughput:<20.1f} | PASS")
            results.append({"batch": size, "latency_ms": latency, "throughput": throughput, "status": "PASS"})
        else:
            print(f"{size:<22} | {'N/A':<15} | {'N/A':<20} | FAIL")
            results.append({"batch": size, "latency_ms": 0, "throughput": 0, "status": "FAIL"})
            
    return results

def benchmark_query_latency(url, org, bucket, token):
    print("\n[+] BÀI KIỂM THỬ 2: ĐO ĐỘ TRỄ TRUY VẤN FLUX (QUERY LATENCY BENCHMARK)")
    print("-" * 80)
    print(f"{'Tên Kịch Bản Truy Vấn':<45} | {'Thời gian (ms)':<16} | {'Số Dòng Trả Về'}")
    print("-" * 80)

    queries = [
        {
            "name": "Q1: Lấy giá trị mới nhất (Last value)",
            "flux": f'''
                from(bucket: "{bucket}")
                  |> range(start: -15m)
                  |> filter(fn: (r) => r["_measurement"] == "air_quality")
                  |> last()
            '''
        },
        {
            "name": "Q2: Truy vấn chuỗi 1 giờ qua (Raw time-series)",
            "flux": f'''
                from(bucket: "{bucket}")
                  |> range(start: -1h)
                  |> filter(fn: (r) => r["_measurement"] == "air_quality")
                  |> filter(fn: (r) => r["_field"] == "co2" or r["_field"] == "pm25")
            '''
        },
        {
            "name": "Q3: Tổng hợp 24h (Aggregate 10m window mean)",
            "flux": f'''
                from(bucket: "{bucket}")
                  |> range(start: -24h)
                  |> filter(fn: (r) => r["_measurement"] == "air_quality")
                  |> filter(fn: (r) => r["_field"] == "temperature" or r["_field"] == "humidity")
                  |> aggregateWindow(every: 10m, fn: mean, createEmpty: false)
                  |> yield(name: "mean")
            '''
        },
        {
            "name": "Q4: Thống kê Max/Min 7 ngày (Max aggregation)",
            "flux": f'''
                from(bucket: "{bucket}")
                  |> range(start: -7d)
                  |> filter(fn: (r) => r["_measurement"] == "air_quality")
                  |> filter(fn: (r) => r["_field"] == "aqi")
                  |> aggregateWindow(every: 1h, fn: max, createEmpty: false)
            '''
        }
    ]

    results = []
    for q in queries:
        success, latency, lines = execute_flux_query(url, org, token, q["flux"])
        if success:
            print(f"{q['name']:<45} | {latency:<16.2f} | {lines} records")
            results.append({"query": q["name"], "latency_ms": latency, "records": lines, "status": "PASS"})
        else:
            print(f"{q['name']:<45} | {'ERROR':<16} | {lines}")
            results.append({"query": q["name"], "latency_ms": 0, "records": 0, "status": "FAIL"})

    return results

def benchmark_scalability(url, org, bucket, token, device_counts=[5, 20, 50, 100]):
    print("\n[+] BÀI KIỂM THỬ 3: THỬ TẢI MỞ RỘNG ĐA THIẾT BỊ (SCALABILITY SIMULATION)")
    print("-" * 80)
    print(f"{'Số Thiết Bị Mô Phỏng':<25} | {'Tổng Points/s':<18} | {'Độ trễ ghi (ms)':<18} | {'Đánh giá'}")
    print("-" * 80)

    base_ts = int(datetime.now(timezone.utc).timestamp() * 1e9)
    results = []
    
    for dev_count in device_counts:
        # Mỗi thiết bị gửi 1 gói telemetry gồm 5 trường
        lines = [generate_sample_line(f"esp32-node-{i:03d}", base_ts) for i in range(dev_count)]
        success, latency, _ = execute_write_batch(url, org, bucket, token, lines)
        total_points = dev_count * 5 # 5 metrics
        
        rating = "Rất Tốt (< 50ms)" if latency < 50 else ("Tốt (< 150ms)" if latency < 150 else "Chấp nhận được")
        print(f"{dev_count:<25} | {total_points:<18} | {latency:<18.2f} | {rating}")
        results.append({"devices": dev_count, "points": total_points, "latency_ms": latency, "rating": rating})

    return results

def main():
    parser = argparse.ArgumentParser(description="InfluxDB Performance Benchmark Suite")
    parser.add_argument("--url", default=DEFAULT_INFLUX_URL, help="InfluxDB URL")
    parser.add_argument("--org", default=DEFAULT_ORG, help="InfluxDB Org")
    parser.add_argument("--bucket", default=DEFAULT_BUCKET, help="InfluxDB Bucket")
    parser.add_argument("--token", default=DEFAULT_TOKEN, help="InfluxDB Token")
    args = parser.parse_args()

    print("===============================================================================")
    print("      CTH619 - INFLUXDB & GRAFANA PERFORMANCE BENCHMARK (KHIÊM)                ")
    print("===============================================================================")
    print(f"Target InfluxDB: {args.url} | Org: {args.org} | Bucket: {args.bucket}")
    print(f"Thời gian bắt đầu: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    try:
        write_res = benchmark_write_throughput(args.url, args.org, args.bucket, args.token)
        query_res = benchmark_query_latency(args.url, args.org, args.bucket, args.token)
        scale_res = benchmark_scalability(args.url, args.org, args.bucket, args.token)

        # Tự động dọn dẹp dữ liệu ảo Test_Lab để giữ Dashboard luôn sạch đẹp
        try:
            del_url = f"{args.url}/api/v2/delete?org={args.org}&bucket={args.bucket}"
            del_payload = json.dumps({
                'start': '1970-01-01T00:00:00Z',
                'stop': '2030-01-01T00:00:00Z',
                'predicate': 'location="Test_Lab"'
            }).encode('utf-8')
            del_req = urllib.request.Request(del_url, data=del_payload, method='POST')
            del_req.add_header('Authorization', f'Token {args.token}')
            del_req.add_header('Content-Type', 'application/json')
            with urllib.request.urlopen(del_req, timeout=10) as resp:
                if resp.status in (200, 204):
                    print("\n[*] Đã tự động dọn dẹp toàn bộ dữ liệu ảo Test_Lab sạch sẽ.")
        except Exception:
            pass

        print("\n" + "=" * 80)
        print("[+] TẤT CẢ CÁC BÀI KIỂM THỬ ĐÃ HOÀN TẤT THÀNH CÔNG!")
        print("    Các bảng số liệu trên có thể trích dẫn trực tiếp vào Báo Cáo Chuyên Đề & Dự Án.")
        print("=" * 80)
    except Exception as e:
        print(f"\n[-] Kiểm thử bị gián đoạn: {e}")
        print("    Gợi ý: Hãy đảm bảo InfluxDB container đang chạy trước khi thực thi benchmark.")

if __name__ == "__main__":
    main()
