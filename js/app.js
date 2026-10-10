import * as S from './schedule.js';
import { AudioEngine, PRESETS, findPreset } from './audio.js';
import { PlaylistPlayer, parsePlaylistId, playlistHint } from './youtube.js';
import { computeStreak, keyOf, dateOf, GOAL_MIN, MAX_SHIELDS } from './streak.js';
import * as store from './store.js';
import { Sync, syncConfigured } from './sync.js';
import { mergeSessions, toRemoteMap, fromRemote } from './merge.js';

const { MIN, HOUR } = S;
const COMPLETE_MS = 45 * MIN; // una sesión cuenta como completa con 45 min o más de enfoque
const MODES = ['focus', 'recovery'];
const ALARM_FOR = { focus: 'focus', break: 'break', long: 'long' };
const THEME_COLORS = { light: '#fff8f7', dark: '#191211' };

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
const dayKey = (t) => keyOf(new Date(t));
const setText = (el, text) => {
  if (el.textContent !== text) el.textContent = text;
};
const icon = (name, cls = '') => `<span class="ms${cls ? ` ${cls}` : ''}" aria-hidden="true">${name}</span>`;
const lowerFirst = (t) => t.charAt(0).toLowerCase() + t.slice(1);
const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`);
const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/* ---------- estado ---------- */
const audio = new AudioEngine();
const settings = store.loadSettings();
let run = store.loadRun(); // { startedAt, waitUntil, quiet, current: { start, session, size, focusedMs } }
const log = store.loadLog(); // [{ start, session, size, minutes, complete }]
const days = store.loadDays(log); // { 'AAAA-MM-DD': minutos }

let lastKey = null;
let lastTick = Date.now();
let lastPersist = 0;
let lastStats = 0;
let alarmArmedFor = null;
let audioPending = !!run; // presencia recuperada tras recargar: hace falta un toque para sonar
let current = null;
let musicTimer = null;
let blockedTimer = null;
let previewTimer = null;
let snackTimer = null;
let wakeLock = null;
let dayRenderKey = '';
let dialHourKey = '';
let todayWasDone = null;

audio.setAlarmVolume(settings.alarm / 100);

/* ---------- tema ---------- */
const THEME_META = {
  system: { icon: 'brightness_auto', label: 'igual que el sistema' },
  light: { icon: 'light_mode', label: 'claro' },
  dark: { icon: 'dark_mode', label: 'oscuro' },
};

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
  // La barra del navegador sigue al tema elegido
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    const scheme = m.media.includes('dark') ? 'dark' : 'light';
    m.content = THEME_COLORS[theme === 'system' ? scheme : theme];
  });
  const btn = $('#btn-theme');
  btn.innerHTML = icon(THEME_META[theme].icon);
  btn.setAttribute('aria-label', `Tema: ${THEME_META[theme].label}. Toca para cambiar.`);
  btn.title = `Tema: ${THEME_META[theme].label}`;
  document.querySelectorAll('[data-theme-opt]').forEach((b) => {
    b.setAttribute('aria-checked', String(b.dataset.themeOpt === theme));
  });
}

function setTheme(theme) {
  settings.theme = theme;
  saveSettings();
  applyTheme(theme);
}

/* ---------- sliders: pintar la parte activa ---------- */
function paintRange(el) {
  const min = Number(el.min || 0);
  const max = Number(el.max || 100);
  el.style.setProperty('--p', `${((Number(el.value) - min) / (max - min)) * 100}%`);
}

/* ---------- tarjetas de audio ---------- */
const CARD_COPY = {
  focus: { title: 'Enfoque', when: 'Suena de :00 a :50 en cada sesión', icon: 'timer' },
  recovery: { title: 'Recuperación', when: 'Suena de :50 a :00 y en la recuperación larga', icon: 'spa' },
};

function cardHTML(mode) {
  const c = CARD_COPY[mode];
  const opts = PRESETS[mode].map((p) => `<option value="${p.id}">${p.label}</option>`).join('');
  return `
  <article class="mode-card" data-mode="${mode}">
    <header class="card-head">
      <span class="avatar">${icon(c.icon)}</span>
      <h3>${c.title}</h3>
      <span class="chip live-tag" hidden>${icon('graphic_eq')}Sonando</span>
      <p class="card-when">${c.when}</p>
    </header>
    <form class="pl-form" novalidate>
      <div class="pl-row">
        <div class="field">
          <label for="pl-${mode}">Playlist de YouTube Music</label>
          <input id="pl-${mode}" name="playlist" type="text" inputmode="url" autocomplete="off" spellcheck="false" placeholder="Enlace de la playlist">
        </div>
        <button class="btn tonal" type="submit">Cargar</button>
      </div>
      <p class="pl-status" role="status"></p>
    </form>
    <div class="player-frame">
      <p class="player-empty">${icon('queue_music')}Sin playlist. En este momento sonarán solo los binaurales, si los activas.</p>
      <div class="player-mount"></div>
    </div>
    <div class="transport" hidden>
      <button type="button" class="icon-btn" data-act="prev" aria-label="Canción anterior">${icon('skip_previous')}</button>
      <button type="button" class="icon-btn filled size-m" data-act="toggle" aria-label="Reproducir">${icon('play_arrow', 'fill')}</button>
      <button type="button" class="icon-btn" data-act="next" aria-label="Siguiente canción">${icon('skip_next')}</button>
      <p class="now-playing" aria-live="polite"></p>
    </div>
    <div class="fields">
      <label class="switch"><input type="checkbox" role="switch" data-k="shuffle"><span>Orden aleatorio</span></label>
      <label class="range"><span>Volumen de la música <output data-o="music"></output></span><input type="range" min="0" max="100" step="1" data-k="music"></label>
    </div>
    <fieldset class="binaural">
      <legend>${icon('headphones')}Binaurales</legend>
      <label class="switch"><input type="checkbox" role="switch" data-k="binaural"><span>Tono binaural</span></label>
      <div class="field select">
        <label for="preset-${mode}">Frecuencia</label>
        <select id="preset-${mode}" data-k="preset">${opts}</select>
      </div>
      <label class="range"><span>Volumen del tono <output data-o="tone"></output></span><input type="range" min="0" max="100" step="1" data-k="tone"></label>
      <label class="range"><span>Ruido marrón de fondo <output data-o="noise"></output></span><input type="range" min="0" max="100" step="1" data-k="noise"></label>
      <button type="button" class="btn text" data-act="preview">${icon('headphones')}<span class="label">Probar 8 segundos</span></button>
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
  btn.innerHTML = icon(playing ? 'pause' : 'play_arrow', 'fill');
  btn.classList.toggle('selected', playing);
  btn.setAttribute('aria-label', playing ? 'Pausar' : 'Reproducir');
}

function showOutput(card, k, v) {
  const o = card.querySelector(`[data-o="${k}"]`);
  if (o) o.textContent = `${v}%`;
}

/** Pone en la tarjeta los valores actuales de los ajustes. */
function refreshCard(mode) {
  const card = cards[mode];
  const s = settings[mode];
  $('input[name="playlist"]', card).value = s.playlist;
  card.querySelectorAll('[data-k]').forEach((el) => {
    const k = el.dataset.k;
    if (el.type === 'checkbox') el.checked = !!s[k];
    else el.value = s[k];
    if (el.type === 'range') paintRange(el);
    showOutput(card, k, s[k]);
  });
}

function wireCard(card, mode) {
  const s = settings[mode];
  const input = $('input[name="playlist"]', card);
  refreshCard(mode);

  card.querySelectorAll('[data-k]').forEach((el) => {
    const k = el.dataset.k;
    el.addEventListener(el.type === 'range' ? 'input' : 'change', () => {
      s[k] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? Number(el.value) : el.value;
      if (el.type === 'range') paintRange(el);
      showOutput(card, k, s[k]);
      saveSettings();
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
    if (fromUser) saveSettings();
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
  if (fromUser) saveSettings();
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
  document.querySelectorAll('[data-act="preview"] .label').forEach((l) => (l.textContent = 'Probar 8 segundos'));
  const layer = layerFor(mode);
  audio.setLayer({ ...layer, tone: true, toneVol: Math.max(layer.toneVol, 0.2) }, 0.6);
  $('.label', btn).textContent = 'Sonando…';
  previewTimer = setTimeout(() => {
    previewTimer = null;
    $('.label', btn).textContent = 'Probar 8 segundos';
    restoreLayer();
  }, 8000);
}

function restoreLayer() {
  const mode = activeMode();
  if (mode && run && !run.quiet && !audioPending) audio.setLayer(layerFor(mode), 1.5);
  else audio.silence(1.5);
}

/* ---------- audio por bloque ---------- */
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
        $('#blocked-text').textContent = `El navegador no dejó iniciar sola la música de ${CARD_COPY[mode].title.toLowerCase()}.`;
        $('#blocked-banner').hidden = false;
      }
    }, 5000);
  }, musicDelayMs);
}

/* ---------- presencia ---------- */
function onEnter(b, live) {
  current = b;
  if (live && b.type !== 'waiting') {
    if (alarmArmedFor !== b.start) audio.playAlarm(ALARM_FOR[b.type]);
    notify(b);
  }
  alarmArmedFor = null;
  if (!audioPending) routeAudio(b, live ? 2500 : 0);
  updateWakeLock();
  renderDay(Date.now());
}

function armAlarm(b, now) {
  if (audioPending || !audio.running) return;
  if (b.end - now > 15_000 || alarmArmedFor === b.end) return;
  const nb = S.blockAt(b.end);
  if (audio.scheduleAlarm(ALARM_FOR[nb.type], b.end)) alarmArmedFor = b.end;
}

function track(b, now, dt) {
  if (b.type === 'focus') {
    if (!run.current || run.current.start !== b.start) {
      finalize();
      run.current = { start: b.start, session: b.sessionInCycle, size: b.cycleSize, focusedMs: 0 };
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
    const minutes = Math.round(c.focusedMs / MIN);
    const entry = { start: c.start, session: c.session, size: c.size, minutes, complete: c.focusedMs >= COMPLETE_MS };
    const existing = log.find((e) => e.start === c.start); // ya llegó de otro dispositivo
    if (!existing) log.push(entry);
    else if (minutes > existing.minutes) Object.assign(existing, entry);
    store.saveLog(log);
    const k = dayKey(c.start);
    days[k] = dayEntries(k).reduce((sum, e) => sum + e.minutes, 0);
    store.saveDays(days);
    pushDay(k);
  }
  store.saveRun(run);
  renderStats(true);
}

/** Empieza a estar presente. `waitUntil`: esperar en silencio hasta ese enfoque. */
function start(waitUntil = null) {
  audio.unlock();
  audioPending = false;
  $('#resume-banner').hidden = true;
  run = { startedAt: Date.now(), waitUntil, quiet: $('#quiet').checked, current: null };
  store.saveRun(run);
  lastKey = null;
  alarmArmedFor = null;
  if (!waitUntil && S.blockAt(Date.now()).type === 'focus') audio.playAlarm('focus');
  tick();
}

/** Bloque vigente para quien está presente (o la espera hasta su enfoque). */
function currentBlock(now) {
  if (run.waitUntil && now < run.waitUntil) {
    return { ...S.blockAt(run.waitUntil), type: 'waiting', start: run.startedAt, end: run.waitUntil };
  }
  if (run.waitUntil) {
    run.waitUntil = null;
    store.saveRun(run);
  }
  return S.blockAt(now);
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
  const b = currentBlock(now);
  const key = `${b.type}:${b.start}`;
  if (key !== lastKey) {
    const live = lastKey !== null;
    lastKey = key;
    onEnter(b, live);
  }
  track(b, now, dt);
  armAlarm(b, now);
  renderRun(b, now);
}

/* ---------- dial: progreso ondulado de M3 Expressive ---------- */
const CX = 170;
const CY = 170;
const R = 124;
const WAVES = 24; // ondas por vuelta completa
const AMP = 3.6;
const SEG_INSET = 4; // grados de separación entre segmentos
const GAP = 7; // grados entre la parte activa y la pista

function polar(deg, r = R) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
}

function arcPath(d0, d1) {
  if (d1 - d0 >= 359.99) d1 = d0 + 359.98;
  const [x0, y0] = polar(d0);
  const [x1, y1] = polar(d1);
  const large = d1 - d0 > 180 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${R} ${R} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

function wavyPath(d0, d1, phase) {
  const pts = [];
  const step = 0.75;
  const point = (d) => {
    const taper = Math.min(1, (d - d0) / 10, (d1 - d) / 10);
    const r = R + AMP * Math.max(0, taper) * Math.sin(((d * Math.PI) / 180) * WAVES + phase);
    const [x, y] = polar(d, r);
    return `${x.toFixed(2)} ${y.toFixed(2)}`;
  };
  for (let d = d0; d < d1; d += step) pts.push(point(d));
  pts.push(point(d1));
  return `M${pts.join('L')}`;
}

const dial = { svg: null, tracks: null, actives: null, parts: [], top: 0, muted: true };

function buildDial() {
  const svg = $('#dial');
  const dots = [];
  for (let m = 0; m < 60; m += 5) {
    const mark = m === 0 || m === 50;
    const [x, y] = polar(m * 6, R + 21);
    dots.push(`<circle class="tick${mark ? ' mark' : ''}" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${mark ? 3 : 2}"/>`);
  }
  const [lx0, ly0] = polar(0, R + 38);
  const [lx50, ly50] = polar(300, R + 38);
  svg.innerHTML = `
    <g>${dots.join('')}</g>
    <text class="dial-label" x="${lx0.toFixed(1)}" y="${(ly0 + 4).toFixed(1)}" text-anchor="middle">:00</text>
    <text class="dial-label" x="${lx50.toFixed(1)}" y="${(ly50 + 4).toFixed(1)}" text-anchor="middle">:50</text>
    <g class="tracks"></g>
    <g class="actives"></g>`;
  dial.svg = svg;
  dial.tracks = $('.tracks', svg);
  dial.actives = $('.actives', svg);
}

function drawDialHour(hourStart, blocks) {
  dial.parts = blocks.map((b) => {
    const d0 = Math.max(0, ((b.start - hourStart) / HOUR) * 360);
    const d1 = Math.min(360, ((b.end - hourStart) / HOUR) * 360);
    const full = d1 - d0 >= 359;
    return { d0: full ? 0 : d0 + SEG_INSET, d1: full ? 360 : d1 - SEG_INSET, full, cls: S.modeOf(b.type) || 'focus' };
  });
  dial.tracks.innerHTML = dial.parts.map((p) => `<path class="track ${p.cls}" d=""/>`).join('');
  dial.actives.innerHTML = dial.parts.map((p) => `<path class="active ${p.cls}" d=""/>`).join('');
}

function updateDial(now) {
  if (!dial.parts.length) return;
  const deg = ((now - dial.top) / HOUR) * 360;
  const animate = !dial.muted && !reduceMotion.matches;
  const phase = animate ? -(now / 1000) * 2.4 : 0;
  const tracks = dial.tracks.children;
  const actives = dial.actives.children;
  dial.parts.forEach((p, i) => {
    const e = Math.min(p.d1, Math.max(p.d0, deg));
    const hasActive = e > p.d0 + 0.5;
    actives[i].setAttribute('d', hasActive ? wavyPath(p.d0, e, phase) : '');
    let t0 = hasActive ? e + GAP : p.d0;
    let t1 = p.full && hasActive ? 360 - GAP : p.d1;
    if (p.full && !hasActive) t1 = 360;
    tracks[i].setAttribute('d', t1 - t0 > 0.5 ? arcPath(t0, t1) : '');
  });
}

function renderDialFor(now, muted) {
  const top = S.startOfHour(now);
  const key = `${top}`;
  if (dialHourKey !== key) {
    dialHourKey = key;
    drawDialHour(top, S.blocksBetween(top, top + HOUR));
  }
  dial.top = top;
  dial.muted = muted;
  dial.svg.classList.toggle('muted', muted);
  if (muted || reduceMotion.matches) updateDial(now);
}

// La onda se mueve con requestAnimationFrame (solo con la pestaña visible)
let lastFrame = 0;
function frame(ts) {
  requestAnimationFrame(frame);
  if (dial.muted || reduceMotion.matches || ts - lastFrame < 33) return;
  lastFrame = ts;
  updateDial(Date.now());
}

/* ---------- textos del bloque ---------- */
function blockLabel(b) {
  if (b.type === 'focus') return `Enfoque, sesión ${b.sessionInCycle} de ${b.cycleSize}`;
  if (b.type === 'long') return b.lunch ? 'Recuperación larga: comida' : 'Recuperación larga';
  return S.LABELS[b.type];
}

function nextLine(b) {
  const nb = S.blockAt(b.end);
  return `Después: ${lowerFirst(blockLabel(nb))}, de ${hm(nb.start)} a ${hm(nb.end)}.`;
}

function renderClock(now) {
  const d = new Date(now);
  setText($('#clock'), hm(now));
  setText($('#today'), `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`);
}

function renderIdle(now) {
  document.body.dataset.mode = 'idle';
  const opt = S.startOptions(now);
  const b = opt.block;

  setText($('#mode-label'), blockLabel(b));
  setText($('#countdown'), mmss(b.end - now));
  setText($('#mode-sub'), b.type === 'focus' ? `Hasta las ${hm(b.end)}` : `El enfoque vuelve a las ${hm(b.end)}`);
  document.title = 'Música & Enfoque';
  setText($('#next-line'), nextLine(b));
  renderPips(b);
  $('#idle-controls').hidden = false;
  $('#run-controls').hidden = true;

  const next = $('#btn-next');
  if (opt.kind === 'now') {
    next.hidden = true;
    setText($('#idle-hint'), 'Es hora en punto: el enfoque empieza en cuanto presiones.');
  } else if (opt.kind === 'choose') {
    next.hidden = false;
    setText($('.label', next), `Esperar al enfoque de las ${hm(opt.nextFocus)}`);
    next.dataset.wait = opt.nextFocus;
    setText($('#idle-hint'), `El enfoque de las ${hm(b.start)} ya empezó. Si comienzas ahora, te quedan ${Math.ceil(opt.focusLeftMs / MIN)} min de enfoque.`);
  } else {
    next.hidden = true;
    const what = b.type === 'long' ? (b.lunch ? 'la recuperación larga de la comida' : 'una recuperación larga') : 'una recuperación de 10 min';
    setText($('#idle-hint'), `Estás en ${what}. Si comienzas ahora, suena la música de recuperación y el enfoque vuelve a las ${hm(opt.nextFocus)}.`);
  }

  renderDialFor(now, true);
  renderDay(now);
  renderStats();
}

function renderRun(b, now) {
  document.body.dataset.mode = b.type;
  $('#idle-controls').hidden = true;
  $('#run-controls').hidden = false;

  const label = blockLabel(b);
  const left = mmss(b.end - now);
  setText($('#mode-label'), label);
  setText($('#countdown'), left);
  let sub;
  if (b.type === 'waiting') sub = `Tu enfoque empieza a las ${hm(b.end)}`;
  else if (b.type === 'focus') sub = `Hasta las ${hm(b.end)}`;
  else sub = `El enfoque vuelve a las ${hm(b.end)}`;
  setText($('#mode-sub'), sub);
  document.title = `${left} ${label} · Música & Enfoque`;
  setText($('#next-line'), nextLine(b));
  renderPips(b);

  if (!document.hidden) {
    renderDialFor(now, b.type === 'waiting');
    renderDay(now);
    renderStats();
  }
}

function renderPips(b) {
  $('#cycle').hidden = false;
  setText($('#cycle-label'), b.cycleName);
  const items = [];
  for (let i = 1; i <= b.cycleSize; i++) {
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

/** Las 24 horas de hoy, agrupadas por bloque, con la hora actual marcada. */
const GROUP_OF = (h) => (h === 0 ? 'Medianoche' : S.PLAN[h].cycleName);

function hourRow(h) {
  let what;
  let note;
  let bar;
  if (h.role === 'long') {
    what = h.lunch ? `${icon('restaurant')}Recuperación larga: comida` : 'Recuperación larga';
    note = `${hm(h.start - 10 * MIN)}–${hm(h.end)}`;
    bar = '<i class="seg recovery" style="flex:60"><b></b></i>';
  } else {
    what = `Enfoque, sesión ${h.sessionInCycle} de ${h.cycleSize}`;
    const at50 = hm(h.start + 50 * MIN);
    const lunchNext = S.PLAN[(h.hour + 1) % 24].lunch;
    note = h.endsInLong ? `${at50} recuperación larga${lunchNext ? ' (comida)' : ''}` : `${at50} recuperación`;
    bar = '<i class="seg focus" style="flex:50"><b></b></i><i class="seg recovery" style="flex:10"><b></b></i>';
  }
  return `
    <li class="hr ${h.role}${h.role === 'long' && h.lunch ? ' lunch' : ''}" data-start="${h.start}" data-end="${h.end}" data-role="${h.role}">
      <span class="hr-time">${hm(h.start)}</span>
      <span class="hr-text"><span class="hr-what">${what}</span><span class="hr-note">${note}</span></span>
      <span class="hr-bar" aria-hidden="true">${bar}</span>
    </li>`;
}

function renderDay(now) {
  const list = $('#day');
  const key = dayKey(now);
  if (key !== dayRenderKey) {
    dayRenderKey = key;
    const groups = [];
    for (const h of S.dayHours(now)) {
      const name = GROUP_OF(h.hour);
      if (!groups.length || groups.at(-1).name !== name) groups.push({ name, hours: [] });
      groups.at(-1).hours.push(h);
    }
    list.innerHTML = groups
      .map((g) => {
        const sessions = g.hours.filter((h) => h.role === 'session').length;
        const count = sessions ? `<span>${sessions} ${sessions === 1 ? 'sesión' : 'sesiones'}</span>` : '';
        return `<li class="day-group"><h3>${g.name}${count}</h3><ol class="seg-list">${g.hours.map(hourRow).join('')}</ol></li>`;
      })
      .join('');
  }
  for (const li of list.querySelectorAll('.hr')) {
    const s = Number(li.dataset.start);
    const e = Number(li.dataset.end);
    const past = now >= e;
    const isNow = now >= s && now < e;
    li.classList.toggle('is-past', past);
    li.classList.toggle('is-now', isNow);
    const fills = li.querySelectorAll('.seg b');
    const m = past ? 60 : isNow ? (now - s) / MIN : 0;
    if (li.dataset.role === 'long') {
      fills[0].style.width = `${((m / 60) * 100).toFixed(2)}%`;
    } else {
      fills[0].style.width = `${((Math.min(m, 50) / 50) * 100).toFixed(2)}%`;
      fills[1].style.width = `${((Math.max(0, m - 50) / 10) * 100).toFixed(2)}%`;
    }
  }
}

/* ---------- racha y registro ---------- */
function renderGoalBar(fraction) {
  const svg = $('#goal-bar');
  const W = 300;
  const y = 8;
  const f = Math.max(0, Math.min(1, fraction));
  const end = f * W;
  const parts = [];
  if (end > 2) {
    // parte activa ondulada, como el indicador lineal de M3 Expressive
    const pts = [];
    for (let x = 4; x < end - 2; x += 2) {
      const taper = Math.min(1, (x - 4) / 12, (end - 2 - x) / 12);
      pts.push(`${x.toFixed(1)} ${(y + 3 * Math.max(0, taper) * Math.sin(x / 6)).toFixed(2)}`);
    }
    pts.push(`${(end - 2).toFixed(1)} ${y}`);
    parts.push(`<path class="g-active" d="M${pts.join('L')}" fill="none" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  const t0 = end > 2 ? end + 10 : 4;
  if (t0 < W - 4) parts.push(`<path class="g-track" d="M${t0.toFixed(1)} ${y}L${W - 4} ${y}" stroke-width="6" stroke-linecap="round"/>`);
  if (f < 1) parts.push(`<circle class="g-stop" cx="${W - 4}" cy="${y}" r="2"/>`);
  const html = parts.join('');
  if (svg.dataset.html !== html) {
    svg.innerHTML = html;
    svg.dataset.html = html;
  }
}

function showSnackbar(html) {
  const bar = $('#snackbar');
  bar.innerHTML = html;
  bar.hidden = false;
  clearTimeout(snackTimer);
  snackTimer = setTimeout(() => (bar.hidden = true), 6000);
}

const STATUS_ICON = {
  done: 'check',
  'done-shield': 'check',
  'today-done': 'check',
  protected: 'shield',
  broken: 'close',
};

function renderStreak(now, todayMin) {
  const today = dayKey(now);
  const st = computeStreak(days, today, todayMin, 14);

  // celebrar cuando hoy cruza la meta estando presente
  if (todayWasDone === false && st.todayDone) {
    showSnackbar(`${icon('local_fire_department', 'fill')}Meta de 4 horas cumplida. Tu racha va en ${st.streak} ${st.streak === 1 ? 'día' : 'días'}.`);
  }
  todayWasDone = st.todayDone;

  const cold = st.streak === 0;
  $('.streak-card').classList.toggle('cold', cold);
  $('.streak-card').classList.toggle('done', st.todayDone);
  setText($('#streak-n'), String(st.streak));
  setText($('#streak-unit'), st.streak === 1 ? 'día de racha' : 'días de racha');
  setText(
    $('#streak-today-text'),
    st.todayDone
      ? `Hoy: ${fmtMin(Math.round(todayMin))} de enfoque. Meta cumplida.`
      : `Hoy: ${fmtMin(Math.round(todayMin))} de 4 h. Te faltan ${fmtMin(Math.ceil(st.leftMin))}.`,
  );
  renderGoalBar(todayMin / GOAL_MIN);

  const slots = [];
  for (let i = 0; i < MAX_SHIELDS; i++) {
    const on = i < st.shields;
    slots.push(`<span class="slot${on ? ' on' : ''}" aria-hidden="true">${icon('shield', on ? 'fill' : '')}</span>`);
  }
  const slotsHTML = slots.join('');
  const slotsEl = $('#shield-slots');
  if (slotsEl.dataset.html !== slotsHTML) {
    slotsEl.innerHTML = slotsHTML;
    slotsEl.dataset.html = slotsHTML;
  }
  const shieldWord = st.shields === 1 ? 'protector' : 'protectores';
  let shieldText = `${st.shields} de ${MAX_SHIELDS} ${shieldWord}.`;
  if (st.daysToShield != null && !cold) shieldText += ` El siguiente en ${st.daysToShield} ${st.daysToShield === 1 ? 'día completo' : 'días completos'}.`;
  if (cold) shieldText += ' Completa 7 días seguidos para ganar uno.';
  setText($('#shield-text'), shieldText);

  // chip de la barra superior
  const chip = $('#streak-chip');
  chip.classList.toggle('cold', cold);
  setText($('#streak-chip-n'), String(st.streak));
  chip.setAttribute('aria-label', `Racha de ${st.streak} ${st.streak === 1 ? 'día' : 'días'}, ${st.shields} ${shieldWord}`);
  const chipShields = Array.from({ length: st.shields }, () => icon('shield', 'fill')).join('');
  const chipEl = $('#chip-shields');
  if (chipEl.dataset.html !== chipShields) {
    chipEl.innerHTML = chipShields;
    chipEl.dataset.html = chipShields;
  }

  // últimos 14 días
  const LABEL = {
    done: 'completo',
    'done-shield': 'completo, ganaste un protector',
    'today-done': 'hoy, completo',
    today: 'hoy, en curso',
    protected: 'protegido',
    broken: 'racha perdida',
    missed: 'sin completar',
    none: 'sin registro',
  };
  const daysHTML = st.history
    .map((h) => {
      const d = dateOf(h.key);
      const cls = h.status === 'today-done' ? 'done is-today' : h.status.startsWith('done') ? 'done' : h.status === 'today' ? 'today is-today' : h.status;
      const ic = STATUS_ICON[h.status] ? icon(STATUS_ICON[h.status], h.status === 'protected' ? 'fill' : '') : '';
      return `<li class="${cls}" title="${WEEKDAYS[d.getDay()]} ${d.getDate()}: ${fmtMin(Math.round(h.minutes))}"><span class="dot" aria-label="${WEEKDAYS[d.getDay()]} ${d.getDate()}, ${LABEL[h.status]}">${ic}</span>${WEEKDAYS[d.getDay()].charAt(0).toUpperCase()}</li>`;
    })
    .join('');
  const daysEl = $('#streak-days');
  if (daysEl.dataset.html !== daysHTML) {
    daysEl.innerHTML = daysHTML;
    daysEl.dataset.html = daysHTML;
  }
}

function renderStats(force = false) {
  const now = Date.now();
  if (!force && now - lastStats < 5000) return;
  lastStats = now;
  const today = dayKey(now);
  const cur = run?.current && dayKey(run.current.start) === today ? run.current : null;
  const already = cur ? log.find((e) => e.start === cur.start)?.minutes || 0 : 0;
  const inProgress = cur ? Math.max(0, cur.focusedMs / MIN - already) : 0;
  const todays = log.filter((e) => dayKey(e.start) === today).sort((a, b) => a.start - b.start);
  const todayMin = (days[today] || 0) + inProgress;
  setText($('#stat-today'), fmtMin(Math.round(todayMin)));
  setText($('#stat-sessions'), String(todays.filter((e) => e.complete).length));

  renderStreak(now, todayMin);

  // últimos 7 días, con la línea de la meta de 4 horas
  const week = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const k = keyOf(d);
    const min = Math.round((days[k] || 0) + (i === 0 ? inProgress : 0));
    week.push({ label: WEEKDAYS[d.getDay()], min, isToday: i === 0 });
  }
  const weekMin = week.reduce((s, d) => s + d.min, 0);
  setText($('#stat-week'), `${(weekMin / 60).toFixed(1).replace('.0', '')} h`);
  const max = Math.max(GOAL_MIN * 1.25, ...week.map((d) => d.min));
  const goalPct = ((GOAL_MIN / max) * 100).toFixed(1);
  const weekHTML = week
    .map((d) => `
      <div class="day${d.isToday ? ' today' : ''}${d.min >= GOAL_MIN ? ' goal' : ''}">
        <span class="day-val">${d.min ? d.min : ''}</span>
        <span class="day-bar"><i style="height:${((d.min / max) * 100).toFixed(1)}%"></i><span class="goal-line" style="bottom:${goalPct}%"></span></span>
        <span class="day-name">${d.label}</span>
      </div>`)
    .join('');
  const weekEl = $('#week');
  if (weekEl.dataset.html !== weekHTML) {
    weekEl.innerHTML = weekHTML;
    weekEl.dataset.html = weekHTML;
    weekEl.setAttribute('aria-label', `Minutos de enfoque por día, meta de 240: ${week.map((d) => `${d.label} ${d.min}`).join(', ')}`);
  }

  const items = todays.map((e) => `
    <li><span class="log-time">${hm(e.start)}</span><span>${e.size ? `Sesión ${e.session} de ${e.size}` : `Sesión ${e.session}`}</span><span class="log-min">${e.minutes} min</span><span class="log-state ${e.complete ? 'ok' : ''}">${e.complete ? 'Completa' : 'Parcial'}</span></li>`);
  if (inProgress >= 1) {
    items.push(`<li class="live"><span class="log-time">${hm(run.current.start)}</span><span>Sesión ${run.current.session} de ${run.current.size}</span><span class="log-min">${Math.floor(inProgress)} min</span><span class="log-state">En curso</span></li>`);
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
      ? `Sesión ${b.sessionInCycle} de ${b.cycleSize}, hasta las ${hm(b.end)}.`
      : `El enfoque vuelve a las ${hm(b.end)}.`;
  try {
    new Notification(blockLabel(b), { body, tag: 'musica-enfoque', icon: 'icons/icon-192.png', badge: 'icons/favicon-32.png', silent: true });
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

/* ---------- sincronización entre dispositivos ---------- */
let pushSettingsTimer = null;
let lastSyncAt = 0;
let syncState = syncConfigured ? 'loading' : 'off';
let syncDetail = '';
let syncUser = null;

function saveSettings() {
  store.saveSettings(settings);
  if (!sync.signedIn) return;
  clearTimeout(pushSettingsTimer);
  pushSettingsTimer = setTimeout(() => sync.pushSettings(settings, settings._updatedAt), 1200);
}

const dayEntries = (k) => log.filter((e) => dayKey(e.start) === k);

function pushDay(k) {
  if (!sync.signedIn) return;
  sync.pushDay(k, toRemoteMap(dayEntries(k)), days[k] || 0);
}

function onRemoteSettings(remote, remoteAt) {
  const localAt = settings._updatedAt || 0;
  if (!remote || remoteAt < localAt) {
    // La nube no tiene ajustes o los de aquí son más nuevos: se suben
    if (localAt > remoteAt) sync.pushSettings(settings, localAt || Date.now());
    return;
  }
  if (remoteAt === localAt) return;
  for (const mode of MODES) {
    if (!remote[mode]) continue;
    const before = settings[mode].playlist;
    Object.assign(settings[mode], remote[mode]);
    refreshCard(mode);
    if (settings[mode].playlist !== before) loadPlaylist(mode, settings[mode].playlist, false);
    players[mode].setVolume(settings[mode].music);
    players[mode].setShuffle(settings[mode].shuffle);
    if (activeMode() === mode && !previewTimer && run && !run.quiet && !audioPending) audio.setLayer(layerFor(mode), 1);
  }
  if (typeof remote.alarm === 'number') {
    settings.alarm = remote.alarm;
    const vol = $('#alarm-vol');
    vol.value = settings.alarm;
    paintRange(vol);
    $('#alarm-out').textContent = `${settings.alarm}%`;
    audio.setAlarmVolume(settings.alarm / 100);
  }
  if (remote.theme && remote.theme !== settings.theme) {
    settings.theme = remote.theme;
    applyTheme(settings.theme);
  }
  settings._updatedAt = remoteAt;
  store.saveSettings(settings, { touch: false });
}

function onRemoteDays(docs, { initial }) {
  let changed = false;
  const seen = new Set();
  for (const d of docs) {
    const k = d.day;
    seen.add(k);
    const local = dayEntries(k);
    const res = mergeSessions(local, d.sessions || {});
    if (res.localChanged) {
      for (let i = log.length - 1; i >= 0; i--) if (dayKey(log[i].start) === k) log.splice(i, 1);
      for (const [start, r] of Object.entries(res.merged)) log.push(fromRemote(start, r));
      changed = true;
    }
    const hasSessions = local.length || Object.keys(d.sessions || {}).length;
    const target = hasSessions ? res.minutes : Math.max(days[k] || 0, d.minutes || 0);
    if (target !== (days[k] || 0)) {
      days[k] = target;
      changed = true;
    }
    if (res.remoteNeedsPush) sync.pushDay(k, res.merged, target);
  }
  if (initial) {
    // Días que solo existen aquí: se suben
    for (const k of Object.keys(days)) {
      if (!seen.has(k) && days[k] > 0) sync.pushDay(k, toRemoteMap(dayEntries(k)), days[k]);
    }
  }
  if (changed) {
    log.sort((a, b) => a.start - b.start);
    store.saveLog(log);
    store.saveDays(days);
    renderStats(true);
  }
  lastSyncAt = Date.now();
  renderSync();
}

function renderSync() {
  const title = $('#sync-title');
  const detail = $('#sync-detail');
  const signIn = $('#btn-signin');
  const signOutBtn = $('#btn-signout');
  const account = $('#btn-account');
  const avatar = $('#sync-avatar');
  account.hidden = !syncConfigured;
  signIn.hidden = !syncConfigured || !!syncUser;
  signOutBtn.hidden = !syncUser;

  if (!syncConfigured) {
    setText(title, 'La sincronización aún no está conectada');
    setText(detail, 'Tus datos se guardan solo en este navegador.');
    avatar.innerHTML = icon('cloud_off');
    return;
  }
  if (!syncUser) {
    setText(title, 'Tus datos están solo en este navegador');
    setText(detail, syncState === 'error' && syncDetail ? syncDetail : 'Inicia sesión con Google para guardarlos en la nube y verlos igual en tu celular.');
    avatar.innerHTML = icon('cloud_off');
    account.innerHTML = icon('account_circle');
    account.setAttribute('aria-label', 'Iniciar sesión para sincronizar');
    account.title = 'Iniciar sesión para sincronizar';
    return;
  }
  const name = syncUser.displayName || syncUser.email || 'Tu cuenta';
  setText(title, syncUser.email ? `${name} (${syncUser.email})` : name);
  let text;
  if (syncState === 'error') text = syncDetail;
  else if (syncState === 'syncing') text = 'Sincronizando…';
  else text = `Sincronizado${lastSyncAt ? ` a las ${hm(lastSyncAt)}` : ''}. Tus ajustes, playlists, historial y racha se guardan en tu cuenta.`;
  setText(detail, text);
  const photo = syncUser.photoURL ? `<img src="${syncUser.photoURL}" alt="" referrerpolicy="no-referrer">` : icon('cloud_done');
  if (avatar.dataset.photo !== photo) {
    avatar.innerHTML = photo;
    avatar.dataset.photo = photo;
    account.innerHTML = photo;
  }
  account.setAttribute('aria-label', `Sincronizado con ${name}. Ver sincronización.`);
  account.title = `Sincronizado con ${name}`;
}

const sync = new Sync({
  onStatus: (state, detail) => {
    syncState = state;
    syncDetail = detail;
    if (state === 'synced') lastSyncAt = Date.now();
    renderSync();
  },
  onUser: (user) => {
    syncUser = user;
    renderSync();
  },
  onRemoteSettings,
  onRemoteDays,
});

function wireSync() {
  renderSync();
  const signIn = () => sync.signIn();
  $('#btn-signin').addEventListener('click', signIn);
  $('#btn-signout').addEventListener('click', () => sync.signOut());
  $('#btn-account').addEventListener('click', () => {
    if (syncUser) $('#h-sync').scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'center' });
    else signIn();
  });
  sync.init();
}

/* ---------- controles generales ---------- */
function armTwoStep(btn, label, confirmLabel, action) {
  let armed = null;
  const text = $('.label', btn);
  const reset = () => {
    armed = null;
    text.textContent = label;
    btn.classList.remove('confirm');
  };
  btn.addEventListener('click', () => {
    if (armed) {
      clearTimeout(armed);
      reset();
      action();
      return;
    }
    text.textContent = confirmLabel;
    btn.classList.add('confirm');
    armed = setTimeout(reset, 4000);
  });
}

function wireGlobal() {
  $('#btn-join').addEventListener('click', () => start(null));
  $('#btn-next').addEventListener('click', (e) => start(Number(e.currentTarget.dataset.wait)));
  armTwoStep($('#btn-stop'), 'Dejar de estar presente', 'Toca otra vez para confirmar', stop);
  armTwoStep($('#btn-clear'), 'Borrar historial', 'Toca otra vez: se borra también la racha', async () => {
    if (sync.signedIn) {
      const keys = new Set([...Object.keys(days), ...(await sync.remoteDayKeys().catch(() => []))]);
      await sync.deleteDays([...keys]);
    }
    log.splice(0, log.length);
    store.saveLog(log);
    for (const k of Object.keys(days)) delete days[k];
    store.saveDays(days);
    todayWasDone = null;
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

  // tema
  const order = ['system', 'light', 'dark'];
  $('#btn-theme').addEventListener('click', () => setTheme(order[(order.indexOf(settings.theme) + 1) % order.length]));
  document.querySelectorAll('[data-theme-opt]').forEach((b) => b.addEventListener('click', () => setTheme(b.dataset.themeOpt)));

  const vol = $('#alarm-vol');
  vol.value = settings.alarm;
  paintRange(vol);
  $('#alarm-out').textContent = `${settings.alarm}%`;
  vol.addEventListener('input', () => {
    settings.alarm = Number(vol.value);
    paintRange(vol);
    $('#alarm-out').textContent = `${settings.alarm}%`;
    audio.setAlarmVolume(settings.alarm / 100);
    saveSettings();
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
      saveSettings();
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
    saveSettings();
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
  requestAnimationFrame(frame);
}

/* ---------- arranque ---------- */
function init() {
  applyTheme(settings.theme);
  buildDial();
  buildCards();
  wireGlobal();
  if (run) {
    // Formato anterior (ciclo contado desde que se iniciaba): se conserva como presencia activa
    if (run.startedAt == null) run = { startedAt: run.anchor ?? Date.now(), waitUntil: null, quiet: !!run.quiet, current: null };
    if (run.waitUntil && Date.now() >= run.waitUntil) run.waitUntil = null;
    store.saveRun(run);
    // Cerrar un enfoque guardado que ya terminó mientras la pestaña estaba cerrada
    const b = S.blockAt(Date.now());
    if (run.current && run.current.start !== b.start) finalize();
    $('#resume-banner').hidden = false;
  }
  for (const mode of MODES) if (settings[mode].playlist) loadPlaylist(mode, settings[mode].playlist, false);
  renderStats(true);
  tick();
  startTicker();
  wireSync();
}

init();
