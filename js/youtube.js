/**
 * Reproductor de música de YouTube / YouTube Music con la IFrame Player API.
 * Acepta una playlist o un video suelto:
 *  - Playlist: se repite toda al terminar.
 *  - Video: se vuelve a reproducir desde el inicio cada vez que termina.
 * YouTube Music no se puede incrustar directamente, pero sus enlaces usan los mismos
 * identificadores (list=… para playlists, v=… para videos) que el reproductor de YouTube.
 */

let apiPromise = null;

function loadApi() {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT);
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = () => {
      apiPromise = null;
      reject(new Error('No se pudo cargar YouTube'));
    };
    document.head.append(s);
  });
  return apiPromise;
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const LIST_ID = /^[A-Za-z0-9_-]{2,}$/;
// Listas que no se pueden incrustar: privadas de la cuenta o mezclas automáticas
const PRIVATE_OR_MIX = /^(WL|LM|RD)/;

/**
 * Lee un enlace de YouTube o YouTube Music (o un ID suelto) y dice qué es.
 * @returns {{ type: 'playlist' | 'video', id: string } | null}
 *
 * Playlists: …/playlist?list=…, music.youtube.com/browse/VL…
 * Videos: …/watch?v=…, youtu.be/…, /shorts/…, /live/…, /embed/…
 * Si el enlace trae video y lista, gana la lista; salvo que la lista sea privada o una
 * mezcla automática (Me gusta, Ver más tarde, Mix), que no se pueden incrustar: entonces el video.
 */
export function parseSource(input) {
  const raw = (input || '').trim();
  if (!raw) return null;
  if (!/youtu\.?be|^https?:\/\/|\//i.test(raw)) {
    if (VIDEO_ID.test(raw)) return { type: 'video', id: raw };
    return LIST_ID.test(raw) ? { type: 'playlist', id: stripVL(raw) } : null;
  }
  let u;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\.|^m\./, '');
  let video = u.searchParams.get('v');
  if (host === 'youtu.be') video = u.pathname.split('/')[1] || null;
  const path = u.pathname.match(/^\/(shorts|live|embed|v)\/([A-Za-z0-9_-]{11})/);
  if (path) video = path[2];
  let list = u.searchParams.get('list');
  if (!list) {
    const m = u.pathname.match(/\/browse\/([A-Za-z0-9_-]+)/);
    if (m) list = m[1];
  }
  if (list) list = stripVL(list);
  if (video && !VIDEO_ID.test(video)) video = null;
  if (list && !LIST_ID.test(list)) list = null;
  if (list && !(video && PRIVATE_OR_MIX.test(list))) return { type: 'playlist', id: list };
  if (video) return { type: 'video', id: video };
  return null;
}

function stripVL(id) {
  return /^VL(PL|OLAK|RD|UU|FL)/.test(id) ? id.slice(2) : id;
}

/** Aviso para fuentes que nunca se pueden incrustar. */
export function sourceHint(src) {
  if (src.type !== 'playlist') return null;
  const id = src.id;
  if (id === 'LM') return '"Me gusta" es privada y no se puede incrustar. Guarda esas canciones en una playlist pública o no listada.';
  if (id === 'WL') return '"Ver más tarde" es privada. Usa una playlist pública o no listada.';
  if (id.length < 10) return 'Ese ID de playlist parece incompleto. Copia el enlace con Compartir.';
  return null;
}

const PLAYLIST_ERRORS = {
  2: 'YouTube no reconoce esa playlist. Revisa el enlace.',
  5: 'El reproductor no pudo cargar el video actual.',
  100: 'Un video de la playlist ya no existe o es privado.',
  101: 'Los videos de esta playlist no permiten reproducirse fuera de YouTube.',
  150: 'Los videos de esta playlist no permiten reproducirse fuera de YouTube.',
};
const VIDEO_ERRORS = {
  2: 'YouTube no reconoce ese video. Revisa el enlace.',
  5: 'El reproductor no pudo cargar ese video.',
  100: 'Ese video ya no existe o es privado.',
  101: 'Ese video no permite reproducirse fuera de YouTube. Prueba con otro.',
  150: 'Ese video no permite reproducirse fuera de YouTube. Prueba con otro.',
};
const COMMON_ERRORS = {
  153: 'YouTube rechazó el reproductor. Abre la app desde su dirección web (GitHub Pages), no como archivo local.',
};

const ENDED = 0;
const PLAYING = 1;
const BUFFERING = 3;
const CUED = 5;

export class MusicPlayer {
  constructor(mount, hooks = {}) {
    this.mount = mount;
    this.hooks = hooks;
    this.player = null;
    this.ready = false;
    this.src = null;
    this.wantPlay = false;
    this.volume = 60;
    this.shuffle = false;
    this.shuffled = false;
    this.skips = 0;
    this.fadeTimer = null;
    this.verifyTimer = null;
    this.loopTimer = null;
    this.priming = false;
    this.primeTimer = null;
  }

  get loaded() {
    return !!this.src;
  }

  get isVideo() {
    return this.src?.type === 'video';
  }

  /** Carga una playlist o un video ({ type, id }). */
  async load(src, { shuffle = false } = {}) {
    this.src = src;
    this.shuffle = shuffle;
    this.shuffled = false;
    this.skips = 0;
    const YT = await loadApi();
    if (this.player && this.ready) {
      this.#cue();
      this.#verify();
      return;
    }
    if (this.player) return; // ya se está creando; usará this.src al estar listo
    const el = document.createElement('div');
    this.mount.replaceChildren(el);
    const vars = { playsinline: 1, rel: 0, enablejsapi: 1 };
    if (src.type === 'playlist') Object.assign(vars, { listType: 'playlist', list: src.id });
    if (location.protocol.startsWith('http')) vars.origin = location.origin;
    const first = src;
    await new Promise((resolve) => {
      this.player = new YT.Player(el, {
        width: '100%',
        height: '100%',
        ...(src.type === 'video' ? { videoId: src.id } : {}),
        playerVars: vars,
        events: {
          onReady: () => {
            this.ready = true;
            this.player.setVolume(this.volume);
            this.player.setLoop(true);
            if (this.src !== first) this.#cue();
            this.#verify();
            if (this.wantPlay) this.play();
            resolve();
          },
          onStateChange: (e) => this.#onState(e.data),
          onError: (e) => this.#onError(e.data),
        },
      });
    });
  }

  #cue() {
    if (this.isVideo) this.player.cueVideoById(this.src.id);
    else this.player.cuePlaylist({ listType: 'playlist', list: this.src.id, index: 0 });
  }

  unload() {
    this.src = null;
    this.wantPlay = false;
    this.#cancelFade();
    clearTimeout(this.verifyTimer);
    clearTimeout(this.loopTimer);
    if (this.player) {
      try {
        this.player.destroy();
      } catch {
        /* nada */
      }
    }
    this.player = null;
    this.ready = false;
    this.mount.replaceChildren();
  }

  /** Comprueba que YouTube pudo leer la playlist o el video. */
  #verify(tries = 0) {
    clearTimeout(this.verifyTimer);
    if (!this.player || !this.src) return;
    if (this.isVideo) {
      const data = this.player.getVideoData?.();
      if (data?.video_id === this.src.id && (data.title || tries >= 4)) {
        this.hooks.onLoaded?.({ type: 'video', title: data.title || '' });
        return;
      }
    } else {
      const list = this.player.getPlaylist?.();
      if (list && list.length) {
        this.hooks.onLoaded?.({ type: 'playlist', count: list.length });
        return;
      }
    }
    if (tries >= 8) {
      this.hooks.onError?.(this.isVideo
        ? 'No pude leer ese video. Revisa que sea público o no listado.'
        : 'No pude leer esa playlist. Asegúrate de que sea pública o no listada.');
      return;
    }
    this.verifyTimer = setTimeout(() => this.#verify(tries + 1), 700);
  }

  #onState(s) {
    if (s === PLAYING && this.priming) {
      this.#endPrime();
      this.hooks.onState?.(s);
      return;
    }
    if (s === PLAYING && !this.wantPlay && !this.fadeTimer) {
      // Se le dio play desde el propio reproductor de YouTube
      this.wantPlay = true;
      this.hooks.onManualPlay?.();
    }
    if (s === PLAYING) {
      this.skips = 0;
      clearTimeout(this.loopTimer);
      if (!this.isVideo) {
        this.player.setLoop(true);
        if (this.shuffle && !this.shuffled) {
          this.shuffled = true;
          this.player.setShuffle(true);
        }
      }
      this.hooks.onTitle?.(this.player.getVideoData?.()?.title || '');
    }
    if (s === ENDED && this.wantPlay) this.#repeat();
    if (s === CUED && this.wantPlay) this.player.playVideo();
    this.hooks.onState?.(s);
  }

  /** Al terminar: un video vuelve a empezar; una playlist vuelve al inicio si YouTube no lo hizo solo. */
  #repeat() {
    clearTimeout(this.loopTimer);
    if (this.isVideo) {
      this.player.seekTo(0, true);
      this.player.playVideo();
      return;
    }
    this.loopTimer = setTimeout(() => {
      if (this.wantPlay && this.player?.getPlayerState() === ENDED) this.player.playVideoAt(0);
    }, 1500);
  }

  #onError(code) {
    if (!this.isVideo && (code === 100 || code === 101 || code === 150) && this.skips < 25) {
      this.skips++;
      this.player.nextVideo();
      return;
    }
    const table = this.isVideo ? VIDEO_ERRORS : PLAYLIST_ERRORS;
    this.hooks.onError?.(table[code] || COMMON_ERRORS[code] || `YouTube devolvió el error ${code}.`);
  }

  /**
   * "Despierta" el reproductor durante un toque del usuario: lo reproduce en silencio un
   * instante y lo pausa. Así los navegadores (sobre todo en celular) dejan que suene
   * después solo, cuando cambia el bloque.
   */
  prime() {
    if (!this.ready || this.playing || this.priming || this.wantPlay) return;
    this.priming = true;
    try {
      this.player.mute();
      this.player.playVideo();
    } catch {
      this.priming = false;
      return;
    }
    clearTimeout(this.primeTimer);
    this.primeTimer = setTimeout(() => this.#endPrime(), 1500);
  }

  #endPrime() {
    if (!this.priming) return;
    this.priming = false;
    clearTimeout(this.primeTimer);
    if (!this.wantPlay) this.player.pauseVideo();
    this.player.unMute();
    this.player.setVolume(this.volume);
  }

  play() {
    this.wantPlay = true;
    if (!this.ready) return;
    if (this.priming) {
      this.priming = false;
      clearTimeout(this.primeTimer);
      this.player.unMute();
    }
    this.#cancelFade();
    this.player.setVolume(this.volume);
    if (!this.isVideo && this.shuffle && !this.shuffled) {
      const n = this.player.getPlaylist?.()?.length || 0;
      this.shuffled = true;
      this.player.setShuffle(true);
      if (n > 1) {
        this.player.playVideoAt(Math.floor(Math.random() * n));
        return;
      }
    }
    if (this.player.getPlayerState() === ENDED && this.isVideo) this.player.seekTo(0, true);
    this.player.playVideo();
  }

  pause() {
    this.wantPlay = false;
    this.#cancelFade();
    clearTimeout(this.loopTimer);
    if (this.priming) this.#endPrime();
    if (this.ready) this.player.pauseVideo();
  }

  /** Baja el volumen poco a poco y pausa. Con la pestaña oculta pausa de inmediato. */
  fadeOutPause(ms = 1500) {
    this.wantPlay = false;
    clearTimeout(this.loopTimer);
    if (!this.ready || this.priming) return;
    const st = this.player.getPlayerState();
    if ((st !== PLAYING && st !== BUFFERING) || ms <= 0 || document.hidden) {
      this.#cancelFade();
      this.player.pauseVideo();
      return;
    }
    const from = this.player.getVolume();
    const steps = 15;
    let i = 0;
    this.#cancelFade();
    this.fadeTimer = setInterval(() => {
      i++;
      this.player.setVolume(Math.round(from * (1 - i / steps)));
      if (i >= steps) {
        this.#cancelFade();
        this.player.pauseVideo();
        this.player.setVolume(this.volume);
      }
    }, ms / steps);
  }

  #cancelFade() {
    if (this.fadeTimer) clearInterval(this.fadeTimer);
    this.fadeTimer = null;
  }

  get playing() {
    if (!this.ready) return false;
    const st = this.player.getPlayerState();
    return st === PLAYING || st === BUFFERING;
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  next() {
    if (this.ready && !this.isVideo) this.player.nextVideo();
  }

  prev() {
    if (!this.ready) return;
    if (this.isVideo) this.player.seekTo(0, true);
    else this.player.previousVideo();
  }

  setVolume(v) {
    this.volume = v;
    if (this.ready && !this.fadeTimer) this.player.setVolume(v);
  }

  setShuffle(on) {
    this.shuffle = on;
    this.shuffled = on;
    if (this.ready && !this.isVideo) this.player.setShuffle(on);
  }
}
