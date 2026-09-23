// Essai comparatif de modèles sur de vrais articles, par le chemin de production.
//
//   npm run essai:modele                      10 articles, Opus bas / Sonnet bas / Sonnet haut
//   npm run essai:modele -- 6                 6 articles
//   npm run essai:modele -- 10 claude-sonnet-5:high
//
// Chaque dossier passe par buildDossier : même consigne, mêmes contrôles éditoriaux, mêmes trois
// tentatives, même réparation des défauts mécaniques. Ce qui est mesuré est donc ce qui serait
// publié. Le cache est désactivé : sans cela, un article déjà rédigé ne rappellerait pas le modèle.
//
// Les appels sont facturés et comptés dans state/couts.json comme les autres.
import { writeFile, mkdir } from 'node:fs/promises';
import { fromRoot } from '../src/core/config.mjs';
import { fetchItems } from '../src/sources/rss.mjs';
import { loadMemory } from '../src/brain/memory.mjs';
import { buildDossier } from '../src/brain/dossier.mjs';
import { loadJson } from '../src/core/state.mjs';

// Le coût d'une configuration est lu dans le relevé lui-même, avant et après : il comprend ainsi
// les tentatives refusées, qui sont facturées comme les autres et qu'un simple « usage » du
// dossier retenu ne montrerait pas.
const depenseRelevee = async () => Object.values(await loadJson('couts.json', {})).reduce((n, l) => n + (l.cout ?? 0), 0);

const combien = Number(process.argv[2]) || 10;
const arms = process.argv.slice(3).length
  ? process.argv.slice(3).map((a) => { const [modele, effort = 'low'] = a.split(':'); return { modele, effort }; })
  : [
    { modele: 'claude-opus-5', effort: 'low' },
    { modele: 'claude-sonnet-5', effort: 'low' },
    { modele: 'claude-sonnet-5', effort: 'high' },
  ];

const nom = ({ modele, effort }) => `${modele.replace('claude-', '')} · effort ${effort}`;
const items = (await fetchItems(process.env.RSS_URL || 'https://passion-aquitaine.ouest-france.fr/feed/')).slice(0, combien);
if (!items.length) {
  console.error('Aucun article dans le flux.');
  process.exit(1);
}
console.log(`${items.length} articles, ${arms.length} configurations — ${items.length * arms.length} dossiers à produire.\n`);

// La mémoire sert aux angles imposés et au contrôle anti-répétition. Une copie par configuration :
// sinon la deuxième verrait les textes de la première et serait jugée sur une contrainte de plus.
const memoireSource = await loadMemory();
const resultats = [];

for (const arm of arms) {
  const memory = structuredClone(memoireSource);
  const lignes = [];
  const refus = {};
  let appels = 0;
  let replis = 0;
  const depenseAvant = await depenseRelevee();
  process.stdout.write(`── ${nom(arm)}\n`);

  for (const article of items) {
    const avant = Date.now();
    const messages = [];
    const dossier = await buildDossier(article, { memory, useCache: false, log: (m) => messages.push(m.trim()), ...arm });
    const refuses = messages.filter((m) => m.startsWith('IA essai'));
    const essais = refuses.length + (dossier.source === 'ia' ? 1 : 0);
    const valide = dossier.source === 'ia';
    if (!valide) replis += 1;
    appels += Math.max(1, essais);
    // chaque motif de refus est compté : c'est ce qui dit où un modèle décroche
    for (const m of refuses) {
      for (const p of m.replace(/^IA essai d+ refusé : /, '').split(' | ')) {
        const motif = p.replace(/(.*?)/g, '').replace(/emoji(s) S+ /, 'emoji ').trim();
        refus[motif] = (refus[motif] ?? 0) + 1;
      }
    }
    lignes.push({
      titre: article.title,
      valide,
      essais,
      secondes: Math.round((Date.now() - avant) / 100) / 10,
      usage: dossier.usage ?? null,
      messages,
      textes: {
        rubrique: dossier.rubrique,
        visuelTitre: dossier.visuel.titre,
        surlignage: dossier.visuel.surlignage,
        description: dossier.visuel.description,
        instagram: dossier.instagram.texte,
        facebook: dossier.facebook.texte,
        bluesky: dossier.bluesky.texte,
        threads: dossier.threads.texte,
        x: dossier.x.texte,
      },
    });
    process.stdout.write(`   ${valide ? '✔' : '✘'} ${article.title.slice(0, 58).padEnd(58)} ${essais} essai${essais > 1 ? 's' : ''}\n`);
  }

  const coutTotal = (await depenseRelevee()) - depenseAvant;
  const reussis = lignes.filter((l) => l.valide);
  resultats.push({
    ...arm,
    nom: nom(arm),
    articles: lignes.length,
    valides: reussis.length,
    replis,
    appels,
    essaiMoyen: reussis.length ? Math.round((reussis.reduce((n, l) => n + l.essais, 0) / reussis.length) * 100) / 100 : 0,
    entreeMoyenne: reussis.length ? Math.round(reussis.reduce((n, l) => n + (l.usage?.input ?? 0), 0) / reussis.length) : 0,
    sortieMoyenne: reussis.length ? Math.round(reussis.reduce((n, l) => n + (l.usage?.output ?? 0), 0) / reussis.length) : 0,
    secondes: Math.round((lignes.reduce((n, l) => n + l.secondes, 0) / lignes.length) * 10) / 10,
    refus: Object.fromEntries(Object.entries(refus).sort((a, b) => b[1] - a[1])),
    cout: Math.round(coutTotal * 1e4) / 1e4,
    coutParArticle: Math.round((coutTotal / lignes.length) * 1e4) / 1e4,
    coutParAppel: appels ? Math.round((coutTotal / appels) * 1e4) / 1e4 : 0,
    lignes,
  });
  process.stdout.write('\n');
}

await mkdir(fromRoot('state/rapports'), { recursive: true });
const fichier = fromRoot(`state/rapports/essai-modele-${new Date().toISOString().slice(0, 10)}.json`);
await writeFile(fichier, `${JSON.stringify({ quand: new Date().toISOString(), articles: items.map((i) => i.title), resultats }, null, 2)}\n`);

const eur = (n) => `${n.toFixed(4).replace('.', ',')} $`;
console.log('Configuration                  valides  essais  entrée  sortie  coût/article   mois*');
for (const r of resultats) {
  // 1,7 article par jour, moyenne relevée sur les 10 premiers jours de publication
  const mois = r.coutParArticle * 1.7 * 30;
  console.log(`${r.nom.padEnd(30)} ${String(`${r.valides}/${r.articles}`).padStart(7)} ${String(r.essaiMoyen).padStart(7)} ${String(r.entreeMoyenne).padStart(7)} ${String(r.sortieMoyenne).padStart(7)}   ${eur(r.coutParArticle).padStart(10)}  ${eur(mois).padStart(8)}`);
}
console.log(`\n* au rythme de 1,7 article par jour. Dépense de cet essai : ${eur(resultats.reduce((n, r) => n + r.cout, 0))}.`);
console.log(`Détail complet (textes compris) : ${fichier}`);
