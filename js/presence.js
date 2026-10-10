/**
 * Presencia compartida entre dispositivos.
 *
 * En la nube (users/{uid}.presence):
 *   { active, startedAt, waitUntil, quiet, soundDevice, v, by, updatedAt }
 *
 * Los cambios se ordenan por versión (v), no por la hora de cada dispositivo,
 * así una diferencia de reloj entre el celular y la computadora no hace perder cambios.
 * Cada cambio local usa la versión siguiente a la última vista; si dos dispositivos
 * cambian a la vez con la misma versión, gana el de identificador mayor (y ambos
 * terminan iguales).
 *
 * El sonido suena solo en `soundDevice`; los demás dispositivos muestran el reloj,
 * cuentan el tiempo y quedan en silencio.
 */

/** Estado local → formato de la nube. */
export function toPresence(run, version, deviceId, updatedAt = Date.now()) {
  const base = { v: version, by: deviceId, updatedAt };
  if (!run) return { ...base, active: false, startedAt: null, waitUntil: null, quiet: false, soundDevice: null };
  return {
    ...base,
    active: true,
    startedAt: run.startedAt,
    waitUntil: run.waitUntil || null,
    quiet: !!run.quiet,
    soundDevice: run.soundDevice || null,
  };
}

/**
 * Decide qué hacer con la presencia que llegó de la nube.
 * @param local {{ v: number, by: string }} última versión aplicada aquí
 * @returns {'ignore'|'push'|'start'|'update'|'stop'}
 *   push   → lo de aquí es más nuevo: subirlo
 *   start  → empezar a estar presente aquí
 *   update → ya estaba presente; actualizar (solo alarmas, espera, dispositivo con sonido)
 *   stop   → dejar de estar presente aquí
 */
export function reconcile(localRun, local, remote) {
  const lv = local?.v || 0;
  const lby = local?.by || '';
  if (!remote || typeof remote.v !== 'number') return lv > 0 || localRun ? 'push' : 'ignore';
  const rby = remote.by || '';
  const remoteWins = remote.v > lv || (remote.v === lv && rby > lby);
  if (!remoteWins) return remote.v === lv && rby === lby ? 'ignore' : 'push';
  if (remote.active) return localRun ? 'update' : 'start';
  return localRun ? 'stop' : 'ignore';
}

/** ¿Debe sonar en este dispositivo? */
export function soundHere(run, deviceId, signedIn) {
  if (!run) return false;
  if (!signedIn || !run.soundDevice) return true;
  return run.soundDevice === deviceId;
}
