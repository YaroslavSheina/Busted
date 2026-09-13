// Звук: синтез через Web Audio, без файлов (docs/mechanics.md, «Звук»). События игры дёргают эффекты по именам —
// чем они озвучены (синтез или семплы), вопрос ассетов, не игры. Вне браузера (харнесс в Node) — заглушка.
// Контекст создаётся при первом жесте (тап по загрузочному экрану): мобильные браузеры иначе молчат.

export type Sfx = 'near' | 'panic' | 'crash' | 'off' | 'caught' | 'train' | 'jump' | 'land' | 'copOut' | 'score' | 'big'
  | 'delivered' | 'card' | 'beep' | 'go' | 'spikes' | 'horn' | 'trap';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = true;
let noiseBuf: AudioBuffer | null = null;

// мотор: пила через фильтр, тон от скорости машины, «хрип» в заносе — шум через полосовой фильтр
let engOsc: OscillatorNode | null = null, engGain: GainNode | null = null, engFilter: BiquadFilterNode | null = null;
let rough: GainNode | null = null;
// сирена: два тона, частота качается прямоугольным LFO; громкость — от близости копа
let sirOsc: OscillatorNode | null = null, sirGain: GainNode | null = null;

export function setAudioEnabled(on: boolean): void { enabled = on; if (master) master.gain.value = on ? 0.5 : 0; }

// Первый жест пользователя: создать контекст и постоянные узлы
export function unlockAudio(): void {
  if (ctx || typeof AudioContext === 'undefined') return;
  ctx = new AudioContext();
  master = ctx.createGain(); master.gain.value = enabled ? 0.5 : 0; master.connect(ctx.destination);
  // буфер шума на 2 с
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  // мотор
  engOsc = ctx.createOscillator(); engOsc.type = 'sawtooth'; engOsc.frequency.value = 70;
  engFilter = ctx.createBiquadFilter(); engFilter.type = 'lowpass'; engFilter.frequency.value = 500; engFilter.Q.value = 2;
  engGain = ctx.createGain(); engGain.gain.value = 0;
  // тарахтение: амплитуда модулируется низким прямоугольником
  rough = ctx.createGain(); rough.gain.value = 0.7;
  const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 28;
  const lfoDepth = ctx.createGain(); lfoDepth.gain.value = 0.3; lfo.connect(lfoDepth); lfoDepth.connect(rough.gain); lfo.start();
  engOsc.connect(engFilter); engFilter.connect(rough); rough.connect(engGain); engGain.connect(master); engOsc.start();
  // сирена
  sirOsc = ctx.createOscillator(); sirOsc.type = 'triangle'; sirOsc.frequency.value = 700;
  const sirLfo = ctx.createOscillator(); sirLfo.type = 'square'; sirLfo.frequency.value = 1.6;
  const sirDepth = ctx.createGain(); sirDepth.gain.value = 110; sirLfo.connect(sirDepth); sirDepth.connect(sirOsc.frequency); sirLfo.start();
  const sirFilter = ctx.createBiquadFilter(); sirFilter.type = 'lowpass'; sirFilter.frequency.value = 1800;
  sirGain = ctx.createGain(); sirGain.gain.value = 0;
  sirOsc.connect(sirFilter); sirFilter.connect(sirGain); sirGain.connect(master); sirOsc.start();
  if (ctx.state === 'suspended') void ctx.resume();
}

// Мотор каждый кадр: on — мир идёт; speed — скорость машины px/с; turn — |ω|/порог заноса 0..1+; skid — занос; air — в полёте; slow — слоу-мо
export function engine(on: boolean, speed: number, turn: number, skid: boolean, air: boolean, slow: boolean): void {
  if (!ctx || !engOsc || !engGain || !engFilter) return;
  const t = ctx.currentTime;
  const base = 55 + speed * 0.14;                          // 240 → 89 Гц, 420 → 114 Гц
  const f = base * (air ? 1.6 : skid ? 1.35 : 1 + Math.min(1, turn) * 0.12) * (slow ? 0.6 : 1);
  engOsc.frequency.setTargetAtTime(f, t, 0.08);
  engFilter.frequency.setTargetAtTime(skid ? 1400 : air ? 900 : 420 + speed * 0.6, t, 0.1);
  engGain.gain.setTargetAtTime(on ? (skid ? 0.16 : 0.11) : 0, t, on ? 0.05 : 0.15);
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
