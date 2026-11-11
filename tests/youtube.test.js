// Pruebas de los enlaces de música. Ejecuta: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, sourceHint } from '../js/youtube.js';

const V = 'dQw4w9WgXcQ';
const PL = 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG';

test('playlists de YouTube Music y YouTube', () => {
  assert.deepEqual(parseSource(`https://music.youtube.com/playlist?list=${PL}&si=abc`), { type: 'playlist', id: PL });
  assert.deepEqual(parseSource(`https://youtube.com/playlist?list=${PL}`), { type: 'playlist', id: PL });
  assert.deepEqual(parseSource(`https://music.youtube.com/browse/VL${PL}`), { type: 'playlist', id: PL });
  assert.deepEqual(parseSource(PL), { type: 'playlist', id: PL });
});

test('videos sueltos en todas sus formas', () => {
  for (const url of [
    `https://www.youtube.com/watch?v=${V}`,
    `https://music.youtube.com/watch?v=${V}&si=xyz`,
    `https://m.youtube.com/watch?v=${V}&t=42s`,
    `https://youtu.be/${V}?si=abc`,
    `https://www.youtube.com/shorts/${V}`,
    `https://www.youtube.com/live/${V}?feature=share`,
    `https://www.youtube.com/embed/${V}`,
    `youtube.com/watch?v=${V}`,
    V,
  ]) {
    assert.deepEqual(parseSource(url), { type: 'video', id: V }, url);
  }
});

test('video dentro de una playlist: gana la playlist', () => {
  assert.deepEqual(parseSource(`https://www.youtube.com/watch?v=${V}&list=${PL}&index=3`), { type: 'playlist', id: PL });
});

test('video dentro de un Mix, Me gusta o Ver más tarde: gana el video', () => {
  assert.deepEqual(parseSource(`https://www.youtube.com/watch?v=${V}&list=RD${V}&start_radio=1`), { type: 'video', id: V });
  assert.deepEqual(parseSource(`https://music.youtube.com/watch?v=${V}&list=LM`), { type: 'video', id: V });
  assert.deepEqual(parseSource(`https://www.youtube.com/watch?v=${V}&list=WL&index=2`), { type: 'video', id: V });
});

test('enlaces que no son música', () => {
  assert.equal(parseSource(''), null);
  assert.equal(parseSource('https://www.youtube.com/'), null);
  assert.equal(parseSource('https://www.youtube.com/@canal'), null);
  assert.equal(parseSource('hola mundo'), null);
});

test('avisos para listas que no se pueden incrustar', () => {
  assert.match(sourceHint(parseSource('https://music.youtube.com/playlist?list=LM')), /Me gusta/);
  assert.equal(sourceHint({ type: 'video', id: V }), null);
  assert.equal(sourceHint({ type: 'playlist', id: PL }), null);
});
