/**
 * Horario fijo de 24 horas. Es igual todos los días y no se puede cambiar
 * desde la interfaz.
 *
 *  - Enfoque: 50 min. Siempre empieza a la hora en punto (:00).
 *  - Recuperación: 10 min. Siempre empieza a los :50.
 *  - Sesión = 1 hora.
 *  - Cada 4 sesiones, recuperación larga de 70 min: empieza a los :50 de la
 *    última sesión y termina en punto dos horas después.
 *  - La comida es a las 14:00, así que una recuperación larga es 13:50–15:00.
 *    Las demás quedan cada 5 horas a partir de ahí: 3:50, 8:50, 18:50 y 23:50.
 *  - Como 24 h no se dividen en ciclos de 5 h, la madrugada (1:00–3:50) es
 *    el único ciclo de 3 sesiones.
 */
export const MIN = 60_000;
export const HOUR = 60 * MIN;

export const RULES = Object.freeze({
  focusMin: 50,
  breakMin: 10,
  sessionsPerCycle: 4,
  longBreakMin: 70,
  cycleHours: 5,
  lunchHour: 14,
});

export const LABELS = Object.freeze({
  focus: 'Enfoque',
  break: 'Recuperación',
  long: 'Recuperación larga',
  waiting: 'En espera',
});

const CYCLE_NAMES = { 1: 'Madrugada', 5: 'Mañana', 10: 'Mediodía', 15: 'Tarde', 20: 'Noche' };

/** Horas del reloj ocupadas por una recuperación larga (empieza a los :50 de la hora anterior). */
export const LONG_HOURS = (() => {
  const set = new Set();
  for (let h = RULES.lunchHour; h <= 24; h += RULES.cycleHours) set.add(h % 24);
  for (let h = RULES.lunchHour - RULES.cycleHours; h >= 0; h -= RULES.cycleHours) set.add(h);
  return set;
})();

/** Plan de cada hora del día: sesión (con su lugar en el ciclo) u hora de recuperación larga. */
export const PLAN = (() => {
  const plan = new Array(24);
  let runStart = null;
  const closeRun = (end) => {
    if (runStart == null) return;
    const size = end - runStart;
    const name = CYCLE_NAMES[runStart] || 'Ciclo';
    for (let h = runStart; h < end; h++) {
      plan[h] = { role: 'session', sessionInCycle: h - runStart + 1, cycleSize: size, cycleName: name };
    }
    runStart = null;
  };
  for (let h = 0; h < 24; h++) {
    if (LONG_HOURS.has(h)) closeRun(h);
    else if (runStart == null) runStart = h;
  }
  closeRun(24);
  // Cada hora larga pertenece al ciclo que la precede (la de las 0:00, al de la noche).
  for (const L of LONG_HOURS) {
    const prev = plan[(L + 23) % 24];
    plan[L] = {
      role: 'long',
      sessionInCycle: prev.cycleSize,
      cycleSize: prev.cycleSize,
      cycleName: prev.cycleName,
      lunch: L === RULES.lunchHour,
    };
  }
  return Object.freeze(plan);
})();

/** focus → 'focus'; break/long → 'recovery'; waiting → null */
export function modeOf(type) {
  if (type === 'focus') return 'focus';
  if (type === 'break' || type === 'long') return 'recovery';
  return null;
}

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

function meta(p) {
  return { sessionInCycle: p.sessionInCycle, cycleSize: p.cycleSize, cycleName: p.cycleName, lunch: !!p.lunch };
}

/** Bloque del horario vigente en el instante `t`. */
export function blockAt(t) {
  const d = new Date(t);
  const h = d.getHours();
  const p = PLAN[h];
  if (p.role === 'long') {
    return { type: 'long', start: onDay(t, h - 1, 50), end: onDay(t, h + 1), ...meta(p) };
  }
  if (d.getMinutes() < RULES.focusMin) {
    return { type: 'focus', start: onDay(t, h), end: onDay(t, h, RULES.focusMin), ...meta(p) };
  }
  const next = PLAN[(h + 1) % 24];
  if (next.role === 'long') {
    return { type: 'long', start: onDay(t, h, 50), end: onDay(t, h + 2), ...meta(next) };
  }
  return { type: 'break', start: onDay(t, h, 50), end: onDay(t, h + 1), ...meta(p) };
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

/**
 * Qué ofrecer al presionar "iniciar" en el instante `now`.
 *  - 'now'      → primer minuto de un enfoque: empieza ya.
 *  - 'choose'   → enfoque ya empezado: unirse o esperar al siguiente enfoque.
 *  - 'recovery' → en recuperación: se entra en ella y el enfoque sigue a su fin.
 */
export function startOptions(now) {
  const b = blockAt(now);
  if (b.type === 'focus') {
    if (now - b.start < MIN) return { kind: 'now', block: b };
    return { kind: 'choose', block: b, focusLeftMs: b.end - now, nextFocus: nextBlock(b).end };
  }
  return { kind: 'recovery', block: b, nextFocus: b.end };
}

/** Las 24 horas del día de `t`, con lo que ocurre en cada una. */
export function dayHours(t) {
  const out = [];
  for (let h = 0; h < 24; h++) {
    const p = PLAN[h];
    const start = onDay(t, h);
    const nextIsLong = PLAN[(h + 1) % 24].role === 'long';
    out.push({ hour: h, start, end: onDay(t, h + 1), ...p, endsInLong: p.role === 'session' && nextIsLong });
  }
  return out;
}
