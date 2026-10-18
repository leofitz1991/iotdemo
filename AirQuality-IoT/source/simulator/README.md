# Simulator thử tải – nhiều thiết bị đo chất lượng không khí

Phụ trách: Chi · Dùng cho: thử nghiệm khả năng mở rộng (dự án §17, TC06) và PoC InfluxDB (chuyên đề).

Wokwi chỉ chạy được vài ESP32 cùng lúc và chạy chậm hơn thời gian thực, nên thử tải 10/50/100+ thiết bị
dùng simulator này. Dữ liệu cùng mô hình với firmware (5 đại lượng + `seq`, giá trị trôi chậm + nhiễu),
nhưng `ts` lấy từ đồng hồ máy thật nên **dùng được để đo độ trễ**.

## Cài đặt

```powershell
cd nhom\AirQuality-IoT\source\simulator
npm install
```

## Chế độ 1 – ThingsBoard (dự án)

Simulator tự đăng nhập ThingsBoard (`tenant@thingsboard.org`), tạo device `sim-0001…`, lấy token
(lưu cache ở `tokens.json`), mỗi device mở 1 kết nối MQTT riêng tới cổng 1883.

```powershell
node simulator.mjs --target tb --devices 10 --interval 5000 --duration 120
node simulator.mjs --target tb --cleanup     # xóa toàn bộ device sim-* sau khi thử
```

Payload: topic `v1/devices/me/telemetry`, `{"ts":<epoch ms>,"values":{"temperature":..,"humidity":..,"co2":..,"pm25":..,"air_quality":..,"seq":..}}`

## Chế độ 2 – MQTT broker thường (PoC InfluxDB)

```powershell
node simulator.mjs --target mqtt --host localhost --port 1884 --devices 100 --interval 1000 --duration 60
```

Payload: topic `environment/<device_id>/telemetry`,
`{"device_id":"sim-0001","location":"mtp-block-a-datacenter","ts":<epoch ms>,"temperature":..,...,"seq":..}`

## Tham số

| Tham số | Mặc định | Ý nghĩa |
|---|---|---|
| `--target` | `tb` | `tb` hoặc `mqtt` |
| `--host` / `--port` | `localhost` / 1883 (tb), 1884 (mqtt) | Địa chỉ broker |
| `--devices` | 10 | Số thiết bị (mỗi thiết bị 1 kết nối MQTT) |
| `--interval` | 5000 | ms giữa 2 bản tin của 1 thiết bị |
| `--duration` | 60 | Thời gian chạy (s); `0` = đến khi Ctrl+C |
| `--qos` | 1 | QoS publish (1 → đo được PUBACK latency) |
| `--scenario` | `normal` | `normal`, `co2-high` (CO₂ 1300–1700 ppm), `pm-high` (PM2.5 60–100 µg/m³) |
| `--prefix` | `sim` | Tiền tố tên device |

Tải lý thuyết = devices × 1000 / interval (msg/s).

## Kết quả

Mỗi 5 s in: số kết nối, tốc độ gửi, tổng gửi/ack/lỗi. Khi kết thúc in throughput và PUBACK latency
(p50/p95/max) và **ghi thêm 1 dòng vào `results/scale-results.csv`** để đưa vào báo cáo.

## Kịch bản thử tải đề xuất (dự án §17)

```powershell
node simulator.mjs --target tb --devices 5   --interval 1000 --duration 120
node simulator.mjs --target tb --devices 10  --interval 1000 --duration 120
node simulator.mjs --target tb --devices 50  --interval 1000 --duration 120
node simulator.mjs --target tb --devices 100 --interval 1000 --duration 120
node simulator.mjs --target tb --cleanup
```

Trong lúc chạy, theo dõi CPU/RAM container: `docker stats --no-stream` (chạy vài lần) để ghi vào báo cáo.
Ghi lại cấu hình máy, phiên bản ThingsBoard, số lần chạy và lấy trung bình – không dùng một lần chạy duy nhất.

Thử nghiệm sơ bộ (15/10/2026, laptop nhóm, ThingsBoard CE 4.3.1.6 Docker): 50 thiết bị × 1 msg/s,
20 s → 944/944 bản tin ack, 0 lỗi, PUBACK p50 = 2,7 ms, p95 = 3,5 ms. (Chỉ để kiểm tra công cụ, chưa phải số liệu chính thức.)
