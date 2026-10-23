#!/usr/bin/env python3
"""Simulate environmental IoT devices and publish telemetry to MQTT."""

import argparse
import json
import math
import random
import time

import paho.mqtt.client as mqtt


def generate_payload(device_index, seq):
    """Generate environmental telemetry for one device."""

    device_name = f"aq-node-{device_index + 1:02d}"

    temperature = round(
        28 + 5 * math.sin(seq / 25 + device_index / 13)
        + random.uniform(-0.5, 0.5), 2
    )

    humidity = round(
        max(0, min(100,
            65 + 10 * math.sin(seq / 32 + device_index / 17)
            + random.uniform(-2, 2)
        )), 2
    )

    co2 = int(max(
        400,
        900 + 500 * math.sin(seq / 30 + device_index / 10)
        + random.uniform(-100, 100)
    ))

    pm25 = round(max(
        0,
        45 + 20 * math.sin(seq / 19 + device_index / 11)
        + random.uniform(-3, 3)
    ), 2)

    air_quality = int(max(
        0,
        min(500, 100 + pm25 * 0.9 + random.uniform(-10, 10))
    ))

    return {
        "device_id": device_name,
        "ts": str(int(time.time() * 1000)),
        "values": {
            "temperature": temperature,
            "humidity": humidity,
            "co2": co2,
            "pm25": pm25,
            "air_quality": air_quality,
            "seq": seq
        }
    }


def main():
    parser = argparse.ArgumentParser(
        description="IoT Environmental MQTT Simulator"
    )

    parser.add_argument("--host", default="localhost")
    parser.add_argument("--port", type=int, default=1883)
    parser.add_argument("--devices", type=int, default=10)
    parser.add_argument("--interval", type=float, default=2.0)
    parser.add_argument("--duration", type=float, default=0)
    parser.add_argument("--qos", type=int, choices=[0, 1], default=0)

    args = parser.parse_args()

    if args.devices < 1 or args.interval <= 0 or args.duration < 0:
        parser.error("Invalid devices, interval or duration")

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    client.connect(args.host, args.port, 60)
    client.loop_start()

    started = time.monotonic()
    sent = 0
    round_num = 0

    print(
        f"Simulator started: devices={args.devices}, "
        f"interval={args.interval}s, broker={args.host}:{args.port}",
        flush=True
    )

    try:
        while args.duration == 0 or time.monotonic() - started < args.duration:

            tick = time.monotonic()
            round_num += 1

            for i in range(args.devices):

                payload = generate_payload(i, round_num)

                topic = f'iot/environment/{payload["device_id"]}'

                info = client.publish(
                    topic,
                    json.dumps(payload),
                    qos=args.qos
                )

                if info.rc == mqtt.MQTT_ERR_SUCCESS:
                    sent += 1
                else:
                    print(f"Publish error: {info.rc}", flush=True)

            elapsed = time.monotonic() - tick

            if round_num % 10 == 0:
                rate = sent / max(
                    0.001, time.monotonic() - started
                )

                print(
                    f"round={round_num} "
                    f"published={sent} "
                    f"rate={rate:.1f} msg/s",
                    flush=True
                )

            time.sleep(max(0, args.interval - elapsed))

    except KeyboardInterrupt:
        print("Stopping simulator...")

    finally:
        client.disconnect()
        client.loop_stop()

        print(
            f"published={sent}, "
            f"elapsed={time.monotonic() - started:.2f}s "
            "(MQTT publish accepted, not DB commit count)"
        )


if __name__ == "__main__":
    main()