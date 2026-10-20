#!/usr/bin/env python3
"""Publish simulated environmental telemetry to MQTT."""
import argparse, json, math, random, time
import paho.mqtt.client as mqtt

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--host',default='localhost')
    ap.add_argument('--port',type=int,default=1883)
    ap.add_argument('--devices',type=int,default=10)
    ap.add_argument('--interval',type=float,default=2.0,help='Seconds between rounds; each round sends one sample/device')
    ap.add_argument('--duration',type=float,default=0,help='Seconds; 0 runs until Ctrl+C')
    ap.add_argument('--qos',type=int,choices=[0,1],default=0)
    args=ap.parse_args()
    if args.devices<1 or args.interval<=0 or args.duration<0: ap.error('invalid devices/interval/duration')
    client=mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    client.connect(args.host,args.port,60)
    client.loop_start()
    started=time.monotonic(); sent=0; round_num=0
    try:
        while args.duration==0 or time.monotonic()-started<args.duration:
            tick=time.monotonic(); stamp=int(time.time()*1000)
            for i in range(args.devices):
                d={'device_id':f'sensor_{i+1:04d}', 'timestamp_ms':stamp,
                   'temperature':round(26+4*math.sin(round_num/25+i/13)+random.uniform(-.5,.5),2),
                   'humidity':round(max(0,min(100,65+10*math.sin(round_num/32+i/17)+random.uniform(-2,2))),2),
                   'pm25':round(max(0,24+12*math.sin(round_num/19+i/11)+random.uniform(-3,3)),2)}
                info=client.publish(f'iot/environment/{d["device_id"]}',json.dumps(d),qos=args.qos)
                if info.rc!=mqtt.MQTT_ERR_SUCCESS: print('publish error',info.rc)
                else: sent+=1
            round_num+=1
            elapsed=time.monotonic()-tick
            if round_num%10==0: print(f'round={round_num} published={sent} rate={sent/max(.001,time.monotonic()-started):.1f} msg/s',flush=True)
            time.sleep(max(0,args.interval-elapsed))
    except KeyboardInterrupt: pass
    finally:
        client.disconnect(); client.loop_stop()
        print(f'published={sent}, elapsed={time.monotonic()-started:.2f}s (MQTT publish success, not DB commit count)')
if __name__=='__main__': main()
