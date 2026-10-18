// create_mekong_mtp_thermostats.mjs
// Tao va cau hinh he thong Thermostats cho 5 phan khu quanh Cong vien phan mem Mekong (Mekong MTP)
// tren nen tang ThingsBoard CE

async function main() {
  const TB_URL = process.env.TB_URL || "http://localhost:8080";
  console.log(`Connecting to ThingsBoard at ${TB_URL}...`);

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

  // Danh sach 5 phan khu Thermostats Mekong MTP
  const MTP_THERMOSTATS = [
    {
      name: "Thermostat MTP - Block A (Data Center)",
      label: "Mekong MTP - Toa nha A: Dieu hanh & Data Center",
      type: "thermostat",
      lat: 10.35520,
      lng: 106.40180,
      tempThreshold: 24.0,
      humThreshold: 60.0,
      targetTemp: 22.0,
      currentTemp: 22.5,
      currentHum: 55.0,
      aqNodeId: "aq-node-01"
    },
    {
      name: "Thermostat MTP - Block B (Software Hub)",
      label: "Mekong MTP - Toa nha B: Doanh nghiep Phan mem",
      type: "thermostat",
      lat: 10.35575,
      lng: 106.40225,
      tempThreshold: 28.0,
      humThreshold: 65.0,
      targetTemp: 25.0,
      currentTemp: 26.2,
      currentHum: 60.0,
      aqNodeId: "aq-node-02"
    },
    {
      name: "Thermostat MTP - Block C (IoT Incubator)",
      label: "Mekong MTP - Toa nha C: Vuon uom & IoT Lab",
      type: "thermostat",
      lat: 10.35620,
      lng: 106.40160,
      tempThreshold: 27.0,
      humThreshold: 65.0,
      targetTemp: 24.0,
      currentTemp: 25.0,
      currentHum: 62.0,
      aqNodeId: "aq-node-03"
    },
    {
      name: "Thermostat MTP - Grand Hall (Convention)",
      label: "Mekong MTP - Hoi truong Da nang 600 cho",
      type: "thermostat",
      lat: 10.35470,
      lng: 106.40260,
      tempThreshold: 27.5,
      humThreshold: 65.0,
      targetTemp: 23.5,
      currentTemp: 24.8,
      currentHum: 58.0,
      aqNodeId: "aq-node-04"
    },
    {
      name: "Thermostat MTP - Main Gate (Ambient QL50)",
      label: "Mekong MTP - Cong chinh & Quan trac Ngoai vi QL50",
      type: "thermostat",
      lat: 10.35415,
      lng: 106.40120,
      tempThreshold: 35.0,
      humThreshold: 80.0,
      targetTemp: 28.0,
      currentTemp: 31.0,
      currentHum: 72.0,
      aqNodeId: "aq-node-05"
    }
  ];

  // 1. Don dep 2 Thermostat demo cu o California de ban do tap trung vao Mekong MTP
  const allDevsRes = await fetch(`${TB_URL}/api/tenant/devices?pageSize=50&page=0`, { headers: H });
  const allDevs = (await allDevsRes.json()).data;
  for (const oldName of ["Thermostat T1", "Thermostat T2"]) {
    const found = allDevs.find(d => d.name === oldName);
    if (found) {
      console.log(`Dang xoa thiet bi demo cu [${oldName}]...`);
      await fetch(`${TB_URL}/api/device/${found.id.id}`, { method: "DELETE", headers: H });
    }
  }

  // 2. Tao hoac cap nhat 5 Thermostats tai Mekong MTP
  for (const item of MTP_THERMOSTATS) {
    let dev = allDevs.find(d => d.name === item.name);
    if (!dev) {
      console.log(`Tao moi thiet bi [${item.name}]...`);
      const createRes = await fetch(`${TB_URL}/api/device`, {
        method: "POST",
        headers: H,
        body: JSON.stringify({
          name: item.name,
          label: item.label,
          type: item.type
        })
      });
      dev = await createRes.json();
    } else {
      console.log(`Cap nhat thiet bi [${item.name}]...`);
      dev.label = item.label;
      dev.type = item.type;
      await fetch(`${TB_URL}/api/device`, {
        method: "POST",
        headers: H,
        body: JSON.stringify(dev)
      });
    }

    const devId = dev.id.id;

    // Luu Server Attributes
    const serverAttrs = {
      latitude: item.lat,
      longitude: item.lng,
      temperatureAlarmFlag: true,
      humidityAlarmFlag: true,
      temperatureAlarmThreshold: item.tempThreshold,
      humidityAlarmThreshold: item.humThreshold,
      targetTemperature: item.targetTemp,
      hvacMode: "AUTO",
      location: item.name,
      zone: item.label,
      site: "Công viên phần mềm Mekong (Mekong MTP)",
      address: "Ấp Phong Thuận, Tân Mỹ Chánh, TP. Mỹ Tho, Tiền Giang (QL50)",
      linkedNode: item.aqNodeId
    };

    await fetch(`${TB_URL}/api/plugins/telemetry/DEVICE/${devId}/SERVER_SCOPE`, {
      method: "POST",
      headers: H,
      body: JSON.stringify(serverAttrs)
    });

    // Luu Shared Attributes (cho widget Thermostat slider / controls)
    await fetch(`${TB_URL}/api/plugins/telemetry/DEVICE/${devId}/SHARED_SCOPE`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        targetTemperature: item.targetTemp,
        hvacMode: "AUTO",
        cooler: 0,
        fan: 0
      })
    });

    // Gui telemetry khoi tao
    const now = Date.now();
    await fetch(`${TB_URL}/api/plugins/telemetry/DEVICE/${devId}/timeseries/ANY`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        temperature: item.currentTemp,
        humidity: item.currentHum,
        targetTemperature: item.targetTemp,
        cooler: 0,
        fan: 0
      })
    });

    console.log(`-> Da cau hinh xong Thermostat: ${item.name} (${item.lat}, ${item.lng})`);
  }

  // 3. Dong thoi cap nhat thuoc tinh Thermostat cho 5 trạm aq-node-01 .. aq-node-05
  for (let i = 0; i < 5; i++) {
    const nodeName = `aq-node-0${i + 1}`;
    const mtpMeta = MTP_THERMOSTATS[i];
    const aqDev = allDevs.find(d => d.name === nodeName);
    if (aqDev) {
      const devId = aqDev.id.id;
      await fetch(`${TB_URL}/api/plugins/telemetry/DEVICE/${devId}/SERVER_SCOPE`, {
        method: "POST",
        headers: H,
        body: JSON.stringify({
          latitude: mtpMeta.lat,
          longitude: mtpMeta.lng,
          temperatureAlarmFlag: true,
          humidityAlarmFlag: true,
          temperatureAlarmThreshold: mtpMeta.tempThreshold,
          humidityAlarmThreshold: mtpMeta.humThreshold,
          targetTemperature: mtpMeta.targetTemp,
          hvacMode: "AUTO",
          zone: mtpMeta.label,
          site: "Công viên phần mềm Mekong (Mekong MTP)"
        })
      });
      console.log(`-> Da dong bo thuoc tinh Thermostat cho trạm: ${nodeName}`);
    }
  }

  // 4. Nang cap Dashboard "Thermostats" (id: 51501270-c9e2-11f1-ac6f-417f523b53c5)
  // Dat tam ban do ve Mekong MTP (10.3558, 106.4021) va zoom 17 de nhin ro 5 phan khu
  const dbRes = await fetch(`${TB_URL}/api/dashboard/51501270-c9e2-11f1-ac6f-417f523b53c5`, { headers: H });
  if (dbRes.ok) {
    const db = await dbRes.json();
    console.log("Dang toi uu Dashboard Thermostats cho khu vuc Mekong MTP...");

    // Mở rộng alias để hỗ trợ cả 2 device types: "thermostat" và "AirQualityNode"
    if (db.configuration && db.configuration.entityAliases) {
      for (const alias of Object.values(db.configuration.entityAliases)) {
        if (alias.filter && alias.filter.deviceTypes) {
          if (!alias.filter.deviceTypes.includes("AirQualityNode")) {
            alias.filter.deviceTypes.push("AirQualityNode");
          }
        }
      }
    }

    // Tối ưu hóa widget Map để lấy tâm Mekong MTP và hiển thị đẹp mắt
    if (db.configuration && db.configuration.widgets) {
      for (const w of Object.values(db.configuration.widgets)) {
        if (w.typeFullFqn && w.typeFullFqn.includes("map")) {
          w.config.settings.useDefaultCenterPosition = true;
          w.config.settings.defaultCenterPosition = "10.355847,106.402084";
          w.config.settings.defaultZoomLevel = 17;
          w.config.settings.fitMapBounds = true;
        }
      }
    }

    await fetch(`${TB_URL}/api/dashboard`, {
      method: "POST",
      headers: H,
      body: JSON.stringify(db)
    });
    console.log("-> Da cap nhat Dashboard Thermostats thanh cong!");
  }

  console.log("\n=== HOAN TAT CAU HINH HE THONG THERMOSTATS MEKONG MTP ===");
}

main().catch(err => {
  console.error("Loi:", err);
  process.exit(1);
});
