// Pruebas de la unión de sesiones entre dispositivos. Ejecuta: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSessions, toRemoteMap, fromRemote } from '../js/merge.js';

const e = (start, minutes, session = 1) => ({ start, session, size: 4, minutes, complete: minutes >= 45 });

test('sin datos en la nube: hay que subir lo local', () => {
  const r = mergeSessions([e(1000, 50)], {});
  assert.equal(r.minutes, 50);
  assert.equal(r.localChanged, false);
  assert.equal(r.remoteNeedsPush, true);
});

test('el mismo bloque en dos dispositivos cuenta una vez y gana el de más minutos', () => {
  const remote = toRemoteMap([e(1000, 50)]);
  const r = mergeSessions([e(1000, 30)], remote);
  assert.equal(r.minutes, 50);
  assert.equal(r.localChanged, true);
  assert.equal(r.remoteNeedsPush, false);
  const r2 = mergeSessions([e(1000, 50)], toRemoteMap([e(1000, 30)]));
  assert.equal(r2.minutes, 50);
  assert.equal(r2.localChanged, false);
  assert.equal(r2.remoteNeedsPush, true);
});

test('sesiones distintas se suman', () => {
  const r = mergeSessions([e(1000, 50)], toRemoteMap([e(2000, 40, 2)]));
  assert.equal(r.minutes, 90);
  assert.equal(r.localChanged, true);
  assert.equal(r.remoteNeedsPush, true);
});

test('si ya están iguales no se sube nada (sin bucles)', () => {
  const list = [e(1000, 50), e(2000, 50, 2)];
  const r = mergeSessions(list, toRemoteMap(list));
  assert.equal(r.localChanged, false);
  assert.equal(r.remoteNeedsPush, false);
});

test('ida y vuelta conserva los datos', () => {
  const back = fromRemote('1000', toRemoteMap([e(1000, 47, 3)])['1000']);
  assert.deepEqual(back, { start: 1000, session: 3, size: 4, minutes: 47, complete: true });
});
