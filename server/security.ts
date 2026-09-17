import type { IncomingMessage, ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { NET } from '../src/net/config';

export class RequestError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
export const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

export function configuredOrigins(values: string[], production: boolean) {
  const origins = [...new Set(values.map(v => v.trim()).filter(Boolean))];
  if (production && !origins.length) throw Error('Production requires ALLOWED_ORIGINS.');
  for (const value of origins) {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value || (production && url.protocol !== 'https:')) {
      throw Error('ALLOWED_ORIGINS must contain exact HTTP origins (HTTPS in production).');
    }
  }
  return origins;
}
export function originAllowed(origin: string | undefined, origins: string[], production: boolean) {
  // Native clients do not send Origin. This is browser isolation, not authentication.
  return !origin || origins.includes(origin) || (!production && origins.length === 0 && origin !== 'null');
}
const normalizeIP = (ip: string) => ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip;
export function configuredProxies(value: string) {
  const addresses = value.split(',').map(s => s.trim()).filter(Boolean);
  if (addresses.some(ip => !isIP(ip))) throw Error('TRUSTED_PROXY_IPS must contain exact IP addresses.');
  return addresses.map(normalizeIP);
}
export function clientAddress(req: IncomingMessage, trusted: string[]) {
  const peer = normalizeIP(req.socket.remoteAddress ?? 'unknown');
  if (!trusted.includes(peer)) return peer;
  const header = req.headers['x-forwarded-for'];
  if (typeof header !== 'string' || header.length > 1024) return peer;
  // Walk from the trusted immediate hop; never trust an attacker-controlled leftmost value.
  const chain = header.split(',').map(s => normalizeIP(s.trim()));
  if (!chain.length || chain.length > 8 || chain.some(ip => !isIP(ip))) return peer;
  for (let i = chain.length - 1; i >= 0; i--) if (!trusted.includes(chain[i])) return chain[i];
  return peer;
}

/** Fixed upper bound; new identities fail closed while the table is full. */
export class RateLimit {
  private buckets = new Map<string, { tokens: number; at: number }>();
  constructor(readonly capacity: number, readonly periodMs: number, readonly maxKeys = 4096, private now = () => performance.now()) {}
  take(key: string): boolean {
    const now = this.now();
    for (const [id, b] of this.buckets) if (now - b.at >= this.periodMs * 2) this.buckets.delete(id);
    let b = this.buckets.get(key);
    if (!b) {
      if (this.buckets.size >= this.maxKeys) return false;
      b = { tokens: this.capacity, at: now }; this.buckets.set(key, b);
    }
    b.tokens = Math.min(this.capacity, b.tokens + Math.max(0, now - b.at) * this.capacity / this.periodMs); b.at = now;
    if (b.tokens < 1) return false;
    b.tokens--; return true;
  }
}

export function securityHeaders(res: ServerResponse, origins: string[]) {
  const connections = [...origins, ...origins.map(o => o.replace(/^http/, 'ws'))].join(' ');
  res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; media-src 'self' blob:; connect-src 'self' ${connections}; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
}

export function readJoinBody(req: IncomingMessage): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '') ||
      (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity')) {
    return Promise.reject(new RequestError(415, 'INVALID'));
  }
  if (Number(req.headers['content-length']) > NET.maxInputBytes) return Promise.reject(new RequestError(413, 'INVALID'));
  return new Promise((resolve, reject) => {
    let size = 0; const chunks: Buffer[] = [];
    const finish = (error?: RequestError, body?: unknown) => {
      clearTimeout(timer); req.off('data', data); req.off('end', end); req.off('aborted', aborted); req.off('error', aborted);
      if (error) { req.resume(); reject(error); } else resolve(body);
    };
    const data = (chunk: Buffer) => { size += chunk.length; if (size > NET.maxInputBytes) finish(new RequestError(413, 'INVALID')); else chunks.push(chunk); };
    const end = () => { try { finish(undefined, JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { finish(new RequestError(400, 'INVALID')); } };
    const aborted = () => finish(new RequestError(400, 'INVALID'));
    const timer = setTimeout(() => finish(new RequestError(408, 'INVALID')), 5000);
    req.on('data', data); req.once('end', end); req.once('aborted', aborted); req.once('error', aborted);
  });
}

export function validSignal(type: string, message: unknown): boolean {
  if (type === 'webrtc:join') return message === undefined || message === null || (object(message) && Object.keys(message).length === 0);
  if (!object(message) || typeof message.targetId !== 'string' || !/^[\w-]{1,128}$/.test(message.targetId)) return false;
  if (type === 'webrtc:offer' || type === 'webrtc:answer') {
    const sdp = message.sdp;
    return object(sdp) && sdp.type === type.slice(7) && typeof sdp.sdp === 'string' && Buffer.byteLength(sdp.sdp) <= 14_000;
  }
  if (type === 'webrtc:ice-candidate') {
    const c = message.candidate;
    return object(c) && typeof c.candidate === 'string' && c.candidate.length <= 2048 &&
      (c.sdpMid === null || c.sdpMid === undefined || typeof c.sdpMid === 'string' && c.sdpMid.length <= 128) &&
      (c.sdpMLineIndex === null || c.sdpMLineIndex === undefined || Number.isInteger(c.sdpMLineIndex) && c.sdpMLineIndex >= 0 && c.sdpMLineIndex <= 65535) &&
      (c.usernameFragment === undefined || c.usernameFragment === null || typeof c.usernameFragment === 'string' && c.usernameFragment.length <= 256);
  }
  return false;
}
