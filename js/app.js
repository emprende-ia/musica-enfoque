import * as S from './schedule.js';
import { AudioEngine, PRESETS, findPreset } from './audio.js';
import { PlaylistPlayer, parsePlaylistId, playlistHint } from './youtube.js';
import * as store from './store.js';

const { MIN, HOUR } = S;
const COMPLETE_MS = 45 * MIN; // una sesión cuenta como completa con 45 min o más de enfoque
const MODES = ['focus', 'recovery'];
const ALARM_FOR = { focus: 'focus', break: 'break', long: 'long' };

/* ---------- utilidades ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const pad = (n) => String(n).padStart(2, '0');
const hm = (t) => {
  const d = new Date(t);
  return `${d.getHours()}:${pad(d.getMinutes())}`;
};
const mmss = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
};
const dayKey = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const setText = (el, text) => {
  if (el.textContent !== text) el.textContent = text;
};
const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const ICONS = {
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h2v14H6zM20 5v14L9 12z"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 5h2v14h-2zM4 5l11 7-11 7z"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>',
};

/* ---------- estado ---------- */
const audio = new AudioEngine();
let settings = store.loadSettings();
let run = store.loadRun(); // { anchor, armedAt, quiet, current: { start, session, focusedMs } }
const log = store.loadLog(); // [{ start, session, minutes, complete }]

let lastKey = null;
let lastTick = Date.now();
let lastPersist = 0;
let lastStats = 0;
let alarmArmedFor = null;
let audioPending = !!run; // ciclo recuperado tras recargar: hace falta un toque para sonar
let current = null;
let musicTimer = null;
let blockedTimer = null;
let previewTimer = null;
let wakeLock = null;
let scheduleKey = '';
let dialHourKey = '';

audio.setAlarmVolume(settings.alarm / 100);

/* ---------- tarjetas de audio ---------- */
const CARD_COPY = {
  focus: { title: 'Enfoque', when: 'Suena de :00 a :50 en cada sesión' },
  recovery: { title: 'Recuperación', when: 'Suena de :50 a :00 y en la recuperación larga' },
};

function cardHTML(mode) {
  const c = CARD_COPY[mode];
  const opts = PRESETS[mode].map((p) => `<option value="${p.id}">${p.label}</option>`).join('');
  return `
  <article class="mode-card" data-mode="${mode}">
    <header class="card-head">
      <h3>${c.title}</h3>
      <span class="live-tag" hidden>Sonando</span>
      <p class="card-when">${c.when}</p>
    </header>
    <form class="pl-form" novalidate>
      <label for="pl-${mode}">Playlist de YouTube Music</label>
      <div class="pl-row">
        <input id="pl-${mode}" name="playlist" type="text" inputmode="url" autocomplete="off" spellcheck="false" placeholder="Enlace de la playlist">
        <button class="btn small" type="submit">Cargar</button>
      </div>
      <p class="pl-status" role="status"></p>
    </form>
    <div class="player-frame">
      <p class="player-empty">Sin playlist. En este momento sonarán solo los binaurales, si los activas.</p>
      <div class="player-mount"></div>
    </div>
    <div class="transport" hidden>
      <button type="button" class="icon-btn" data-act="prev" aria-label="Canción anterior">${ICONS.prev}</button>
      <button type="button" class="icon-btn" data-act="toggle" aria-label="Reproducir">${ICONS.play}</button>
      <button type="button" class="icon-btn" data-act="next" aria-label="Siguiente canción">${ICONS.next}</button>
      <p class="now-playing" aria-live="polite"></p>
    </div>
    <div class="fields">
      <label class="switch"><input type="checkbox" data-k="shuffle"><span>Orden aleatorio</span></label>
      <label class="range"><span>Volumen de la música <output data-o="music"></output></span><input type="range" min="0" max="100" step="1" data-k="music"></label>
    </div>
    <fieldset class="binaural">
      <legend>Binaurales</legend>
      <label class="switch"><input type="checkbox" data-k="binaural"><span>Tono binaural</span></label>
      <label class="select"><span>Frecuencia</span><select data-k="preset">${opts}</select></label>
      <label class="range"><span>Volumen del tono <output data-o="tone"></output></span><input type="range" min="0" max="100" step="1" data-k="tone"></label>
      <label class="range"><span>Ruido marrón de fondo <output data-o="noise"></output></span><input type="range" min="0" max="100" step="1" data-k="noise"></label>
      <button type="button" class="btn small ghost" data-act="preview">Probar 8 segundos</button>
    </fieldset>
  </article>`;
}

const cards = {};
const players = {};

function buildCards() {
  const host = $('#modes');
  host.innerHTML = MODES.map(cardHTML).join('');
  for (const mode of MODES) {
    const card = host.querySelector(`[data-mode="${mode}"]`);
    cards[mode] = card;
    players[mode] = new PlaylistPlayer($('.player-mount', card), {
      onLoaded: (n) => plStatus(mode, `Playlist lista: ${n} ${n === 1 ? 'canción' : 'canciones'}.`),
      onError: (msg) => plStatus(mode, msg, 'error'),
      onTitle: (title) => setText($('.now-playing', card), title),
      onState: () => {
        syncToggle(mode);
        if (players[mode].playing && activeMode() === mode) $('#blocked-banner').hidden = true;
      },
    });
    wireCard(card, mode);
  }
}

function plStatus(mode, text, tone = '') {
  const el = $('.pl-status', cards[mode]);
  el.textContent = text;
  el.dataset.tone = tone;
}

function syncToggle(mode) {
  const btn = $('[data-act="toggle"]', cards[mode]);
  const playing = players[mode].playing;
  btn.innerHTML = playing ? ICONS.pause : ICONS.play;
  btn.setAttribute('aria-label', playing ? 'Pausar' : 'Reproducir');
}

function showOutput(card, k, v) {
  const o = card.querySelector(`[data-o="${k}"]`);
  if (o) o.textContent = `${v}%`;
}

function wireCard(card, mode) {
  const s = settings[mode];
  const input = $('input[name="playlist"]', card);
  input.value = s.playlist;

  card.querySelectorAll('[data-k]').forEach((el) => {
    const k = el.dataset.k;
    if (el.type === 'checkbox') el.checked = !!s[k];
    else el.value = s[k];
    showOutput(card, k, s[k]);
    el.addEventListener(el.type === 'range' ? 'input' : 'change', () => {
      s[k] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? Number(el.value) : el.value;
      showOutput(card, k, s[k]);
      store.saveSettings(settings);
      onSettingChanged(mode, k);
    });
  });

  $('form', card).addEventListener('submit', (e) => {
    e.preventDefault();
    loadPlaylist(mode, input.value, true);
  });

  card.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    const p = players[mode];
    if (act === 'prev') p.prev();
    if (act === 'next') p.next();
    if (act === 'toggle') p.toggle();
    if (act === 'preview') previewLayer(mode, e.target.closest('button'));
  });
}

async function loadPlaylist(mode, raw, fromUser) {
  const card = cards[mode];
  const s = settings[mode];
  const text = (raw || '').trim();
  if (!text) {
    s.playlist = '';
    store.saveSettings(settings);
    players[mode].unload();
    card.classList.remove('has-player');
    $('.transport', card).hidden = true;
    plStatus(mode, fromUser ? 'Playlist quitada.' : '');
    return;
  }
  const id = parsePlaylistId(text);
  if (!id) {
    plStatus(mode, 'No encontré una playlist en ese enlace. En YouTube Music abre la playlist, toca Compartir y copia el enlace (incluye “list=”).', 'error');
    return;
  }
  const hint = playlistHint(id);
  if (hint) {
    plStatus(mode, hint, 'error');
    return;
  }
  s.playlist = text;
  store.saveSettings(settings);
  plStatus(mode, 'Cargando playlist…');
  card.classList.add('has-player');
  $('.transport', card).hidden = false;
  try {
    await players[mode].load(id, { shuffle: s.shuffle });
    players[mode].setVolume(s.music);
  } catch {
    plStatus(mode, 'No se pudo conectar con YouTube. Revisa tu conexión y vuelve a tocar Cargar.', 'error');
    return;
  }
  if (fromUser && run && !run.quiet && !audioPending && activeMode() === mode) players[mode].play();
}

function onSettingChanged(mode, k) {
  const s = settings[mode];
  if (k === 'music') players[mode].setVolume(s.music);
  if (k === 'shuffle') players[mode].setShuffle(s.shuffle);
  if (['binaural', 'preset', 'tone', 'noise'].includes(k) && activeMode() === mode && !previewTimer) {
    audio.setLayer(layerFor(mode), 1);
  }
}

function layerFor(mode) {
  const s = settings[mode];
  const p = findPreset(mode, s.preset);
  return { tone: s.binaural, beat: p.beat, carrier: p.carrier, toneVol: s.tone / 100, noiseVol: s.noise / 100 };
}

function previewLayer(mode, btn) {
  audio.unlock();
  clearTimeout(previewTimer);
  document.querySelectorAll('[data-act="preview"]').forEach((b) => (b.textContent = 'Probar 8 segundos'));
  const layer = layerFor(mode);
  audio.setLayer({ ...layer, tone: true, toneVol: Math.max(layer.toneVol, 0.2) }, 0.6);
  btn.textContent = 'Sonando…';
  previewTimer = setTimeout(() => {
    previewTimer = null;
    btn.textContent = 'Probar 8 segundos';
    restoreLayer();
  }, 8000);
}

function restoreLayer() {
  const mode = activeMode();
  if (mode && run && !run.quiet && !audioPending) audio.setLayer(layerFor(mode), 1.5);
  else audio.silence(1.5);
}

/* ---------- ruteo de audio por bloque ---------- */
function activeMode() {
  return run && current ? S.modeOf(current.type) : null;
}

function markLive(mode) {
  for (const m of MODES) {
    cards[m].classList.toggle('is-live', m === mode);
    $('.live-tag', cards[m]).hidden = m !== mode;
  }
}

function routeAudio(b, musicDelayMs = 0) {
  const mode = S.modeOf(b.type);
  const quiet = !run || run.quiet || !mode;
  clearTimeout(musicTimer);
  clearTimeout(blockedTimer);
  for (const m of MODES) if (m !== mode || quiet) players[m].fadeOutPause(1500);
  if (quiet) {
    if (!previewTimer) audio.silence();
    markLive(null);
    return;
  }
  if (!previewTimer) audio.setLayer(layerFor(mode), 4);
  markLive(mode);
  const p = players[mode];
  if (!p.loaded) return;
  p.setVolume(settings[mode].music);
  musicTimer = setTimeout(() => {
    p.play();
    blockedTimer = setTimeout(() => {
      if (p.wantPlay && !p.playing && activeMode() === mode) {
        $('#blocked-text').textContent = `El navegador no dejó iniciar la música de ${CARD_COPY[mode].title.toLowerCase()} sola.`;
        $('#blocked-banner').hidden = false;
      }
    }, 5000);
  }, musicDelayMs);
}

/* ---------- ciclo ---------- */
function onEnter(b, live) {
  current = b;
  if (live && b.type !== 'waiting') {
    if (alarmArmedFor !== b.start) audio.playAlarm(ALARM_FOR[b.type]);
    notify(b);
  }
  alarmArmedFor = null;
  if (!audioPending) routeAudio(b, live ? 2500 : 0);
  updateWakeLock();
  renderSchedule(Date.now());
}

function armAlarm(b, now) {
  if (audioPending || !audio.running) return;
  if (b.end - now > 15_000 || alarmArmedFor === b.end) return;
  const nb = S.blockAt(run.anchor, b.end);
  if (audio.scheduleAlarm(ALARM_FOR[nb.type], b.end)) alarmArmedFor = b.end;
}

function track(b, now, dt) {
  if (b.type === 'focus') {
    if (!run.current || run.current.start !== b.start) {
      finalize();
      run.current = { start: b.start, session: b.session, focusedMs: 0 };
    }
    run.current.focusedMs += dt;
    if (now - lastPersist > 10_000) {
      store.saveRun(run);
      lastPersist = now;
    }
  } else if (run.current) {
    finalize();
  }
}

function finalize() {
  const c = run?.current;
  if (!c) return;
  run.current = null;
  if (c.focusedMs >= MIN) {
    log.push({
      start: c.start,
      session: c.session,
      minutes: Math.round(c.focusedMs / MIN),
      complete: c.focusedMs >= COMPLETE_MS,
    });
    store.saveLog(log);
  }
  store.saveRun(run);
  renderStats(true);
}

function start(anchor) {
  audio.unlock();
  audioPending = false;
  $('#resume-banner').hidden = true;
  run = { anchor, armedAt: Date.now(), quiet: $('#quiet').checked, current: null };
  store.saveRun(run);
  lastKey = null;
  alarmArmedFor = null;
  const b = S.blockAt(anchor, Date.now());
  if (b.type === 'focus') audio.playAlarm('focus');
  tick();
}

function stop() {
  finalize();
  run = null;
  current = null;
  store.saveRun(null);
  lastKey = null;
  alarmArmedFor = null;
  audioPending = false;
  clearTimeout(musicTimer);
  clearTimeout(blockedTimer);
  audio.cancelAlarms();
  audio.silence(1);
  for (const m of MODES) players[m].fadeOutPause(600);
  markLive(null);
  $('#resume-banner').hidden = true;
  $('#blocked-banner').hidden = true;
  updateWakeLock();
  scheduleKey = '';
  dialHourKey = '';
  tick();
}

function resumeAudio() {
  audio.unlock();
  audioPending = false;
  $('#resume-banner').hidden = true;
  if (current) routeAudio(current, 0);
}

/* ---------- reloj principal ---------- */
function tick() {
  const now = Date.now();
  const dt = Math.min(Math.max(0, now - lastTick), 5000);
  lastTick = now;
  renderClock(now);
  if (!run) {
    renderIdle(now);
    return;
  }
  const b = S.blockAt(run.anchor, now);
  const key = `${b.type}:${b.start ?? 'w'}`;
  if (key !== lastKey) {
    const live = lastKey !== null;
    lastKey = key;
    onEnter(b, live);
  }
  track(b, now, dt);
  armAlarm(b, now);
  renderRun(b, now);
}

/* ---------- render ---------- */
const CX = 170;
const CY = 170;
const R = 128;

function polar(deg, r = R) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
}

function arcPath(d0, d1, r = R) {
  if (d1 - d0 >= 359.99) d1 = d0 + 359.98;
  const [x0, y0] = polar(d0, r);
  const [x1, y1] = polar(d1, r);
  const large = d1 - d0 > 180 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

const SVGNS = 'http://www.w3.org/2000/svg';
const dial = { segs: null, fills: null, bead: null, parts: [] };

function buildDial() {
  const svg = $('#dial');
  const ticks = [];
  for (let m = 0; m < 60; m++) {
    const major = m % 5 === 0;
    const mark = m === 0 || m === 50;
    const [x0, y0] = polar(m * 6, R + 15);
    const [x1, y1] = polar(m * 6, R + (mark ? 25 : major ? 21 : 18));
    ticks.push(`<line class="tick${major ? ' major' : ''}${mark ? ' mark' : ''}" x1="${x0.toFixed(2)}" y1="${y0.toFixed(2)}" x2="${x1.toFixed(2)}" y2="${y1.toFixed(2)}"/>`);
  }
  const [lx0, ly0] = polar(0, R + 37);
  const [lx50, ly50] = polar(300, R + 37);
  svg.innerHTML = `
    <circle class="track" cx="${CX}" cy="${CY}" r="${R}"/>
    <g class="ticks">${ticks.join('')}</g>
    <text class="dial-label" x="${lx0.toFixed(1)}" y="${(ly0 + 4).toFixed(1)}" text-anchor="middle">:00</text>
    <text class="dial-label" x="${lx50.toFixed(1)}" y="${(ly50 + 4).toFixed(1)}" text-anchor="middle">:50</text>
    <g class="segs"></g>
    <g class="fills"></g>
    <g class="bead"><circle cx="${CX}" cy="${CY - R}" r="8"/></g>`;
  dial.segs = $('.segs', svg);
  dial.fills = $('.fills', svg);
  dial.bead = $('.bead', svg);
}

/** Dibuja los segmentos de la hora de reloj actual. `blocks` ya recortados a esta hora. */
function drawDialHour(hourStart, blocks, muted) {
  dial.parts = blocks.map((b) => {
    const d0 = Math.max(0, ((b.start - hourStart) / HOUR) * 360);
    const d1 = Math.min(360, ((b.end - hourStart) / HOUR) * 360);
    const gap = d1 - d0 < 359 ? 1 : 0;
    return { d0: d0 + gap, d1: d1 - gap, cls: S.modeOf(b.type) || 'focus' };
  });
  dial.segs.innerHTML = dial.parts
    .map((p) => `<path class="seg ${p.cls}${muted ? ' muted' : ''}" d="${arcPath(p.d0, p.d1)}"/>`)
    .join('');
  dial.fills.innerHTML = muted ? '' : dial.parts.map((p) => `<path class="fill ${p.cls}" d=""/>`).join('');
}

function updateDial(now, hourStart, showFill) {
  const deg = ((now - hourStart) / HOUR) * 360;
  dial.bead.setAttribute('transform', `rotate(${deg.toFixed(2)} ${CX} ${CY})`);
  if (!showFill) return;
  const paths = dial.fills.children;
  dial.parts.forEach((p, i) => {
    const end = Math.min(p.d1, deg);
    paths[i]?.setAttribute('d', end > p.d0 + 0.2 ? arcPath(p.d0, end) : '');
  });
}

function renderClock(now) {
  const d = new Date(now);
  setText($('#clock'), hm(now));
  setText($('#today'), `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`);
}

function renderIdle(now) {
  document.body.dataset.mode = 'idle';
  const opt = S.startOptions(now);
  const top = S.startOfHour(now);
  const nextTop = top + HOUR;

  setText($('#mode-label'), 'Listo para empezar');
  setText($('#countdown'), mmss(nextTop - now));
  setText($('#mode-sub'), `para las ${hm(nextTop)}`);
  document.title = 'Música & Enfoque';
  $('#cycle').hidden = true;
  setText($('#next-line'), '');
  $('#idle-controls').hidden = false;
  $('#run-controls').hidden = true;

  const join = $('#btn-join');
  const next = $('#btn-next');
  if (opt.kind === 'now') {
    join.hidden = false;
    next.hidden = true;
    setText(join, 'Iniciar sesión ahora');
    join.dataset.anchor = opt.anchor;
    setText($('#idle-hint'), `Son las ${hm(top)} en punto: la sesión 1 empieza en cuanto presiones.`);
  } else if (opt.kind === 'choose') {
    join.hidden = false;
    next.hidden = false;
    setText(join, `Unirme a la sesión en curso (${Math.ceil(opt.focusLeftMs / MIN)} min de enfoque)`);
    join.dataset.anchor = opt.joinAnchor;
    setText(next, `Empezar a las ${hm(opt.nextAnchor)}`);
    next.dataset.anchor = opt.nextAnchor;
    setText($('#idle-hint'), `La sesión de las ${hm(top)} ya empezó. Únete con el tiempo que queda o espera a la siguiente hora en punto.`);
  } else {
    join.hidden = true;
    next.hidden = false;
    setText(next, `Empezar a las ${hm(opt.anchor)}`);
    next.dataset.anchor = opt.anchor;
    setText($('#idle-hint'), `Ya pasó el minuto :50. La sesión 1 empieza a las ${hm(opt.anchor)}.`);
  }
  next.classList.toggle('primary', opt.kind === 'wait');

  // Dial de muestra: la hora actual con su patrón de enfoque y recuperación
  const hourKey = `idle:${top}`;
  if (dialHourKey !== hourKey) {
    dialHourKey = hourKey;
    drawDialHour(top, [
      { type: 'focus', start: top, end: top + 50 * MIN },
      { type: 'break', start: top + 50 * MIN, end: nextTop },
    ], true);
  }
  updateDial(now, top, false);

  const previewAnchor = opt.kind === 'wait' ? opt.anchor : opt.kind === 'now' ? opt.anchor : opt.joinAnchor;
  renderSchedule(now, previewAnchor);
  renderStats();
}

function renderRun(b, now) {
  document.body.dataset.mode = b.type;
  $('#idle-controls').hidden = true;
  $('#run-controls').hidden = false;

  const label = S.LABELS[b.type];
  const left = mmss(b.end - now);
  setText($('#mode-label'), b.type === 'focus' ? `Enfoque, sesión ${b.session}` : label);
  setText($('#countdown'), left);
  let sub = '';
  if (b.type === 'waiting') sub = `La sesión 1 empieza a las ${hm(b.end)}`;
  else if (b.type === 'focus') sub = `Hasta las ${hm(b.end)}`;
  else if (b.type === 'break') sub = `Vuelves al enfoque a las ${hm(b.end)}`;
  else sub = `Fin del ciclo ${b.cycle}. Vuelves a las ${hm(b.end)}`;
  setText($('#mode-sub'), sub);
  document.title = `${left} ${label} · Música & Enfoque`;

  const nb = S.blockAt(run.anchor, b.end);
  const nbLabel = nb.type === 'focus' ? `enfoque de la sesión ${nb.session}` : S.LABELS[nb.type].toLowerCase();
  setText($('#next-line'), `Después: ${nbLabel}, de ${hm(nb.start)} a ${hm(nb.end)}.`);

  renderPips(b);

  const top = S.startOfHour(now);
  const hourKey = `run:${run.anchor}:${top}:${b.type === 'waiting'}`;
  if (dialHourKey !== hourKey) {
    dialHourKey = hourKey;
    if (b.type === 'waiting') {
      drawDialHour(top, [
        { type: 'focus', start: top, end: top + 50 * MIN },
        { type: 'break', start: top + 50 * MIN, end: top + HOUR },
      ], true);
    } else {
      drawDialHour(top, S.blocksIn(run.anchor, top, top + HOUR), false);
    }
  }
  if (!document.hidden) {
    updateDial(now, top, b.type !== 'waiting');
    renderSchedule(now);
    renderStats();
  }
}

function renderPips(b) {
  const box = $('#cycle');
  box.hidden = false;
  setText($('#cycle-label'), `Ciclo ${b.cycle}`);
  const items = [];
  for (let i = 1; i <= 4; i++) {
    let st = 'todo';
    if (b.type !== 'waiting') {
      if (i < b.sessionInCycle) st = 'done';
      else if (i === b.sessionInCycle) st = b.type === 'focus' ? 'now' : 'done';
    }
    const word = st === 'done' ? 'hecha' : st === 'now' ? 'en curso' : 'pendiente';
    items.push(`<li class="pip focus ${st}" aria-label="Sesión ${i}, ${word}"></li>`);
  }
  const longSt = b.type === 'long' ? 'now' : 'todo';
  items.push(`<li class="pip long ${longSt}" aria-label="Recuperación larga, ${longSt === 'now' ? 'en curso' : 'pendiente'}"></li>`);
  const html = items.join('');
  const pips = $('#pips');
  if (pips.dataset.html !== html) {
    pips.innerHTML = html;
    pips.dataset.html = html;
  }
}

function renderSchedule(now, previewAnchor) {
  const anchor = run ? run.anchor : previewAnchor;
  if (anchor == null) return;
  const list = $('#schedule');
  const blocks = S.upcoming(anchor, now, 11);
  const key = `${run ? 'run' : 'preview'}:${anchor}:${blocks[0].start}`;
  setText($('#schedule-note'), run ? '' : 'Así quedaría si empiezas ahora:');
  if (key !== scheduleKey) {
    scheduleKey = key;
    let lastCycle = null;
    const rows = [];
    for (const b of blocks) {
      if (lastCycle !== null && b.cycle !== lastCycle) rows.push(`<li class="row-sep">Ciclo ${b.cycle}</li>`);
      lastCycle = b.cycle;
      const what = b.type === 'focus' ? `Enfoque, sesión ${b.session}` : S.LABELS[b.type];
      const mins = Math.round((b.end - b.start) / MIN);
      rows.push(`
        <li class="row ${S.modeOf(b.type)} ${b.type}" data-start="${b.start}" data-end="${b.end}">
          <span class="row-time">${hm(b.start)}–${hm(b.end)}</span>
          <span class="row-what">${what}</span>
          <span class="row-dur">${mins} min</span>
          <span class="row-bar"><i></i></span>
        </li>`);
    }
    list.innerHTML = rows.join('');
  }
  for (const li of list.querySelectorAll('.row')) {
    const s = Number(li.dataset.start);
    const e = Number(li.dataset.end);
    const isNow = run && now >= s && now < e;
    li.classList.toggle('is-now', !!isNow);
    const bar = li.querySelector('.row-bar i');
    bar.style.width = isNow ? `${(((now - s) / (e - s)) * 100).toFixed(2)}%` : '0%';
  }
}

function renderStats(force = false) {
  const now = Date.now();
  if (!force && now - lastStats < 5000) return;
  lastStats = now;
  const today = dayKey(now);
  const inProgress = run?.current && dayKey(run.current.start) === today ? run.current.focusedMs / MIN : 0;
  const todays = log.filter((e) => dayKey(e.start) === today).sort((a, b) => a.start - b.start);
  const todayMin = Math.round(todays.reduce((s, e) => s + e.minutes, 0) + inProgress);
  setText($('#stat-today'), `${todayMin} min`);
  setText($('#stat-sessions'), String(todays.filter((e) => e.complete).length));

  // últimos 7 días
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - i);
    days.push({ key: dayKey(d.getTime()), label: WEEKDAYS[d.getDay()], min: 0, isToday: i === 0 });
  }
  for (const e of log) {
    const day = days.find((x) => x.key === dayKey(e.start));
    if (day) day.min += e.minutes;
  }
  days[6].min += Math.round(inProgress);
  const weekMin = days.reduce((s, d) => s + d.min, 0);
  setText($('#stat-week'), `${(weekMin / 60).toFixed(1).replace('.0', '')} h`);
  const max = Math.max(200, ...days.map((d) => d.min));
  const weekHTML = days
    .map((d) => `
      <div class="day${d.isToday ? ' today' : ''}">
        <span class="day-val">${d.min ? d.min : ''}</span>
        <span class="day-bar"><i style="height:${((d.min / max) * 100).toFixed(1)}%"></i></span>
        <span class="day-name">${d.label}</span>
      </div>`)
    .join('');
  const week = $('#week');
  if (week.dataset.html !== weekHTML) {
    week.innerHTML = weekHTML;
    week.dataset.html = weekHTML;
    week.setAttribute('aria-label', `Minutos de enfoque por día: ${days.map((d) => `${d.label} ${d.min}`).join(', ')}`);
  }

  const items = todays.map((e) => `
    <li><span class="log-time">${hm(e.start)}</span><span>Sesión ${e.session}</span><span class="log-min">${e.minutes} min</span><span class="log-state ${e.complete ? 'ok' : ''}">${e.complete ? 'Completa' : 'Parcial'}</span></li>`);
  if (inProgress >= 1) {
    items.push(`<li class="live"><span class="log-time">${hm(run.current.start)}</span><span>Sesión ${run.current.session}</span><span class="log-min">${Math.floor(inProgress)} min</span><span class="log-state">En curso</span></li>`);
  }
  const logHTML = items.length ? items.join('') : '<li class="empty">Aún no hay sesiones hoy. Cada sesión aparece aquí al terminar su enfoque.</li>';
  const ul = $('#today-log');
  if (ul.dataset.html !== logHTML) {
    ul.innerHTML = logHTML;
    ul.dataset.html = logHTML;
  }
}

/* ---------- avisos ---------- */
function notify(b) {
  if (!settings.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
  if (!document.hidden) return;
  const body =
    b.type === 'focus'
      ? `Sesión ${b.session}, hasta las ${hm(b.end)}.`
      : b.type === 'long'
        ? `Recuperación larga hasta las ${hm(b.end)}.`
        : `Recuperación hasta las ${hm(b.end)}.`;
  try {
    new Notification(S.LABELS[b.type], { body, tag: 'musica-enfoque', icon: 'icon.svg', silent: true });
  } catch {
    /* algunos navegadores solo permiten notificaciones desde un service worker */
  }
}

async function updateWakeLock() {
  const want = settings.wake && !!run && !document.hidden;
  if (want && !wakeLock && 'wakeLock' in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        wakeLock = null;
      });
    } catch {
      wakeLock = null;
    }
  } else if (!want && wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}

/* ---------- controles generales ---------- */
function armTwoStep(btn, label, confirmLabel, action) {
  let armed = null;
  btn.addEventListener('click', () => {
    if (armed) {
      clearTimeout(armed);
      armed = null;
      btn.textContent = label;
      btn.classList.remove('danger');
      action();
      return;
    }
    btn.textContent = confirmLabel;
    btn.classList.add('danger');
    armed = setTimeout(() => {
      armed = null;
      btn.textContent = label;
      btn.classList.remove('danger');
    }, 4000);
  });
}

function wireGlobal() {
  $('#btn-join').addEventListener('click', (e) => start(Number(e.currentTarget.dataset.anchor)));
  $('#btn-next').addEventListener('click', (e) => start(Number(e.currentTarget.dataset.anchor)));
  armTwoStep($('#btn-stop'), 'Detener ciclo', 'Toca otra vez para detener', stop);
  armTwoStep($('#btn-clear'), 'Borrar historial', 'Toca otra vez para borrar todo', () => {
    log.splice(0, log.length);
    store.saveLog(log);
    renderStats(true);
  });

  const quiet = $('#quiet');
  quiet.checked = !!run?.quiet;
  quiet.addEventListener('change', () => {
    if (!run) return;
    run.quiet = quiet.checked;
    store.saveRun(run);
    if (current && !audioPending) routeAudio(current, 0);
  });

  $('#btn-resume').addEventListener('click', resumeAudio);
  $('#btn-unblock').addEventListener('click', () => {
    const mode = activeMode();
    if (mode) players[mode].play();
    $('#blocked-banner').hidden = true;
  });

  const vol = $('#alarm-vol');
  vol.value = settings.alarm;
  $('#alarm-out').textContent = `${settings.alarm}%`;
  vol.addEventListener('input', () => {
    settings.alarm = Number(vol.value);
    $('#alarm-out').textContent = `${settings.alarm}%`;
    audio.setAlarmVolume(settings.alarm / 100);
    store.saveSettings(settings);
  });
  document.querySelectorAll('[data-test]').forEach((b) =>
    b.addEventListener('click', () => audio.playAlarm(b.dataset.test)),
  );

  const notifyBox = $('#notify');
  const notifyMsg = $('#notify-msg');
  if (!('Notification' in window)) {
    notifyBox.disabled = true;
    notifyMsg.textContent = 'Este navegador no ofrece notificaciones.';
  } else {
    notifyBox.checked = settings.notify && Notification.permission === 'granted';
    notifyBox.addEventListener('change', async () => {
      if (notifyBox.checked) {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') {
          notifyBox.checked = false;
          notifyMsg.textContent = 'Las notificaciones están bloqueadas. Actívalas en los permisos del sitio en tu navegador.';
        } else {
          notifyMsg.textContent = '';
        }
      }
      settings.notify = notifyBox.checked;
      store.saveSettings(settings);
    });
  }

  const wake = $('#wake');
  if (!('wakeLock' in navigator)) {
    wake.disabled = true;
    $('#wake-msg').textContent = 'Este navegador no permite mantener la pantalla encendida.';
  }
  wake.checked = settings.wake;
  wake.addEventListener('change', () => {
    settings.wake = wake.checked;
    store.saveSettings(settings);
    updateWakeLock();
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      if (!audioPending && audio.ctx?.state === 'suspended') audio.ctx.resume().catch(() => {});
      dialHourKey = '';
      tick();
    }
    updateWakeLock();
  });
}

function startTicker() {
  try {
    const w = new Worker(new URL('./tick-worker.js', import.meta.url));
    w.onmessage = tick;
    w.onerror = () => setInterval(tick, 250);
  } catch {
    setInterval(tick, 250);
  }
}

/* ---------- arranque ---------- */
function init() {
  buildDial();
  buildCards();
  wireGlobal();
  if (run) {
    // Cerrar un enfoque guardado que ya terminó mientras la pestaña estaba cerrada
    const b = S.blockAt(run.anchor, Date.now());
    if (run.current && run.current.start !== b.start) finalize();
    $('#resume-banner').hidden = false;
  }
  for (const mode of MODES) if (settings[mode].playlist) loadPlaylist(mode, settings[mode].playlist, false);
  renderStats(true);
  tick();
  startTicker();
}

init();
