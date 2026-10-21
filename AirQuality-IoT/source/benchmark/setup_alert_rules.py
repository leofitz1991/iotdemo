"""
SETUP ALERT RULES FOR GRAFANA (CTH619 - KHIÊM)
Tự động cấu hình các Rule cảnh báo theo chuẩn WHO / US-EPA qua Grafana API:
1. Rule CO2 > 1000 ppm (Warning - Kém thông thoáng)
2. Rule AQI > 150 (Critical - Không khí ô nhiễm mức có hại)
"""

import urllib.request
import urllib.error
import base64
import json
import sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

GRAFANA_URL = "http://localhost:3003"
FOLDER_UID = "bg1bd8cjnu9s0c"
DATASOURCE_UID = "P7206BD2ACDC63FCC"

def create_alert_rule(title, field, threshold_value, severity, summary, desc):
    url = f"{GRAFANA_URL}/api/v1/provisioning/alert-rules"
    auth = base64.b64encode(b"admin:admin").decode("ascii")
    
    payload = {
        "folderUID": FOLDER_UID,
        "title": title,
        "ruleGroup": "Air_Quality_Alert_Group",
        "condition": "C",
        "data": [
            {
                "refId": "A",
                "queryType": "",
                "relativeTimeRange": {"from": 300, "to": 0},
                "datasourceUid": DATASOURCE_UID,
                "model": {
                    "datasource": {"type": "influxdb", "uid": DATASOURCE_UID},
                    "query": f'from(bucket: "airquality")\n  |> range(start: -5m)\n  |> filter(fn: (r) => r["_measurement"] =~ /^air_quality/)\n  |> filter(fn: (r) => r["_field"] == "{field}")\n  |> last()',
                    "refId": "A"
                }
            },
            {
                "refId": "B",
                "queryType": "",
                "relativeTimeRange": {"from": 300, "to": 0},
                "datasourceUid": "__expr__",
                "model": {
                    "datasource": {"type": "__expr__", "uid": "__expr__"},
                    "expression": "A",
                    "reducer": "last",
                    "type": "reduce",
                    "refId": "B",
                    "settings": {"mode": "dropNN"}
                }
            },
            {
                "refId": "C",
                "queryType": "",
                "relativeTimeRange": {"from": 300, "to": 0},
                "datasourceUid": "__expr__",
                "model": {
                    "datasource": {"type": "__expr__", "uid": "__expr__"},
                    "expression": "B",
                    "type": "threshold",
                    "refId": "C",
                    "conditions": [
                        {
                            "evaluator": {"params": [threshold_value], "type": "gt"},
                            "operator": {"type": "and"},
                            "query": {"params": ["C"]},
                            "reducer": {"params": [], "type": "avg"},
                            "type": "query"
                        }
                    ]
                }
            }
        ],
        "noDataState": "NoData",
        "execErrState": "Error",
        "for": "0s",
        "annotations": {
            "summary": summary,
            "description": desc
        },
        "labels": {
            "severity": severity,
            "project": "cth619_air_quality"
        }
    }
    
    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), method="POST")
    req.add_header("Authorization", f"Basic {auth}")
    req.add_header("Content-Type", "application/json")
    req.add_header("X-Disable-Provenance", "true")
    
    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            print(f"[OK] Đã tạo thành công Alert Rule: '{title}' (UID: {data.get('uid')})")
            return True
    except urllib.error.HTTPError as e:
        error_msg = e.read().decode("utf-8")
        print(f"[LỖI] Không thể tạo Alert Rule '{title}': HTTP {e.code} - {error_msg}")
        return False

def main():
    print("=" * 70)
    print(" KHỞI TẠO ALERT RULES TỰ ĐỘNG CHO GRAFANA (CTH619 - KHIÊM)")
    print("=" * 70)
    
    # 1. Cảnh báo CO2 > 1000 ppm
    create_alert_rule(
        title="Cảnh báo CO2 vượt ngưỡng khuyến cáo (> 1000 ppm)",
        field="co2",
        threshold_value=1000,
        severity="warning",
        summary="Nồng độ khí CO2 trong phòng vượt ngưỡng 1000 ppm",
        desc="Phát hiện chất lượng không khí kém, thông gió không đủ theo chuẩn WHO."
    )
    
    # 2. Cảnh báo AQI > 150 (Không khí có hại)
    create_alert_rule(
        title="Báo động khẩn cấp: Chỉ số AQI nguy hại (> 150)",
        field="aqi",
        threshold_value=150,
        severity="critical",
        summary="Chỉ số chất lượng không khí AQI vượt mức 150 (Unhealthy)",
        desc="Cảnh báo mức độ ô nhiễm không khí ảnh hưởng nghiêm trọng đến sức khỏe."
    )

if __name__ == "__main__":
    main()
