import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliser, motifTrouve, trier, modererCommentaires, MOTIFS } from '../src/measure/moderation.mjs';

// 25/09/2026 : 26 commentaires publicitaires sous une seule publication Instagram, 16 sous une
// autre. Tous pour le même site, écrits pour passer les filtres par mot-clé — caractères
// cyrilliques qui imitent des lettres latines, gras mathématique, caractères invisibles, chiffres
// à la place des lettres. Ces textes sont les vrais, copiés tels quels.
const SPAM_REEL = [
  'Là y’a que des vdeo de la trend allo doudou sur le s!te  tepu.lol',
  'Le meilleur Website pour se br ces sur tepu.l‍o⁠l 🤣',
  'Je regrette d’avoir marquer tepu.𝐥𝐨𝐥  sur g0ogle 🤭',
  'Ceux qui veulent voir des 2008 entrain de 🐝 ça se passe sur tepu.lоl ( tape sur ssfari 🤝',
  'Un conseil jamais taper tepu.lol sur ton navigаteur 🥲',
  'Toute tes influenceuses préférées sont sur tepu.lol écris ça sur ton navigatеur 😆',
  'Mon pote m’a dit tape tepu.𝐥𝐨𝐥 sur Googlе, j’aurais pas dû l’écouter 😭',
];

// De vrais commentaires de lecteurs, dont un qui cite une adresse : aucun ne doit être touché.
const VRAIS = [
  'Ouai enfin il y a toujours eu des dauphins sur la côte, de façon aléatoire. Encore des articles putaclic',
  'Vous n’habitez pas ici pour dire des âneries pareilles. Ils ont tjrs été là et c’est plein de poissons.',
  'Envoie-le à @Bordeaux__life ❤️🙌',
  'On retrouve vraiment une grosse similitude dans notre code couleur sur nos parutions c’est moyen',
  'Super article ! Le site passion-aquitaine.ouest-france.fr est une mine d’or',
  'J’y étais, ambiance folle 🎉',
];

test('normalisation : les sosies de lettres ne trompent pas le filtre', () => {
  // о cyrillique, 𝐥𝐨 en gras mathématique, zéro pour o, point d'exclamation pour i
  assert.equal(normaliser('tepu.lоl'), normaliser('tepu.lol'));
  assert.equal(normaliser('tepu.𝐥𝐨𝐥'), normaliser('tepu.lol'));
  assert.equal(normaliser('tepu.l‍o⁠l'), normaliser('tepu.lol'), 'caractères invisibles retirés');
  assert.equal(normaliser('s!te'), 'site');
  assert.equal(normaliser('g0ogle'), 'google');
  assert.equal(normaliser('navigаteur'), 'navigateur');
  assert.equal(normaliser(null), '');
});

test('les sept variantes réellement reçues sont toutes reconnues', () => {
  assert.deepEqual(MOTIFS, ['tepu.lol', 'teupu.lol'], 'motifs lus dans config/channels.json');
  for (const t of SPAM_REEL) assert.ok(motifTrouve(t), `manqué : ${t}`);
});

test('aucun commentaire de lecteur n’est pris pour du spam', () => {
  for (const t of VRAIS) assert.equal(motifTrouve(t), null, `faux positif : ${t}`);
  // un motif est une marque, pas un mot courant : rien dans la langue ordinaire ne le déclenche
  for (const t of ['J’adore ce lieu', 'Le tempo est parfait', 'Superbe photo de Pons']) {
    assert.equal(motifTrouve(t), null, `faux positif : ${t}`);
  }
});

test('motif connu : suppression. Texte répété avec une adresse : masquage, plus prudent', () => {
  const verdicts = trier([
    { id: '1', texte: SPAM_REEL[0], publication: 'A' },
    { id: '2', texte: 'Venez voir sur monsite.xyz les photos', publication: 'A' },
    { id: '3', texte: 'Venez voir sur monsite.xyz les photos', publication: 'B' },
    { id: '4', texte: VRAIS[0], publication: 'A' },
    { id: '5', texte: 'Bravo pour cet article', publication: 'A' },
    { id: '6', texte: 'Bravo pour cet article', publication: 'B' },
  ]);
  assert.deepEqual(verdicts.filter((v) => v.action === 'supprimer').map((v) => v.id), ['1']);
  assert.deepEqual(verdicts.filter((v) => v.action === 'masquer').map((v) => v.id), ['2', '3']);
  // un commentaire ordinaire répété sous deux publications reste en place : pas d'adresse
  assert.equal(verdicts.some((v) => ['4', '5', '6'].includes(v.id)), false);
});

test('passage complet : ce qui est supprimé, ce qui est masqué, et l’arrêt sur droit manquant', async () => {
  const avant = process.env.IG_TOKEN;
  process.env.IG_TOKEN = 'jeton';
  // La mémoire des alertes vit dans state/ : un test ne doit pas consommer celle du jour, sinon
  // un vrai spam passerait sous silence. Elle est remise exactement comme elle était.
  const { fromRoot } = await import('../src/core/config.mjs');
  const { readFile, writeFile, rm } = await import('node:fs/promises');
  const memo = await readFile(fromRoot('state/moderation.json'), 'utf8').catch(() => null);
  try {
    await rm(fromRoot('state/moderation.json'), { force: true });
    const history = [
      { channel: 'instagram', mediaId: 'm1', titre: 'Article A' },
      { channel: 'instagram', mediaId: 'm2', titre: 'Article B' },
      { channel: 'x', mediaId: 'kit-telegram', titre: 'kit' },
    ];
    const commentaires = {
      m1: [{ id: 'c1', text: SPAM_REEL[0] }, { id: 'c2', text: VRAIS[0] }, { id: 'c3', text: SPAM_REEL[2], hidden: true }],
      m2: [{ id: 'c4', text: SPAM_REEL[3] }],
    };
    const lire = async (url) => ({ data: commentaires[url.match(/\/(m\d)\/comments/)[1]] });

    const faits = [];
    const ecrire = async (url, opts) => { faits.push(`${opts.method} ${url.match(/\/(c\d)/)[1]}${/hide=true/.test(url) ? ' (masquer)' : ''}`); return {}; };
    const r = await modererCommentaires({ history, lire, ecrire, log: () => {} });
    assert.equal(r.verdicts.length, 2, 'deux spams, le commentaire de lecteur et le déjà-masqué exclus');
    assert.deepEqual(faits, ['DELETE c1', 'DELETE c4']);
    assert.equal(r.traites, 2);

    // droit manquant : on n'insiste pas 26 fois, et on prévient une seule fois par jour
    const envoyes = [];
    const refuse = async () => { throw Object.assign(new Error('(#10) Application does not have permission for this action'), { code: 10 }); };
    const opts = { history, lire, ecrire: refuse, log: () => {}, envoyer: async (t) => envoyes.push(t), now: Date.parse('2026-09-25T12:00:00Z') };
    const r2 = await modererCommentaires(opts);
    assert.equal(r2.traites, 0);
    assert.equal(envoyes.length, 1);
    assert.match(envoyes[0], /instagram_manage_comments/);
    assert.match(envoyes[0], /Mots masqués/, 'la solution immédiate est rappelée');
    await modererCommentaires(opts);
    assert.equal(envoyes.length, 1, 'une alerte par jour, pas une par rafale');
  } finally {
    if (avant === undefined) delete process.env.IG_TOKEN; else process.env.IG_TOKEN = avant;
    await (memo === null ? rm(fromRoot('state/moderation.json'), { force: true }) : writeFile(fromRoot('state/moderation.json'), memo));
  }
});
