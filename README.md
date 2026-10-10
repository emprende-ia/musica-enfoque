# Música & Enfoque

App web para trabajar en sesiones fijas al reloj, con tu música de YouTube Music y tonos binaurales para cada momento. Funciona como sitio estático en GitHub Pages: no necesita servidor ni cuenta.

## Horario fijo de 24 horas

Es el mismo todos los días y no se puede cambiar desde la app.

- **Enfoque:** 50 min. Siempre empieza a la hora en punto (:00).
- **Recuperación:** 10 min. Siempre empieza a los :50.
- **Sesión:** 1 hora.
- **Cada 4 sesiones, recuperación larga de 70 min:** empieza a los :50 de la última sesión y termina en punto.
- **La comida es a las 14:00:** la recuperación larga de 13:50 a 15:00 la cubre. Las demás quedan cada 5 horas a partir de ahí.

| Hora | Bloque |
|---|---|
| 0:00 – 1:00 | Recuperación larga (empezó a las 23:50) |
| 1:00, 2:00, 3:00 | Madrugada: 3 sesiones |
| 3:50 – 5:00 | Recuperación larga |
| 5:00, 6:00, 7:00, 8:00 | Mañana: 4 sesiones |
| 8:50 – 10:00 | Recuperación larga |
| 10:00, 11:00, 12:00, 13:00 | Mediodía: 4 sesiones |
| 13:50 – 15:00 | Recuperación larga: comida |
| 15:00, 16:00, 17:00, 18:00 | Tarde: 4 sesiones |
| 18:50 – 20:00 | Recuperación larga |
| 20:00, 21:00, 22:00, 23:00 | Noche: 4 sesiones |
| 23:50 – 1:00 | Recuperación larga |

Las 24 horas no se dividen exacto en ciclos de 5 horas, así que la madrugada es el único bloque de 3 sesiones. En total son 19 sesiones al día.

**Estar presente:** la app sigue el reloj todo el tiempo. "Comenzar a estar presente" activa la música, los binaurales, las alarmas y el registro en el bloque que toca. Si el enfoque ya empezó, puedes entrar con el tiempo que queda o esperar al siguiente enfoque. "Dejar de estar presente" lo apaga todo y guarda el tiempo ya contado.

## Qué incluye

- Dial de la hora actual: enfoque y recuperación marcados en el reloj, con el avance en vivo.
- Las 24 horas del día en una lista, con la hora actual marcada.
- Una playlist de YouTube Music para enfoque y otra para recuperación. Cada una sigue donde se quedó al volver a su bloque.
- Tono binaural y ruido marrón por modo, con varias frecuencias.
- Alarmas distintas: enfoque (campanas ascendentes), recuperación (descendentes) y recuperación larga (gong).
- Opción "Solo alarmas" para estar presente sin música ni binaurales.
- Registro: minutos de enfoque de hoy, sesiones completas (45 min o más) y los últimos 7 días.
- Notificaciones opcionales y opción para mantener la pantalla encendida.

## Publicar en GitHub Pages

### Desde la web de GitHub

1. Crea un repositorio nuevo (por ejemplo `musica-enfoque`). Puede ser público.
2. Sube todos los archivos de esta carpeta, incluido `.nojekyll`.
3. Ve a **Settings → Pages**.
4. En **Build and deployment**, elige **Deploy from a branch**, rama `main`, carpeta `/ (root)` y guarda.
5. En uno o dos minutos la app queda en `https://TU-USUARIO.github.io/musica-enfoque/`.

### Desde la terminal

```bash
cd musica-enfoque
git init
git add .
git commit -m "Música & Enfoque"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/musica-enfoque.git
git push -u origin main
```

Después activa Pages como en el paso 3 y 4.

## Cómo copiar el enlace de una playlist de YouTube Music

1. Abre la playlist en YouTube Music (web o app).
2. Toca **Compartir → Copiar vínculo**.
3. Pégalo en la tarjeta de Enfoque o de Recuperación y toca **Cargar**.

Sirven enlaces como `music.youtube.com/playlist?list=…`, `youtube.com/playlist?list=…` o el ID suelto.

**Límites de YouTube:**

- La playlist debe ser **pública o no listada**. "Me gusta" y las privadas no se pueden incrustar.
- Si un video no permite reproducirse fuera de YouTube, la app salta al siguiente.
- La música necesita una cuenta de YouTube normal; los anuncios dependen de tu cuenta y no los controla la app.

## Para que las alarmas suenen a tiempo

- Deja la pestaña abierta. Puede estar en segundo plano: el reloj corre en un worker y las alarmas se programan en el motor de audio.
- Los navegadores exigen un toque antes de reproducir sonido. Por eso, si recargas la página mientras estás presente, aparece **Activar sonido**.
- En iPhone y iPad, Safari pausa el audio con la pantalla bloqueada. Usa "Mantener la pantalla encendida".

## Binaurales

Usa audífonos: cada oído recibe un tono distinto y la diferencia crea el pulso. El efecto varía entre personas. Empieza con volumen bajo.

## Desarrollo local

Los módulos de JavaScript no cargan si abres `index.html` directo como archivo. Levanta un servidor:

```bash
python3 -m http.server 8080
# abre http://localhost:8080
```

Pruebas del horario (Node 18 o superior):

```bash
npm test
```

## Estructura

```
index.html            Página
css/styles.css        Estilos
js/schedule.js        Reglas del horario (lógica pura, con pruebas)
js/audio.js           Binaurales, ruido marrón y alarmas (Web Audio)
js/youtube.js         Reproductor de playlists (YouTube IFrame API)
js/store.js           Ajustes, ciclo e historial en localStorage
js/tick-worker.js     Reloj en segundo plano
js/app.js             Interfaz y flujo del ciclo
tests/                Pruebas del horario
```

Tus ajustes e historial se guardan solo en tu navegador.
