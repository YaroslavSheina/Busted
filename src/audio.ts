// Звук: синтез через Web Audio, без файлов (docs/mechanics.md, «Звук»). События игры дёргают эффекты по именам —
// чем они озвучены (синтез или семплы), вопрос ассетов, не игры. Вне браузера (харнесс в Node) — заглушка.
// Контекст создаётся при первом жесте (тап по загрузочному экрану): мобильные браузеры иначе молчат.

export type Sfx = 'near' | 'panic' | 'crash' | 'off' | 'caught' | 'train' | 'jump' | 'land' | 'copOut' | 'score' | 'big'
  | 'delivered' | 'card' | 'beep' | 'go' | 'spikes' | 'horn' | 'trap';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = true;
let noiseBuf: AudioBuffer | null = null;

// мотор (2026-09-14, «слишком синтезированно»): три голоса — пила, пила на октаву ниже и чуть расстроенный квадрат — через мягкую
// перегрузку (WaveShaper) и резонансный фильтр, поверх шум выхлопа; амплитуда пульсирует на частоте «вспышек» (f/2), тон медленно
// дрожит случайным блужданием. Тон от скорости машины, выше в повороте, в заносе хрип и открытый фильтр
let engOsc: OscillatorNode | null = null, engSub: OscillatorNode | null = null, engSq: OscillatorNode | null = null;
let engGain: GainNode | null = null, engFilter: BiquadFilterNode | null = null, engFire: OscillatorNode | null = null;
let exhaust: GainNode | null = null, exhaustFilter: BiquadFilterNode | null = null;
let wobble = 0;
function softClip(drive: number): Float32Array<ArrayBuffer> {
  const n = 1024, c = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * drive) / Math.tanh(drive); }
  return c;
}
// сирена: два тона, частота качается прямоугольным LFO; громкость — от близости копа
let sirOsc: OscillatorNode | null = null, sirGain: GainNode | null = null;

const SND = 'lr.sound';
try { if (localStorage.getItem(SND) === '0') enabled = false; } catch { /* нет хранилища */ }
export function audioEnabled(): boolean { return enabled; }
export function setAudioEnabled(on: boolean): void { enabled = on; if (master) master.gain.value = on ? 0.5 : 0; try { localStorage.setItem(SND, on ? '1' : '0'); } catch { /* приватный режим */ } }

// Первый жест пользователя: создать контекст и постоянные узлы. Дальше каждый жест будит контекст, если система его остановила
// (iOS после звонка держит его в состоянии interrupted, пока пользователь не коснётся экрана)
export function unlockAudio(): void {
  if (ctx) { if (ctx.state !== 'running' && !quiet) void ctx.resume(); return; }
  if (typeof AudioContext === 'undefined') return;
  ctx = new AudioContext();
  master = ctx.createGain(); master.gain.value = enabled ? 0.5 : 0; master.connect(ctx.destination);
  // буфер шума на 2 с
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  // мотор: голоса → перегрузка → фильтр → пульсация → громкость
  engOsc = ctx.createOscillator(); engOsc.type = 'sawtooth'; engOsc.frequency.value = 90;
  engSub = ctx.createOscillator(); engSub.type = 'sawtooth'; engSub.frequency.value = 45; engSub.detune.value = 6;
  engSq = ctx.createOscillator(); engSq.type = 'square'; engSq.frequency.value = 90; engSq.detune.value = -9;
  const mix = ctx.createGain(); mix.gain.value = 0.5;
  const subG = ctx.createGain(); subG.gain.value = 0.7; const sqG = ctx.createGain(); sqG.gain.value = 0.25;
  engOsc.connect(mix); engSub.connect(subG); subG.connect(mix); engSq.connect(sqG); sqG.connect(mix);
  const shaper = ctx.createWaveShaper(); shaper.curve = softClip(3.5); shaper.oversample = '2x';
  engFilter = ctx.createBiquadFilter(); engFilter.type = 'lowpass'; engFilter.frequency.value = 500; engFilter.Q.value = 1.4;
  const fire = ctx.createGain(); fire.gain.value = 0.75;
  engFire = ctx.createOscillator(); engFire.type = 'sine'; engFire.frequency.value = 45;
  const fireDepth = ctx.createGain(); fireDepth.gain.value = 0.25; engFire.connect(fireDepth); fireDepth.connect(fire.gain); engFire.start();
  engGain = ctx.createGain(); engGain.gain.value = 0;
  mix.connect(shaper); shaper.connect(engFilter); engFilter.connect(fire); fire.connect(engGain); engGain.connect(master);
  engOsc.start(); engSub.start(); engSq.start();
  // выхлоп: полосовой шум, громче в заносе
  const ex = ctx.createBufferSource(); ex.buffer = noiseBuf; ex.loop = true;
  exhaustFilter = ctx.createBiquadFilter(); exhaustFilter.type = 'bandpass'; exhaustFilter.frequency.value = 600; exhaustFilter.Q.value = 0.8;
  exhaust = ctx.createGain(); exhaust.gain.value = 0;
  ex.connect(exhaustFilter); exhaustFilter.connect(exhaust); exhaust.connect(engGain); ex.start();
  // сирена
  sirOsc = ctx.createOscillator(); sirOsc.type = 'triangle'; sirOsc.frequency.value = 700;
  const sirLfo = ctx.createOscillator(); sirLfo.type = 'square'; sirLfo.frequency.value = 1.6;
  const sirDepth = ctx.createGain(); sirDepth.gain.value = 110; sirLfo.connect(sirDepth); sirDepth.connect(sirOsc.frequency); sirLfo.start();
  const sirFilter = ctx.createBiquadFilter(); sirFilter.type = 'lowpass'; sirFilter.frequency.value = 1800;
  sirGain = ctx.createGain(); sirGain.gain.value = 0;
  sirOsc.connect(sirFilter); sirFilter.connect(sirGain); sirGain.connect(master); sirOsc.start();
  if (ctx.state === 'suspended') void ctx.resume();
}

// Свёрнутая игра молчит: пока страница скрыта, контекст стоит — иначе мотор и сирена гудят в фоне и после блокировки экрана
let quiet = false;
export function quietAudio(on: boolean): void {
  quiet = on;
  if (ctx) void (on ? ctx.suspend() : ctx.resume()).catch(() => { /* без жеста iOS не разбудит — разбудит следующий тап */ });
}

// Мотор каждый кадр: on — мир идёт; speed — скорость машины px/с; turn — |ω|/порог заноса 0..1+; skid — занос; air — в полёте; slow — слоу-мо
export function engine(on: boolean, speed: number, turn: number, skid: boolean, air: boolean, slow: boolean): void {
  if (!ctx || !engOsc || !engSub || !engSq || !engFire || !engGain || !engFilter || !exhaust || !exhaustFilter) return;
  const t = ctx.currentTime;
  // медленное блуждание тона ±2 %: мотор не гудит на одной ноте
  wobble = Math.max(-0.02, Math.min(0.02, wobble * 0.97 + (Math.random() - 0.5) * 0.004));
  const base = 55 + speed * 0.14;                          // 240 → 89 Гц, 420 → 114 Гц
  const f = base * (air ? 1.6 : skid ? 1.35 : 1 + Math.min(1, turn) * 0.12) * (slow ? 0.6 : 1) * (1 + wobble);
  engOsc.frequency.setTargetAtTime(f, t, 0.08);
  engSub.frequency.setTargetAtTime(f / 2, t, 0.08);
  engSq.frequency.setTargetAtTime(f, t, 0.08);
  engFire.frequency.setTargetAtTime(f / 2, t, 0.08);
  engFilter.frequency.setTargetAtTime(skid ? 1600 : air ? 1000 : 380 + speed * 0.55 + Math.min(1, turn) * 150, t, 0.1);
  exhaust.gain.setTargetAtTime(skid ? 0.5 : 0.18, t, 0.1);
  exhaustFilter.frequency.setTargetAtTime(skid ? 1200 : 600, t, 0.1);
  engGain.gain.setTargetAtTime(on ? (skid ? 0.15 : 0.1) : 0, t, on ? 0.05 : 0.15);
}

// Сирена: level 0 — копа нет; 0..1 — близость (danger)
export function siren(level: number): void {
  if (!ctx || !sirGain) return;
  const g = level <= 0 ? 0 : 0.04 + Math.min(1, level) * 0.16;
  sirGain.gain.setTargetAtTime(g, ctx.currentTime, 0.2);
}

// ---- одиночные эффекты ----
function tone(type: OscillatorType, f0: number, f1: number, dur: number, gain: number, at = 0): void {
  if (!ctx || !master) return;
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur: number, gain: number, filter: BiquadFilterType, f0: number, f1: number, q = 1, at = 0): void {
  if (!ctx || !master || !noiseBuf) return;
  const t = ctx.currentTime + at;
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const fl = ctx.createBiquadFilter(); fl.type = filter; fl.Q.value = q; fl.frequency.setValueAtTime(f0, t); fl.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(fl); fl.connect(g); g.connect(master); s.start(t); s.stop(t + dur + 0.02);
}

export function play(name: Sfx): void {
  if (!ctx) return;
  switch (name) {
    case 'near': noise(0.18, 0.35, 'bandpass', 2400, 500, 2); break;                                   // свист впритирку
    case 'panic': tone('square', 330, 300, 0.45, 0.08); tone('square', 415, 380, 0.45, 0.08); break;   // клаксон испуганного
    case 'crash': noise(0.5, 0.6, 'lowpass', 900, 120); tone('sine', 90, 40, 0.35, 0.5); break;        // удар
    case 'off': noise(0.6, 0.4, 'lowpass', 600, 150, 1, 0); tone('sine', 70, 35, 0.4, 0.35, 0.05); break; // вылет: шорох и глухой удар
    case 'caught': tone('square', 520, 520, 0.18, 0.12); tone('square', 390, 390, 0.25, 0.12, 0.2); noise(0.4, 0.3, 'lowpass', 800, 150); break;
    case 'train': noise(0.9, 0.7, 'lowpass', 500, 80); tone('sine', 60, 30, 0.6, 0.6); tone('sawtooth', 220, 200, 0.5, 0.15); tone('sawtooth', 277, 250, 0.5, 0.15); break;
    case 'jump': tone('sine', 300, 900, 0.3, 0.14); noise(0.25, 0.15, 'highpass', 1500, 3000); break;  // взлёт
    case 'land': tone('sine', 120, 50, 0.22, 0.35); noise(0.2, 0.3, 'lowpass', 1200, 200); break;      // посадка
    case 'copOut': noise(0.45, 0.5, 'lowpass', 1000, 150); tone('square', 480, 120, 0.5, 0.12); break; // коп выбыл: хруст и падающий тон
    case 'score': tone('sine', 880, 1320, 0.09, 0.12); break;                                            // очки
    case 'big': tone('square', 660, 660, 0.08, 0.1); tone('square', 990, 990, 0.12, 0.1, 0.09); break;   // крупные очки
    case 'delivered': [523, 659, 784, 1047].forEach((f, i) => tone('square', f, f, i === 3 ? 0.45 : 0.14, 0.1, i * 0.12)); break;
    case 'trap': tone('square', 392, 392, 0.2, 0.1); tone('square', 311, 311, 0.2, 0.1, 0.22); tone('square', 233, 233, 0.6, 0.1, 0.44); break; // ловушка: нисходящая
    case 'card': noise(0.16, 0.25, 'bandpass', 600, 2600, 2); break;                                   // стрип вылетает
    case 'beep': tone('square', 440, 440, 0.1, 0.08); break;
    case 'go': tone('square', 880, 880, 0.28, 0.1); break;
    case 'spikes': noise(0.7, 0.35, 'lowpass', 2500, 300, 1); tone('sine', 140, 60, 0.3, 0.2); break;  // прокол: шипение и хлопок
    case 'horn': tone('sawtooth', 220, 220, 0.7, 0.12); tone('sawtooth', 277, 277, 0.7, 0.12); break;   // гудок поезда
  }
}
