// Pruebas del horario. Ejecuta: npm test  (o: node --test tests/*.test.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  blockAt, blocksBetween, startOptions, dayHours, nextFocusStart, setPlanSource, normalizePlan, summarize,
  DEFAULT_PLAN, MIN, HOUR, RULES,
} from '../js/schedule.js';

const at = (d, h, m = 0, s = 0) => new Date(2026, 9, d, h, m, s).getTime(); // octubre 2026, hora local
const D = 12;

function expectBlock(t, type, start, end, extra = {}) {
  const b = blockAt(t);
  const when = new Date(t).toTimeString().slice(0, 8);
  assert.equal(b.type, type, `tipo a las ${when}`);
  if (start != null) assert.equal(b.start, start, `inicio a las ${when}`);
  if (end != null) assert.equal(b.end, end, `fin a las ${when}`);
  for (const [k, v] of Object.entries(extra)) assert.equal(b[k], v, `${k} a las ${when}`);
}

test('la recuperación larga coincide con la comida: 13:50 a 15:00', () => {
  expectBlock(at(D, 13, 50), 'long', at(D, 13, 50), at(D, 15), { lunch: true });
  expectBlock(at(D, 14, 0), 'long', at(D, 13, 50), at(D, 15), { lunch: true });
  expectBlock(at(D, 14, 59, 59), 'long', at(D, 13, 50), at(D, 15));
  const b = blockAt(at(D, 14, 30));
  assert.equal((b.end - b.start) / MIN, RULES.longBreakMin);
  expectBlock(at(D, 15, 0), 'focus', at(D, 15), at(D, 15, 50), { sessionInCycle: 1, cycleName: 'Tarde' });
});

test('mediodía: 4 sesiones de 10:00 a 13:50', () => {
  for (let h = 10; h <= 13; h++) {
    expectBlock(at(D, h, 0), 'focus', at(D, h), at(D, h, 50), { sessionInCycle: h - 9, cycleSize: 4, cycleName: 'Mediodía' });
  }
  expectBlock(at(D, 10, 50), 'break', at(D, 10, 50), at(D, 11));
  expectBlock(at(D, 12, 50), 'break', at(D, 12, 50), at(D, 13));
  expectBlock(at(D, 13, 49, 59), 'focus');
});

test('recuperaciones largas del día: 3:50, 8:50, 13:50, 18:50 y 23:50', () => {
  const longs = blocksBetween(at(D, 0), at(D + 1, 0)).filter((b) => b.type === 'long');
  const starts = longs.map((b) => new Date(b.start)).map((d) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`);
  assert.deepEqual(starts, ['23:50', '3:50', '8:50', '13:50', '18:50', '23:50']); // la primera viene del día anterior
  assert.equal(DEFAULT_PLAN.length, 24);
  assert.deepEqual([...DEFAULT_PLAN].flatMap((c, h) => (c === 'L' ? [h] : [])), [0, 4, 9, 14, 19]);
});

test('la recuperación de medianoche cruza de día', () => {
  expectBlock(at(D, 23, 55), 'long', at(D, 23, 50), at(D + 1, 1));
  expectBlock(at(D + 1, 0, 30), 'long', at(D, 23, 50), at(D + 1, 1));
  expectBlock(at(D + 1, 1, 0), 'focus', null, null, { sessionInCycle: 1, cycleSize: 3, cycleName: 'Madrugada' });
});

test('19 sesiones al día; solo la madrugada tiene 3', () => {
  const focus = blocksBetween(at(D, 0), at(D + 1, 0)).filter((b) => b.type === 'focus');
  assert.equal(focus.length, 19);
  const sizes = {};
  for (const b of focus) sizes[b.cycleName] = b.cycleSize;
  assert.deepEqual(sizes, { Madrugada: 3, Mañana: 4, Mediodía: 4, Tarde: 4, Noche: 4 });
});

test('en 3 días todo enfoque empieza a :00, todo descanso a :50 y no hay huecos', () => {
  const blocks = blocksBetween(at(D, 0), at(D + 3, 0));
  for (const b of blocks) {
    const s = new Date(b.start);
    const e = new Date(b.end);
    if (b.type === 'focus') {
      assert.equal(s.getMinutes(), 0);
      assert.equal((b.end - b.start) / MIN, 50);
    } else {
      assert.equal(s.getMinutes(), 50);
      assert.equal(e.getMinutes(), 0);
      assert.equal((b.end - b.start) / MIN, b.type === 'long' ? 70 : 10);
    }
  }
  for (let i = 1; i < blocks.length; i++) assert.equal(blocks[i].start, blocks[i - 1].end);
});

test('opciones al iniciar', () => {
  assert.equal(startOptions(at(D, 10, 0, 20)).kind, 'now');
  const c = startOptions(at(D, 10, 23));
  assert.equal(c.kind, 'choose');
  assert.equal(c.focusLeftMs, 27 * MIN);
  assert.equal(c.nextFocus, at(D, 11));
  const c4 = startOptions(at(D, 13, 23));
  assert.equal(c4.nextFocus, at(D, 15), 'tras la sesión 4 el siguiente enfoque es a las 15:00');
  const r = startOptions(at(D, 14, 10));
  assert.equal(r.kind, 'recovery');
  assert.equal(r.nextFocus, at(D, 15));
  assert.equal(startOptions(at(D, 10, 52)).nextFocus, at(D, 11));
});

test('dayHours describe las 24 horas', () => {
  const hours = dayHours(at(D, 9));
  assert.equal(hours.length, 24);
  assert.equal(hours[14].role, 'long');
  assert.equal(hours[14].lunch, true);
  assert.equal(hours[13].endsInLong, true);
  assert.equal(hours[12].endsInLong, false);
  assert.equal(hours[0].role, 'long');
  assert.equal(hours[23].endsInLong, true);
  assert.equal(hours[23].end - hours[23].start, HOUR);
});

/* ---------- horario editable ---------- */

// Día en que te despiertas a las 3:00: libre 0–2, ciclos de 4 y comida a las 14:00
const WAKE3 = 'FFF' + 'SSSS' + 'L' + 'SSSS' + 'L' + 'S' + 'L' + 'SSSS' + 'L' + 'SSSS';
const key = (d) => `2026-10-${String(d).padStart(2, '0')}`;

function withPlans(map, fn) {
  setPlanSource((k) => map[k] ?? DEFAULT_PLAN);
  try {
    fn();
  } finally {
    setPlanSource(() => DEFAULT_PLAN);
  }
}

test('plan de un día que empieza a las 3:00', () => {
  assert.equal(WAKE3.length, 24);
  withPlans({ [key(D)]: WAKE3 }, () => {
    expectBlock(at(D, 1), 'free', at(D, 0), at(D, 3));
    expectBlock(at(D, 3, 0), 'focus', at(D, 3), at(D, 3, 50), { sessionInCycle: 1, cycleSize: 4, cycleName: 'Madrugada' });
    expectBlock(at(D, 3, 50), 'break', at(D, 3, 50), at(D, 4)); // ya no hay recuperación larga a las 3:50
    expectBlock(at(D, 6, 50), 'long', at(D, 6, 50), at(D, 8));
    expectBlock(at(D, 13, 55), 'long', at(D, 13, 50), at(D, 15), { lunch: true });
    // El día anterior usa el plan normal; su última sesión termina en recuperación corta
    expectBlock(at(D - 1, 23, 55), 'break', at(D - 1, 23, 50), at(D, 0));
    // El día siguiente vuelve al plan normal
    expectBlock(at(D + 1, 0, 30), 'long', at(D, 23, 50), at(D + 1, 1));
  });
});

test('en hora libre, el siguiente enfoque es la primera sesión', () => {
  withPlans({ [key(D)]: WAKE3 }, () => {
    const o = startOptions(at(D, 1, 15));
    assert.equal(o.kind, 'free');
    assert.equal(o.nextFocus, at(D, 3));
    assert.equal(nextFocusStart(at(D, 0, 1)), at(D, 3));
  });
});

test('una recuperación larga sin sesión antes se vuelve libre', () => {
  assert.equal(normalizePlan('SSSFL' + 'S'.repeat(19)), 'SSSFF' + 'S'.repeat(19));
  assert.equal(normalizePlan('L' + 'S'.repeat(23), 'F')[0], 'F', 'la de las 0:00 depende del día anterior');
  assert.equal(normalizePlan('L' + 'S'.repeat(23), 'S')[0], 'L');
});

test('una sesión seguida de horas libres termina con recuperación corta', () => {
  const plan = 'F'.repeat(8) + 'SSSS' + 'F'.repeat(12);
  withPlans({ [key(D)]: plan }, () => {
    expectBlock(at(D, 11, 55), 'break', at(D, 11, 50), at(D, 12), { sessionInCycle: 4, cycleSize: 4 });
    // La L de las 0:00 del día siguiente no tiene sesión antes: también es libre
    expectBlock(at(D, 12, 0), 'free', at(D, 12), at(D + 1, 1));
  });
});

test('un día completamente libre no se traba', () => {
  withPlans({ [key(D)]: 'F'.repeat(24) }, () => {
    const b = blockAt(at(D, 10));
    assert.equal(b.type, 'free');
    assert.ok(b.start <= at(D, 0) && b.end >= at(D + 1, 0));
    assert.equal(startOptions(at(D, 10)).nextFocus, at(D + 1, 1), 'la siguiente sesión es al día siguiente');
  });
});

test('en todo plan los enfoques empiezan a :00 y las recuperaciones a :50, sin huecos', () => {
  withPlans({ [key(D)]: WAKE3, [key(D + 1)]: 'SSFFLSSSSSSLFFSSSSLSSSSF' }, () => {
    const blocks = blocksBetween(at(D - 1, 12), at(D + 2, 12));
    for (const b of blocks) {
      if (b.type === 'focus') assert.equal(new Date(b.start).getMinutes(), 0);
      if (b.type === 'break' || b.type === 'long') assert.equal(new Date(b.start).getMinutes(), 50);
      if (b.type === 'long') assert.equal((b.end - b.start) / MIN, 70);
    }
    for (let i = 1; i < blocks.length; i++) assert.equal(blocks[i].start, blocks[i - 1].end);
  });
});

test('dayHours sigue al plan del día', () => {
  withPlans({ [key(D)]: WAKE3 }, () => {
    const h = dayHours(at(D, 9));
    assert.equal(h[0].role, 'free');
    assert.equal(h[3].role, 'session');
    assert.equal(h[6].endsInLong, true);
    assert.equal(h[13].nextLunch, true);
    assert.equal(h[14].lunch, true);
  });
});

test('resumen del plan avisa de ciclos de más de 4 sesiones', () => {
  const s = summarize(WAKE3);
  assert.deepEqual([s.sessions, s.longs, s.free], [17, 4, 3]);
  assert.deepEqual(s.longRuns, []);
  const s2 = summarize('FFF' + 'S'.repeat(6) + 'L' + 'S'.repeat(14));
  assert.deepEqual(s2.longRuns.map((r) => [r.from, r.size]), [[3, 6], [10, 14]]);
});
