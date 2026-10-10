/**
 * Reproductor de playlists de YouTube / YouTube Music con la IFrame Player API.
 * YouTube Music no se puede incrustar directamente, pero sus playlists comparten
 * el mismo identificador (list=…) y se reproducen con el reproductor de YouTube.
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

/**
 * Extrae el ID de playlist de un enlace de YouTube Music o YouTube, o de un ID suelto.
 * Acepta: music.youtube.com/playlist?list=…, youtube.com/playlist?list=…,
 * watch?v=…&list=…, music.youtube.com/browse/VL…
 */
export function parsePlaylistId(input) {
  const raw = (input || '').trim();
  if (!raw) return null;
  let id = null;
  if (/youtu\.?be|^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      id = u.searchParams.get('list');
      if (!id) {
        const m = u.pathname.match(/\/browse\/([A-Za-z0-9_-]+)/);
        if (m) id = m[1];
      }
    } catch {
      return null;
    }
  } else {
    id = raw;
  }
  if (!id) return null;
  if (/^VL(PL|OLAK|RD|UU|FL)/.test(id)) id = id.slice(2);
  if (!/^[A-Za-z0-9_-]{2,}$/.test(id)) return null;
  return id;
}

/** Listas que nunca se pueden incrustar porque son privadas de la cuenta. */
export function playlistHint(id) {
  if (id === 'LM') {
    return '"Me gusta" es privada y no se puede incrustar. Guarda esas canciones en una playlist pública o no listada.';
  }
  if (id === 'WL') {
    return '"Ver más tarde" es privada. Usa una playlist pública o no listada.';
  }
  if (id.length < 10) return 'Ese ID de playlist parece incompleto. Copia el enlace con Compartir.';
  return null;
}

const ERRORS = {
  2: 'YouTube no reconoce esa playlist. Revisa el enlace.',
  5: 'El reproductor no pudo cargar el video actual.',
  100: 'Un video de la playlist ya no existe o es privado.',
  101: 'Los videos de esta playlist no permiten reproducirse fuera de YouTube.',
  150: 'Los videos de esta playlist no permiten reproducirse fuera de YouTube.',
  153: 'YouTube rechazó el reproductor. Abre la app desde su dirección web (GitHub Pages), no como archivo local.',
};

const PLAYING = 1;
const BUFFERING = 3;
const CUED = 5;

export class PlaylistPlayer {
  constructor(mount, hooks = {}) {
    this.mount = mount;
    this.hooks = hooks;
    this.player = null;
    this.ready = false;
    this.listId = null;
    this.wantPlay = false;
    this.volume = 60;
    this.shuffle = false;
    this.shuffled = false;
    this.skips = 0;
    this.fadeTimer = null;
    this.verifyTimer = null;
  }

  get loaded() {
    return !!this.listId;
  }

  async load(listId, { shuffle = false } = {}) {
    this.listId = listId;
    this.shuffle = shuffle;
    this.shuffled = false;
    this.skips = 0;
    const YT = await loadApi();
    if (this.player && this.ready) {
      this.player.cuePlaylist({ listType: 'playlist', list: listId, index: 0 });
      this.#verify();
      return;
    }
    if (this.player) return; // ya se está creando; usará this.listId al estar listo
    const el = document.createElement('div');
    this.mount.replaceChildren(el);
    const vars = { listType: 'playlist', list: listId, playsinline: 1, rel: 0, enablejsapi: 1 };
    if (location.protocol.startsWith('http')) vars.origin = location.origin;
    await new Promise((resolve) => {
      this.player = new YT.Player(el, {
        width: '100%',
        height: '100%',
        playerVars: vars,
        events: {
          onReady: () => {
            this.ready = true;
            this.player.setVolume(this.volume);
            this.player.setLoop(true);
            if (this.listId !== listId) this.player.cuePlaylist({ listType: 'playlist', list: this.listId });
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

  unload() {
    this.listId = null;
    this.wantPlay = false;
    this.#cancelFade();
    clearTimeout(this.verifyTimer);
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

  /** Comprueba que YouTube pudo leer la lista (las privadas devuelven vacío). */
  #verify(tries = 0) {
    clearTimeout(this.verifyTimer);
    const list = this.player?.getPlaylist?.();
    if (list && list.length) {
      this.hooks.onLoaded?.(list.length);
      return;
    }
    if (tries >= 8) {
      this.hooks.onError?.('No pude leer esa playlist. Asegúrate de que sea pública o no listada.');
      return;
    }
    this.verifyTimer = setTimeout(() => this.#verify(tries + 1), 700);
  }

  #onState(s) {
    if (s === PLAYING) {
      this.skips = 0;
      this.player.setLoop(true);
      if (this.shuffle && !this.shuffled) {
        this.shuffled = true;
        this.player.setShuffle(true);
      }
      this.hooks.onTitle?.(this.player.getVideoData?.()?.title || '');
    }
    if (s === CUED && this.wantPlay) this.player.playVideo();
    this.hooks.onState?.(s);
  }

  #onError(code) {
    if ((code === 100 || code === 101 || code === 150) && this.skips < 25) {
      this.skips++;
      this.player.nextVideo();
      return;
    }
    this.hooks.onError?.(ERRORS[code] || `YouTube devolvió el error ${code}.`);
  }

  play() {
    this.wantPlay = true;
    if (!this.ready) return;
    this.#cancelFade();
    this.player.setVolume(this.volume);
    if (this.shuffle && !this.shuffled) {
      const n = this.player.getPlaylist?.()?.length || 0;
      this.shuffled = true;
      this.player.setShuffle(true);
      if (n > 1) {
        this.player.playVideoAt(Math.floor(Math.random() * n));
        return;
      }
    }
    this.player.playVideo();
  }

  pause() {
    this.wantPlay = false;
    this.#cancelFade();
    if (this.ready) this.player.pauseVideo();
  }

  /** Baja el volumen poco a poco y pausa. Con la pestaña oculta pausa de inmediato. */
  fadeOutPause(ms = 1500) {
    this.wantPlay = false;
    if (!this.ready) return;
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
    if (this.ready) this.player.nextVideo();
  }

  prev() {
    if (this.ready) this.player.previousVideo();
  }

  setVolume(v) {
    this.volume = v;
    if (this.ready && !this.fadeTimer) this.player.setVolume(v);
  }

  setShuffle(on) {
    this.shuffle = on;
    this.shuffled = on;
    if (this.ready) this.player.setShuffle(on);
  }
}
