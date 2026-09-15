"""Mac-only CONNECT tunnel to the QA VPS, with outbound sockets bound to one NIC.

TLS and SSH stay encrypted end to end. This does not change system routing.
Docker Desktop reaches the loopback listener through host.docker.internal.
"""
import argparse
import asyncio
import json
import resource
import socket
import sys
import time

parser = argparse.ArgumentParser()
parser.add_argument('--interface', default='en0')
parser.add_argument('--port', type=int, default=5299)
args = parser.parse_args()
if sys.platform != 'darwin':
    raise SystemExit('IP_BOUND_IF requires macOS')
interface_index = socket.if_nametoindex(args.interface)
counts = dict(active=0, accepted=0, rejected=0, errors=0, bytesUp=0, bytesDown=0)


async def copy(reader, writer, counter):
    while data := await reader.read(65536):
        writer.write(data)
        await writer.drain()
        counts[counter] += len(data)


async def tunnel(reader, writer):
    remote_writer = None
    raw = None
    active = False
    pumps = []
    try:
        header = await asyncio.wait_for(reader.readuntil(b'\r\n\r\n'), 5)
        first = header.split(b'\r\n', 1)[0].decode('ascii').split()
        allowed = {f'{host}:{port}' for host in ('67.jeshio.ru', '89.19.211.4') for port in (22, 443)}
        if len(first) != 3 or first[0] != 'CONNECT' or first[1] not in allowed:
            counts['rejected'] += 1
            writer.write(b'HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n')
            await writer.drain()
            return
        raw = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        # Verified in the macOS SDK's netinet/in.h; Python does not expose it.
        raw.setsockopt(socket.IPPROTO_IP, 25, interface_index)
        raw.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        raw.setblocking(False)
        await asyncio.wait_for(asyncio.get_running_loop().sock_connect(raw, ('89.19.211.4', int(first[1].rsplit(':', 1)[1]))), 10)
        remote_reader, remote_writer = await asyncio.open_connection(sock=raw)
        raw = None
        writer.write(b'HTTP/1.0 200 Connection Established\r\n\r\n')
        await writer.drain()
        counts['accepted'] += 1
        counts['active'] += 1
        active = True
        pumps = [asyncio.create_task(copy(reader, remote_writer, 'bytesUp')),
                 asyncio.create_task(copy(remote_reader, writer, 'bytesDown'))]
        await asyncio.wait(pumps, return_when=asyncio.FIRST_COMPLETED)
    except (OSError, ValueError, UnicodeError, asyncio.TimeoutError, asyncio.IncompleteReadError, asyncio.LimitOverrunError):
        counts['errors'] += 1
    finally:
        for task in pumps:
            task.cancel()
        if pumps:
            await asyncio.gather(*pumps, return_exceptions=True)
        if active:
            counts['active'] -= 1
        if raw:
            raw.close()
        if remote_writer:
            remote_writer.close()
        writer.close()


async def telemetry():
    initial_usage = resource.getrusage(resource.RUSAGE_SELF)
    previous = time.monotonic()
    previous_cpu = initial_usage.ru_utime + initial_usage.ru_stime
    while True:
        usage = resource.getrusage(resource.RUSAGE_SELF)
        now = time.monotonic()
        cpu = usage.ru_utime + usage.ru_stime
        print(json.dumps(dict(at=int(time.time()*1000), interface=args.interface, **counts,
                              maxRssBytes=usage.ru_maxrss,
                              cpuPercent=100*(cpu-previous_cpu)/max(0.001, now-previous))), flush=True)
        previous, previous_cpu = now, cpu
        await asyncio.sleep(1)


async def main():
    server = await asyncio.start_server(tunnel, '127.0.0.1', args.port, limit=8192, backlog=512)
    async with server:
        await asyncio.gather(server.serve_forever(), telemetry())


try:
    asyncio.run(main())
except KeyboardInterrupt:
    pass
