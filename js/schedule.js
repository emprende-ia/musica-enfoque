/**
 * Reglas del horario. Son fijas: la interfaz no permite cambiarlas.
 *
 *  - Enfoque: 50 min. Siempre empieza a la hora en punto (:00).
 *  - Recuperación: 10 min. Siempre empieza a los :50.
 *  - Sesión = 1 hora (enfoque + recuperación).
 *  - Cada 4 sesiones, recuperación larga: empieza a los :50 de la sesión 4
 *    y termina en la hora en punto que sigue a la siguiente (70 min).
 *    Ej.: 11:50 → 13:00. La sesión 5 empieza a las 13:00.
 *
 * Un ciclo completo ocupa 5 horas de reloj.
 */
export const MIN = 60_000;
export const HOUR = 60 * MIN;

export const RULES = Object.freeze({
  focusMin: 50,
  breakMin: 10,
  sessionsPerCycle: 4,
  longBreakMin: 70,
  cycleHours: 5,
});

const FOCUS_MS = RULES.focusMin * MIN;
const CYCLE_MS = RULES.cycleHours * HOUR;

export const LABELS = Object.freeze({
  focus: 'Enfoque',
  break: 'Recuperación',
  long: 'Recuperación larga',
  waiting: 'En espera',
});

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

/**
 * Qué ofrecer cuando se presiona "iniciar" en el instante `now`.
 *  - 'now'    → primer minuto de la hora: empieza ya.
 *  - 'choose' → antes de los :50: unirse a la sesión en curso o esperar.
 *  - 'wait'   → de :50 a :59: la primera sesión es en la siguiente hora.
 * El ancla es la hora en punto en la que arranca la Sesión 1 del ciclo.
 */
export function startOptions(now) {
  const top = startOfHour(now);
  const into = now - top;
  if (into < MIN) return { kind: 'now', anchor: top };
  if (into < FOCUS_MS) {
    return { kind: 'choose', joinAnchor: top, nextAnchor: top + HOUR, focusLeftMs: FOCUS_MS - into };
  }
  return { kind: 'wait', anchor: top + HOUR };
}

/** Los 8 bloques del ciclo `k` (0, 1, 2…) contados desde el ancla. */
export function blocksOfCycle(anchor, k) {
  const cycleStart = anchor + k * CYCLE_MS;
  const out = [];
  for (let i = 0; i < RULES.sessionsPerCycle; i++) {
    const h = cycleStart + i * HOUR;
    const base = {
      cycle: k + 1,
      session: k * RULES.sessionsPerCycle + i + 1,
      sessionInCycle: i + 1,
    };
    out.push({ ...base, type: 'focus', start: h, end: h + FOCUS_MS });
    const last = i === RULES.sessionsPerCycle - 1;
    out.push({
      ...base,
      type: last ? 'long' : 'break',
      start: h + FOCUS_MS,
      end: last ? cycleStart + CYCLE_MS : h + HOUR,
    });
  }
  return out;
}

/** Bloque vigente en el instante `t`. Antes del ancla: 'waiting'. */
export function blockAt(anchor, t) {
  if (t < anchor) {
    return { type: 'waiting', start: null, end: anchor, cycle: 1, session: 1, sessionInCycle: 1 };
  }
  const k = Math.floor((t - anchor) / CYCLE_MS);
  return blocksOfCycle(anchor, k).find((b) => t >= b.start && t < b.end);
}

/** El bloque actual (o el primero, si aún se espera) y los siguientes; `count` en total. */
export function upcoming(anchor, t, count) {
  const out = [];
  let k = t < anchor ? 0 : Math.floor((t - anchor) / CYCLE_MS);
  while (out.length < count) {
    for (const b of blocksOfCycle(anchor, k)) {
      if (b.end > t && out.length < count) out.push(b);
    }
    k++;
  }
  return out;
}

/** Bloques que se cruzan con el intervalo [from, to). */
export function blocksIn(anchor, from, to) {
  const out = [];
  let k = Math.max(0, Math.floor((from - anchor) / CYCLE_MS));
  for (;;) {
    const blocks = blocksOfCycle(anchor, k);
    if (blocks[0].start >= to) break;
    for (const b of blocks) if (b.end > from && b.start < to) out.push(b);
    k++;
  }
  return out;
}
