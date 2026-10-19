/**
 * Sincronización opcional con Firebase (inicio de sesión con Google + Firestore).
 *
 * Datos en la nube, por persona:
 *   users/{uid}               → { settings, settingsUpdatedAt, presence }
 *   users/{uid}/days/{día}    → { day, minutes, sessions: { [inicio]: { s, z, m, c } } }
 *
 * Sin configuración (firebase-config.js en null) la app funciona solo con este navegador.
 */
import { firebaseConfig } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/12.19.0';
const LIVE_DAYS = 14; // días que se escuchan en vivo; el resto se lee una vez al iniciar sesión

export const syncConfigured = !!(firebaseConfig && firebaseConfig.apiKey && firebaseConfig.projectId);

/** Ajustes que se sincronizan (los permisos del navegador se quedan en cada dispositivo). */
export const SYNCED_SETTINGS = ['focus', 'recovery', 'alarm', 'theme', 'schedule'];

// Firestore combina mapas al guardar con merge; los días especiales van como lista
// para que quitar uno también se refleje en los demás dispositivos.
const scheduleOut = (s) => ({ base: s.base, days: Object.entries(s.days || {}).map(([d, p]) => ({ d, p })) });
export const scheduleIn = (s) => (s ? { base: s.base, days: Object.fromEntries((Array.isArray(s.days) ? s.days : []).map((x) => [x.d, x.p])) } : null);

export class Sync {
  constructor(hooks = {}) {
    this.hooks = hooks;
    this.fb = null;
    this.user = null;
    this.unsubs = [];
    this.loading = null;
  }

  get signedIn() {
    return !!this.user;
  }

  #status(state, detail = '') {
    this.hooks.onStatus?.(state, detail);
  }

  async #load() {
    if (this.fb) return this.fb;
    if (!this.loading) {
      this.loading = Promise.all([
        import(`${SDK}/firebase-app.js`),
        import(`${SDK}/firebase-auth.js`),
        import(`${SDK}/firebase-firestore.js`),
      ]).then(([appM, A, F]) => {
        const app = appM.initializeApp(firebaseConfig);
        this.fb = { app, A, F, auth: A.getAuth(app), db: F.getFirestore(app) };
        return this.fb;
      });
    }
    return this.loading;
  }

  async init() {
    if (!syncConfigured) {
      this.#status('off');
      return;
    }
    try {
      const { A, auth } = await this.#load();
      A.getRedirectResult(auth).catch((e) => this.#status('error', explain(e)));
      A.onAuthStateChanged(auth, (u) => this.#onAuth(u));
    } catch (e) {
      this.#status('error', 'No se pudo cargar el servicio de sincronización. Revisa tu conexión.');
    }
  }

  /** Si el SDK ya cargó, abre la ventana de Google en el mismo toque (si no, el navegador la bloquea). */
  signIn() {
    if (this.fb) return this.#popup();
    return this.#load().then(() => this.#popup());
  }

  async #popup() {
    const { A, auth } = this.fb;
    const provider = new A.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await A.signInWithPopup(auth, provider);
    } catch (e) {
      if (e?.code === 'auth/popup-blocked' || e?.code === 'auth/operation-not-supported-in-this-environment') {
        await A.signInWithRedirect(auth, provider);
      } else if (e?.code !== 'auth/popup-closed-by-user' && e?.code !== 'auth/cancelled-popup-request') {
        this.#status('error', explain(e));
      }
    }
  }

  async signOut() {
    const { A, auth } = await this.#load();
    await A.signOut(auth);
  }

  #ref(...path) {
    const { F, db } = this.fb;
    return F.doc(db, 'users', this.user.uid, ...path);
  }

  #stop() {
    for (const u of this.unsubs) u();
    this.unsubs = [];
  }

  async #onAuth(user) {
    this.#stop();
    this.user = user || null;
    this.hooks.onUser?.(this.user);
    if (!user) {
      this.#status('signed-out');
      return;
    }
    const { F, db } = this.fb;
    this.#status('syncing');
    try {
      const userRef = this.#ref();
      const daysCol = F.collection(db, 'users', user.uid, 'days');

      // 1) Todo el historial, una vez
      const snap = await F.getDocs(daysCol);
      const remoteDays = snap.docs.map((d) => ({ day: d.id, ...d.data() }));
      this.hooks.onRemoteDays?.(remoteDays, { initial: true });

      // 2) Ajustes y días recientes, en vivo
      this.unsubs.push(
        F.onSnapshot(userRef, (d) => {
          const data = d.exists() ? d.data() : {};
          this.hooks.onRemoteSettings?.(data.settings || null, data.settingsUpdatedAt || 0);
          this.hooks.onRemotePresence?.(data.presence || null);
        }, (e) => this.#status('error', explain(e))),
      );
      const from = new Date();
      from.setDate(from.getDate() - LIVE_DAYS);
      const fromKey = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`;
      this.unsubs.push(
        F.onSnapshot(F.query(daysCol, F.where('day', '>=', fromKey)), (q) => {
          const changed = q.docChanges().filter((c) => c.type !== 'removed').map((c) => ({ day: c.doc.id, ...c.doc.data() }));
          if (changed.length) this.hooks.onRemoteDays?.(changed, { initial: false });
          if (!q.metadata.hasPendingWrites) this.#status('synced');
        }, (e) => this.#status('error', explain(e))),
      );
    } catch (e) {
      this.#status('error', explain(e));
    }
  }

  async pushSettings(settings, updatedAt) {
    if (!this.user) return;
    const { F } = this.fb;
    const data = {};
    for (const k of SYNCED_SETTINGS) if (settings[k] !== undefined) data[k] = settings[k];
    if (data.schedule) data.schedule = scheduleOut(data.schedule);
    try {
      await F.setDoc(this.#ref(), { settings: data, settingsUpdatedAt: updatedAt, updatedAt: F.serverTimestamp() }, { merge: true });
      this.#status('synced');
    } catch (e) {
      this.#status('error', explain(e));
    }
  }

  /** Presencia compartida: comenzar o dejar de estar presente se refleja en todos los dispositivos. */
  async pushPresence(presence) {
    if (!this.user) return;
    const { F } = this.fb;
    try {
      await F.setDoc(this.#ref(), { presence, updatedAt: F.serverTimestamp() }, { merge: true });
      this.#status('synced');
    } catch (e) {
      this.#status('error', explain(e));
    }
  }

  async pushDay(day, sessions, minutes) {
    if (!this.user) return;
    const { F } = this.fb;
    try {
      await F.setDoc(this.#ref('days', day), { day, minutes, sessions, updatedAt: F.serverTimestamp() }, { merge: true });
      this.#status('synced');
    } catch (e) {
      this.#status('error', explain(e));
    }
  }

  /** Borra en la nube los días indicados (para "Borrar historial"). */
  async deleteDays(days) {
    if (!this.user || !days.length) return;
    const { F, db } = this.fb;
    try {
      for (let i = 0; i < days.length; i += 400) {
        const batch = F.writeBatch(db);
        for (const day of days.slice(i, i + 400)) batch.delete(this.#ref('days', day));
        await batch.commit();
      }
      this.#status('synced');
    } catch (e) {
      this.#status('error', explain(e));
    }
  }

  /** Lista de días guardados en la nube (para borrar también los que no están aquí). */
  async remoteDayKeys() {
    if (!this.user) return [];
    const { F, db } = this.fb;
    const snap = await F.getDocs(F.collection(db, 'users', this.user.uid, 'days'));
    return snap.docs.map((d) => d.id);
  }
}

function explain(e) {
  const code = e?.code || '';
  if (code === 'auth/unauthorized-domain') return 'Este dominio no está autorizado en Firebase. Agrégalo en Authentication → Settings → Authorized domains.';
  if (code === 'auth/operation-not-allowed') return 'El inicio de sesión con Google no está activado en Firebase.';
  if (code === 'auth/network-request-failed') return 'Sin conexión. Se sincronizará al volver la conexión.';
  if (code === 'permission-denied') return 'Firestore rechazó el acceso. Revisa que las reglas estén publicadas.';
  if (code === 'unavailable') return 'Sin conexión. Los cambios se guardan aquí y se suben al volver la conexión.';
  return e?.message ? `Error de sincronización: ${e.message}` : 'Error de sincronización.';
}
