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

async function main() {
  const TB_URL = (process.env.TB_URL || "http://localhost:8080").replace(/\/$/, "");
  const TB_USERNAME = process.env.TB_USERNAME;
  const TB_PASSWORD = process.env.TB_PASSWORD;
  const backupFile = process.env.RULE_CHAIN_BACKUP || process.argv[2];
  if (!TB_USERNAME || !TB_PASSWORD) throw new Error("Set TB_USERNAME and TB_PASSWORD before restoring the Root Rule Chain");
  if (!backupFile) throw new Error("Usage: set RULE_CHAIN_BACKUP or pass the backup JSON file path");

  const metadata = JSON.parse(await readFile(backupFile, "utf8"));
  const chainId = metadata.ruleChainId?.id;
  if (!chainId || !Array.isArray(metadata.nodes) || !Array.isArray(metadata.connections)) {
    throw new Error("Backup does not contain Root Rule Chain metadata (id, nodes, and connections)");
  }

  const loginRes = await fetch(`${TB_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: TB_USERNAME, password: TB_PASSWORD }),
  });
  if (!loginRes.ok) throw new Error(`ThingsBoard login failed: HTTP ${loginRes.status}`);
  const { token } = await loginRes.json();
  const response = await fetch(`${TB_URL}/api/ruleChain/metadata`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Authorization": `Bearer ${token}` },
    body: JSON.stringify(metadata),
  });
  if (!response.ok) throw new Error(`Failed to restore Root Rule Chain: HTTP ${response.status} ${await response.text()}`);
  console.log(`Restored Root Rule Chain metadata from ${backupFile}`);
}

main().catch((error) => {
  console.error(`Restore failed: ${error.message}`);
  process.exit(1);
});
