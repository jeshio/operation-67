import { parentPort } from 'node:worker_threads';
import { HostRunner } from '../src/net/host-worker.ts';
const runner=new HostRunner(data=>parentPort.postMessage(data));
parentPort.on('message',command=>runner.receive(command));
