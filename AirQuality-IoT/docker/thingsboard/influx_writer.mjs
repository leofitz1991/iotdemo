import http from "node:http";

const PORT = Number(process.env.PORT || 3000);
const INFLUX_URL = (process.env.INFLUX_URL || "http://influxdb:8086").replace(/\/$/, "");
const INFLUX_ORG = process.env.INFLUX_ORG;
const INFLUX_BUCKET = process.env.INFLUX_BUCKET;
const INFLUX_TOKEN = process.env.INFLUX_TOKEN;
const WRITER_API_TOKEN = process.env.WRITER_API_TOKEN;
const MAX_BODY_BYTES = 64 * 1024;
const RETRIES = 3;

if (!INFLUX_ORG || !INFLUX_BUCKET || !INFLUX_TOKEN || !WRITER_API_TOKEN) {
  throw new Error("INFLUX_ORG, INFLUX_BUCKET, INFLUX_TOKEN and WRITER_API_TOKEN are required");
}

const FIELD_TYPES = {
  temperature: "number",
  humidity: "number",
  co2: "number",
  pm25: "number",
  air_quality: "number",
  seq: "integer",
  targetTemperature: "number",
  heatIndex: "number",
  alarmLevel: "string",
  co2Alarm: "boolean",
  airQualityAlarm: "boolean",
  temperatureAlarm: "boolean",
  humidityAlarm: "boolean",
  humidityStatus: "string",
  fanDecision: "string",
  purifierDecision: "string",
  coolerDecision: "string",
  humidifierDecision: "string",
  buzzerDecision: "string",
};
const RAW_FIELDS = new Set(["temperature", "humidity", "co2", "pm25", "air_quality", "seq"]);
const PROCESSED_FIELDS = new Set(Object.keys(FIELD_TYPES));
const MEASUREMENT_FIELDS = {
  air_quality_raw: RAW_FIELDS,
  air_quality_processed: PROCESSED_FIELDS,
};

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateRecord(record, measurement) {
  if (!isPlainObject(record) || !isPlainObject(record.values)) {
    throw new Error("expected an object with a values object");
  }
  if (record.deviceName !== undefined && typeof record.deviceName !== "string") {
    throw new Error("deviceName must be a string");
  }
  if (record.device !== undefined && typeof record.device !== "string") {
    throw new Error("device must be a string");
  }
  if (record.location !== undefined && typeof record.location !== "string") {
    throw new Error("location must be a string");
  }
  if (record.ts !== undefined && record.ts !== null && !Number.isFinite(Number(record.ts))) {
    throw new Error("ts must be epoch milliseconds");
  }
  const allowed = MEASUREMENT_FIELDS[measurement];
  const stringLimits = { alarmLevel: 16, humidityStatus: 16, fanDecision: 8, purifierDecision: 8, coolerDecision: 8, humidifierDecision: 8, buzzerDecision: 8 };
  const allowedStrings = { alarmLevel: ["NORMAL", "WARNING", "CRITICAL"], humidityStatus: ["LOW", "WATCH", "NORMAL"], fanDecision: ["ON", "OFF", "HOLD"], purifierDecision: ["ON", "OFF", "HOLD"], coolerDecision: ["ON", "OFF", "HOLD"], humidifierDecision: ["ON", "OFF", "HOLD"], buzzerDecision: ["ON", "OFF", "HOLD"] };

  if (record.deviceName?.length > 128 || record.device?.length > 128 || record.location?.length > 128) {
    throw new Error("deviceName, device and location must not exceed 128 characters");
  }
  if (record.deviceName && record.device && record.deviceName !== record.device) {
    throw new Error("deviceName and device must not conflict");
  }
  for (const key of Object.keys(record)) {
    if (!["deviceName", "device", "location", "ts", "values"].includes(key)) {
      throw new Error(`unsupported record property '${key}'`);
    }
  }
  for (const key of Object.keys(record.values)) {
    if (!allowed.has(key)) throw new Error(`unsupported field '${key}' for ${measurement}`);
  }
  for (const [key, allowedValues] of Object.entries(allowedStrings)) {
    if (record.values[key] !== undefined && record.values[key] !== null && !allowedValues.includes(record.values[key])) {
      throw new Error(`${key} has an unsupported value`);
    }
  }
  for (const [key, value] of Object.entries(record.values)) {
    if (!allowed.has(key)) throw new Error(`unsupported field '${key}' for ${measurement}`);
    if (value === null || value === undefined) continue;
    const type = FIELD_TYPES[key];
    if (type === "number" && (typeof value !== "number" || !Number.isFinite(value))) {
      throw new Error(`${key} must be a finite number`);
    }
    if (type === "integer" && !Number.isSafeInteger(value)) {
      throw new Error(`${key} must be a safe integer`);
    }
    if (type === "boolean" && typeof value !== "boolean") {
      throw new Error(`${key} must be a boolean`);
    }
    if (type === "string" && typeof value !== "string") {
      throw new Error(`${key} must be a string`);
    }
    if (type === "string" && value.length > stringLimits[key]) {
      throw new Error(`${key} exceeds its maximum length`);
    }
  }
}

function escapeTag(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll(" ", "\\ ").replaceAll(",", "\\,").replaceAll("=", "\\=");
}

function escapeString(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n")}"`;
}

function formatField(value, type) {
  if (type === "string") return escapeString(value);
  if (type === "boolean") return value ? "true" : "false";
  if (type === "integer") {
    const n = Number(value);
    if (!Number.isSafeInteger(n)) throw new Error("invalid integer field");
    return `${n}i`;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error("invalid numeric field");
  return String(n);
}

function toLineProtocol(record, measurement) {
  validateRecord(record, measurement);
  const device = record.deviceName || record.device || "unknown";
  const tags = [`device=${escapeTag(device)}`];
  if (record.location) tags.push(`location=${escapeTag(record.location)}`);

  const fields = [];
  for (const [key, type] of Object.entries(FIELD_TYPES)) {
    if (!MEASUREMENT_FIELDS[measurement].has(key)) continue;
    const value = record.values[key];
    if (value === undefined || value === null) continue;
    fields.push(`${key}=${formatField(value, type)}`);
  }
  if (!fields.length) throw new Error("no supported fields in values");

  const ts = Number(record.ts);
  // ThingsBoard metadata timestamps are epoch milliseconds; permit a small clock skew only.
  const timestampNs = Number.isSafeInteger(ts) && ts >= 946684800000 && ts <= Date.now() + 300000
    ? BigInt(ts) * 1_000_000n
    : BigInt(Date.now()) * 1_000_000n;
  return `${measurement},${tags.join(",")} ${fields.join(",")} ${timestampNs}`;
}

async function writeInflux(line) {
  const url = new URL(`${INFLUX_URL}/api/v2/write`);
  url.searchParams.set("org", INFLUX_ORG);
  url.searchParams.set("bucket", INFLUX_BUCKET);
  url.searchParams.set("precision", "ns");
  let lastError;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Token ${INFLUX_TOKEN}`,
          "Content-Type": "text/plain; charset=utf-8",
        },
        body: line,
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) return;
      lastError = new Error(`InfluxDB HTTP ${response.status}`);
      if (response.status >= 400 && response.status < 500 && response.status !== 429) break;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * (2 ** attempt)));
  }
  throw lastError || new Error("InfluxDB write failed");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" }).end('{"status":"ok"}');
    return;
  }
  const measurement = req.url === "/write/raw" ? "air_quality_raw"
    : req.url === "/write/processed" ? "air_quality_processed" : null;
  if (req.method !== "POST" || !measurement) {
    res.writeHead(404).end();
    return;
  }
  if (req.headers.authorization !== `Bearer ${WRITER_API_TOKEN}`) {
    res.writeHead(401).end();
    return;
  }
  try {
    const body = await readBody(req);
    const record = JSON.parse(body);
    const line = toLineProtocol(record, measurement);
    await writeInflux(line);
    res.writeHead(204).end();
  } catch (error) {
    const status = error instanceof SyntaxError ? 400 : error.message === "request body too large" ? 413
      : error.message.startsWith("InfluxDB HTTP") || error.name === "TimeoutError" || error.name === "TypeError" ? 502 : 400;
    console.error(`[${measurement}] ${error.message}`);
    res.writeHead(status, { "content-type": "application/json" })
      .end(JSON.stringify({ error: status === 400 ? error.message : status === 413 ? "request body too large" : "write failed" }));
  }
});

server.listen(PORT, "0.0.0.0", () => console.log(`Influx writer listening on :${PORT}`));
