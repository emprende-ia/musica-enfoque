/**
 * Unión de sesiones entre dispositivos.
 * Cada sesión se identifica por la hora en que empezó su enfoque, así que el mismo
 * bloque registrado en la computadora y en el celular cuenta una sola vez: gana el
 * registro con más minutos.
 *
 * Formato en la nube (compacto): { s: sesión, z: tamaño del ciclo, m: minutos, c: completa }
 */
export const toRemote = (e) => ({ s: e.session, z: e.size ?? null, m: e.minutes, c: !!e.complete });

export const fromRemote = (start, r) => {
  const e = { start: Number(start), session: r.s, minutes: r.m, complete: !!r.c };
  if (r.z != null) e.size = r.z;
  return e;
};

/** Sesiones locales de un día → mapa para la nube. */
export function toRemoteMap(localList) {
  const map = {};
  for (const e of localList) map[String(e.start)] = toRemote(e);
  return map;
}

/**
 * Une las sesiones de un día.
 * @returns {{ merged: Record<string, object>, minutes: number, localChanged: boolean, remoteNeedsPush: boolean }}
 */
export function mergeSessions(localList, remoteMap = {}) {
  const merged = toRemoteMap(localList);
  let localChanged = false;
  let remoteNeedsPush = false;
  for (const [start, r] of Object.entries(remoteMap || {})) {
    const l = merged[start];
    if (!l || r.m > l.m) {
      merged[start] = r;
      localChanged = true;
    } else if (l.m > r.m) {
      remoteNeedsPush = true;
    }
  }
  for (const start of Object.keys(merged)) if (!remoteMap || !(start in remoteMap)) remoteNeedsPush = true;
  const minutes = Object.values(merged).reduce((sum, x) => sum + (x.m || 0), 0);
  return { merged, minutes, localChanged, remoteNeedsPush };
}
