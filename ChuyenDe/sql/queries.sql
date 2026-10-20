-- Run using: ./scripts/query.sh
SELECT * FROM environment ORDER BY time DESC LIMIT 10;
SELECT device_id, COUNT(*) AS samples FROM environment GROUP BY device_id ORDER BY samples DESC LIMIT 10;
SELECT AVG(temperature) AS avg_temperature, MIN(temperature) AS min_temperature, MAX(temperature) AS max_temperature FROM environment WHERE time > now() - INTERVAL '1 hour';
SELECT date_bin(INTERVAL '1 minute', time) AS minute, AVG(humidity) AS avg_humidity FROM environment WHERE time > now() - INTERVAL '1 hour' GROUP BY 1 ORDER BY 1;
