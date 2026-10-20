
# first start
docker compose up -d influxdb3

// create token
docker exec -it influxdb3-iot-poc-influxdb3-1 sh
influxdb3 create token --admin --format text 

// update token .env
copy to token 

docker compose down

# docker compose up 

flux ui: http://127.0.0.1:8888
gf http://127.0.0.1:3000
