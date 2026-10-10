// Pruebas de la presencia compartida. Ejecuta: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcile, toPresence, soundHere } from '../js/presence.js';

const run = { startedAt: 1000, waitUntil: null, quiet: false, soundDevice: 'pc' };
const at = (v, by) => ({ v, by });

test('comenzar en el celular → la computadora empieza', () => {
  const remote = toPresence({ ...run, soundDevice: 'cel' }, 3, 'cel');
  assert.equal(reconcile(null, at(2, 'pc'), remote), 'start');
});

test('dejar de estar presente en la computadora → el celular se detiene', () => {
  assert.equal(reconcile(run, at(3, 'cel'), toPresence(null, 4, 'pc')), 'stop');
});

test('el reloj de cada dispositivo no importa: manda la versión', () => {
  // El celular va 5 minutos atrasado, pero su cambio es posterior (versión mayor)
  const remote = toPresence({ ...run, quiet: true }, 5, 'cel', 1000);
  assert.equal(reconcile(run, at(4, 'pc'), remote), 'update');
});

test('cambios propios ya aplicados no hacen nada', () => {
  assert.equal(reconcile(run, at(3, 'pc'), toPresence(run, 3, 'pc')), 'ignore');
});

test('si lo de aquí es más nuevo, se sube', () => {
  assert.equal(reconcile(run, at(6, 'pc'), toPresence(null, 4, 'cel')), 'push');
  assert.equal(reconcile(run, at(6, 'pc'), null), 'push');
  assert.equal(reconcile(null, at(0, ''), null), 'ignore');
  assert.equal(reconcile(run, at(0, ''), null), 'push', 'presencia de antes de sincronizar');
});

test('empate de versión: gana el identificador mayor y ambos coinciden', () => {
  const a = toPresence(null, 7, 'aaa');
  const z = toPresence(run, 7, 'zzz');
  assert.equal(reconcile(null, at(7, 'aaa'), z), 'start'); // aaa acepta lo de zzz
  assert.equal(reconcile(run, at(7, 'zzz'), a), 'push'); // zzz mantiene lo suyo y lo vuelve a subir
});

test('el sonido suena solo en un dispositivo', () => {
  assert.equal(soundHere(run, 'pc', true), true);
  assert.equal(soundHere(run, 'cel', true), false);
  assert.equal(soundHere(run, 'cel', false), true, 'sin sesión, cada dispositivo suena');
  assert.equal(soundHere(null, 'pc', true), false);
});
