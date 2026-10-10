// Pruebas del horario. Ejecuta: npm test  (o: node --test tests/*.test.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockAt, blocksIn, upcoming, startOptions, MIN, HOUR, RULES } from '../js/schedule.js';

const at = (h, m = 0, s = 0) => new Date(2026, 9, 12, h, m, s).getTime(); // lunes 12 oct 2026, hora local
const ANCHOR = at(8);

function expectBlock(t, type, session, start, end) {
  const b = blockAt(ANCHOR, t);
  assert.equal(b.type, type, `tipo en ${new Date(t).toTimeString()}`);
  if (session != null) assert.equal(b.session, session, 'sesión');
  if (start != null) assert.equal(b.start, start, 'inicio');
  if (end != null) assert.equal(b.end, end, 'fin');
}

test('ciclo 1: enfoque en punto, recuperación a los :50', () => {
  expectBlock(at(8, 0), 'focus', 1, at(8, 0), at(8, 50));
  expectBlock(at(8, 49, 59), 'focus', 1);
  expectBlock(at(8, 50), 'break', 1, at(8, 50), at(9, 0));
  expectBlock(at(9, 0), 'focus', 2, at(9, 0), at(9, 50));
  expectBlock(at(9, 50), 'break', 2, at(9, 50), at(10, 0));
  expectBlock(at(10, 0), 'focus', 3);
  expectBlock(at(10, 50), 'break', 3);
  expectBlock(at(11, 0), 'focus', 4, at(11, 0), at(11, 50));
});

test('recuperación larga de 11:50 a 13:00 (70 min, sin margen)', () => {
  expectBlock(at(11, 50), 'long', 4, at(11, 50), at(13, 0));
  expectBlock(at(12, 0), 'long', 4);
  expectBlock(at(12, 40), 'long', 4);
  expectBlock(at(12, 59, 59), 'long', 4);
  const b = blockAt(ANCHOR, at(12, 30));
  assert.equal((b.end - b.start) / MIN, RULES.longBreakMin);
});

test('ciclo 2 empieza a las 13:00 con la sesión 5', () => {
  const b = blockAt(ANCHOR, at(13, 0));
  assert.equal(b.type, 'focus');
  assert.equal(b.session, 5);
  assert.equal(b.sessionInCycle, 1);
  assert.equal(b.cycle, 2);
  expectBlock(at(16, 0), 'focus', 8);
  expectBlock(at(16, 50), 'long', 8, at(16, 50), at(18, 0));
  expectBlock(at(18, 0), 'focus', 9);
});

test('antes del ancla se espera', () => {
  const b = blockAt(ANCHOR, at(7, 55));
  assert.equal(b.type, 'waiting');
  assert.equal(b.end, ANCHOR);
});

test('en 24 h todo enfoque empieza a :00 y todo descanso a :50', () => {
  const blocks = blocksIn(ANCHOR, ANCHOR, ANCHOR + 24 * HOUR);
  assert.ok(blocks.length > 0);
  for (const b of blocks) {
    const d = new Date(b.start);
    if (b.type === 'focus') {
      assert.equal(d.getMinutes(), 0);
      assert.equal((b.end - b.start) / MIN, 50);
    } else {
      assert.equal(d.getMinutes(), 50);
      assert.equal(new Date(b.end).getMinutes(), 0, 'todo descanso termina en punto');
    }
  }
  // bloques contiguos, sin huecos
  for (let i = 1; i < blocks.length; i++) assert.equal(blocks[i].start, blocks[i - 1].end);
});

test('8:00 a 18:00 = 8 sesiones', () => {
  const focus = blocksIn(ANCHOR, ANCHOR, at(18)).filter((b) => b.type === 'focus');
  assert.equal(focus.length, 8);
});

test('opciones al iniciar a mitad de hora', () => {
  assert.deepEqual(startOptions(at(8, 0, 20)), { kind: 'now', anchor: at(8) });
  const o = startOptions(at(8, 23));
  assert.equal(o.kind, 'choose');
  assert.equal(o.joinAnchor, at(8));
  assert.equal(o.nextAnchor, at(9));
  assert.equal(o.focusLeftMs, 27 * MIN);
  assert.deepEqual(startOptions(at(8, 52)), { kind: 'wait', anchor: at(9) });
});

test('upcoming devuelve el bloque actual y los siguientes', () => {
  const list = upcoming(ANCHOR, at(11, 20), 4);
  assert.deepEqual(list.map((b) => b.type), ['focus', 'long', 'focus', 'break']);
  assert.equal(list[2].start, at(13));
});
