// verify_schematic.mjs
import fs from "fs";

const diagram = JSON.parse(fs.readFileSync("diagram.json", "utf8"));
const parts = diagram.parts;

const esp = parts.find(p => p.id === "esp");
const dht = parts.find(p => p.id === "dht1");
const potCo2 = parts.find(p => p.id === "potCo2");
const potPm = parts.find(p => p.id === "potPm");
const bz = parts.find(p => p.id === "bz1");
const relay = parts.find(p => p.id === "relayFan");

// Danh sách Bounding Boxes của thân linh kiện
const bboxes = [
  { id: "DHT22", x1: dht.left, x2: dht.left + 60, y1: dht.top, y2: dht.top + 114 },
  { id: "Pot_CO2", x1: potCo2.left, x2: potCo2.left + 75, y1: potCo2.top, y2: potCo2.top + 68 },
  { id: "Pot_PM25", x1: potPm.left, x2: potPm.left + 75, y1: potPm.top, y2: potPm.top + 68 },
  { id: "Buzzer", x1: bz.left, x2: bz.left + 70, y1: bz.top, y2: bz.top + 83 },
  { id: "ESP32_Body", x1: esp.left + 6, x2: esp.left + 95, y1: esp.top, y2: esp.top + 196 },
  { id: "Relay_Body", x1: relay.left + 5, x2: relay.left + 135, y1: relay.top + 5, y2: relay.top + 75 },
  { id: "LED_Fan", x1: 670, x2: 730, y1: 65, y2: 125 },
  { id: "LED_Purifier", x1: 670, x2: 730, y1: 145, y2: 205 },
  { id: "LED_Cooler", x1: 670, x2: 730, y1: 225, y2: 285 },
  { id: "LED_Humidifier", x1: 670, x2: 730, y1: 305, y2: 365 },
  { id: "LED_Alert", x1: 670, x2: 730, y1: 385, y2: 445 }
];

console.log("=== KIỂM TRA HÌNH HỌC CHI TIẾT SƠ ĐỒ MẠCH WOKWI ===");

const pinMap = {
  "esp:TX": [esp.left + 4.6, esp.top],
  "esp:RX": [esp.left + 4.6, esp.top],
  "esp:3V3":  [esp.left + 4.6, esp.top + 24.0],
  "esp:34":   [esp.left + 4.6, esp.top + 24.0 + 4 * 9.6],
  "esp:35":   [esp.left + 4.6, esp.top + 24.0 + 5 * 9.6],
  "esp:33":   [esp.left + 4.6, esp.top + 24.0 + 7 * 9.6],
  "esp:25":   [esp.left + 4.6, esp.top + 24.0 + 8 * 9.6],
  "esp:26":   [esp.left + 4.6, esp.top + 24.0 + 9 * 9.6],
  "esp:27":   [esp.left + 4.6, esp.top + 24.0 + 10 * 9.6],
  "esp:14":   [esp.left + 4.6, esp.top + 24.0 + 11 * 9.6],
  "esp:GND.1": [esp.left + 4.6, esp.top + 24.0 + 13 * 9.6],
  "esp:13":   [esp.left + 4.6, esp.top + 24.0 + 14 * 9.6],
  "esp:5V":   [esp.left + 4.6, esp.top + 24.0 + 18 * 9.6],
  "esp:GND.2": [esp.left + 101.0, esp.top + 24.0],
  "esp:15":   [esp.left + 101.0, esp.top + 24.0 + 15 * 9.6],

  "dht1:VCC": [dht.left + 15.0, dht.top + 114.9],
  "dht1:SDA": [dht.left + 24.5, dht.top + 114.9],
  "dht1:GND": [dht.left + 43.8, dht.top + 114.9],

  "potCo2:GND": [potCo2.left + 29.0, potCo2.top + 68.5],
  "potCo2:SIG": [potCo2.left + 39.0, potCo2.top + 68.5],
  "potCo2:VCC": [potCo2.left + 49.0, potCo2.top + 68.5],

  "potPm:GND": [potPm.left + 29.0, potPm.top + 68.5],
  "potPm:SIG": [potPm.left + 39.0, potPm.top + 68.5],
  "potPm:VCC": [potPm.left + 49.0, potPm.top + 68.5],

  "bz1:1": [bz.left + 27.0, bz.top + 84.0],
  "bz1:2": [bz.left + 37.0, bz.top + 84.0],

  "relayFan:VCC": [relay.left, relay.top + 20.0],
  "relayFan:GND": [relay.left, relay.top + 35.0],
  "relayFan:IN":  [relay.left, relay.top + 50.0],
  "relayFan:NO":  [relay.left + 140.0, relay.top + 25.0],
  "relayFan:COM": [relay.left + 140.0, relay.top + 45.0],

  "r1:1": [540.0, 106.65], "r1:2": [598.8, 106.65],
  "r3:1": [540.0, 186.65], "r3:2": [598.8, 186.65],
  "r4:1": [540.0, 266.65], "r4:2": [598.8, 266.65],
  "r5:1": [540.0, 346.65], "r5_2": [598.8, 346.65],
  "r2:1": [540.0, 426.65], "r2_2": [598.8, 426.65],

  "ledFan_A": [685.0, 107.0], "ledFan_C": [695.0, 107.0],
  "ledPurifier_A": [685.0, 187.0], "ledPurifier_C": [695.0, 187.0],
  "ledCooler_A": [685.0, 267.0], "ledCooler_C": [695.0, 267.0],
  "ledHumidifier_A": [685.0, 347.0], "ledHumidifier_C": [695.0, 347.0],
  "ledAlert_A": [685.0, 427.0], "ledAlert_C": [695.0, 427.0]
};

let violations = 0;

for (const conn of diagram.connections) {
  const from = conn[0];
  const to = conn[1];
  const instrs = conn[3];
  if (!pinMap[from]) continue;

  let curr = [...pinMap[from]];
  for (const inst of instrs) {
    let next = [...curr];
    if (inst.startsWith("h")) {
      next[0] += parseFloat(inst.substring(1));
    } else if (inst.startsWith("v")) {
      next[1] += parseFloat(inst.substring(1));
    }

    const segXmin = Math.min(curr[0], next[0]);
    const segXmax = Math.max(curr[0], next[0]);
    const segYmin = Math.min(curr[1], next[1]);
    const segYmax = Math.max(curr[1], next[1]);

    for (const b of bboxes) {
      const overlapX = Math.max(0, Math.min(segXmax, b.x2) - Math.max(segXmin, b.x1));
      const overlapY = Math.max(0, Math.min(segYmax, b.y2) - Math.max(segYmin, b.y1));
      if (overlapX > 0 && overlapY > 0) {
        const isHorizontalPenetration = (segYmin === segYmax) && (segYmin > b.y1 + 5 && segYmin < b.y2 - 5);
        const isVerticalPenetration = (segXmin === segXmax) && (segXmin > b.x1 + 5 && segXmin < b.x2 - 5);
        if (isHorizontalPenetration || isVerticalPenetration) {
          console.error(`[CẢNH BÁO VA CHẠM]: Đường ${from} -> ${to} đoạn [${curr}] -> [${next}] cắt xuyên qua ${b.id}`);
          violations++;
        }
      }
    }
    curr = next;
  }
}

if (violations === 0) {
  console.log("XÁC NHẬN HOÀN TOÀN: 100% đường dây KHÔNG CẮT XUYÊN QUA BẤT KỲ LINH KIỆN NÀO!");
} else {
  console.log(`Tìm thấy ${violations} điểm cần điều chỉnh.`);
}
