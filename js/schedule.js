/**
 * Horario de 24 horas.
 *
 * Reglas fijas (no se pueden cambiar):
 *  - Enfoque: 50 min. Siempre empieza a la hora en punto (:00).
 *  - Recuperación: 10 min. Siempre empieza a los :50.
 *  - Recuperación larga: 70 min. Empieza a los :50 de una sesión y termina en
 *    punto dos horas después.
 *
 * Lo que sí se puede mover: qué hace cada hora del día. Un plan es un texto de
 * 24 letras, una por hora:
 *   S = sesión (enfoque de :00 a :50 y recuperación de :50 a :00)
 *   L = recuperación larga (empieza a los :50 de la hora anterior, que debe ser S)
 *   F = libre (sin enfoque ni recuperación: dormir, comer fuera, etc.)
 *
 * Cada día puede tener su propio plan (hoy, mañana) o usar el de todos los días.
 * Si una L no tiene una sesión justo antes, se trata como libre.
 */
export const MIN = 60_000;
export const HOUR = 60 * MIN;

export const RULES = Object.freeze({
  focusMin: 50,
  breakMin: 10,
  sessionsPerCycle: 4,
  longBreakMin: 70,
  lunchHour: 14,
});

/** Plan inicial: recuperaciones largas a las 23:50, 3:50, 8:50, 13:50 (comida) y 18:50. */
export const DEFAULT_PLAN = 'LSSSLSSSSLSSSSLSSSSLSSSS';

export const LABELS = Object.freeze({
  focus: 'Enfoque',
  break: 'Recuperación',
  long: 'Recuperación larga',
  free: 'Libre',
  waiting: 'En espera',
});

/* ---------- de dónde sale el plan de cada día ---------- */
let source = () => DEFAULT_PLAN;
let version = 0;
const cache = new Map();

/** `fn(fecha 'AAAA-MM-DD')` devuelve el plan de ese día (24 letras S/L/F). */
export function setPlanSource(fn) {
  source = fn;
  version++;
  cache.clear();
}

/** Cambia cada vez que cambia el plan (para saber cuándo volver a dibujar). */
export const planVersion = () => version;

export const isValidPlan = (p) => typeof p === 'string' && /^[SLF]{24}$/.test(p);

const pad = (n) => String(n).padStart(2, '0');

export function dateKey(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function shiftDay(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return dateKey(new Date(y, m - 1, d + n, 12).getTime());
}

function rawPlan(key) {
  const p = source(key);
  return isValidPlan(p) ? p : DEFAULT_PLAN;
}

/**
 * Plan corregido: una L solo vale si la hora anterior es una sesión; si no, es libre.
 * `prevLast` es la última hora del día anterior (para la L de las 0:00).
 */
export function normalizePlan(plan, prevLast = 'S') {
  let out = '';
  for (let h = 0; h < 24; h++) {
    const prev = h === 0 ? prevLast : plan[h - 1];
    out += plan[h] === 'L' && prev !== 'S' ? 'F' : plan[h];
  }
  return out;
}

/** Plan efectivo de un día (ya corregido). */
export function effectivePlan(key) {
  let p = cache.get(key);
  if (!p) {
    p = normalizePlan(rawPlan(key), rawPlan(shiftDay(key, -1))[23]);
    cache.set(key, p);
  }
  return p;
}

/** Qué hace la hora que empieza en `hs`: 'S', 'L' o 'F'. */
const roleAt = (hs) => effectivePlan(dateKey(hs))[new Date(hs).getHours()];

/* ---------- utilidades de tiempo ---------- */
/** Hora en punto (local) que contiene a `t`. */
export function startOfHour(t) {
  const d = new Date(t);
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

/** Medianoche local del día de `t`. */
export function startOfDay(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function onDay(t, hour, minute = 0) {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, minute).getTime();
}

/** focus → 'focus'; break/long → 'recovery'; libre o espera → null */
export function modeOf(type) {
  if (type === 'focus') return 'focus';
  if (type === 'break' || type === 'long') return 'recovery';
  return null;
}

/* ---------- ciclos (sesiones seguidas) ---------- */
function nameFor(hour) {
  if (hour < 5) return 'Madrugada';
  if (hour < 10) return 'Mañana';
  if (hour < 15) return 'Mediodía';
  if (hour < 20) return 'Tarde';
  return 'Noche';
}

/** Ciclo al que pertenece la sesión de la hora `hs`. */
function runInfo(hs) {
  let start = hs;
  for (let i = 0; i < 24 && roleAt(start - HOUR) === 'S'; i++) start -= HOUR;
  let end = hs + HOUR;
  for (let i = 0; i < 24 && roleAt(end) === 'S'; i++) end += HOUR;
  return {
    index: Math.round((hs - start) / HOUR) + 1,
    size: Math.round((end - start) / HOUR),
    name: nameFor(new Date(start).getHours()),
  };
}

/** La recuperación larga de la comida: la que cae a las 14:00 (o a las 13:00 o 15:00 si no hay). */
function isLunch(longHs) {
  const plan = effectivePlan(dateKey(longHs));
  const h = new Date(longHs).getHours();
  for (const c of [RULES.lunchHour, RULES.lunchHour - 1, RULES.lunchHour + 1]) {
    if (plan[c] === 'L') return h === c;
  }
  return false;
}

const meta = (run) => ({ sessionInCycle: run.index, cycleSize: run.size, cycleName: run.name, lunch: false });
const endMeta = (run, longHs) => ({ sessionInCycle: run.size, cycleSize: run.size, cycleName: run.name, lunch: isLunch(longHs) });

/* ---------- bloques ---------- */
/** Bloque del horario vigente en el instante `t`. */
export function blockAt(t) {
  const hs = startOfHour(t);
  const role = roleAt(hs);
  if (role === 'L') {
    return { type: 'long', start: hs - 10 * MIN, end: hs + HOUR, ...endMeta(runInfo(hs - HOUR), hs) };
  }
  if (role === 'S') {
    const run = runInfo(hs);
    const focusEnd = hs + RULES.focusMin * MIN;
    if (t < focusEnd) return { type: 'focus', start: hs, end: focusEnd, ...meta(run) };
    if (roleAt(hs + HOUR) === 'L') return { type: 'long', start: focusEnd, end: hs + 2 * HOUR, ...endMeta(run, hs + HOUR) };
    return { type: 'break', start: focusEnd, end: hs + HOUR, ...meta(run) };
  }
  let start = hs;
  for (let i = 0; i < 48 && roleAt(start - HOUR) === 'F'; i++) start -= HOUR;
  let end = hs + HOUR;
  for (let i = 0; i < 48 && roleAt(end) === 'F'; i++) end += HOUR;
  return { type: 'free', start, end, sessionInCycle: 0, cycleSize: 0, cycleName: LABELS.free, lunch: false };
}

/** El bloque que sigue a `b`. */
export const nextBlock = (b) => blockAt(b.end);

/** Bloques que se cruzan con [from, to), en orden. */
export function blocksBetween(from, to) {
  const out = [];
  let t = from;
  while (t < to) {
    const b = blockAt(t);
    out.push(b);
    t = b.end;
  }
  return out;
}

/** Inicio del siguiente enfoque a partir de `t` (incluido), o null si no hay en 48 h. */
export function nextFocusStart(t) {
  let hs = startOfHour(t);
  if (hs < t) hs += HOUR;
  for (let i = 0; i < 48; i++, hs += HOUR) if (roleAt(hs) === 'S') return hs;
  return null;
}

/**
 * Qué ofrecer al presionar "iniciar" en el instante `now`.
 *  - 'now'      → primer minuto de un enfoque: empieza ya.
 *  - 'choose'   → enfoque ya empezado: unirse o esperar al siguiente enfoque.
 *  - 'recovery' → en recuperación: se entra en ella y el enfoque sigue a su fin.
 *  - 'free'     → hora libre: se espera en silencio al siguiente enfoque.
 */
export function startOptions(now) {
  const b = blockAt(now);
  if (b.type === 'focus') {
    if (now - b.start < MIN) return { kind: 'now', block: b };
    return { kind: 'choose', block: b, focusLeftMs: b.end - now, nextFocus: nextFocusStart(b.end) };
  }
  return { kind: b.type === 'free' ? 'free' : 'recovery', block: b, nextFocus: nextFocusStart(b.end) };
}

/** Las 24 horas del día de `t`, con lo que ocurre en cada una. */
export function dayHours(t) {
  const out = [];
  for (let h = 0; h < 24; h++) {
    const hs = onDay(t, h);
    const role = roleAt(hs);
    const base = { hour: h, start: hs, end: hs + HOUR };
    if (role === 'S') {
      const endsInLong = roleAt(hs + HOUR) === 'L';
      out.push({ ...base, role: 'session', ...meta(runInfo(hs)), endsInLong, nextLunch: endsInLong && isLunch(hs + HOUR) });
    } else if (role === 'L') {
      out.push({ ...base, role: 'long', ...endMeta(runInfo(hs - HOUR), hs), endsInLong: false });
    } else {
      out.push({ ...base, role: 'free', sessionInCycle: 0, cycleSize: 0, cycleName: LABELS.free, lunch: false, endsInLong: false });
    }
  }
  return out;
}

/** Resumen de un plan: sesiones, recuperaciones largas, horas libres y ciclos de más de 4 sesiones. */
export function summarize(plan, prevLast = 'S') {
  const p = normalizePlan(plan, prevLast);
  const long = [];
  let run = 0;
  for (let h = 0; h <= 24; h++) {
    if (h < 24 && p[h] === 'S') {
      run++;
      continue;
    }
    if (run > RULES.sessionsPerCycle) long.push({ from: h - run, to: h, size: run });
    run = 0;
  }
  return {
    sessions: [...p].filter((c) => c === 'S').length,
    longs: [...p].filter((c) => c === 'L').length,
    free: [...p].filter((c) => c === 'F').length,
    longRuns: long,
  };
}
