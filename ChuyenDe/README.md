
# first start
docker compose up -d influxdb3

// create token
docker exec -it influxdb3-iot-poc-influxdb3-1 sh
influxdb3 create token --admin --format text 

// update token .env
copy to token 

docker compose down

# docker compose up 

gf http://127.0.0.1:3000

check Throughput
curl -s -w "\n⏱️ Query Latency: %{time_total}s\n" \
  -X POST "http://127.0.0.1:8181/api/v3/query_sql" \
  -H "Authorization: Bearer ${INFLUX_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "db": "iot_environment",
    "q": "SELECT DATE_TRUNC('\''second'\'', time) AS \"Giờ nhận\", COUNT(*) AS \"Records/giây\" FROM air_quality_raw WHERE time >= NOW() - INTERVAL '\''1 minute'\'' GROUP BY DATE_TRUNC('\''second'\'', time) ORDER BY \"Giờ nhận\" DESC LIMIT 15"
  }'
mosquitto_sub -h localhost -p 1883 -t "iot/environment/#" -v
#  Truy vấn SQL và Phép tính Aggregation
source .env
curl -s -w "\n⏱️  Query Latency: %{time_total}s (tương đương %{time_total}000 ms)\n" \
  -X POST "http://127.0.0.1:8181/api/v3/query_sql" \
  -H "Authorization: Bearer ${INFLUX_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "db": "iot_environment",
    "q": "SELECT DATE_TRUNC('\''minute'\'', time) AS time_bucket, device_id AS sensor_id, AVG(temperature) AS avg_temp, MAX(temperature) AS max_temp, MIN(temperature) AS min_temp, AVG(humidity) AS avg_humidity FROM air_quality_raw WHERE time >= NOW() - INTERVAL '\''6 hours'\'' GROUP BY DATE_TRUNC('\''minute'\'', time), device_id ORDER BY time_bucket DESC LIMIT 10"
  }'

#  Kiểm thử tải và khả năng mở rộng

docker stats influxdb3-iot-poc-influxdb3-1 influxdb3-iot-poc-telegraf-1

python simulate.py --devices 10 --interval 1.0 --duration 300 --host localhost --port 1883

python simulate.py --devices 100 --interval 1.0 --duration 30 --host localhost --port 1883

python simulate.py --devices 1000 --interval 1.0 --duration 30 --host localhost --port 1883

# Thử nghiệm độ tin cậy và khắc phục sự cố

python simulate.py --devices 1000 --interval 0.1 --host localhost --port 1883

time docker compose restart influxdb3
