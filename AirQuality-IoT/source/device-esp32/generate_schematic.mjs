// generate_schematic.mjs
// Tu dong dong bo hoa va tinh toan tuyet doi theo vi tri keo tha cua nguoi dung

import fs from "fs";

function route(p0, points) {
  let curr = p0;
  const instrs = [];
  for (const next of points) {
    const dx = Math.round((next[0] - curr[0]) * 100) / 100;
    const dy = Math.round((next[1] - curr[1]) * 100) / 100;
    if (dx !== 0 && dy === 0) {
      instrs.push(`h${dx}`);
    } else if (dx === 0 && dy !== 0) {
      instrs.push(`v${dy}`);
    } else if (dx === 0 && dy === 0) {
      // no-op
    } else {
      instrs.push(`h${dx}`);
      instrs.push(`v${dy}`);
    }
    curr = next;
  }
  return instrs;
}

// Đọc diagram.json hiện tại để lấy CHÍNH XÁC vị trí linh kiện người dùng đã kéo thả
const currentDiagram = JSON.parse(fs.readFileSync("diagram.json", "utf8"));
const parts = currentDiagram.parts;

const esp = parts.find(p => p.id === "esp");
const dht = parts.find(p => p.id === "dht1");
const potCo2 = parts.find(p => p.id === "potCo2");
const potPm = parts.find(p => p.id === "potPm");
const bz = parts.find(p => p.id === "bz1");
const relay = parts.find(p => p.id === "relayFan");

// Tính toán toạ độ pin tuyệt đối dựa trên vị trí kéo thả
const P = {
  // ESP32 DevKitC V4 (left, top)
  esp_3V3:  [esp.left + 4.6, esp.top + 24.0],
  esp_34:   [esp.left + 4.6, esp.top + 24.0 + 4 * 9.6],
  esp_35:   [esp.left + 4.6, esp.top + 24.0 + 5 * 9.6],
  esp_33:   [esp.left + 4.6, esp.top + 24.0 + 7 * 9.6],
  esp_25:   [esp.left + 4.6, esp.top + 24.0 + 8 * 9.6],
  esp_26:   [esp.left + 4.6, esp.top + 24.0 + 9 * 9.6],
  esp_27:   [esp.left + 4.6, esp.top + 24.0 + 10 * 9.6],
  esp_14:   [esp.left + 4.6, esp.top + 24.0 + 11 * 9.6],
  esp_GND1: [esp.left + 4.6, esp.top + 24.0 + 13 * 9.6],
  esp_13:   [esp.left + 4.6, esp.top + 24.0 + 14 * 9.6],
  esp_5V:   [esp.left + 4.6, esp.top + 24.0 + 18 * 9.6],

  esp_GND2: [esp.left + 101.0, esp.top + 24.0],
  esp_15:   [esp.left + 101.0, esp.top + 24.0 + 15 * 9.6],

  // DHT22 (left, top)
  dht_VCC: [dht.left + 15.0, dht.top + 114.9],
  dht_SDA: [dht.left + 24.5, dht.top + 114.9],
  dht_GND: [dht.left + 43.8, dht.top + 114.9],

  // Potentiometers (left, top)
  potCo2_GND: [potCo2.left + 29.0, potCo2.top + 68.5],
  potCo2_SIG: [potCo2.left + 39.0, potCo2.top + 68.5],
  potCo2_VCC: [potCo2.left + 49.0, potCo2.top + 68.5],

  potPm_GND: [potPm.left + 29.0, potPm.top + 68.5],
  potPm_SIG: [potPm.left + 39.0, potPm.top + 68.5],
  potPm_VCC: [potPm.left + 49.0, potPm.top + 68.5],

  // Buzzer (left, top)
  bz_1: [bz.left + 27.0, bz.top + 84.0], // GND
  bz_2: [bz.left + 37.0, bz.top + 84.0], // SIG

  // Relay (left, top)
  relay_VCC: [relay.left, relay.top + 20.0],
  relay_GND: [relay.left, relay.top + 35.0],
  relay_IN:  [relay.left, relay.top + 50.0],
  relay_NO:  [relay.left + 140.0, relay.top + 25.0],
  relay_COM: [relay.left + 140.0, relay.top + 45.0],

  // Resistors & LEDs
  r1_1: [540.0, 106.65], r1_2: [598.8, 106.65],
  r3_1: [540.0, 186.65], r3_2: [598.8, 186.65],
  r4_1: [540.0, 266.65], r4_2: [598.8, 266.65],
  r5_1: [540.0, 346.65], r5_2: [598.8, 346.65],
  r2_1: [540.0, 426.65], r2_2: [598.8, 426.65],

  ledFan_A: [685.0, 107.0], ledFan_C: [695.0, 107.0],
  ledPurifier_A: [685.0, 187.0], ledPurifier_C: [695.0, 187.0],
  ledCooler_A: [685.0, 267.0], ledCooler_C: [695.0, 267.0],
  ledHumidifier_A: [685.0, 347.0], ledHumidifier_C: [695.0, 347.0],
  ledAlert_A: [685.0, 427.0], ledAlert_C: [695.0, 427.0]
};

const connections = [
  // Serial Monitor
  [ "esp:TX", "$serialMonitor:RX", "", [] ],
  [ "esp:RX", "$serialMonitor:TX", "", [] ],

  // ===========================================================================
  // 1. NGUỒN 3V3 CẢM BIẾN (Red) - Máng Y = -60
  // ===========================================================================
  [
    "esp:3V3", "potCo2:VCC", "red",
    route(P.esp_3V3, [
      [65.0, P.esp_3V3[1]],
      [65.0, -60.0],
      [P.potCo2_VCC[0], -60.0],
      P.potCo2_VCC
    ])
  ],
  [
    "potCo2:VCC", "potPm:VCC", "red",
    route(P.potCo2_VCC, [
      [P.potCo2_VCC[0], -60.0],
      [P.potPm_VCC[0], -60.0],
      P.potPm_VCC
    ])
  ],
  [
    "potCo2:VCC", "dht1:VCC", "red",
    route(P.potCo2_VCC, [
      [P.potCo2_VCC[0], -60.0],
      [P.dht_VCC[0], -60.0],
      P.dht_VCC
    ])
  ],

  // ===========================================================================
  // 2. GND CẢM BIẾN (Black) - Máng Y = -30
  // ===========================================================================
  [
    "esp:GND.1", "dht1:GND", "black",
    route(P.esp_GND1, [
      [25.0, P.esp_GND1[1]],
      [25.0, -30.0],
      [P.dht_GND[0], -30.0],
      P.dht_GND
    ])
  ],
  [
    "dht1:GND", "potCo2:GND", "black",
    route(P.dht_GND, [
      [P.dht_GND[0], -30.0],
      [P.potCo2_GND[0], -30.0],
      P.potCo2_GND
    ])
  ],
  [
    "potCo2:GND", "potPm:GND", "black",
    route(P.potCo2_GND, [
      [P.potCo2_GND[0], -30.0],
      [P.potPm_GND[0], -30.0],
      P.potPm_GND
    ])
  ],

  // ===========================================================================
  // 3. TÍN HIỆU CẢM BIẾN (Sensor Signals)
  // ===========================================================================
  // CO2 (ADC34) - Orange
  [
    "potCo2:SIG", "esp:34", "orange",
    route(P.potCo2_SIG, [
      [P.potCo2_SIG[0], 10.0],
      [75.0, 10.0],
      [75.0, P.esp_34[1]],
      P.esp_34
    ])
  ],
  // PM2.5 (ADC35) - Purple
  [
    "potPm:SIG", "esp:35", "purple",
    route(P.potPm_SIG, [
      [P.potPm_SIG[0], 40.0],
      [65.0, 40.0],
      [65.0, P.esp_35[1]],
      P.esp_35
    ])
  ],
  // DHT22 SDA - Green (GPIO 15)
  [
    "dht1:SDA", "esp:15", "green",
    route(P.dht_SDA, [
      [P.dht_SDA[0], 70.0],
      [225.0, 70.0],
      [225.0, P.esp_15[1]],
      P.esp_15
    ])
  ],

  // ===========================================================================
  // 4. CÒI BÁO ĐỘNG (Buzzer - Left)
  // ===========================================================================
  // bz1:2 (Tín hiệu) -> esp:25 (Brown)
  [
    "bz1:2", "esp:25", "brown",
    route(P.bz_2, [
      [-140.0, P.bz_2[1]],
      [-140.0, P.esp_25[1]],
      P.esp_25
    ])
  ],
  // bz1:1 (GND) -> esp:GND.1 (Black)
  [
    "bz1:1", "esp:GND.1", "black",
    route(P.bz_1, [
      [-160.0, P.bz_1[1]],
      [-160.0, P.esp_GND1[1]],
      P.esp_GND1
    ])
  ],

  // ===========================================================================
  // 5. RƠ-LE ĐIỀU KHIỂN QUẠT (Relay Fan Module)
  // ===========================================================================
  // 5V Relay từ esp:5V -> relayFan:VCC (Red)
  [
    "esp:5V", "relayFan:VCC", "red",
    route(P.esp_5V, [
      [-40.0, P.esp_5V[1]],
      [-40.0, 490.0],
      [295.0, 490.0],
      [295.0, P.relay_VCC[1]],
      P.relay_VCC
    ])
  ],
  // GND Relay từ esp:GND.2 -> relayFan:GND (Black)
  [
    "esp:GND.2", "relayFan:GND", "black",
    route(P.esp_GND2, [
      [215.0, P.esp_GND2[1]],
      [215.0, P.relay_GND[1]],
      P.relay_GND
    ])
  ],
  // IN Relay từ esp:26 -> relayFan:IN (Cyan)
  [
    "esp:26", "relayFan:IN", "cyan",
    route(P.esp_26, [
      [45.0, P.esp_26[1]],
      [45.0, 340.0],
      [305.0, 340.0],
      [305.0, P.relay_IN[1]],
      P.relay_IN
    ])
  ],
  // COM Relay cấp 3V3 (Red)
  [
    "esp:3V3", "relayFan:COM", "red",
    route(P.esp_3V3, [
      [65.0, P.esp_3V3[1]],
      [65.0, 85.0],
      [485.0, 85.0],
      [485.0, P.relay_COM[1]],
      P.relay_COM
    ])
  ],
  // Tiếp điểm NO của Relay nối sang r1:1 (Green)
  [
    "relayFan:NO", "r1:1", "green",
    route(P.relay_NO, [
      [495.0, P.relay_NO[1]],
      [495.0, P.r1_1[1]],
      P.r1_1
    ])
  ],

  // ===========================================================================
  // 6. 5 CƠ CẤU CHẤP HÀNH (5 Actuators)
  // ===========================================================================
  // Row 1: Quạt (Fan - Green)
  [
    "r1:2", "ledFan:A", "green",
    [ "h86.2" ]
  ],

  // Row 2: Máy lọc không khí HEPA (Purifier - Blue, GPIO 27)
  [
    "esp:27", "r3:1", "blue",
    route(P.esp_27, [
      [25.0, P.esp_27[1]],
      [25.0, 370.0],
      [500.0, 370.0],
      [500.0, P.r3_1[1]],
      P.r3_1
    ])
  ],
  [
    "r3:2", "ledPurifier:A", "blue",
    [ "h86.2" ]
  ],

  // Row 3: Máy làm mát / Điều hòa (Cooler - Gold, GPIO 14)
  [
    "esp:14", "r4:1", "gold",
    route(P.esp_14, [
      [5.0, P.esp_14[1]],
      [5.0, 400.0],
      [510.0, 400.0],
      [510.0, P.r4_1[1]],
      P.r4_1
    ])
  ],
  [
    "r4:2", "ledCooler:A", "gold",
    [ "h86.2" ]
  ],

  // Row 4: Máy phun sương tạo ẩm (Humidifier - Orange, GPIO 13)
  [
    "esp:13", "r5:1", "orange",
    route(P.esp_13, [
      [-15.0, P.esp_13[1]],
      [-15.0, 430.0],
      [520.0, 430.0],
      [520.0, P.r5_1[1]],
      P.r5_1
    ])
  ],
  [
    "r5:2", "ledHumidifier:A", "orange",
    [ "h86.2" ]
  ],

  // Row 5: Đèn báo động khẩn cấp (Alert - Red, GPIO 33)
  [
    "esp:33", "r2:1", "red",
    route(P.esp_33, [
      [-30.0, P.esp_33[1]],
      [-30.0, 460.0],
      [530.0, 460.0],
      [530.0, P.r2_1[1]],
      P.r2_1
    ])
  ],
  [
    "r2:2", "ledAlert:A", "red",
    [ "h86.2" ]
  ],

  // ===========================================================================
  // 7. CATHODE GND CHUNG CHO 5 LED (Right Outer GND Bus - X = 760)
  // ===========================================================================
  [
    "ledAlert:C", "ledHumidifier:C", "black",
    route(P.ledAlert_C, [
      [760.0, P.ledAlert_C[1]],
      [760.0, P.ledHumidifier_C[1]],
      P.ledHumidifier_C
    ])
  ],
  [
    "ledHumidifier:C", "ledCooler:C", "black",
    route(P.ledHumidifier_C, [
      [760.0, P.ledHumidifier_C[1]],
      [760.0, P.ledCooler_C[1]],
      P.ledCooler_C
    ])
  ],
  [
    "ledCooler:C", "ledPurifier:C", "black",
    route(P.ledCooler_C, [
      [760.0, P.ledCooler_C[1]],
      [760.0, P.ledPurifier_C[1]],
      P.ledPurifier_C
    ])
  ],
  [
    "ledPurifier:C", "ledFan:C", "black",
    route(P.ledPurifier_C, [
      [760.0, P.ledPurifier_C[1]],
      [760.0, P.ledFan_C[1]],
      P.ledFan_C
    ])
  ],
  [
    "ledFan:C", "esp:GND.2", "black",
    route(P.ledFan_C, [
      [760.0, P.ledFan_C[1]],
      [760.0, -10.0],
      [205.0, -10.0],
      [205.0, P.esp_GND2[1]],
      P.esp_GND2
    ])
  ]
];

currentDiagram.connections = connections;

fs.writeFileSync("diagram.json", JSON.stringify(currentDiagram, null, 2), "utf8");
console.log("-> Da lam moi diagram.json thanh cong voi toan bo duong day Manhattan routing!");

// Dong bo sang 4 tram ve tinh
const nodeDirs = ["sim/node02", "sim/node03", "sim/node04", "sim/node05"];
for (const dir of nodeDirs) {
  const filePath = `${dir}/diagram.json`;
  if (fs.existsSync(filePath)) {
    const existing = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const cloned = JSON.parse(JSON.stringify(currentDiagram));
    for (const p of cloned.parts) {
      const old = existing.parts.find(x => x.id === p.id);
      if (old && old.attrs) {
        p.attrs = { ...p.attrs, ...old.attrs };
      }
    }
    fs.writeFileSync(filePath, JSON.stringify(cloned, null, 2), "utf8");
    console.log(`-> Da dong bo sang ${filePath}`);
  }
}
console.log("HOAN TAT DONG BO TAT CA 5 TRAM!");
