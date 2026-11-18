/**
 * Reactive soundscape, fully synthesized with the Web Audio API.
 * A quiet drone plays from the start, and one musical layer joins each time
 * part of the world is restored. Short tones give interaction feedback.
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const layers: GainNode[] = [];

// A-major-ish pad: each restoration adds a voice.
const LAYER_VOICES: { freq: number; type: OscillatorType; gain: number }[] = [
  { freq: 110, type: 'sine', gain: 0.05 }, // 0: the silence (always on, very quiet)
  { freq: 164.81, type: 'sine', gain: 0.035 }, // 1: first island
  { freq: 277.18, type: 'triangle', gain: 0.02 }, // 2: second island
  { freq: 440, type: 'sine', gain: 0.03 }, // 3: the Heart
];

function ensure(): AudioContext | null {
  try {
    if (ctx == null) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
      for (const voice of LAYER_VOICES) {
        const osc = ctx.createOscillator();
        osc.type = voice.type;
        osc.frequency.value = voice.freq;
        // Slow tremolo so the pad breathes.
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.15 + Math.random() * 0.2;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = voice.freq * 0.004;
        lfo.connect(lfoGain).connect(osc.frequency);
        const gain = ctx.createGain();
        gain.gain.value = 0;
        osc.connect(gain).connect(master);
        osc.start();
        lfo.start();
        layers.push(gain);
      }
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** A copy of the game's audio as a MediaStream, for recording the demo video. */
export function captureAudioStream(): MediaStream | null {
  const c = ensure();
  if (c == null || master == null) return null;
  const dest = c.createMediaStreamDestination();
  master.connect(dest);
  return dest.stream;
}

/** Fade music layers 0..count-1 in and the rest out. */
export function setMusicLayers(count: number): void {
  const c = ensure();
  if (c == null) return;
  layers.forEach((gain, i) => {
    const target = i < count ? LAYER_VOICES[i].gain : 0;
    gain.gain.cancelScheduledValues(c.currentTime);
    gain.gain.setTargetAtTime(target, c.currentTime, 1.2);
  });
}

/** A short feedback tone. */
export function tone(freq: number, length = 0.2, type: OscillatorType = 'sine', volume = 0.15): void {
  const c = ensure();
  if (c == null || master == null) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  const t = c.currentTime;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(volume, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(gain).connect(master);
  osc.start(t);
  osc.stop(t + length + 0.05);
}

/** A rising arpeggio for big moments. */
export function chord(root: number, steps = [1, 1.25, 1.5, 2], gap = 0.12): void {
  steps.forEach((ratio, i) => {
    setTimeout(() => tone(root * ratio, 0.6, 'triangle', 0.12), i * gap * 1000);
  });
}
