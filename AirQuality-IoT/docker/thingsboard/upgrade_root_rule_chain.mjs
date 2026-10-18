// Script nang cap Root Rule Chain ThingsBoard:
// Closed-Loop Control cho 5 thiet bi chap hanh tuong ung voi 5 yeu to vi luong (theo bang so sanh):
// 1. CO2                 -> Quat thong gio (Ventilation Fan - Green LED / Relay) -> setFan
// 2. PM2.5 / VOC         -> May loc khong khi (Air Purifier HEPA - Blue LED)      -> setPurifier
// 3. Nhiet do (Temp)     -> Dieu hoa / May lam mat (Cooler / AC - Yellow LED)   -> setCooler
// 4. Do am (Humidity)    -> May phun suong / Tao am (Humidifier - Orange LED)   -> setHumidifier
// 5. Nguy cap (Emergency)-> Coi hu & Den bao dong do (Buzzer & Alert - Red LED) -> setBuzzer

async function main() {
  const TB_URL = process.env.TB_URL || "http://localhost:8080";
  const loginRes = await fetch(`${TB_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "tenant@thingsboard.org", password: "tenant" })
  });
  if (!loginRes.ok) throw new Error(`Dang nhap that bai: ${loginRes.status}`);
  const { token } = await loginRes.json();
  const H = {
    "Content-Type": "application/json",
    "X-Authorization": `Bearer ${token}`
  };

  const rcListRes = await fetch(`${TB_URL}/api/ruleChains?pageSize=10&page=0`, { headers: H });
  const rcList = await rcListRes.json();
  const rootRc = rcList.data.find(r => r.root);
  if (!rootRc) throw new Error("Khong tim thay Root Rule Chain!");
  const ruleChainId = rootRc.id.id;
  console.log(`Dang nang cap Root Rule Chain [${ruleChainId}] ...`);

  // TBEL Script cho Bo ra quyet dinh da yeu to & da thiet bi chap hanh (Multi-Actuator Decision)
  const decisionTbelScript = `
var routes = [];
var co2 = msg.co2 != null ? msg.co2 : 0;
var pm25 = msg.pm25 != null ? msg.pm25 : 0;
var aqi = msg.air_quality != null ? msg.air_quality : 0;
var temp = msg.temperature != null ? msg.temperature : 0;
var hum = msg.humidity != null ? msg.humidity : 0;

// === 1. Quat thong gio (Ventilation Fan - Green LED) -> Giam CO2 ===
if (co2 > 1000) {
    routes.push('FanOn');
} else if (co2 <= 800) {
    routes.push('FanOff');
}

// === 2. May loc khong khi HEPA (Air Purifier - Blue LED) -> Khu PM2.5 & Bui min, VOC ===
if (pm25 > 35.4 || aqi > 100) {
    routes.push('PurifierOn');
} else if (pm25 <= 25.0 && aqi <= 75) {
    routes.push('PurifierOff');
}

// === 3. May lam mat / Dieu hoa (Cooler / AC - Yellow LED) -> Ha nhiet do ===
if (temp > 32.0) {
    routes.push('CoolerOn');
} else if (temp <= 28.0) {
    routes.push('CoolerOff');
}

// === 4. May tao am / Phun suong (Humidifier / Mist - Orange LED) -> Tang do am khi kho ===
if (hum < 40.0) {
    routes.push('HumidifierOn');
} else if (hum >= 55.0) {
    routes.push('HumidifierOff');
}

// === 5. Coi hu & Den bao dong do (Buzzer & Alert - Red LED) -> Canh bao khan cap ===
if (co2 > 2000 || aqi > 200 || pm25 > 125.4 || temp > 45.0) {
    routes.push('BuzzerOn');
} else if (co2 <= 1500 && aqi <= 150 && pm25 <= 55.4 && temp <= 40.0) {
    routes.push('BuzzerOff');
}

// === 6. He thong tao & xoa Alarms tren ThingsBoard Dashboard ===
// CO2 Alarms
if (co2 > 2000) {
    routes.push('Co2Critical');
} else if (co2 > 1000) {
    routes.push('Co2Warning');
} else if (co2 <= 850) {
    routes.push('Co2Normal');
}

// Air Quality / PM2.5 Alarms
if (aqi > 200 || pm25 > 125.4) {
    routes.push('AqiHazardous');
} else if (aqi > 150 || pm25 > 55.4) {
    routes.push('AqiPoor');
} else if (aqi <= 100 && pm25 <= 35.4) {
    routes.push('AqiNormal');
}

// Temperature Alarms
if (temp > 38.0) {
    routes.push('TempWarning');
} else if (temp <= 35.0) {
    routes.push('TempNormal');
}

// Humidity Alarms
if (hum < 35.0) {
    routes.push('HumidityLow');
} else if (hum >= 45.0) {
    routes.push('HumidityNormal');
}

return routes;
`;

  function makeRpcScript(method, paramVal) {
    return `
var rpc = {
    method: "${method}",
    params: ${paramVal},
    timeout: 5000
};
return { msg: rpc, metadata: metadata, msgType: "TO_DEVICE_RPC_REQUEST" };
`;
  }

  // Danh sach tat ca cac nodes (26 nodes)
  const nodes = [
    // 0: Message Type Switch
    {
      type: "org.thingsboard.rule.engine.filter.TbMsgTypeSwitchNode",
      name: "Message Type Switch",
      configurationVersion: 0,
      configuration: {},
      additionalInfo: { layoutX: 300, layoutY: 250 }
    },
    // 1: Save Timeseries
    {
      type: "org.thingsboard.rule.engine.telemetry.TbMsgTimeseriesNode",
      name: "Save Timeseries",
      configurationVersion: 0,
      configuration: { defaultTTL: 0, useServerTs: false, processingSettings: { type: "ON_EVERY_MESSAGE" } },
      additionalInfo: { layoutX: 580, layoutY: 200 }
    },
    // 2: Save Client Attributes
    {
      type: "org.thingsboard.rule.engine.telemetry.TbMsgAttributesNode",
      name: "Save Client Attributes",
      configurationVersion: 2,
      configuration: { scope: "CLIENT_SCOPE", notifyDevice: false, sendAttributesUpdatedNotification: false, updateAttributesOnlyOnValueChange: true },
      additionalInfo: { layoutX: 580, layoutY: 340 }
    },
    // 3: Multi-Actuator Decision
    {
      type: "org.thingsboard.rule.engine.filter.TbJsSwitchNode",
      name: "Air Quality & Multi-Actuator Decision",
      configurationVersion: 0,
      configuration: { scriptLang: "TBEL", tbelScript: decisionTbelScript },
      additionalInfo: { layoutX: 880, layoutY: 200 }
    },

    // 4: Create Alarm CO2 High
    {
      type: "org.thingsboard.rule.engine.action.TbCreateAlarmNode",
      name: "Create Alarm: CO2 High",
      configurationVersion: 0,
      configuration: {
        alarmType: "CO2_HIGH_WARNING",
        severity: "WARNING",
        scriptLang: "TBEL",
        alarmDetailsBuildTbel: "var d = {}; d.message = 'Nồng độ CO2 vượt ngưỡng an toàn: ' + msg.co2 + ' ppm (> 1000 ppm)'; d.action = 'Kích hoạt quạt thông gió (Fan ON)'; return d;",
        propagate: false, propagateToOwner: false, propagateToTenant: false, useMessageAlarmData: false, overwriteAlarmDetails: false, dynamicSeverity: false, relationTypes: []
      },
      additionalInfo: { layoutX: 1400, layoutY: 20 }
    },
    // 5: Create Alarm CO2 Critical
    {
      type: "org.thingsboard.rule.engine.action.TbCreateAlarmNode",
      name: "Create Alarm: CO2 Critical",
      configurationVersion: 0,
      configuration: {
        alarmType: "CO2_CRITICAL_DANGER",
        severity: "CRITICAL",
        scriptLang: "TBEL",
        alarmDetailsBuildTbel: "var d = {}; d.message = 'NGUY HIỂM: Nồng độ CO2 đạt mức ngạt khí ' + msg.co2 + ' ppm (> 2000 ppm)'; d.action = 'BẬT CÒI BÁO ĐỘNG & QUẠT CÔNG SUẤT CAO'; return d;",
        propagate: false, propagateToOwner: false, propagateToTenant: false, useMessageAlarmData: false, overwriteAlarmDetails: false, dynamicSeverity: false, relationTypes: []
      },
      additionalInfo: { layoutX: 1400, layoutY: 80 }
    },
    // 6: Clear Alarm CO2 Normal
    {
      type: "org.thingsboard.rule.engine.action.TbClearAlarmNode",
      name: "Clear Alarm: CO2 Normal",
      configurationVersion: 0,
      configuration: {
        alarmType: "CO2_HIGH_WARNING",
        scriptLang: "TBEL",
        alarmDetailsBuildTbel: "var d = {}; d.message = 'CO2 đã trở lại mức an toàn: ' + msg.co2 + ' ppm'; return d;"
      },
      additionalInfo: { layoutX: 1400, layoutY: 140 }
    },

    // 7: Create Alarm Poor Air Quality
    {
      type: "org.thingsboard.rule.engine.action.TbCreateAlarmNode",
      name: "Create Alarm: Poor Air Quality",
      configurationVersion: 0,
      configuration: {
        alarmType: "POOR_AIR_QUALITY",
        severity: "WARNING",
        scriptLang: "TBEL",
        alarmDetailsBuildTbel: "var d = {}; d.message = 'Chất lượng không khí kém (AQI=' + msg.air_quality + ', PM2.5=' + msg.pm25 + ' µg/m³)'; d.action = 'Kích hoạt máy lọc không khí HEPA (Purifier ON)'; return d;",
        propagate: false, propagateToOwner: false, propagateToTenant: false, useMessageAlarmData: false, overwriteAlarmDetails: false, dynamicSeverity: false, relationTypes: []
      },
      additionalInfo: { layoutX: 1400, layoutY: 200 }
    },
    // 8: Create Alarm Hazardous Air
    {
      type: "org.thingsboard.rule.engine.action.TbCreateAlarmNode",
      name: "Create Alarm: Hazardous Air",
      configurationVersion: 0,
      configuration: {
        alarmType: "HAZARDOUS_AIR_QUALITY",
        severity: "CRITICAL",
        scriptLang: "TBEL",
        alarmDetailsBuildTbel: "var d = {}; d.message = 'BÁO ĐỘNG ĐỎ: Không khí ô nhiễm nguy hại cấp độ khẩn cấp (AQI=' + msg.air_quality + ', PM2.5=' + msg.pm25 + ' µg/m³)'; return d;",
        propagate: false, propagateToOwner: false, propagateToTenant: false, useMessageAlarmData: false, overwriteAlarmDetails: false, dynamicSeverity: false, relationTypes: []
      },
      additionalInfo: { layoutX: 1400, layoutY: 260 }
    },
    // 9: Clear Alarm Air Quality Normal
    {
      type: "org.thingsboard.rule.engine.action.TbClearAlarmNode",
      name: "Clear Alarm: Air Quality Normal",
      configurationVersion: 0,
      configuration: {
        alarmType: "POOR_AIR_QUALITY",
        scriptLang: "TBEL",
        alarmDetailsBuildTbel: "var d = {}; d.message = 'Chất lượng không khí đã sạch và an toàn (AQI=' + msg.air_quality + ')'; return d;"
      },
      additionalInfo: { layoutX: 1400, layoutY: 320 }
    },

    // 10: Create Alarm High Temp
    {
      type: "org.thingsboard.rule.engine.action.TbCreateAlarmNode",
      name: "Create Alarm: High Temperature",
      configurationVersion: 0,
      configuration: {
        alarmType: "HIGH_TEMPERATURE",
        severity: "WARNING",
        scriptLang: "TBEL",
        alarmDetailsBuildTbel: "var d = {}; d.message = 'Nhiệt độ phòng tăng cao: ' + msg.temperature + ' °C'; d.action = 'Kích hoạt điều hòa / máy làm mát (Cooler ON)'; return d;",
        propagate: false, propagateToOwner: false, propagateToTenant: false, useMessageAlarmData: false, overwriteAlarmDetails: false, dynamicSeverity: false, relationTypes: []
      },
      additionalInfo: { layoutX: 1400, layoutY: 380 }
    },
    // 11: Clear Alarm Temp Normal
    {
      type: "org.thingsboard.rule.engine.action.TbClearAlarmNode",
      name: "Clear Alarm: Temp Normal",
      configurationVersion: 0,
      configuration: {
        alarmType: "HIGH_TEMPERATURE",
        scriptLang: "TBEL",
        alarmDetailsBuildTbel: "var d = {}; d.message = 'Nhiệt độ đã trở lại ngưỡng dễ chịu: ' + msg.temperature + ' °C'; return d;"
      },
      additionalInfo: { layoutX: 1400, layoutY: 440 }
    },

    // 12: Create Alarm Low Humidity
    {
      type: "org.thingsboard.rule.engine.action.TbCreateAlarmNode",
      name: "Create Alarm: Low Humidity",
      configurationVersion: 0,
      configuration: {
        alarmType: "LOW_HUMIDITY",
        severity: "WARNING",
        scriptLang: "TBEL",
        alarmDetailsBuildTbel: "var d = {}; d.message = 'Độ ẩm không khí quá thấp: ' + msg.humidity + ' % (< 35%) gây khô da & kích ứng hô hấp'; d.action = 'Kích hoạt máy phun sương bù ẩm (Humidifier ON)'; return d;",
        propagate: false, propagateToOwner: false, propagateToTenant: false, useMessageAlarmData: false, overwriteAlarmDetails: false, dynamicSeverity: false, relationTypes: []
      },
      additionalInfo: { layoutX: 1400, layoutY: 500 }
    },
    // 13: Clear Alarm Humidity Normal
    {
      type: "org.thingsboard.rule.engine.action.TbClearAlarmNode",
      name: "Clear Alarm: Humidity Normal",
      configurationVersion: 0,
      configuration: {
        alarmType: "LOW_HUMIDITY",
        scriptLang: "TBEL",
        alarmDetailsBuildTbel: "var d = {}; d.message = 'Độ ẩm không khí đã cân bằng: ' + msg.humidity + ' %'; return d;"
      },
      additionalInfo: { layoutX: 1400, layoutY: 560 }
    },

    // Actuators RPC Generators (14 - 23)
    // 14: Fan ON
    {
      type: "org.thingsboard.rule.engine.transform.TbTransformMsgNode",
      name: "Gen RPC: Fan ON",
      configurationVersion: 0,
      configuration: { scriptLang: "TBEL", tbelScript: makeRpcScript("setFan", "true") },
      additionalInfo: { layoutX: 1750, layoutY: 20 }
    },
    // 15: Fan OFF
    {
      type: "org.thingsboard.rule.engine.transform.TbTransformMsgNode",
      name: "Gen RPC: Fan OFF",
      configurationVersion: 0,
      configuration: { scriptLang: "TBEL", tbelScript: makeRpcScript("setFan", "false") },
      additionalInfo: { layoutX: 1750, layoutY: 80 }
    },
    // 16: Purifier ON
    {
      type: "org.thingsboard.rule.engine.transform.TbTransformMsgNode",
      name: "Gen RPC: Purifier ON",
      configurationVersion: 0,
      configuration: { scriptLang: "TBEL", tbelScript: makeRpcScript("setPurifier", "true") },
      additionalInfo: { layoutX: 1750, layoutY: 140 }
    },
    // 17: Purifier OFF
    {
      type: "org.thingsboard.rule.engine.transform.TbTransformMsgNode",
      name: "Gen RPC: Purifier OFF",
      configurationVersion: 0,
      configuration: { scriptLang: "TBEL", tbelScript: makeRpcScript("setPurifier", "false") },
      additionalInfo: { layoutX: 1750, layoutY: 200 }
    },
    // 18: Cooler ON
    {
      type: "org.thingsboard.rule.engine.transform.TbTransformMsgNode",
      name: "Gen RPC: Cooler ON",
      configurationVersion: 0,
      configuration: { scriptLang: "TBEL", tbelScript: makeRpcScript("setCooler", "true") },
      additionalInfo: { layoutX: 1750, layoutY: 260 }
    },
    // 19: Cooler OFF
    {
      type: "org.thingsboard.rule.engine.transform.TbTransformMsgNode",
      name: "Gen RPC: Cooler OFF",
      configurationVersion: 0,
      configuration: { scriptLang: "TBEL", tbelScript: makeRpcScript("setCooler", "false") },
      additionalInfo: { layoutX: 1750, layoutY: 320 }
    },
    // 20: Humidifier ON
    {
      type: "org.thingsboard.rule.engine.transform.TbTransformMsgNode",
      name: "Gen RPC: Humidifier ON",
      configurationVersion: 0,
      configuration: { scriptLang: "TBEL", tbelScript: makeRpcScript("setHumidifier", "true") },
      additionalInfo: { layoutX: 1750, layoutY: 380 }
    },
    // 21: Humidifier OFF
    {
      type: "org.thingsboard.rule.engine.transform.TbTransformMsgNode",
      name: "Gen RPC: Humidifier OFF",
      configurationVersion: 0,
      configuration: { scriptLang: "TBEL", tbelScript: makeRpcScript("setHumidifier", "false") },
      additionalInfo: { layoutX: 1750, layoutY: 440 }
    },
    // 22: Buzzer ON
    {
      type: "org.thingsboard.rule.engine.transform.TbTransformMsgNode",
      name: "Gen RPC: Buzzer ON",
      configurationVersion: 0,
      configuration: { scriptLang: "TBEL", tbelScript: makeRpcScript("setBuzzer", "true") },
      additionalInfo: { layoutX: 1750, layoutY: 500 }
    },
    // 23: Buzzer OFF
    {
      type: "org.thingsboard.rule.engine.transform.TbTransformMsgNode",
      name: "Gen RPC: Buzzer OFF",
      configurationVersion: 0,
      configuration: { scriptLang: "TBEL", tbelScript: makeRpcScript("setBuzzer", "false") },
      additionalInfo: { layoutX: 1750, layoutY: 560 }
    },

    // 24: Send RPC Request Node
    {
      type: "org.thingsboard.rule.engine.rpc.TbSendRPCRequestNode",
      name: "RPC Call to Device",
      configurationVersion: 0,
      configuration: { timeoutInSeconds: 30 },
      additionalInfo: { layoutX: 2050, layoutY: 280 }
    },
    // 25: Log RPC Node
    {
      type: "org.thingsboard.rule.engine.action.TbLogNode",
      name: "Log RPC Result",
      configurationVersion: 0,
      configuration: {
        scriptLang: "TBEL",
        tbelScript: "return 'RPC to device ' + metadata.deviceName + ' result: ' + JSON.stringify(msg);"
      },
      additionalInfo: { layoutX: 2320, layoutY: 280 }
    }
  ];

  // Ket noi giua cac nodes
  const connections = [
    // MsgTypeSwitch -> Timeseries & Attributes
    { fromIndex: 0, toIndex: 1, type: "Post telemetry" },
    { fromIndex: 0, toIndex: 2, type: "Post attributes" },

    // Timeseries -> Decision
    { fromIndex: 1, toIndex: 3, type: "Success" },

    // Decision -> Alarms
    { fromIndex: 3, toIndex: 4, type: "Co2Warning" },
    { fromIndex: 3, toIndex: 5, type: "Co2Critical" },
    { fromIndex: 3, toIndex: 6, type: "Co2Normal" },
    { fromIndex: 3, toIndex: 7, type: "AqiPoor" },
    { fromIndex: 3, toIndex: 8, type: "AqiHazardous" },
    { fromIndex: 3, toIndex: 9, type: "AqiNormal" },
    { fromIndex: 3, toIndex: 10, type: "TempWarning" },
    { fromIndex: 3, toIndex: 11, type: "TempNormal" },
    { fromIndex: 3, toIndex: 12, type: "HumidityLow" },
    { fromIndex: 3, toIndex: 13, type: "HumidityNormal" },

    // Decision -> Actuators RPC Generators
    { fromIndex: 3, toIndex: 14, type: "FanOn" },
    { fromIndex: 3, toIndex: 15, type: "FanOff" },
    { fromIndex: 3, toIndex: 16, type: "PurifierOn" },
    { fromIndex: 3, toIndex: 17, type: "PurifierOff" },
    { fromIndex: 3, toIndex: 18, type: "CoolerOn" },
    { fromIndex: 3, toIndex: 19, type: "CoolerOff" },
    { fromIndex: 3, toIndex: 20, type: "HumidifierOn" },
    { fromIndex: 3, toIndex: 21, type: "HumidifierOff" },
    { fromIndex: 3, toIndex: 22, type: "BuzzerOn" },
    { fromIndex: 3, toIndex: 23, type: "BuzzerOff" },

    // All RPC Generators -> Send RPC Node (24)
    { fromIndex: 14, toIndex: 24, type: "Success" },
    { fromIndex: 15, toIndex: 24, type: "Success" },
    { fromIndex: 16, toIndex: 24, type: "Success" },
    { fromIndex: 17, toIndex: 24, type: "Success" },
    { fromIndex: 18, toIndex: 24, type: "Success" },
    { fromIndex: 19, toIndex: 24, type: "Success" },
    { fromIndex: 20, toIndex: 24, type: "Success" },
    { fromIndex: 21, toIndex: 24, type: "Success" },
    { fromIndex: 22, toIndex: 24, type: "Success" },
    { fromIndex: 23, toIndex: 24, type: "Success" },

    // Send RPC -> Log Result (25)
    { fromIndex: 24, toIndex: 25, type: "Success" },
    { fromIndex: 24, toIndex: 25, type: "Failure" }
  ];

  const payload = {
    ruleChainId: { entityType: "RULE_CHAIN", id: ruleChainId },
    firstNodeIndex: 0,
    nodes: nodes,
    connections: connections,
    ruleChainConnections: null
  };

  const saveRes = await fetch(`${TB_URL}/api/ruleChain/metadata`, {
    method: "POST",
    headers: H,
    body: JSON.stringify(payload)
  });

  if (!saveRes.ok) {
    const errText = await saveRes.text();
    throw new Error(`Loi khi luu Rule Chain metadata: HTTP ${saveRes.status} - ${errText}`);
  }

  console.log("Cap nhat Root Rule Chain thanh cong!");
  console.log(`Tong so node: ${nodes.length}`);
  console.log(`Tong so connection: ${connections.length}`);
}

main().catch(err => {
  console.error("LOI:", err.message);
  process.exit(1);
});
