import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Tu dong doc .env tu cung thu muc script (neu chua co trong process.env)
async function loadDotEnv() {
  const envPath = resolve(dirname(fileURLToPath(import.meta.url)), ".env");
  let text;
  try { text = await readFile(envPath, "utf8"); } catch { return; }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
await loadDotEnv();

const INFLUX_URL = (process.env.INFLUX_URL || "http://localhost:8086").replace(/\/$/, "");
const ADMIN_TOKEN = process.env.INFLUXDB_ADMIN_TOKEN;
const ORG = process.env.INFLUXDB_ORG || "airquality-iot";
const BUCKET = process.env.INFLUXDB_BUCKET || "airquality";

if (!ADMIN_TOKEN) throw new Error("Set INFLUXDB_ADMIN_TOKEN from docker/thingsboard/.env first");

const headers = {
  Authorization: `Token ${ADMIN_TOKEN}`,
  "Content-Type": "application/json",
};

async function request(path, options) {
  let response;
  try {
    response = await fetch(`${INFLUX_URL}${path}`, { ...options, signal: AbortSignal.timeout(10000) });
  } catch (error) {
    throw new Error(`InfluxDB request failed: ${error.name}`);
  }
  if (!response.ok) throw new Error(`InfluxDB request failed: HTTP ${response.status}`);
  return response;
}

const orgsResponse = await request(`/api/v2/orgs?org=${encodeURIComponent(ORG)}`, { headers });
const org = (await orgsResponse.json()).orgs?.find((entry) => entry.name === ORG);
if (!org?.id) throw new Error(`InfluxDB organization '${ORG}' not found`);

const bucketsResponse = await request(`/api/v2/buckets?name=${encodeURIComponent(BUCKET)}&orgID=${encodeURIComponent(org.id)}`, { headers });
const bucket = (await bucketsResponse.json()).buckets?.find((entry) => entry.name === BUCKET);
if (!bucket?.id) throw new Error(`InfluxDB bucket '${BUCKET}' not found`);

const tokenResponse = await request("/api/v2/authorizations", {
  method: "POST",
  headers,
  body: JSON.stringify({
    orgID: org.id,
    description: "AirQuality Influx writer bucket-scoped write token",
    status: "active",
    permissions: [{
      action: "write",
      resource: { type: "buckets", id: bucket.id, orgID: org.id },
    }],
  }),
});
const token = (await tokenResponse.json()).token;
if (!token) throw new Error("InfluxDB did not return a token value");
console.log("Created a bucket-scoped write token. Add this to INFLUXDB_WRITE_TOKEN in .env:");
console.log(token);
