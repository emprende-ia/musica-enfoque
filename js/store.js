/** Persistencia en localStorage: ajustes, ciclo en marcha e historial. */

const KEYS = {
  settings: 'mye.settings.v1',
  run: 'mye.run.v1',
  log: 'mye.log.v1',
};

const KEEP_DAYS = 120;

export const DEFAULTS = Object.freeze({
  focus: { playlist: '', shuffle: true, music: 60, binaural: true, preset: 'beta14', tone: 35, noise: 0 },
  recovery: { playlist: '', shuffle: true, music: 50, binaural: true, preset: 'alpha8', tone: 35, noise: 25 },
  alarm: 80,
  notify: false,
  wake: false,
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

export const saveSettings = (s) => write(KEYS.settings, s);

export function loadRun() {
  const r = read(KEYS.run, null);
  return r && typeof r.anchor === 'number' ? r : null;
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
