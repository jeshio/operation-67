#!/usr/bin/env python3
"""Read-only VPS sampler; a baseline workload command targets its loopback QA port."""
import hashlib, json, os, pathlib, re, select, subprocess, sys, time, urllib.request

def get(url):
    try:
        with urllib.request.urlopen(url, timeout=0.8) as r:
            return json.load(r)
    except Exception as e:
        return {"error": type(e).__name__}

def read(path):
    try:
        return pathlib.Path(path).read_text().strip()
    except OSError:
        return None

def kv(path):
    value = read(path)
    return dict((k, int(v)) for k, v in (line.split() for line in value.splitlines())) if value else {}

def service(name):
    root = '/sys/fs/cgroup/system.slice/' + name + '.service/'
    raw = read(root + 'memory.current')
    pids = (read(root + 'cgroup.procs') or '').split()
    return {"cpu": kv(root+'cpu.stat'), "memoryBytes": int(raw) if raw else None,
            "memoryEvents": kv(root+'memory.events'), "memoryStat": {k:v for k,v in kv(root+'memory.stat').items() if k in ('anon','file','sock')},
            "cpuLimit": read(root+'cpu.max'), "memoryLimit": read(root+'memory.max'), "processes": len(pids)}

def tcp():
    try:
        lines=subprocess.check_output(['ss','-Htin','state','established','( sport = :443 )'],text=True,timeout=0.5).splitlines()
        result=[]
        for header,info in zip(lines[::2],lines[1::2]):
            fields=header.split()
            def number(pattern):
                found=re.search(pattern,info)
                return float(found.group(1)) if found else 0
            # Addresses and ephemeral ports never leave the VPS.
            result.append({"id":hashlib.sha256(header[header.find(fields[2]):].encode()).hexdigest()[:16],
                "receiveQueue":int(fields[0]),"sendQueue":int(fields[1]),"rttMs":number(r'\brtt:([\d.]+)'),
                "bytesSent":number(r'\bbytes_sent:(\d+)'),"bytesRetransmitted":number(r'\bbytes_retrans:(\d+)'),
                "retransmissions":number(r'\bretrans:\d+/(\d+)')})
        return result
    except (OSError,subprocess.SubprocessError,ValueError,IndexError):
        return None

def sample():
    production = get('http://127.0.0.1:5179/health')
    health = get('http://127.0.0.1:5209/health')
    qa = get('http://127.0.0.1:5210/') if os.environ.get('CAPACITY_VERSION')=='baseline' else get('http://127.0.0.1:5209/api/qa')
    if isinstance(qa.get('rooms'), list):
        qa['rooms'] = [{k:r[k] for k in ('matchId','code','hostEpoch','round','stage','checkpointAgeMs','checkpointTicks','tick','wave','stepP95Ms','stepTimes','reason','players') if k in r and k!='players'} | {"players": len(r['players']) if isinstance(r.get('players'),list) else r.get('players')} for r in qa['rooms']]
    qa.pop('events',None)
    nic = {}
    for line in (read('/proc/net/dev') or '').splitlines()[2:]:
        name, data = line.split(':',1); name=name.strip(); values=data.split()
        if name!='lo': nic[name]={"receivedBytes":int(values[0]),"sentBytes":int(values[8])}
    return {"at":time.time()*1000,"production":production,"health":health,"qa":qa,"game":service('roma67-qa'),"https":service('roma67-https'),"tcp":tcp(),"network":nic,"loadAverage":os.getloadavg()}

while True:
    began = time.monotonic()
    print(json.dumps(sample(),separators=(',',':')), flush=True)
    while time.monotonic()-began < 1:
        ready,_,_ = select.select([sys.stdin],[],[],max(0,1-(time.monotonic()-began)))
        if not ready: break
        line=sys.stdin.readline()
        if not line: sys.exit(0)
        try:
            command=json.loads(line)
            if command.get('action')=='workload' and os.environ.get('CAPACITY_VERSION')=='baseline':
                request=urllib.request.Request('http://127.0.0.1:5210/workload', data=json.dumps(command).encode(),headers={'Content-Type':'application/json'})
                with urllib.request.urlopen(request, timeout=5) as r: result=json.load(r)
                print(json.dumps({"command":command.get('id'),"result":result}),flush=True)
        except Exception as e:
            print(json.dumps({"commandError":str(e)}),flush=True)
