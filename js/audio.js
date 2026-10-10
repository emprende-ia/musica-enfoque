/**
 * Motor de audio local (Web Audio API):
 *  - Tono binaural: un seno distinto en cada oído; la diferencia es la frecuencia del pulso.
 *  - Ruido marrón opcional de fondo.
 *  - Alarmas sintetizadas y programadas en el reloj de audio, para que suenen
 *    a tiempo aunque la pestaña esté en segundo plano.
 */

export const PRESETS = {
  focus: [
    { id: 'beta14', label: 'Beta 14 Hz (concentración)', beat: 14, carrier: 220 },
    { id: 'beta18', label: 'Beta 18 Hz (alerta)', beat: 18, carrier: 220 },
    { id: 'gamma40', label: 'Gamma 40 Hz (trabajo intenso)', beat: 40, carrier: 240 },
    { id: 'alpha10f', label: 'Alfa 10 Hz (enfoque tranquilo)', beat: 10, carrier: 200 },
  ],
  recovery: [
    { id: 'alpha8', label: 'Alfa 8 Hz (relajación)', beat: 8, carrier: 170 },
    { id: 'alpha10', label: 'Alfa 10 Hz (pausa ligera)', beat: 10, carrier: 180 },
    { id: 'theta6', label: 'Theta 6 Hz (descanso profundo)', beat: 6, carrier: 150 },
    { id: 'delta3', label: 'Delta 3 Hz (muy profundo)', beat: 3, carrier: 130 },
  ],
};

export function findPreset(mode, id) {
  return PRESETS[mode].find((p) => p.id === id) ?? PRESETS[mode][0];
}

// Parciales [proporción, amplitud, factor de caída]
const BELL = [[1, 1, 1], [2.0, 0.45, 0.7], [3.01, 0.22, 0.5], [4.2, 0.12, 0.35]];
const SOFT = [[1, 1, 1], [3.0, 0.16, 0.4], [4.0, 0.08, 0.3]];
const GONG = [[1, 1, 1], [1.48, 0.55, 0.85], [2.02, 0.42, 0.7], [2.76, 0.3, 0.55], [3.9, 0.16, 0.4], [5.3, 0.08, 0.3]];

const NOTE = { G4: 392.0, C5: 523.25, E5: 659.25, G5: 783.99, C6: 1046.5 };

/** Ruido marrón estéreo que se repite sin clic en la unión. */
function brownNoise(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const fade = Math.floor(ctx.sampleRate * 0.5);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const raw = new Float32Array(len + fade);
    let last = 0;
    for (let i = 0; i < raw.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      raw[i] = last * 3.5;
    }
    const out = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) out[i] = raw[i];
    // El inicio se mezcla con lo que seguiría al final → el bucle es continuo.
    for (let i = 0; i < fade; i++) {
      const w = i / fade;
      out[i] = raw[i] * w + raw[len + i] * (1 - w);
    }
  }
  return buf;
}

export class AudioEngine {
  ctx = null;
  #nodes = new Set();
  #alarmVolume = 0.8;

  /** Crea o reanuda el contexto. Llamar desde un toque o clic del usuario. */
  unlock() {
    if (!this.ctx) this.#build();
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  get running() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  #build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = (this.ctx = new AC());

    // Binaural
    this.oscL = ctx.createOscillator();
    this.oscR = ctx.createOscillator();
    this.oscL.frequency.value = 213;
    this.oscR.frequency.value = 227;
    const merger = ctx.createChannelMerger(2);
    this.oscL.connect(merger, 0, 0);
    this.oscR.connect(merger, 0, 1);
    this.toneGain = ctx.createGain();
    this.toneGain.gain.value = 0;
    merger.connect(this.toneGain).connect(ctx.destination);
    this.oscL.start();
    this.oscR.start();

    // Ruido marrón
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0;
    const noise = ctx.createBufferSource();
    noise.buffer = brownNoise(ctx, 12);
    noise.loop = true;
    noise.connect(this.noiseGain).connect(ctx.destination);
    noise.start();

    // Alarmas (con limitador para que las campanas superpuestas no saturen)
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 4;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    limiter.connect(ctx.destination);
    this.alarmGain = ctx.createGain();
    this.alarmGain.gain.value = this.#alarmVolume;
    this.alarmGain.connect(limiter);
  }

  #ramp(param, value, seconds) {
    const t = this.ctx.currentTime;
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
    param.setTargetAtTime(value, t, Math.max(0.05, seconds / 3));
  }

  /** Capa de fondo de un modo: { tone, beat, carrier, toneVol 0–1, noiseVol 0–1 } */
  setLayer({ tone = false, beat = 0, carrier = 200, toneVol = 0, noiseVol = 0 }, fade = 3) {
    if (!this.ctx) return;
    if (tone && beat) {
      this.#ramp(this.oscL.frequency, carrier - beat / 2, 0.6);
      this.#ramp(this.oscR.frequency, carrier + beat / 2, 0.6);
    }
    this.#ramp(this.toneGain.gain, tone ? toneVol * 0.16 : 0, fade);
    this.#ramp(this.noiseGain.gain, noiseVol * 0.45, fade);
  }

  silence(fade = 2) {
    this.setLayer({}, fade);
  }

  setAlarmVolume(v) {
    this.#alarmVolume = v;
    if (this.alarmGain) this.alarmGain.gain.value = v;
  }

  /** Programa la alarma para el instante `epochMs` del reloj del sistema. */
  scheduleAlarm(kind, epochMs) {
    if (!this.running) return false;
    const delay = Math.max(0, (epochMs - Date.now()) / 1000);
    this.#pattern(kind, this.ctx.currentTime + delay);
    return true;
  }

  playAlarm(kind) {
    this.unlock();
    if (!this.ctx) return;
    this.#pattern(kind, this.ctx.currentTime + 0.05);
  }

  /** Cancela las alarmas programadas (y la que esté sonando). */
  cancelAlarms() {
    for (const osc of this.#nodes) {
      try {
        osc.stop();
        osc.disconnect();
      } catch {
        /* ya terminó */
      }
    }
    this.#nodes.clear();
  }

  #pattern(kind, t0) {
    const { G4, C5, E5, G5, C6 } = NOTE;
    if (kind === 'focus') {
      // Ascendente y brillante: empieza el enfoque
      [C5, E5, G5, C6].forEach((f, i) => this.#bell(t0 + i * 0.16, f, 1.8, 0.3, BELL));
      [C5, E5, G5, C6].forEach((f, i) => this.#bell(t0 + 1.5 + i * 0.16, f, 2.4, 0.26, BELL));
    } else if (kind === 'break') {
      // Descendente y suave: empieza la recuperación
      [G5, E5, C5].forEach((f, i) => this.#bell(t0 + i * 0.42, f, 2.4, 0.3, SOFT));
      [G5, E5, C5].forEach((f, i) => this.#bell(t0 + 1.9 + i * 0.42, f, 2.8, 0.24, SOFT));
    } else if (kind === 'long') {
      // Gong grave + campanas descendentes: recuperación larga
      this.#bell(t0, 130.81, 7, 0.5, GONG);
      [G5, E5, C5, G4].forEach((f, i) => this.#bell(t0 + 1.2 + i * 0.5, f, 3, 0.26, SOFT));
    }
  }

  #bell(t, freq, dur, peak, partials) {
    const ctx = this.ctx;
    for (const [ratio, amp, decay] of partials) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      const d = dur * decay;
      osc.frequency.value = freq * ratio;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak * amp, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      osc.connect(g).connect(this.alarmGain);
      osc.start(t);
      osc.stop(t + d + 0.05);
      this.#nodes.add(osc);
      osc.onended = () => {
        this.#nodes.delete(osc);
        osc.disconnect();
      };
    }
  }
}
