// Nut giam sat chat luong khong khi - ESP32 mo phong tren Wokwi
// Luong: cam bien -> telemetry MQTT -> ThingsBoard ; ThingsBoard RPC -> relay quat / buzzer
//
// Cam bien:
//   - DHT22 (GPIO15): nhiet do, do am (keo slider tren Wokwi de thay doi)
//   - Bien tro 1 (GPIO34): muc nen CO2 400..5000 ppm
//   - Bien tro 2 (GPIO35): muc nen PM2.5 0..300 ug/m3
//   Gia tri gui di = muc nen + troi cham + nhieu nho -> khong bao gio la hang so.
// Actuator:
//   - Relay (GPIO26) cap nguon cho LED xanh "quat thong gio"
//   - Buzzer (GPIO25) + LED do (GPIO33): canh bao

#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <sys/time.h>
#include <esp_sntp.h>
#include "config.h"

WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);
DHT dht(PIN_DHT, DHT22);

uint32_t seq = 0;
uint32_t lastSample = 0;
bool fanOn = false;
bool buzzerOn = false;
bool purifierOn = false;
bool coolerOn = false;
bool humidifierOn = false;

// ===== Thermostat State & Control =====
float targetTemperature = THIS_NODE.targetTemp;
String hvacMode = "AUTO"; // AUTO | COOL | FAN | OFF

// Thanh phan troi cham (random walk) de du lieu bien doi tu nhien
float co2Drift = 0;
float pmDrift = 0;

// ---------- Tien ich ----------

float noise(float amplitude) {
  return ((float)random(-1000, 1001) / 1000.0f) * amplitude;
}

float randomWalk(float current, float step, float limit) {
  current += noise(step);
  return constrain(current, -limit, limit);
}

// Epoch milliseconds (UTC); tra ve 0 neu NTP chua dong bo
uint64_t epochMillis() {
  struct timeval tv;
  gettimeofday(&tv, nullptr);
  if (tv.tv_sec < 1700000000) return 0;
  return (uint64_t)tv.tv_sec * 1000ULL + tv.tv_usec / 1000;
}

// Chi so con PM2.5 theo bang breakpoint US EPA (ban sua doi 2024).
// Luu y: AQI chuan tinh tren trung binh 24h; o day tinh tren gia tri tuc thoi
// nen chi la "chi so quy uoc" phuc vu giam sat, khong phai AQI chinh thuc.
int aqiFromPm25(float c) {
  struct Bp { float cLo, cHi; int iLo, iHi; };
  static const Bp table[] = {
    {0.0f,   9.0f,   0,   50},
    {9.1f,   35.4f,  51,  100},
    {35.5f,  55.4f,  101, 150},
    {55.5f,  125.4f, 151, 200},
    {125.5f, 225.4f, 201, 300},
    {225.5f, 325.4f, 301, 500},
  };
  c = floorf(c * 10) / 10;  // EPA cat ve 1 chu so thap phan
  for (const Bp& b : table) {
    if (c <= b.cHi) {
      return (int)lroundf((b.iHi - b.iLo) / (b.cHi - b.cLo) * (c - b.cLo) + b.iLo);
    }
  }
  return 500;
}

// ---------- Actuator ----------

void applyActuators() {
  digitalWrite(PIN_RELAY_FAN, fanOn ? HIGH : LOW);
  digitalWrite(PIN_LED_ALERT, buzzerOn ? HIGH : LOW);
  digitalWrite(PIN_LED_PURIFIER, purifierOn ? HIGH : LOW);
  digitalWrite(PIN_LED_COOLER, coolerOn ? HIGH : LOW);
  digitalWrite(PIN_LED_HUMIDIFIER, humidifierOn ? HIGH : LOW);
  if (buzzerOn) tone(PIN_BUZZER, 1000);
  else noTone(PIN_BUZZER);
}

void publishState() {
  JsonDocument doc;
  doc["fan"] = fanOn ? 1 : 0;
  doc["buzzer"] = buzzerOn ? 1 : 0;
  doc["purifier"] = purifierOn ? 1 : 0;
  doc["cooler"] = coolerOn ? 1 : 0;
  doc["humidifier"] = humidifierOn ? 1 : 0;
  doc["targetTemperature"] = targetTemperature;
  doc["hvacMode"] = hvacMode;
  char buf[200];
  serializeJson(doc, buf);
  mqtt.publish(TOPIC_ATTRIBUTES, buf);
}

// ---------- RPC tu ThingsBoard ----------
// Request:  topic v1/devices/me/rpc/request/{id}, payload {"method":"setFan","params":true}
//           hoac Thermostat RPC: {"method":"setTargetTemp","params":23.5}
// Response: topic v1/devices/me/rpc/response/{id}, payload {"fan":1,"buzzer":0,...}

void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  String t(topic);
  String requestId = t.substring(t.lastIndexOf('/') + 1);

  JsonDocument req;
  if (deserializeJson(req, payload, length)) {
    Serial.printf("[RPC] JSON loi: %.*s\n", length, (char*)payload);
    return;
  }
  const char* method = req["method"] | "";
  bool value = req["params"].is<bool>() ? req["params"].as<bool>()
                                        : (req["params"] | 0) != 0;

  if (strcmp(method, "setFan") == 0) {
    fanOn = value;
  } else if (strcmp(method, "setBuzzer") == 0) {
    buzzerOn = value;
  } else if (strcmp(method, "setPurifier") == 0) {
    purifierOn = value;
  } else if (strcmp(method, "setCooler") == 0 || strcmp(method, "setAC") == 0) {
    coolerOn = value;
  } else if (strcmp(method, "setHumidifier") == 0 || strcmp(method, "setMist") == 0) {
    humidifierOn = value;
  } else if (strcmp(method, "setTargetTemp") == 0 || strcmp(method, "setSetpoint") == 0 || strcmp(method, "setTemperature") == 0) {
    targetTemperature = req["params"].as<float>();
    Serial.printf("[Thermostat RPC] Cap nhat nhiet do muc tieu: %.1f C\n", targetTemperature);
  } else if (strcmp(method, "setHvacMode") == 0) {
    hvacMode = req["params"].as<const char*>();
    Serial.printf("[Thermostat RPC] Cap nhat che do HVAC: %s\n", hvacMode.c_str());
  } else if (strcmp(method, "getState") != 0) {
    Serial.printf("[RPC] method khong ho tro: %s\n", method);
  }
  applyActuators();
  Serial.printf("[RPC] %s -> fan=%d buzzer=%d purifier=%d cooler=%d humidifier=%d targetTemp=%.1f hvac=%s\n",
                method, fanOn, buzzerOn, purifierOn, coolerOn, humidifierOn, targetTemperature, hvacMode.c_str());

  JsonDocument resp;
  resp["fan"] = fanOn ? 1 : 0;
  resp["buzzer"] = buzzerOn ? 1 : 0;
  resp["purifier"] = purifierOn ? 1 : 0;
  resp["cooler"] = coolerOn ? 1 : 0;
  resp["humidifier"] = humidifierOn ? 1 : 0;
  resp["targetTemperature"] = targetTemperature;
  resp["hvacMode"] = hvacMode;
  char buf[200];
  serializeJson(resp, buf);
  mqtt.publish((String(TOPIC_RPC_RESP) + requestId).c_str(), buf);
  publishState();
}

// ---------- Ket noi ----------

void connectWifi() {
  Serial.printf("WiFi: ket noi %s", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD, 6);  // Wokwi-GUEST o kenh 6 -> ket noi nhanh hon
  while (WiFi.status() != WL_CONNECTED) {
    delay(250);
    Serial.print(".");
  }
  Serial.printf(" OK, IP=%s\n", WiFi.localIP().toString().c_str());
}

void connectMqtt() {
  while (!mqtt.connected()) {
    if (WiFi.status() != WL_CONNECTED) connectWifi();
    Serial.printf("MQTT: %s:%d client=%s ... ", MQTT_HOST, MQTT_PORT, THIS_NODE.clientId);
    // ThingsBoard: username = access token, password rong
    if (mqtt.connect(THIS_NODE.clientId, THIS_NODE.token, nullptr)) {
      Serial.println("OK");
      mqtt.subscribe(TOPIC_RPC_REQ, 1);

      JsonDocument attrs;
      attrs["location"] = THIS_NODE.location;
      attrs["zone"] = THIS_NODE.zone;
      attrs["latitude"] = THIS_NODE.latitude;
      attrs["longitude"] = THIS_NODE.longitude;
      attrs["address"] = THIS_NODE.address;
      attrs["site"] = "Mekong Innovation Technology Park (Mekong MTP)";
      attrs["fw"] = FW_VERSION;
      attrs["sample_interval_ms"] = SAMPLE_INTERVAL_MS;
      attrs["targetTemperature"] = targetTemperature;
      attrs["hvacMode"] = hvacMode;
      attrs["temperatureAlarmThreshold"] = targetTemperature + 2.0f;
      attrs["temperatureAlarmFlag"] = true;
      attrs["humidityAlarmThreshold"] = 65.0f;
      attrs["humidityAlarmFlag"] = true;
      attrs["fan"] = fanOn ? 1 : 0;
      attrs["buzzer"] = buzzerOn ? 1 : 0;
      attrs["purifier"] = purifierOn ? 1 : 0;
      attrs["cooler"] = coolerOn ? 1 : 0;
      attrs["humidifier"] = humidifierOn ? 1 : 0;
      char buf[512];
      serializeJson(attrs, buf);
      mqtt.publish(TOPIC_ATTRIBUTES, buf);
    } else {
      // state 5 = sai token; -2 = khong toi duoc broker (kiem tra Docker / gateway)
      Serial.printf("loi state=%d, thu lai sau 3s\n", mqtt.state());
      delay(3000);
    }
  }
}

// ---------- Doc cam bien va gui telemetry ----------

void sampleAndPublish() {
  float temp = dht.readTemperature();
  float hum = dht.readHumidity();
  if (isnan(temp) || isnan(hum)) {
    Serial.println("DHT22: doc loi, bo qua chu ky nay");
    return;
  }

  co2Drift = randomWalk(co2Drift, 15, 120);
  pmDrift = randomWalk(pmDrift, 0.8f, 6);

  float co2Base = 400 + analogRead(PIN_POT_CO2) / 4095.0f * 4600;
  float pmBase = analogRead(PIN_POT_PM25) / 4095.0f * 300;

  float temperature = temp + noise(0.15f);
  float humidity = constrain(hum + noise(0.5f), 0, 100);
  int co2 = (int)max(400.0f, co2Base + co2Drift + noise(10));
  float pm25 = max(0.0f, pmBase + pmDrift + noise(0.5f));
  int airQuality = aqiFromPm25(pm25);

  // Thuat toan dieu nhiet Thermostat tu dong (khi hvacMode = AUTO)
  if (hvacMode == "AUTO") {
    if (temperature > targetTemperature + 0.8f) {
      coolerOn = true;
    } else if (temperature <= targetTemperature - 0.4f) {
      coolerOn = false;
    }
    applyActuators();
  }

  // ThingsBoard: {"ts": <epoch ms>, "values": {...}}; khong co ts -> TB dung gio server
  JsonDocument doc;
  uint64_t ts = SEND_DEVICE_TS ? epochMillis() : 0;
  JsonObject values;
  if (ts) {
    doc["ts"] = ts;
    values = doc["values"].to<JsonObject>();
  } else {
    values = doc.to<JsonObject>();
  }
  values["temperature"] = roundf(temperature * 10) / 10;
  values["humidity"] = roundf(humidity * 10) / 10;
  values["targetTemperature"] = targetTemperature;
  values["co2"] = co2;
  values["pm25"] = roundf(pm25 * 10) / 10;
  values["air_quality"] = airQuality;
  values["cooler"] = coolerOn ? 1 : 0;
  values["fan"] = fanOn ? 1 : 0;
  values["seq"] = ++seq;

  char buf[256];
  size_t n = serializeJson(doc, buf);
  bool ok = mqtt.publish(TOPIC_TELEMETRY, (const uint8_t*)buf, n, false);
  Serial.printf("[%s] %s %s\n", THIS_NODE.clientId, ok ? "PUB" : "FAIL", buf);
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_RELAY_FAN, OUTPUT);
  pinMode(PIN_LED_ALERT, OUTPUT);
  pinMode(PIN_LED_PURIFIER, OUTPUT);
  pinMode(PIN_LED_COOLER, OUTPUT);
  pinMode(PIN_LED_HUMIDIFIER, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  applyActuators();

  randomSeed(esp_random());
  dht.begin();
  Serial.printf("\n=== %s (%s) fw %s ===\n", THIS_NODE.clientId, THIS_NODE.location, FW_VERSION);

  connectWifi();
  sntp_set_sync_interval(NTP_SYNC_INTERVAL_MS);
  configTime(GMT_OFFSET_S, 0, NTP_SERVER);

  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setKeepAlive(MQTT_KEEPALIVE_S);
  mqtt.setBufferSize(512);
  mqtt.setCallback(onMqttMessage);
  connectMqtt();
}

void loop() {
  if (!mqtt.connected()) connectMqtt();
  mqtt.loop();

  if (millis() - lastSample >= SAMPLE_INTERVAL_MS) {
    lastSample = millis();
    sampleAndPublish();
  }
}
