// Simulator nhieu thiet bi do chat luong khong khi - phuc vu thu tai (scale test)
// Cung mo hinh du lieu voi firmware ESP32 tren Wokwi (5 dai luong + seq).
//
// Hai che do dich:
//   --target tb   : moi thiet bi la 1 device ThingsBoard (tu tao qua REST API),
//                   ket noi MQTT bang access token, topic v1/devices/me/telemetry
//   --target mqtt : broker MQTT thuong (Mosquitto...), topic environment/<device_id>/telemetry,
//                   payload phang co device_id, location, ts (dung cho PoC InfluxDB)
//
// Vi du:
//   node simulator.mjs --target tb --devices 10 --interval 5000 --duration 120
//   node simulator.mjs --target mqtt --port 1884 --devices 100 --interval 1000 --duration 60
//   node simulator.mjs --target tb --cleanup        (xoa cac device sim-*)

import { parseArgs } from "node:util";
import fs from "node:fs";
import path from "node:path";
import mqtt from "mqtt";

const { values: opt } = parseArgs({
  options: {
    target:   { type: "string", default: "tb" },
    host:     { type: "string", default: "localhost" },
    port:     { type: "string" },
    devices:  { type: "string", default: "10" },
    interval: { type: "string", default: "5000" },   // ms giua 2 ban tin cua 1 thiet bi
    duration: { type: "string", default: "60" },     // giay; 0 = chay den khi Ctrl+C
    qos:      { type: "string", default: "1" },
    scenario: { type: "string", default: "normal" },  // normal | co2-high | pm-high
    prefix:   { type: "string", default: "sim" },
    "tb-url": { type: "string", default: "http://localhost:8080" },
    "tb-user": { type: "string", default: "tenant@thingsboard.org" },
    "tb-pass": { type: "string", default: "tenant" },
    cleanup:  { type: "boolean", default: false },
    help:     { type: "boolean", short: "h", default: false },
  },
});

if (opt.help) {
  console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(0, 15).join("\n"));
  process.exit(0);
}

const N = parseInt(opt.devices, 10);
const INTERVAL = parseInt(opt.interval, 10);
const DURATION = parseInt(opt.duration, 10);
const QOS = parseInt(opt.qos, 10);
const PORT = parseInt(opt.port ?? (opt.target === "tb" ? "1883" : "1884"), 10);
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const TOKENS_FILE = path.join(HERE, "tokens.json");
const RESULTS_FILE = path.join(HERE, "results", "scale-results.csv");
const MTP_NODES = [
  { location: "mtp-block-a-datacenter", zone: "Toa nha A - Dieu hanh & Data Center", lat: 10.35520, lng: 106.40180 },
  { location: "mtp-block-b-software-hub", zone: "Toa nha B - Doanh nghiep Phan mem", lat: 10.35575, lng: 106.40225 },
  { location: "mtp-block-c-iot-incubator", zone: "Toa nha C - Vuon uom & IoT Lab", lat: 10.35620, lng: 106.40160 },
  { location: "mtp-hall-convention-center", zone: "Hoi truong Da nang 600 cho", lat: 10.35470, lng: 106.40260 },
  { location: "mtp-gate-ambient-ql50", zone: "Cong chinh & Quan trac Ngoai vi QL50", lat: 10.35415, lng: 106.40120 },
];
const LOCATIONS = MTP_NODES.map((n) => n.location);

// ---------- Mo hinh du lieu (giong firmware) ----------

const noise = (a) => (Math.random() * 2 - 1) * a;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round1 = (v) => Math.round(v * 10) / 10;

// Chi so con PM2.5 theo breakpoint US EPA 2024 - chi so quy uoc (gia tri tuc thoi)
function aqiFromPm25(c) {
  const t = [[0, 9, 0, 50], [9.1, 35.4, 51, 100], [35.5, 55.4, 101, 150],
             [55.5, 125.4, 151, 200], [125.5, 225.4, 201, 300], [225.5, 325.4, 301, 500]];
  c = Math.floor(c * 10) / 10;
  for (const [cLo, cHi, iLo, iHi] of t) {
    if (c <= cHi) return Math.round((iHi - iLo) / (cHi - cLo) * (c - cLo) + iLo);
  }
  return 500;
}

function makeSensor(i) {
  const base = {
    temperature: 26 + Math.random() * 4,
    humidity: 55 + Math.random() * 15,
    co2: opt.scenario === "co2-high" ? 1300 + Math.random() * 400 : 600 + Math.random() * 400,
    pm25: opt.scenario === "pm-high" ? 60 + Math.random() * 40 : 8 + Math.random() * 20,
  };
  const drift = { temperature: 0, humidity: 0, co2: 0, pm25: 0 };
  let seq = 0;
  return () => {
    drift.temperature = clamp(drift.temperature + noise(0.05), -1.5, 1.5);
    drift.humidity = clamp(drift.humidity + noise(0.3), -5, 5);
    drift.co2 = clamp(drift.co2 + noise(15), -120, 120);
    drift.pm25 = clamp(drift.pm25 + noise(0.8), -6, 6);
    const pm25 = Math.max(0, base.pm25 + drift.pm25 + noise(0.5));
    return {
      temperature: round1(base.temperature + drift.temperature + noise(0.15)),
      humidity: round1(clamp(base.humidity + drift.humidity + noise(0.5), 0, 100)),
      co2: Math.round(Math.max(400, base.co2 + drift.co2 + noise(10))),
      pm25: round1(pm25),
      air_quality: aqiFromPm25(pm25),
      seq: ++seq,
    };
  };
}

// ---------- ThingsBoard REST: tao / xoa device ----------

async function tbLogin() {
  const r = await fetch(`${opt["tb-url"]}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: opt["tb-user"], password: opt["tb-pass"] }),
  });
  if (!r.ok) throw new Error(`Dang nhap ThingsBoard that bai: HTTP ${r.status}`);
  return { "X-Authorization": `Bearer ${(await r.json()).token}`, "Content-Type": "application/json" };
}

async function tbProvision(n) {
  const cache = fs.existsSync(TOKENS_FILE) ? JSON.parse(fs.readFileSync(TOKENS_FILE, "utf8")) : {};
  const names = Array.from({ length: n }, (_, i) => `${opt.prefix}-${String(i + 1).padStart(4, "0")}`);
  const missing = names.filter((name) => !cache[name]);
  if (missing.length) {
    const H = await tbLogin();
    console.log(`Tao ${missing.length} device tren ThingsBoard...`);
    for (const name of missing) {
      let dev = await fetch(`${opt["tb-url"]}/api/tenant/devices?deviceName=${name}`, { headers: H })
        .then((r) => (r.ok ? r.json() : null));
      if (!dev) {
        const idx = parseInt(name.split("-").pop(), 10) - 1;
        dev = await fetch(`${opt["tb-url"]}/api/device`, {
          method: "POST", headers: H,
          body: JSON.stringify({ name, label: LOCATIONS[idx % LOCATIONS.length], type: "default" }),
        }).then((r) => r.json());
      }
      const cred = await fetch(`${opt["tb-url"]}/api/device/${dev.id.id}/credentials`, { headers: H })
        .then((r) => r.json());
      cache[name] = cred.credentialsId;
    }
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(cache, null, 2));
  }
  return names.map((name) => ({ name, token: cache[name] }));
}

async function tbCleanup() {
  const H = await tbLogin();
  let removed = 0;
  for (;;) {
    const page = await fetch(
      `${opt["tb-url"]}/api/tenant/devices?pageSize=100&page=0&textSearch=${opt.prefix}-`,
      { headers: H }).then((r) => r.json());
    const devs = page.data.filter((d) => d.name.startsWith(`${opt.prefix}-`));
    if (!devs.length) break;
    for (const d of devs) {
      await fetch(`${opt["tb-url"]}/api/device/${d.id.id}`, { method: "DELETE", headers: H });
      removed++;
    }
  }
  if (fs.existsSync(TOKENS_FILE)) fs.unlinkSync(TOKENS_FILE);
  console.log(`Da xoa ${removed} device ${opt.prefix}-*`);
}

// ---------- Thong ke ----------

const stats = { sent: 0, acked: 0, errors: 0, ackLat: [], windowSent: 0 };

function percentile(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

function appendResult(row) {
  fs.mkdirSync(path.dirname(RESULTS_FILE), { recursive: true });
  const header = "time,target,devices,interval_ms,qos,scenario,duration_s,sent,acked,errors," +
                 "msg_per_s,ack_p50_ms,ack_p95_ms,ack_max_ms\n";
  if (!fs.existsSync(RESULTS_FILE)) fs.writeFileSync(RESULTS_FILE, header);
  fs.appendFileSync(RESULTS_FILE, row.join(",") + "\n");
}

// ---------- Chay ----------

async function main() {
  if (opt.cleanup) {
    if (opt.target !== "tb") throw new Error("--cleanup chi dung voi --target tb");
    return tbCleanup();
  }

  const devices = opt.target === "tb"
    ? await tbProvision(N)
    : Array.from({ length: N }, (_, i) => ({ name: `${opt.prefix}-${String(i + 1).padStart(4, "0")}` }));

  console.log(`Target=${opt.target} ${opt.host}:${PORT} | devices=${N} | interval=${INTERVAL}ms | ` +
              `QoS=${QOS} | scenario=${opt.scenario} | duration=${DURATION || "vo han"}s`);
  console.log(`Tai ly thuyet: ${(N * 1000 / INTERVAL).toFixed(1)} msg/s\n`);

  const clients = [];
  const timers = [];
  const started = Date.now();

  devices.forEach((dev, i) => {
    const client = mqtt.connect({
      host: opt.host, port: PORT, clientId: dev.name,
      username: dev.token, reconnectPeriod: 2000, connectTimeout: 10000,
    });
    client.on("error", (e) => { stats.errors++; if (stats.errors <= 3) console.error(`[${dev.name}] ${e.message}`); });
    client.on("connect", () => {
      if (opt.target === "tb") {
        const meta = MTP_NODES[i % MTP_NODES.length];
        client.publish("v1/devices/me/attributes", JSON.stringify({
          location: meta.location,
          zone: meta.zone,
          latitude: meta.lat,
          longitude: meta.lng,
          site: "Mekong Innovation Technology Park (Mekong MTP)",
          address: "Ap Phong Thuan, Tan My Chanh, TP. My Tho, Tien Giang (QL50)"
        }), { qos: 1 });
      }
    });
    clients.push(client);

    const nextValues = makeSensor(i);
    const location = LOCATIONS[i % LOCATIONS.length];
    const publish = () => {
      if (!client.connected) return;
      const v = nextValues();
      const ts = Date.now();  // dong ho may that -> dung de do do tre
      const [topic, payload] = opt.target === "tb"
        ? ["v1/devices/me/telemetry", { ts, values: v }]
        : [`environment/${dev.name}/telemetry`, { device_id: dev.name, location, ts, ...v }];
      const t0 = performance.now();
      stats.sent++; stats.windowSent++;
      client.publish(topic, JSON.stringify(payload), { qos: QOS }, (err) => {
        if (err) { stats.errors++; return; }
        stats.acked++;
        if (QOS > 0) stats.ackLat.push(performance.now() - t0);
      });
    };
    // Rai deu thoi diem gui cua cac thiet bi trong 1 chu ky de tranh don cuc
    timers.push(setTimeout(() => timers.push(setInterval(publish, INTERVAL)), (INTERVAL / N) * i));
  });

  const report = setInterval(() => {
    const el = ((Date.now() - started) / 1000).toFixed(0);
    console.log(`t=${el.padStart(4)}s  connected=${String(clients.filter((c) => c.connected).length).padStart(4)}/${N}  ` +
                `rate=${(stats.windowSent / 5).toFixed(1).padStart(7)} msg/s  sent=${stats.sent}  ` +
                `acked=${stats.acked}  errors=${stats.errors}`);
    stats.windowSent = 0;
  }, 5000);

  const stop = () => {
    clearInterval(report);
    timers.forEach((t) => { clearTimeout(t); clearInterval(t); });
    const dur = (Date.now() - started) / 1000;
    const p50 = percentile(stats.ackLat, 50), p95 = percentile(stats.ackLat, 95);
    const max = stats.ackLat.length ? Math.max(...stats.ackLat) : 0;
    console.log(`\n=== Ket qua ===`);
    console.log(`Thoi gian: ${dur.toFixed(1)} s | gui: ${stats.sent} | ack: ${stats.acked} | loi: ${stats.errors}`);
    console.log(`Throughput: ${(stats.acked / dur).toFixed(1)} msg/s`);
    if (QOS > 0) console.log(`PUBACK latency: p50=${p50.toFixed(1)} ms  p95=${p95.toFixed(1)} ms  max=${max.toFixed(1)} ms`);
    appendResult([new Date().toISOString(), opt.target, N, INTERVAL, QOS, opt.scenario, dur.toFixed(1),
                  stats.sent, stats.acked, stats.errors, (stats.acked / dur).toFixed(2),
                  p50.toFixed(1), p95.toFixed(1), max.toFixed(1)]);
    console.log(`Da ghi them 1 dong vao ${path.relative(process.cwd(), RESULTS_FILE)}`);
    Promise.all(clients.map((c) => new Promise((res) => c.end(false, {}, res)))).then(() => process.exit(0));
  };

  process.on("SIGINT", stop);
  if (DURATION > 0) setTimeout(stop, DURATION * 1000);
}

main().catch((e) => { console.error("LOI:", e.message); process.exit(1); });
