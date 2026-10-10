// Pruebas de las rachas. Ejecuta: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStreak, addDays, GOAL_MIN } from '../js/streak.js';

const TODAY = '2026-10-20';
const day = (n) => addDays(TODAY, -n); // day(1) = ayer

function build(pattern) {
  // pattern: lista de minutos, del día más antiguo a ayer
  const days = {};
  pattern.forEach((m, i) => {
    days[day(pattern.length - i)] = m;
  });
  return days;
}

test('un día solo cuenta con 240 min', () => {
  const r = computeStreak(build([239]), TODAY, 0);
  assert.equal(r.streak, 0);
  const r2 = computeStreak(build([240]), TODAY, 0);
  assert.equal(r2.streak, 1);
  assert.equal(GOAL_MIN, 240);
});

test('hoy no rompe la racha mientras no termina', () => {
  const r = computeStreak(build([300, 300, 300]), TODAY, 100);
  assert.equal(r.streak, 3);
  assert.equal(r.todayDone, false);
  assert.equal(r.leftMin, 140);
  const r2 = computeStreak(build([300, 300, 300]), TODAY, 250);
  assert.equal(r2.streak, 4);
  assert.equal(r2.todayDone, true);
});

test('se gana un protector cada 7 días completos', () => {
  const r = computeStreak(build(Array(7).fill(240)), TODAY, 0);
  assert.equal(r.shields, 1);
  assert.equal(r.daysToShield, 7);
  const r2 = computeStreak(build(Array(6).fill(240)), TODAY, 0);
  assert.equal(r2.shields, 0);
  assert.equal(r2.daysToShield, 1);
});

test('máximo 2 protectores', () => {
  const r = computeStreak(build(Array(30).fill(250)), TODAY, 0);
  assert.equal(r.shields, 2);
  assert.equal(r.daysToShield, null);
  assert.equal(r.streak, 30);
});

test('un día fallado gasta un protector y la racha sigue', () => {
  const r = computeStreak(build([...Array(7).fill(240), 30, 240]), TODAY, 0);
  assert.equal(r.shields, 0);
  assert.equal(r.streak, 8); // el día protegido no suma, pero no rompe
  assert.equal(r.history.find((h) => h.key === day(2)).status, 'protected');
});

test('sin protectores la racha vuelve a 0', () => {
  const r = computeStreak(build([240, 240, 0, 240]), TODAY, 0);
  assert.equal(r.streak, 1);
  const r2 = computeStreak(build([240, 240, 0]), TODAY, 0);
  assert.equal(r2.streak, 0);
});

test('dos días fallados seguidos con 2 protectores', () => {
  const r = computeStreak(build([...Array(14).fill(240), 0, 0, 240]), TODAY, 0);
  assert.equal(r.shields, 0);
  assert.equal(r.streak, 15);
  const r3 = computeStreak(build([...Array(14).fill(240), 0, 0, 0]), TODAY, 0);
  assert.equal(r3.streak, 0);
});

test('los días antes de usar la app no gastan protectores', () => {
  const r = computeStreak({ [day(2)]: 240, [day(1)]: 240 }, TODAY, 0);
  assert.equal(r.streak, 2);
  assert.equal(r.history[0].status, 'none');
});
