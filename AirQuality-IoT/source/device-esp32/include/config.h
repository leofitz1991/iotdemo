#pragma once

// ===== WiFi (mang ao cua Wokwi) =====
#define WIFI_SSID     "Wokwi-GUEST"
#define WIFI_PASSWORD ""

// ===== MQTT broker = MQTT transport cua ThingsBoard =====
// Wokwi for VS Code: host.wokwi.internal tro ve may that (localhost).
// Du phong (Wokwi tren trinh duyet): doi sang dia chi ThingsBoard public.
#define MQTT_HOST      "host.wokwi.internal"
#define MQTT_PORT      1883
#define MQTT_KEEPALIVE_S 30      // giay

// ===== Topic chuan cua ThingsBoard Device MQTT API =====
#define TOPIC_TELEMETRY   "v1/devices/me/telemetry"
#define TOPIC_ATTRIBUTES  "v1/devices/me/attributes"
#define TOPIC_RPC_REQ     "v1/devices/me/rpc/request/+"
#define TOPIC_RPC_RESP    "v1/devices/me/rpc/response/"

// ===== Chu ky lay mau =====
#define SAMPLE_INTERVAL_MS 5000

// ===== NTP (gio Viet Nam UTC+7, ts gui di la epoch UTC) =====
#define NTP_SERVER   "pool.ntp.org"
#define GMT_OFFSET_S (7 * 3600)

// Gui "ts" (thoi diem do) tu thiet bi hay khong.
// 0 = khong gui -> ThingsBoard gan thoi diem nhan (khuyen dung tren Wokwi):
//     Wokwi thuong chay cham hon thoi gian thuc (~50%), dong ho ESP32 mo phong
//     tre dan so voi gio that (do duoc ~30 s moi phut) nen ts thiet bi sai lech.
// 1 = gui ts epoch ms (dung cho ESP32 that, dong ho chay dung toc do).
#define SEND_DEVICE_TS 0
#define NTP_SYNC_INTERVAL_MS 15000   // dong bo lai NTP moi 15 s (gia tri toi thieu cua SNTP)

#define FW_VERSION "1.0.0"

// ===== Thong tin tung node: dan access token lay tu ThingsBoard =====
#ifndef NODE_ID
#define NODE_ID 1
#endif

struct NodeInfo {
  const char* clientId;
  const char* token;
  const char* location;     // Ma dinh danh vi tri
  const char* zone;         // Ten phan khu Mekong MTP
  double latitude;          // Vi do GPS (ThingsBoard Map Widget)
  double longitude;         // Kinh do GPS (ThingsBoard Map Widget)
  const char* address;      // Dia chi khu vuc
  float targetTemp;         // Nhiet do muc tieu Thermostat (°C)
};

// Vi tri cac tram quan trac xung quanh Cong vien phan mem Mekong (Mekong MTP)
// Dia chi: Ap Phong Thuan, xa Tan My Chanh, TP. My Tho, Tien Giang (mat tien QL50)
// Toa do trung tam: 10.355847° N, 106.402084° E (khuon vien 70.000 m2)
static const NodeInfo NODES[] = {
  {
    "aq-node-01", "cfDE7UCWheIlZo6hGJer",
    "mtp-block-a-datacenter",
    "Toa nha A - Dieu hanh & Data Center",
    10.35520, 106.40180,
    "Khu A, Mekong MTP, Tan My Chanh, TP. My Tho",
    22.0f
  },
  {
    "aq-node-02", "Fgpboz3AmE0i69LpsrLy",
    "mtp-block-b-software-hub",
    "Toa nha B - Khu Doanh nghiep Phan mem",
    10.35575, 106.40225,
    "Khu B, Mekong MTP, Tan My Chanh, TP. My Tho",
    25.0f
  },
  {
    "aq-node-03", "Si7Fj23cINvVTu6kkmbQ",
    "mtp-block-c-iot-incubator",
    "Toa nha C - Vuon uom & IoT Lab",
    10.35620, 106.40160,
    "Khu C, Mekong MTP, Tan My Chanh, TP. My Tho",
    24.0f
  },
  {
    "aq-node-04", "wjIuDs8rqNOkrwXidjOF",
    "mtp-hall-convention-center",
    "Hoi truong Da nang 600 cho",
    10.35470, 106.40260,
    "Trung tam Hoi nghi MTP, Tan My Chanh, TP. My Tho",
    23.5f
  },
  {
    "aq-node-05", "3dLgQjXSE9atDwyyQxGd",
    "mtp-gate-ambient-ql50",
    "Cong chinh & Quan trac Ngoai vi QL50",
    10.35415, 106.40120,
    "Cong MTP mat tien QL50, Tan My Chanh, TP. My Tho",
    28.0f
  },
};

static const NodeInfo& THIS_NODE = NODES[NODE_ID - 1];

// ===== Chan ket noi (khop voi diagram.json) =====
#define PIN_DHT             15
#define PIN_POT_CO2         34
#define PIN_POT_PM25        35
#define PIN_RELAY_FAN       26  // Quat thong gio (CO2) - Relay + LED Green
#define PIN_BUZZER          25  // Coi bao dong nguy cap
#define PIN_LED_ALERT       33  // Den bao dong do (Emergency Alert) - LED Red
#define PIN_LED_PURIFIER    27  // May loc khong khi HEPA (PM2.5 / AQI) - LED Blue
#define PIN_LED_COOLER      14  // Dieu hoa / Lam mat (Nhiet do) - LED Yellow
#define PIN_LED_HUMIDIFIER  13  // May phun suong / Tao am (Do am) - LED Orange
