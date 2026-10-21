import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(new URL("./upgrade_root_rule_chain.mjs", import.meta.url));
const scriptText = await readFile(scriptPath, "utf8");
const processedMatch = scriptText.match(/name: "Prepare Influx Processed Record"[\s\S]*?tbelScript: `([\s\S]*?)`/);
const rawMatch = scriptText.match(/name: "Prepare Influx Raw Record"[\s\S]*?tbelScript: "([\s\S]*?)"/);
assert.ok(processedMatch, "processed TBEL script not found");
assert.ok(rawMatch, "raw TBEL script not found");

const processed = processedMatch[1];
const raw = rawMatch[1];
assert.match(processed, /source\.get\('temperature'\)/);
assert.match(processed, /values\.put\('heatIndex'/);
assert.match(processed, /values\.put\('co2Alarm'/);
assert.match(processed, /values\.put\('fanDecision'/);
assert.match(processed, /return\s*\{\s*msg:\s*record,\s*metadata:\s*metadata,\s*msgType:\s*msgType\s*\}/);
assert.doesNotMatch(processed, /source\.temperature/, "TBEL map access should use get()");
assert.doesNotMatch(processed, /values\.heatIndex\s*=/, "TBEL map writes should use put()");
assert.match(raw, /msg\.get\('values'\)/);
assert.match(raw, /record\.put\('values'/);
console.log("PASS: TBEL contract uses map get/put and expected output shape");
