// Genera css/tokens.css: roles de color de Material 3 para tema claro y oscuro.
// Uso: npm install && npm run tokens
//
// Semillas:
//   primary  (enfoque)      → latón  #E6AD42
//   tertiary (recuperación) → salvia #7DC6B1
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Hct, TonalPalette, argbFromHex, hexFromArgb } from '@material/material-color-utilities';

const FOCUS_SEED = '#E6AD42';
const RECOVERY_SEED = '#7DC6B1';

const focus = Hct.fromInt(argbFromHex(FOCUS_SEED));
const recovery = Hct.fromInt(argbFromHex(RECOVERY_SEED));

const P = {
  primary: TonalPalette.fromHueAndChroma(focus.hue, 48),
  secondary: TonalPalette.fromHueAndChroma(focus.hue, 16),
  tertiary: TonalPalette.fromHueAndChroma(recovery.hue, 36),
  error: TonalPalette.fromHueAndChroma(25, 84),
  neutral: TonalPalette.fromHueAndChroma(focus.hue, 5),
  neutralVariant: TonalPalette.fromHueAndChroma(focus.hue, 10),
};

// [rol, paleta, tono claro, tono oscuro]
const ROLES = [
  ['primary', 'primary', 40, 80],
  ['on-primary', 'primary', 100, 20],
  ['primary-container', 'primary', 90, 30],
  ['on-primary-container', 'primary', 30, 90],
  ['secondary', 'secondary', 40, 80],
  ['on-secondary', 'secondary', 100, 20],
  ['secondary-container', 'secondary', 90, 30],
  ['on-secondary-container', 'secondary', 30, 90],
  ['tertiary', 'tertiary', 40, 80],
  ['on-tertiary', 'tertiary', 100, 20],
  ['tertiary-container', 'tertiary', 90, 30],
  ['on-tertiary-container', 'tertiary', 30, 90],
  ['error', 'error', 40, 80],
  ['on-error', 'error', 100, 20],
  ['error-container', 'error', 90, 30],
  ['on-error-container', 'error', 30, 90],
  ['surface', 'neutral', 98, 6],
  ['surface-dim', 'neutral', 87, 6],
  ['surface-bright', 'neutral', 98, 24],
  ['surface-container-lowest', 'neutral', 100, 4],
  ['surface-container-low', 'neutral', 96, 10],
  ['surface-container', 'neutral', 94, 12],
  ['surface-container-high', 'neutral', 92, 17],
  ['surface-container-highest', 'neutral', 90, 22],
  ['on-surface', 'neutral', 10, 90],
  ['surface-variant', 'neutralVariant', 90, 30],
  ['on-surface-variant', 'neutralVariant', 30, 80],
  ['outline', 'neutralVariant', 50, 60],
  ['outline-variant', 'neutralVariant', 80, 30],
  ['inverse-surface', 'neutral', 20, 90],
  ['inverse-on-surface', 'neutral', 95, 20],
  ['inverse-primary', 'primary', 80, 40],
  ['scrim', 'neutral', 0, 0],
  ['shadow', 'neutral', 0, 0],
];

const block = (dark) =>
  ROLES.map(([role, pal, l, d]) => `  --md-sys-color-${role}: ${hexFromArgb(P[pal].tone(dark ? d : l))};`).join('\n');

const css = `/* Generado por tools/generate-tokens.mjs. No editar a mano. */
/* Material 3: roles de color. Semillas: enfoque ${FOCUS_SEED}, recuperación ${RECOVERY_SEED}. */

:root {
  color-scheme: light;
${block(false)}
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
${block(true).replace(/^ {2}/gm, '    ')}
  }
}

:root[data-theme="dark"] {
  color-scheme: dark;
${block(true)}
}
`;

const out = fileURLToPath(new URL('../css/tokens.css', import.meta.url));
writeFileSync(out, css);

// Colores de la barra del navegador (meta theme-color) para cada tema
console.log(JSON.stringify({
  light: hexFromArgb(P.neutral.tone(98)),
  dark: hexFromArgb(P.neutral.tone(6)),
}));
