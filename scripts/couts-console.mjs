// Relève la facturation réelle auprès d'Anthropic, la seule source qui fasse foi.
// Usage : npm run couts:sync   (équivaut à node --env-file=.env scripts/couts-console.mjs)
//
// Le relevé maison (state/couts.json) compte les appels un par un : il est exact, mais il ne
// commence qu'au jour de sa mise en service et ignore ce qui a été facturé avant. Cette commande
// interroge le rapport de coûts de l'organisation et écrit state/couts-console.json, que couts.html
// affiche en tête : montant facturé, jour par jour, depuis le début du mois.
//
// Il faut une clé d'administration (console Anthropic → Settings → API keys → Admin keys). Elle est
// distincte de la clé du projet, n'écrit rien, et sert uniquement à lire la facturation. Elle reste
// dans .env, jamais dans le dépôt ni dans le workflow : une clé d'administration gouverne toute
// l'organisation, elle n'a rien à faire dans les secrets d'un dépôt public.
import { writeFile } from 'node:fs/promises';
import { fromRoot } from '../src/core/config.mjs';

const cle = process.env.ANTHROPIC_ADMIN_KEY;
if (!cle) {
  console.error('ANTHROPIC_ADMIN_KEY manque dans .env.');
  console.error('Console Anthropic → Settings → API keys → Admin keys → Create key, puis :');
  console.error('   ANTHROPIC_ADMIN_KEY=sk-ant-admin…   (dans .env, jamais dans le dépôt)');
  process.exit(1);
}

const debutMois = new Date();
debutMois.setUTCDate(1);
debutMois.setUTCHours(0, 0, 0, 0);
const depuis = process.argv[2] ? new Date(`${process.argv[2]}T00:00:00Z`) : debutMois;
if (Number.isNaN(depuis.getTime())) {
  console.error('Date de départ illisible. Attendu : npm run couts:sync 2026-09-01');
  process.exit(1);
}

// Le rapport donne les montants en centimes, en chaîne décimale (« 123.45 » = 1,23 $).
const dollars = (centimes) => Number(centimes) / 100;

async function page(curseur) {
  const url = new URL('https://api.anthropic.com/v1/organizations/cost_report');
  url.searchParams.set('starting_at', depuis.toISOString());
  url.searchParams.set('bucket_width', '1d');
  url.searchParams.set('limit', '31');
  if (curseur) url.searchParams.set('page', curseur);
  const r = await fetch(url, { headers: { 'x-api-key': cle, 'anthropic-version': '2023-06-01' } });
  if (!r.ok) {
    const corps = await r.text();
    throw new Error(`HTTP ${r.status} — ${corps.replace(/sk-ant-[\w-]+/g, '[masqué]').slice(0, 300)}`);
  }
  return r.json();
}

const jours = {};
let curseur = null;
do {
  const rep = await page(curseur);
  for (const seau of rep.data ?? []) {
    const jour = seau.starting_at.slice(0, 10);
    const montant = (seau.results ?? []).reduce((n, r) => n + dollars(r.amount), 0);
    jours[jour] = Math.round(((jours[jour] ?? 0) + montant) * 1e6) / 1e6;
  }
  curseur = rep.has_more ? rep.next_page : null;
} while (curseur);

const total = Object.values(jours).reduce((n, v) => n + v, 0);
const fichier = { maj: new Date().toISOString(), depuis: depuis.toISOString().slice(0, 10), jours, total: Math.round(total * 1e4) / 1e4 };
await writeFile(fromRoot('state/couts-console.json'), `${JSON.stringify(fichier, null, 2)}\n`);

const eur = (n) => `${n.toFixed(4).replace('.', ',')} $`;
console.log(`Facturation Anthropic depuis le ${fichier.depuis} :`);
for (const [j, v] of Object.entries(jours).sort()) console.log(`   ${j}   ${eur(v).padStart(10)}`);
console.log(`   ──────────────────────`);
console.log(`   total  ${eur(fichier.total).padStart(10)}`);
console.log('state/couts-console.json écrit. Committer ce fichier met la page à jour.');
