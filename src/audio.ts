import { AudioRecovery } from './audio-recovery';
import { hitFeedback } from './feedback';
import { ENEMY_META } from './config';
import { AnnouncerGate, CALLOUTS, type Callout } from './announcer';
import type { GameEvent, Simulation } from './simulation';
export interface AudioOptions { muted: boolean; musicMuted: boolean; narratorMuted: boolean; }
type Bus = 'sfx' | 'music' | 'voice';
export class GameAudio {
  private ctx?: AudioContext; private buses?: Record<Bus, GainNode>; private noise?: AudioBuffer;
  private cleanup=new Map<AudioScheduledSourceNode,()=>void>();
  private sources = new Set<AudioScheduledSourceNode>(); private voice?: AudioBufferSourceNode;
  private clips = new Map<Callout, AudioBuffer>(); private gate = new AnnouncerGate();
  private nextBeat = 0; private beat = 0; private duckUntil = 0; private lastMoved = 0;
  private engine?: OscillatorNode; private engineGain?: GainNode;
  options: AudioOptions;
  constructor(options: AudioOptions) { this.options = { muted: options.muted, musicMuted: options.musicMuted, narratorMuted: options.narratorMuted }; }
  private generation=0;
  private recovery=new AudioRecovery(replace=>this.ensureContext(replace));
  get needsAction(){return this.recovery.needsAction && !(this.options.muted&&this.options.musicMuted&&this.options.narratorMuted);}
  unlock(){return this.recovery.run();}
  retry(){return this.recovery.run(true);}
  private ensureContext(replace=false){
    if(!this.ctx||this.ctx.state==='closed'||replace){
      const old=this.ctx;this.reset();for(const bus of Object.values(this.buses??{}))bus.disconnect();
      if(old&&old.state!=='closed')void old.close().catch(()=>{});
      const generation=++this.generation,ctx=this.ctx=new AudioContext();
      this.buses={sfx:ctx.createGain(),music:ctx.createGain(),voice:ctx.createGain()};
      for(const bus of Object.values(this.buses))bus.connect(ctx.destination);
      this.noise=ctx.createBuffer(1,ctx.sampleRate,ctx.sampleRate);
      const data=this.noise.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;
      for(const key of Object.keys(CALLOUTS) as Callout[])if(!this.clips.has(key))void fetch(`./audio/${key}.wav`).then(r=>{if(!r.ok)throw Error('audio');return r.arrayBuffer();}).then(b=>ctx.decodeAudioData(b)).then(b=>{if(generation===this.generation)this.clips.set(key,b);}).catch(()=>{});
    }
    this.setOptions(this.options);return this.ctx;
  }
  setOptions(options: AudioOptions) {
    this.options = { muted: options.muted, musicMuted: options.musicMuted, narratorMuted: options.narratorMuted };
    if (!this.ctx || !this.buses) return;
    this.buses.sfx.gain.setTargetAtTime(options.muted ? 0 : 0.24, this.ctx.currentTime, 0.02);
    this.buses.music.gain.setTargetAtTime(options.musicMuted ? 0 : 0.12, this.ctx.currentTime, 0.03);
    this.buses.voice.gain.setTargetAtTime(options.narratorMuted ? 0 : 0.7, this.ctx.currentTime, 0.02);
    if (options.narratorMuted) this.stopVoice();
  }
  private stopVoice() { if (this.voice) { try { this.voice.stop(); } catch {} this.voice.disconnect();this.voice = undefined; } }
  private stopSources() {
    for (const [s,dispose] of this.cleanup) { try { s.stop(); } catch {} dispose(); } this.sources.clear(); this.stopVoice();
    if (this.engine) { try { this.engine.stop(); } catch {} this.engine.disconnect(); } this.engine = undefined; this.engineGain?.disconnect(); this.engineGain = undefined;
  }
  reset(){this.stopSources();
    this.gate.reset(); this.nextBeat = this.beat = this.duckUntil = this.lastMoved = 0;
  }
  pause() { this.recovery.stop();this.stopSources();if(this.ctx&&this.ctx.state!=='closed')void this.ctx.suspend().catch(() => {}); }
  resume() { return this.unlock(); }
  private play(source: OscillatorNode | AudioBufferSourceNode, duration: number, bus: Bus, volume: number, delay = 0, pan = 0) {
    if (!this.ctx || !this.buses || this.sources.size >= 48) return;
    const ctx = this.ctx, start = ctx.currentTime + delay, gain = ctx.createGain(), panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-0.85, Math.min(0.85, pan));
    gain.gain.setValueAtTime(0.001, start); gain.gain.exponentialRampToValueAtTime(Math.max(0.002, volume), start + 0.008); gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    source.connect(gain); gain.connect(panner); panner.connect(this.buses[bus]); source.start(start); source.stop(start + duration + 0.025); this.sources.add(source);
    const dispose=()=>{source.disconnect();gain.disconnect();panner.disconnect();this.sources.delete(source);this.cleanup.delete(source);};this.cleanup.set(source,dispose);source.onended=dispose;
  }
  private tone(f: number, duration: number, type: OscillatorType = 'sine', volume = 0.3, end = f, bus: Bus = 'sfx', delay = 0, pan = 0) {
    if (!this.ctx || (bus === 'sfx' && this.options.muted) || (bus === 'music' && this.options.musicMuted)) return;
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, this.ctx.currentTime + delay); o.frequency.exponentialRampToValueAtTime(Math.max(20, end), this.ctx.currentTime + delay + duration); this.play(o, duration, bus, volume, delay, pan);
  }
  private burst(volume: number, duration: number, pan = 0, bus: Bus = 'sfx') {
    if (!this.ctx || !this.noise || (bus === 'sfx' && this.options.muted) || (bus === 'music' && this.options.musicMuted)) return;
    const b = this.ctx.createBufferSource(); b.buffer = this.noise; b.playbackRate.value = 0.5 + Math.random() * 0.4; this.play(b, duration, bus, volume, 0, pan);
  }
  handle(events: GameEvent[], sim: Simulation) {
    if(this.ctx?.state!=='running')return;
    for (const e of events) {
      const pan = ((e.x - sim.player.x) * 0.76 - (e.z - sim.player.z) * 0.65) / 16;
      const volume = 1 / (1 + Math.hypot(e.x - sim.player.x, e.z - sim.player.z) * 0.07);
      if (e.type === 'shot') {
        const f = e.owner === 'enemy' ? ({ light: 90, shooter: 135, flanker: 180, squall: 210, barrier: 70, factory: 55 } as Record<string, number>)[e.weapon ?? ''] ?? 110 : e.owner === 'lev' ? 250 : sim.powerTime > 0 ? 65 : 145;
        this.tone(f * (0.95 + Math.random() * 0.1), 0.1, e.owner === 'lev' ? 'triangle' : 'sawtooth', volume * 0.4, 35, 'sfx', 0, pan); this.burst(volume * 0.09, 0.05, pan);
      } else if (e.type === 'explode' || e.type === 'crate') {
        const size = e.tier === 'boss' ? 2.4 : e.tier === 'mini' ? 1.5 : 1;
        this.tone(60 + Math.random() * 30, 0.4 * size, 'sine', volume * 0.7, 22, 'sfx', 0, pan); this.burst(volume * 0.3 * size, 0.3 * size, pan);
      } else if (e.type === 'hit') { this.tone(e.target === 0 ? 300 : 650, 0.07, 'square', e.target === 0 ? hitFeedback(e,sim.player.hp,sim.player.maxHp).volume : 0.1 * volume, 80, 'sfx', 0, pan); }
      else if (e.type === 'shield') this.tone(800, 0.18, 'sine', 0.25 * volume, 180, 'sfx', 0, pan);
      else if (e.type === 'dash') { this.burst(0.2 * volume, 0.25, pan); this.tone(70, 0.22, 'triangle', 0.3 * volume, 400, 'sfx', 0, pan); }
      else if(e.type==='landing'){this.burst(volume*.07,.09,pan);this.tone(140,.08,'triangle',volume*.12,80,'sfx',0,pan);}
      else if(e.type==='upgrade'){this.burst(volume*.14,.1,pan);[280,420,840].forEach((f,i)=>this.tone(f,.12,'triangle',volume*.3,f,'sfx',i*.1,pan));}
      else if(e.type==='supply'){this.tone(180,.25,'sine',.12*volume,480,'sfx',0,pan);this.tone(480,.2,'sine',.1*volume,620,'sfx',.2,pan);}
      else if(e.type==='supplyLand'){this.tone(90,.25,'triangle',.3*volume,35,'sfx',0,pan);this.tone(370,.12,'square',.05*volume,120,'sfx',.05,pan);}
      else if(e.type==='zoneRepair')this.tone(640,.08,'sine',.035*volume,760,'sfx',0,pan);
      else if (e.type === 'heal' || e.type === 'pickup') [420, 560, 740].forEach((f, i) => this.tone(f, 0.15, 'sine', 0.25 * volume, f, 'sfx', i * 0.09, pan));
      else if (e.type === 'ready') [520, 780].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.3, f, 'sfx', i * 0.13));
      else if (e.type === 'warning') this.tone(500, 0.1, 'sine', 0.2 * volume, 900, 'sfx', 0, pan);
      else if (e.type === 'capture') this.tone(e.text === 'contested' ? 220 : 660, 0.2, 'triangle', 0.25, e.text === 'contested' ? 160 : 880);
      else if (e.type === 'achievement' || e.type === 'phase') [196, 294, 392].forEach((f, i) => this.tone(f, 0.2, 'triangle', 0.22, f, 'sfx', i * 0.07));
      else if (e.type === 'power') { this.duckUntil = sim.elapsed + 1.8; [196, 294, 392, 587, 784].forEach((f, i) => this.tone(f, 0.22, 'square', 0.17, f, 'sfx', i * 0.1)); }
      else if (e.type === 'over') [230, 174, 116].forEach((f, i) => this.tone(f, 0.28, 'triangle', 0.3, f, 'sfx', i * 0.16));
    }
    const chosen = this.gate.choose(events.flatMap(e => e.callout ? [e.callout] : []), sim.elapsed);
    const clip = chosen && this.clips.get(chosen);
    if (clip && this.ctx && this.buses && !this.options.narratorMuted) {
      this.stopVoice(); const source = this.ctx.createBufferSource(); source.buffer = clip; source.connect(this.buses.voice); source.start(); this.voice = source; this.duckUntil = Math.max(this.duckUntil, sim.elapsed + clip.duration + 0.2);
      source.onended = () => { source.disconnect(); if (this.voice === source) this.voice = undefined; };
    }
  }
  update(sim: Simulation) {
    if (!this.ctx || this.ctx.state!=='running' || !this.buses || sim.phase === 'paused') return;
    const active = sim.phase === 'playing' || sim.phase === 'intro';
    this.buses.music.gain.setTargetAtTime(!active || this.options.musicMuted ? 0 : sim.elapsed < this.duckUntil ? 0.035 : 0.12, this.ctx.currentTime, 0.08);
    if (active && !this.engine) {
      this.engine = this.ctx.createOscillator(); this.engine.type = 'triangle'; this.engineGain = this.ctx.createGain(); this.engineGain.gain.value = 0; this.engine.connect(this.engineGain); this.engineGain.connect(this.buses.sfx); this.engine.start();
    }
    if (this.engine && this.engineGain) { const moving = sim.moved > this.lastMoved + 0.001; this.engine.frequency.setTargetAtTime(sim.dashTime > 0 ? 100 : moving ? 57 : 34, this.ctx.currentTime, 0.12); this.engineGain.gain.setTargetAtTime(active ? moving ? 0.14 : 0.05 : 0, this.ctx.currentTime, 0.1); this.lastMoved = sim.moved; }
    if (!active || sim.elapsed < this.nextBeat) return;
    this.nextBeat = sim.elapsed + 60 / 132 / 2;
    const step = this.beat++, fight = sim.breakTime === 0 && sim.phase === 'playing', boss = sim.enemies.find(e => ENEMY_META[e.kind].tier === 'boss');
    const notes = [146.83, 174.61, 220, 196], root = notes[Math.floor(step / 16) % 4];
    if (step % 8 === 0) { this.tone(root, 1.5, 'sine', 0.35, root, 'music'); this.tone(root * 1.5, 1.5, 'sine', 0.18, root * 1.5, 'music'); }
    if (fight) {
      if (step % 4 === 0) this.tone(135, 0.19, 'sine', 0.9, 38, 'music');
      if (step % 4 === 2) this.burst(0.2, 0.09, 0, 'music');
      this.burst(0.035, 0.035, step % 2 ? -0.2 : 0.2, 'music');
      this.tone(root * ([1, 2, 1.5, 2][step % 4]), 0.14, 'triangle', 0.14, root, 'music');
    }
    if (boss) {
      this.tone(root / 2, 0.2, 'sawtooth', 0.23, root / 2, 'music');
      const motif = boss.kind === 'drill' ? [1, 1, 1.5, 1.25] : boss.kind === 'hail' ? [2, 1.5, 1.25, 1] : [1, 1.25, 1.5, 2];
      if (step % 2 === 0) this.tone(root * motif[(step / 2) % 4], 0.19, 'square', 0.08, root, 'music');
    }
  }
  stats() { return { state:this.ctx?.state??'uninitialized',needsAction:this.needsAction,sources: this.sources.size, clips: this.clips.size, engine: !!this.engine, voice: !!this.voice, ...this.options }; }
}
