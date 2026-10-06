import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VIDE, enseigner, exclure, oublier, texteEnseignes, comptesEnseignes, estExclu } from '../src/brain/enseignes.mjs';
import { resoudreComptes } from '../src/brain/comptes.mjs';

// Le 06/10/2026, l'équipe a relevé ce que le robot manquait (@villehendaye64700) et ce qu'il
// répétait (@fondationdupatrimoine). Une commande Telegram suffit désormais, retenue pour toujours.
const jour = '2026-10-06';

test('/compte : un nom, un ou plusieurs comptes, la casse du nom gardée', () => {
  let { table, reponse } = enseigner(VIDE(), ['Hendaye', '@villehendaye64700'], { jour });
  assert.match(reponse, /Retenu : <b>Hendaye<\/b> → @villehendaye64700/);
  ({ table } = enseigner(table, ['hendaye', '@Hendaye_Tourisme_et_Commerce'], { jour }));
  assert.deepEqual(comptesEnseignes(table, 'HENDAYE'), ['villehendaye64700', 'hendaye_tourisme_et_commerce'], 'complété, sans accent ni casse');
  ({ table } = enseigner(table, ['Château', "d'Abbadia", '@chateau.abbadia'], { jour }));
  assert.deepEqual(comptesEnseignes(table, 'chateau d’abbadia'), ['chateau.abbadia'], 'apostrophe droite ou courbe');
  // ce qui ne peut pas être un pseudo Instagram est refusé, la table ne bouge pas
  const refus = enseigner(table, ['Hendaye', '@ville hendaye!'], { jour });
  assert.equal(refus.table, table);
  assert.equal(enseigner(table, ['@seul'], { jour }).table, table, 'il faut un nom');
});

test('/jamais puis /oublier : exclu partout, puis rendu à la recherche', () => {
  let { table } = enseigner(VIDE(), ['Poitiers', '@fondationdupatrimoine'], { jour });
  ({ table } = exclure(table, ['@fondationdupatrimoine', '@fond-patrimoine.bsky.social']));
  assert.ok(estExclu(table, '@FondationDuPatrimoine'));
  assert.ok(estExclu(table, 'fond-patrimoine.bsky.social'), 'un pseudo Bluesky s’exclut aussi');
  assert.deepEqual(comptesEnseignes(table, 'Poitiers'), [], 'un compte exclu n’est plus enseigné nulle part');
  ({ table } = oublier(table, ['@fondationdupatrimoine']));
  assert.ok(!estExclu(table, 'fondationdupatrimoine'));
  // enseigner un compte exclu le sort des exclusions
  ({ table } = enseigner(table, ['Bidache', '@fond-patrimoine.bsky.social'.replace('-', '')], { jour }));
  ({ table } = oublier(table, ['Bidache']));
  assert.deepEqual(comptesEnseignes(table, 'Bidache'), []);
  assert.match(oublier(table, ['Inconnu']).reponse, /Rien d’enseigné/);
  assert.match(texteEnseignes(table), /Jamais tagués/);
});

// Outils simulés, comme dans comptes.test.mjs : rien ne touche le réseau ni l'état du projet
function faux({ comptes = {}, enseignes = VIDE(), memoire = {} } = {}) {
  return {
    suivi: { incertain: false },
    fiche: async () => null,
    site: async () => ({ insta: [], x: [], facebook: [], bluesky: [], threads: [] }),
    decrire: async (h) => comptes[h] ?? null,
    existe: async () => false,
    profilBluesky: async () => null,
    chercherBluesky: async () => [],
    surThreads: async () => false,
    liensArticle: async () => ({ sites: [], instagram: [] }),
    enseignes: async () => enseignes,
    memoire,
    async charger() { return this.memoire; },
    async enregistrer(v) { this.memoire = v; },
  };
}

test('ce qui est enseigné passe avant la recherche, même mémorisée ; l’exclu disparaît partout', async () => {
  let { table } = enseigner(VIDE(), ['Hendaye', '@villehendaye64700', '@hendaye_tourisme_et_commerce'], { jour });
  ({ table } = exclure(table, ['@paysbasque_net']));
  const outils = faux({
    enseignes: table,
    comptes: { villehendaye64700: { handle: 'villehendaye64700', nom: 'Ville d’Hendaye', abonnes: 6233 } },
    // une recherche mémorisée qui n'avait rien trouvé (v3, récente) : l'enseignement l'emporte
    memoire: { 'commune:mairie:hendaye': { v: 3, cherche: '2026-10-05T00:00:00Z', instagram: [] }, 'commune:tourisme:hendaye': { v: 3, cherche: '2026-10-05T00:00:00Z', instagram: [] } },
  });
  const plan = await resoudreComptes([], {
    commune: 'Hendaye', departement: 'Pyrénées-Atlantiques', texte: 'À Hendaye, un château à visiter. Pays basque',
    categories: ['Tourisme'], outils, maintenant: Date.parse('2026-10-06T08:00:00Z'),
  });
  const ig = plan.instagram.map((c) => c.handle);
  assert.ok(ig.includes('villehendaye64700'));
  assert.ok(ig.includes('hendaye_tourisme_et_commerce'), 'compte personnel non décrit par l’API : gardé, l’équipe sait qui le tient');
  assert.ok(!ig.includes('paysbasque_net'), 'exclu par /jamais');
});
