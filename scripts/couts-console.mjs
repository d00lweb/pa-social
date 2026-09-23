// Le montant réellement facturé par Anthropic, la seule source qui fasse foi.
//
//   npm run couts:sync           relève la facturation automatiquement (clé d'organisation)
//   npm run couts:facture 4,12   inscrit à la main le total du mois lu dans la console
//
// Le relevé maison (state/couts.json) compte les appels un par un : il est exact, mais il ne
// commence qu'au jour de sa mise en service et ignore ce qui a été facturé avant. Ce script écrit
// state/couts-console.json, que couts.html affiche en tête et sur lequel les alertes Telegram se
// calent.
//
// La voie automatique passe par le rapport de coûts de l'organisation. Il refuse les clés rattachées
// à un workspace (« The Admin API requires an Admin API key or an organization-scoped API key ») et
// n'est pas ouvert aux comptes individuels. D'où la saisie manuelle, qui donne le même résultat :
// le chiffre vient de l'œil humain au lieu de l'API.
import { writeFile } from 'node:fs/promises';
import { fromRoot } from '../src/core/config.mjs';

const arg = process.argv[2];
const moisCourant = new Date().toISOString().slice(0, 7);

const ecrire = async (fichier) => {
  await writeFile(fromRoot('state/couts-console.json'), `${JSON.stringify(fichier, null, 2)}\n`);
  console.log('state/couts-console.json écrit. Committer ce fichier met la page à jour.');
};

// ── Saisie manuelle ────────────────────────────────────────────────────────────
// « npm run couts:facture 4,12 » ou « … 4,12 2026-09 » pour un mois précédent.
if (arg && /^[\d.,]+$/.test(arg)) {
  const total = Number(arg.replace(',', '.'));
  const mois = process.argv[3] ?? moisCourant;
  if (!Number.isFinite(total) || total < 0) {
    console.error(`Montant illisible : « ${arg} ». Attendu : npm run couts:facture 4,12`);
    process.exit(1);
  }
  if (!/^\d{4}-\d{2}$/.test(mois)) {
    console.error(`Mois illisible : « ${mois} ». Attendu : 2026-09`);
    process.exit(1);
  }
  await ecrire({ maj: new Date().toISOString(), source: 'saisie', mois, total: Math.round(total * 1e4) / 1e4 });
  console.log(`Facturation ${mois} : ${total.toFixed(2).replace('.', ',')} $, relevée à la main dans la console Anthropic.`);
  process.exit(0);
}

// ── Relève automatique ─────────────────────────────────────────────────────────
const cle = process.env.ANTHROPIC_ADMIN_KEY || process.env.ANTHROPIC_API_KEY;
if (!cle) {
  console.error('Aucune clé dans .env (ANTHROPIC_ADMIN_KEY ou ANTHROPIC_API_KEY).');
  process.exit(1);
}

const debutMois = new Date();
debutMois.setUTCDate(1);
debutMois.setUTCHours(0, 0, 0, 0);
const depuis = arg ? new Date(`${arg}T00:00:00Z`) : debutMois;
if (Number.isNaN(depuis.getTime())) {
  console.error(`Date de départ illisible : « ${arg} ». Attendu : npm run couts:sync 2026-09-01`);
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
  if (r.status === 401 || r.status === 403) {
    console.error('Anthropic refuse la lecture de la facturation avec cette clé.');
    console.error('Le rapport de coûts demande une clé d’organisation : une clé créée sans être');
    console.error('rattachée à un workspace, ou une clé d’administration (Settings → Admin keys,');
    console.error('absente des comptes individuels).');
    console.error('');
    console.error('À défaut, inscrire le total du mois lu dans la console, ce qui revient au même :');
    console.error('   npm run couts:facture 4,12');
    process.exit(2);
  }
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
await ecrire({ maj: new Date().toISOString(), source: 'api', depuis: depuis.toISOString().slice(0, 10), jours, total: Math.round(total * 1e4) / 1e4 });

const eur = (n) => `${n.toFixed(4).replace('.', ',')} $`;
console.log(`Facturation Anthropic depuis le ${depuis.toISOString().slice(0, 10)} :`);
for (const [j, v] of Object.entries(jours).sort()) console.log(`   ${j}   ${eur(v).padStart(10)}`);
console.log('   ──────────────────────');
console.log(`   total  ${eur(total).padStart(10)}`);
