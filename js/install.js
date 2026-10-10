/**
 * Instalar la app (PWA).
 *  - Android y navegadores con Chromium: botón "Instalar" con el aviso del sistema.
 *  - iPhone y iPad: Safari no tiene botón de instalar; se muestran los pasos.
 *  - Ya instalada: no se muestra nada.
 */
const DISMISS_KEY = 'mye.installDismissed';
const DISMISS_DAYS = 14;

let deferred = null;

export const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches ||
  matchMedia('(display-mode: fullscreen)').matches ||
  navigator.standalone === true;

const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const isMobile = () => matchMedia('(pointer: coarse)').matches;

function dismissedRecently() {
  try {
    const t = Number(localStorage.getItem(DISMISS_KEY));
    return !!t && Date.now() - t < DISMISS_DAYS * 86_400_000;
  } catch {
    return false;
  }
}

export function initInstall({ icon, onInstalled }) {
  const $ = (s) => document.querySelector(s);
  const banner = $('#install-banner');
  const detail = $('#install-detail');
  const btn = $('#btn-install');
  const later = $('#btn-install-later');
  const status = $('#install-status');
  const btn2 = $('#btn-install-2');

  function render() {
    if (isStandalone()) {
      banner.hidden = true;
      btn2.hidden = true;
      status.textContent = 'Ya la estás usando como app.';
      return;
    }
    const canPrompt = !!deferred;
    let text;
    if (canPrompt) text = 'Ábrela desde tu pantalla de inicio, a pantalla completa y sin la barra del navegador.';
    else if (isIOS()) text = `Toca ${icon('ios_share')} <b>Compartir</b> y luego ${icon('add_box')} <b>Agregar a inicio</b>.`;
    else text = `Abre el menú ${icon('more_vert')} del navegador y toca <b>Instalar app</b> o <b>Agregar a la pantalla principal</b>.`;
    detail.innerHTML = text;
    status.innerHTML = text;
    btn.hidden = !canPrompt;
    btn2.hidden = !canPrompt;
    later.querySelector('.label').textContent = canPrompt ? 'Ahora no' : 'Entendido';
    banner.hidden = !(isMobile() && !dismissedRecently());
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // en lugar de la barra del navegador, se usa el aviso propio
    deferred = e;
    render();
  });

  window.addEventListener('appinstalled', () => {
    deferred = null;
    banner.hidden = true;
    onInstalled?.();
    render();
  });

  async function install() {
    if (!deferred) return;
    const ev = deferred;
    deferred = null;
    ev.prompt();
    try {
      await ev.userChoice;
    } catch {
      /* nada */
    }
    render();
  }

  btn.addEventListener('click', install);
  btn2.addEventListener('click', install);
  later.addEventListener('click', () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* nada */
    }
    banner.hidden = true;
  });
  matchMedia('(display-mode: standalone)').addEventListener?.('change', render);
  render();
}

/** Registra el service worker (necesario para instalar y para abrir sin conexión). */
export function registerServiceWorker() {
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (!('serviceWorker' in navigator) || (location.protocol !== 'https:' && !local)) return;
  const register = () => navigator.serviceWorker.register('sw.js').catch(() => {});
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register);
}
