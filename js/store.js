/** Persistencia en localStorage: ajustes, presencia, historial y minutos por día. */
import { keyOf } from './streak.js';

const KEYS = {
  settings: 'mye.settings.v1',
  run: 'mye.run.v1',
  log: 'mye.log.v1',
  days: 'mye.days.v1',
};

const KEEP_DAYS = 120; // detalle de sesiones; los minutos por día (para la racha) se guardan siempre

export const DEFAULTS = Object.freeze({
  focus: { playlist: '', shuffle: true, music: 60, binaural: true, preset: 'beta14', tone: 35, noise: 0 },
  recovery: { playlist: '', shuffle: true, music: 50, binaural: true, preset: 'alpha8', tone: 35, noise: 25 },
  alarm: 80,
  notify: false,
  wake: false,
  theme: 'system', // 'system' | 'light' | 'dark'
});

function read(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* almacenamiento lleno o bloqueado: la app sigue funcionando en memoria */
  }
}

export function loadSettings() {
  const s = read(KEYS.settings, {}) || {};
  return {
    ...DEFAULTS,
    ...s,
    focus: { ...DEFAULTS.focus, ...(s.focus || {}) },
    recovery: { ...DEFAULTS.recovery, ...(s.recovery || {}) },
  };
}

/** Guarda los ajustes. `touch` marca la hora del cambio (para decidir qué dispositivo gana al sincronizar). */
export function saveSettings(s, { touch = true } = {}) {
  if (touch) s._updatedAt = Date.now();
  write(KEYS.settings, s);
}

export function loadRun() {
  const r = read(KEYS.run, null);
  return r && (typeof r.startedAt === 'number' || typeof r.anchor === 'number') ? r : null;
}

export const saveRun = (r) => write(KEYS.run, r);

export function loadLog() {
  const log = read(KEYS.log, []);
  return Array.isArray(log) ? log : [];
}

export function saveLog(log) {
  const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
  const kept = log.filter((e) => e.start >= cutoff);
  if (kept.length !== log.length) log.splice(0, log.length, ...kept);
  write(KEYS.log, log);
}

/** Minutos de enfoque por día. Si aún no existe, se arma con el historial. */
export function loadDays(log) {
  const days = read(KEYS.days, null);
  if (days && typeof days === 'object' && !Array.isArray(days)) return days;
  const built = {};
  for (const e of log) {
    const k = keyOf(new Date(e.start));
    built[k] = (built[k] || 0) + e.minutes;
  }
  write(KEYS.days, built);
  return built;
}

export const saveDays = (days) => write(KEYS.days, days);
