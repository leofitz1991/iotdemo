# Thiết bị IoT – Nút đo chất lượng không khí (ESP32 trên Wokwi)

Phụ trách: Chi · Lớp IIAF: **IoT Devices** + **Communication (MQTT)**

```
Wokwi ESP32 ──MQTT 1883──► ThingsBoard CE (Docker, host.wokwi.internal)
   ▲                           │ rule chain ──► InfluxDB ──► Grafana   (Thịnh/Thái/Khiêm)
   └──────── RPC setFan / setBuzzer ◄──┘
```

## 1. Phần cứng mô phỏng (`diagram.json`)

| Linh kiện | Chân ESP32 | Vai trò / Cơ cấu chấp hành |
|---|---|---|
| DHT22 | GPIO15 | Nhiệt độ (°C), Độ ẩm (%RH) – kéo slider để đổi |
| Biến trở `potCo2` | GPIO34 | Mức nền CO₂ 400–5000 ppm (ADC 34) |
| Biến trở `potPm` | GPIO35 | Mức nền PM2.5 0–300 µg/m³ (ADC 35) |
| Relay + LED xanh "FAN" | GPIO26 | Quạt thông gió hút khí tươi (Actuator 1 - CO₂) |
| LED xanh dương "PURIFIER" | GPIO27 | Máy lọc không khí màng HEPA (Actuator 2 - PM2.5 / Bụi mịn) |
| LED vàng "COOLER" | GPIO14 | Điều hòa nhiệt độ / Máy làm mát (Actuator 3 - Nhiệt độ cao) |
| LED cam "MIST" | GPIO13 | Máy phun sương siêu âm / Tạo ẩm (Actuator 4 - Độ ẩm thấp) |
| Còi Buzzer + LED đỏ "ALERT" | GPIO25, GPIO33 | Còi hú & Đèn chớp cảnh báo khẩn cấp (Actuator 5 - Nguy cấp) |

Giá trị gửi đi = mức nền (biến trở/slider) + trôi chậm (random walk) + nhiễu nhỏ ⇒ luôn biến đổi theo thời gian.
`air_quality` = chỉ số con PM2.5 theo bảng breakpoint US EPA (2024) tính trên giá trị tức thời – **chỉ số quy ước**, không phải AQI chính thức (AQI chuẩn dùng trung bình 24h).

## 2. Hợp đồng dữ liệu (MQTT – ThingsBoard Device API)

| Topic | Chiều | QoS | Payload |
|---|---|---|---|
| `v1/devices/me/telemetry` | ESP32 → TB | 0 | `{"ts":1791790200000,"values":{"temperature":28.5,"humidity":65.0,"co2":850,"pm25":20.3,"air_quality":69,"seq":42}}` |
| `v1/devices/me/attributes` | ESP32 → TB | 0 | `{"location":"room-101","fw":"1.0.0","sample_interval_ms":5000,"fan":0,"buzzer":0,"purifier":0,"cooler":0,"humidifier":0}` |
| `v1/devices/me/rpc/request/+` | TB → ESP32 | 1 | `{"method":"setFan","params":true}` · `setPurifier` · `setCooler` · `setHumidifier` · `setBuzzer` · `getState` |
| `v1/devices/me/rpc/response/{id}` | ESP32 → TB | 0 | `{"fan":1,"buzzer":0,"purifier":0,"cooler":0,"humidifier":0}` |

- Xác thực: username = access token của device, password rỗng. Client ID = `aq-node-0X`.
- `ts` (thời điểm đo, epoch ms UTC) **tắt mặc định trên Wokwi** (`SEND_DEVICE_TS 0` trong `config.h`): payload gửi phẳng `{"temperature":...}` và ThingsBoard gán thời điểm nhận. Lý do: Wokwi chạy chậm hơn thời gian thực (~50%), đồng hồ ESP32 mô phỏng trễ dần (đo được trễ 281 → 302 s chỉ sau 40 s thực). Với ESP32 thật thì bật `SEND_DEVICE_TS 1`.
- Chu kỳ 5 s là theo thời gian mô phỏng; chu kỳ thực ≈ 5 s ÷ tốc độ mô phỏng (vd. 47% → ~10,6 s). Thử tải dùng simulator chạy trên máy thật.
- `seq` tăng 1 mỗi bản tin (reset khi khởi động lại) → dùng để tính tỷ lệ mất gói.
- Chu kỳ 5 s. PubSubClient chỉ publish được QoS 0 ⇒ mất gói được phát hiện qua `seq`.
- Trạng thái online/offline: dùng thuộc tính `active` mà ThingsBoard tự quản lý.

| Node | Client ID | Location (`location`) | Phân khu Mekong MTP (`zone`) | Tọa độ GPS (`latitude`, `longitude`) | DHT mặc định | CO₂/PM2.5 nền |
|---|---|---|---|---|---|---|
| node01 | aq-node-01 | `mtp-block-a-datacenter` | Tòa nhà A - Điều hành & Data Center | 10.35520, 106.40180 | 28.5 °C / 65 % | ~850 / ~20 |
| node02 | aq-node-02 | `mtp-block-b-software-hub` | Tòa nhà B - Doanh nghiệp Phần mềm | 10.35575, 106.40225 | 27.0 / 60 | ~760 / ~12 |
| node03 | aq-node-03 | `mtp-block-c-iot-incubator` | Tòa nhà C - Vườn ươm & IoT Lab | 10.35620, 106.40160 | 29.5 / 70 | ~1030 / ~26 |
| node04 | aq-node-04 | `mtp-hall-convention-center` | Hội trường Đa năng 600 chỗ | 10.35470, 106.40260 | 26.0 / 55 | ~670 / ~9 |
| node05 | aq-node-05 | `mtp-gate-ambient-ql50` | Cổng chính & Quan trắc Ngoại vi QL50 | 10.35415, 106.40120 | 30.5 / 72 | ~1210 / ~35 |

> **Thông tin thực địa khuôn viên**: Công viên phần mềm Mekong (Mekong Innovation Technology Park - Mekong MTP), ấp Phong Thuận, xã Tân Mỹ Chánh, TP. Mỹ Tho, tỉnh Tiền Giang (mặt tiền Quốc lộ 50). Diện tích 70.000 m². Tọa độ trạm đã được tích hợp vào `attributes` của thiết bị để ThingsBoard hiển thị trực tiếp trên Map Widget (OpenStreetMap).

## 3. Cài đặt (một lần)

1. Mở **Docker Desktop** và chờ trạng thái *Engine running*.
2. VS Code → Extensions, cài **PlatformIO IDE** và **Wokwi Simulator**.
3. `F1` → `Wokwi: Request a New License` → đăng nhập Wokwi để kích hoạt license cho VS Code.

## 4. Chạy ThingsBoard

```powershell
cd nhom\AirQuality-IoT\docker\thingsboard
docker compose run --rm -e INSTALL_TB=true -e LOAD_DEMO=true thingsboard-ce   # chỉ lần đầu, vài phút
docker compose up -d
```

Mở http://localhost:8080, đăng nhập `tenant@thingsboard.org` / `tenant` (đổi mật khẩu sau).

Tạo 5 device: **Entities → Devices → + → Add new device**, tên `aq-node-01` … `aq-node-05`.
Với mỗi device: **Manage credentials** → copy *Access token* → dán vào `include/config.h` thay cho `TOKEN_NODE_0X`.

**Kiểm tra ThingsBoard trước khi dùng Wokwi** (thay `<TOKEN>`):

```powershell
docker run --rm eclipse-mosquitto mosquitto_pub -h host.docker.internal -p 1883 -u <TOKEN> -t v1/devices/me/telemetry -m '{\"seq\":0,\"co2\":500}'
```

Device → tab *Latest telemetry* phải thấy `co2 = 500`.

## 5. Build và chạy 1 node

1. VS Code → `File > Open Folder` → `nhom\AirQuality-IoT\source\device-esp32`.
2. Build: thanh PlatformIO → *Project Tasks* → `node01` → **Build** (hoặc terminal: `pio run -e node01`).
3. `F1` → `Wokwi: Start Simulator`. Serial Monitor mong đợi:

```
=== aq-node-01 (room-101) fw 1.0.0 ===
WiFi: ket noi Wokwi-GUEST... OK, IP=10.10.0.2
MQTT: host.wokwi.internal:1883 client=aq-node-01 ... OK
[aq-node-01] PUB {"temperature":28.4,"humidity":64.9,...,"seq":1}
```

4. ThingsBoard → `aq-node-01` → *Latest telemetry* cập nhật mỗi 5 s; *Attributes* có `location`, `fw`, `fan`, `buzzer`, `purifier`, `cooler`, `humidifier`.
5. Xoay biến trở `potCo2` → giá trị `co2` đổi ngay ở chu kỳ sau.

## 6. Kiểm tra chiều lệnh (RPC → actuator)

Cách 1 – giao diện: tạo dashboard → widget **Control widgets → RPC debug terminal**, chọn device `aq-node-01`, gõ `setFan true`, `setPurifier true`, `setCooler true`, `setHumidifier true` hoặc `setBuzzer true`.

Cách 2 – REST API (PowerShell):

```powershell
$jwt = (Invoke-RestMethod -Method Post -Uri http://localhost:8080/api/auth/login -ContentType 'application/json' -Body '{"username":"tenant@thingsboard.org","password":"tenant"}').token
Invoke-RestMethod -Method Post -Uri http://localhost:8080/api/rpc/oneway/<DEVICE_UUID> -Headers @{ 'X-Authorization' = "Bearer $jwt" } -ContentType 'application/json' -Body '{"method":"setFan","params":true}'
```

`<DEVICE_UUID>`: Device → *Copy device Id*. Kết quả:
- `setFan true`: Relay đóng, LED xanh FAN sáng, attribute `fan` = 1.
- `setPurifier true`: LED xanh dương PURIFIER sáng (máy lọc HEPA kích hoạt), attribute `purifier` = 1.
- `setCooler true`: LED vàng COOLER sáng (điều hòa làm mát kích hoạt), attribute `cooler` = 1.
- `setHumidifier true`: LED cam MIST sáng (máy phun sương kích hoạt), attribute `humidifier` = 1.
- `setBuzzer true`: Còi buzzer kêu + LED đỏ ALERT chớp báo động khẩn cấp, attribute `buzzer` = 1.

## 7. Chạy đủ 5 node

```powershell
pio run            # build cả 5 env node01..node05
code -n sim\node02 # mở cửa sổ VS Code mới cho node02, rồi F1 → Wokwi: Start Simulator
code -n sim\node03
code -n sim\node04
code -n sim\node05
```

Mỗi cửa sổ chạy một ESP32 (cửa sổ gốc chạy node01). Kiểm tra trên ThingsBoard: 5 device đều *Active*, dữ liệu không trộn lẫn (TC04).

## 8. Xử lý lỗi thường gặp

| Hiện tượng | Nguyên nhân / cách xử lý |
|---|---|
| `MQTT ... loi state=-2` | Không tới được broker: ThingsBoard chưa chạy (`docker compose ps`), port 1883 chưa map, hoặc đang chạy Wokwi trên trình duyệt (không vào được localhost). |
| `loi state=5` | Sai access token trong `config.h`, hoặc dùng token cũ của device đã xóa. |
| Giờ trên ThingsBoard lùi dần so với giờ thật | Đang bật `SEND_DEVICE_TS 1` trên Wokwi – đặt lại 0. |
| `DHT22: doc loi` | Dây DHT22 sai chân trong `diagram.json` (phải là GPIO15). |
| RPC báo lỗi 409/504 | Device đang offline – chạy Wokwi trước khi gửi lệnh. |

## 9. Bàn giao cho các thành viên

- **Thịnh (rule chain):** khóa telemetry `temperature, humidity, co2, pm25, air_quality, seq`; RPC `setFan`/`setBuzzer` với `params` boolean. Rule gợi ý (ngưỡng thử nghiệm): `co2 > 1000` → `setFan true`, `co2 < 800` → `setFan false`; `pm25 > 35.4` → `setBuzzer true`.
- **Thái (InfluxDB):** measurement gợi ý `air_quality`, tag `device`, `location`; field là 5 đại lượng + `seq`; thời gian lấy từ `ts`.
- **Khiêm (kiểm thử):** TC02/TC03 xoay biến trở CO₂/PM2.5; TC04 chạy 5 node; đo độ trễ bằng simulator trên máy thật (đồng hồ chuẩn), không dùng `ts` của Wokwi.
