# Música & Enfoque

App web para trabajar en sesiones fijas al reloj, con tu música de YouTube Music y tonos binaurales para cada momento. Funciona como sitio estático en GitHub Pages: no necesita servidor ni cuenta.

## Reglas del horario (fijas)

- **Enfoque:** 50 min. Siempre empieza a la hora en punto (:00).
- **Recuperación:** 10 min. Siempre empieza a los :50.
- **Sesión:** 1 hora.
- **Cada 4 sesiones, recuperación larga:** empieza a los :50 de la sesión 4 y termina en la hora en punto siguiente a la próxima (70 min). La sesión 5 empieza en punto.

Un ciclo ocupa 5 horas de reloj. Ejemplo empezando a las 8:00:

| Hora | Bloque | Duración |
|---|---|---|
| 8:00 – 8:50 | Enfoque, sesión 1 | 50 min |
| 8:50 – 9:00 | Recuperación | 10 min |
| 9:00 – 9:50 | Enfoque, sesión 2 | 50 min |
| 9:50 – 10:00 | Recuperación | 10 min |
| 10:00 – 10:50 | Enfoque, sesión 3 | 50 min |
| 10:50 – 11:00 | Recuperación | 10 min |
| 11:00 – 11:50 | Enfoque, sesión 4 | 50 min |
| 11:50 – 13:00 | Recuperación larga | 70 min |
| 13:00 | Enfoque, sesión 5 (ciclo 2) | |

**Si inicias a mitad de hora:** antes de los :50 puedes unirte a la sesión en curso con el tiempo que queda, o esperar a la siguiente hora en punto. De :50 a :59 la primera sesión empieza en la siguiente hora en punto.

## Qué incluye

- Dial de la hora actual: enfoque y recuperación marcados en el reloj, con el avance en vivo.
- Una playlist de YouTube Music para enfoque y otra para recuperación. Cada una sigue donde se quedó al volver a su bloque.
- Tono binaural y ruido marrón por modo, con varias frecuencias.
- Alarmas distintas: enfoque (campanas ascendentes), recuperación (descendentes) y recuperación larga (gong).
- Opción "Solo alarmas" para iniciar sin música ni binaurales.
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
- Los navegadores exigen un toque antes de reproducir sonido. Por eso, si recargas la página con un ciclo en marcha, aparece **Activar sonido**.
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
