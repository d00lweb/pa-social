// Scelle la page publique de l'équipe (site/reseaux-sociaux.html) : recalcule l'empreinte de son
// script et de son style dans la politique de sécurité (CSP). Sans empreinte à jour, le navigateur
// refuse d'exécuter la page : à relancer après chaque modification, avant de la téléverser.
//   node scripts/page-equipe.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const PAGE = fileURLToPath(new URL('../site/reseaux-sociaux.html', import.meta.url));

// Le navigateur ramène les fins de ligne CRLF à LF avant de calculer l'empreinte : on fait de même,
// pour que la page reste valable si Git ou un éditeur Windows change ses fins de ligne.
const empreinte = (texte) => `'sha256-${createHash('sha256').update(texte.replace(/\r\n?/g, '\n'), 'utf8').digest('base64')}'`;
const bloc = (html, balise) => {
  const m = html.match(new RegExp(`<${balise}>([\\s\\S]*?)</${balise}>`));
  if (!m) throw new Error(`<${balise}> introuvable`);
  return m[1];
};

export function politique(html) {
  return [
    "default-src 'none'",
    `script-src ${empreinte(bloc(html, 'script'))}`,
    `style-src ${empreinte(bloc(html, 'style'))}`,
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
  ].join('; ');
}

const META = /(<meta http-equiv="Content-Security-Policy" content=")[^"]*(")/;

export const cspDeLaPage = (html) => html.match(/Content-Security-Policy" content="([^"]*)"/)?.[1] ?? null;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const html = readFileSync(PAGE, 'utf8');
  const scelle = html.replace(META, `$1${politique(html)}$2`);
  writeFileSync(PAGE, scelle);
  console.log(scelle === html ? 'Page déjà scellée.' : 'Page scellée : empreintes mises à jour.');
}
