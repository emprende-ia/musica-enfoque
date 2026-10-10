/**
 * Rachas.
 *  - Un día cuenta como completo con 240 min (4 h) de enfoque.
 *  - Protectores: máximo 2. Se gana 1 por cada 7 días completos dentro de la racha.
 *  - Si un día no se completa, se gasta un protector y la racha sigue (el día queda "protegido").
 *    Sin protectores, la racha vuelve a 0.
 *  - Hoy no rompe la racha mientras no termina.
 *
 * Todo se calcula a partir de los minutos de enfoque de cada día, así que no hay
 * estado escondido que se pueda desincronizar.
 */
export const GOAL_MIN = 240;
export const MAX_SHIELDS = 2;
export const SHIELD_EVERY = 7;

const pad = (n) => String(n).padStart(2, '0');

export function keyOf(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function dateOf(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12); // mediodía: a salvo de cambios de horario
}

export function addDays(key, n) {
  const d = dateOf(key);
  d.setDate(d.getDate() + n);
  return keyOf(d);
}

/**
 * @param {Record<string, number>} days  minutos de enfoque por día ('AAAA-MM-DD')
 * @param {string} todayKey
 * @param {number} todayMin  minutos de hoy (incluye la sesión en curso)
 * @param {number} historyDays  cuántos días devolver en `history` (terminando hoy)
 */
export function computeStreak(days, todayKey, todayMin, historyDays = 14) {
  let streak = 0;
  let shields = 0;
  let toward = 0; // días completos hacia el siguiente protector
  const status = {};

  const keys = Object.keys(days).filter((k) => k < todayKey && days[k] > 0).sort();
  if (keys.length) {
    for (let k = keys[0]; k < todayKey; k = addDays(k, 1)) {
      const done = (days[k] || 0) >= GOAL_MIN;
      if (done) {
        streak++;
        toward++;
        status[k] = 'done';
        if (toward >= SHIELD_EVERY) {
          toward = 0;
          if (shields < MAX_SHIELDS) {
            shields++;
            status[k] = 'done-shield';
          }
        }
      } else if (streak > 0 && shields > 0) {
        shields--;
        status[k] = 'protected';
      } else {
        if (streak > 0) status[k] = 'broken';
        else status[k] = 'missed';
        streak = 0;
        toward = 0;
      }
    }
  }

  const todayDone = todayMin >= GOAL_MIN;
  if (todayDone) {
    streak++;
    toward++;
    status[todayKey] = 'today-done';
    if (toward >= SHIELD_EVERY) {
      toward = 0;
      if (shields < MAX_SHIELDS) shields++;
    }
  } else {
    status[todayKey] = 'today';
  }

  const history = [];
  for (let i = historyDays - 1; i >= 0; i--) {
    const k = addDays(todayKey, -i);
    history.push({ key: k, minutes: k === todayKey ? todayMin : days[k] || 0, status: status[k] || 'none' });
  }

  return {
    streak,
    shields,
    todayDone,
    todayMin,
    leftMin: Math.max(0, GOAL_MIN - todayMin),
    daysToShield: shields >= MAX_SHIELDS ? null : SHIELD_EVERY - toward,
    history,
  };
}
