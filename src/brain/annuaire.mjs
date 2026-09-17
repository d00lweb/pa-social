// Choix des comptes à mentionner. Règle de fond : l'IA propose des NOMS d'entités,
// jamais des pseudos ; le pseudo vient de la fiche officielle ou du site de l'entité,
// et rien n'est publié sans vérification. Aucun compte trouvé est un résultat normal.

export const fold = (s) => String(s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

const PETITS = new Set(['de', 'du', 'des', 'le', 'la', 'les', 'd', 'l', 'en', 'et', 'aux', 'au', 'un', 'une', 'pour']);
export const motsCles = (nom) => fold(nom).split(/[^a-z0-9]+/).filter((m) => m.length > 2 && !PETITS.has(m));

const jetons = (s) => new Set(fold(s).split(/[^a-z0-9]+/).filter(Boolean));

// Mots qu'un compte officiel peut ajouter au nom de l'entité sans changer de sujet
const CIVIQUES = new Set([
  'ville', 'mairie', 'commune', 'departement', 'departemental', 'conseil', 'officiel', 'officielle',
  'compte', 'agglomeration', 'metropole', 'communaute', 'agglo',
]);

// Un candidat n'est retenu que si TOUS les mots du nom figurent dans son nom ou son pseudo,
// comparés comme des MOTS ENTIERS : « ami » ne doit pas se reconnaître dans « gaming ».
// Et il ne doit pas parler d'autre chose : « Université de Bordeaux » n'est pas « Bordeaux ».
export function correspond(entite, candidat) {
  const mots = motsCles(entite);
  if (!mots.length) return false;
  const cible = jetons(`${candidat.nom ?? ''} ${candidat.handle ?? ''}`);
  if (!mots.every((m) => cible.has(m))) return false;
  const attendus = new Set([...mots, ...CIVIQUES]);
  return motsCles(candidat.nom ?? '').every((m) => attendus.has(m));
}

// Signaux d'un compte qui porte le bon nom sans être l'officiel (fan, parodie, revue de presse)
const SUSPECTS = /\b(fan|fans|parodie|parody|non officiel|unofficial|actu|info|news|l'antre|antre)\b/i;

export function suspect(candidat) {
  return SUSPECTS.test(`${candidat.nom ?? ''} ${candidat.description ?? ''}`) || (candidat.abonnes ?? Infinity) < 30;
}

// Ordre de priorité des rôles : le sujet de l'article d'abord, le thème en dernier recours
const POIDS = { sujet: 0, acteur: 1, tutelle: 2, theme: 3 };

// Retient au plus `max` comptes, un seul par entité, en respectant l'ordre des rôles
export function choisir(comptes, { max = 2 } = {}) {
  const vus = new Set();
  return [...comptes]
    .filter((c) => c.handle && !vus.has(fold(c.entite)) && (vus.add(fold(c.entite)) || true))
    .sort((a, b) => (POIDS[a.role] ?? 9) - (POIDS[b.role] ?? 9))
    .slice(0, max);
}

// Mention dans un texte : uniquement en remplaçant le nom déjà écrit, jamais en l'ajoutant.
// Renvoie null si le nom n'y figure pas — dans ce cas, aucune mention sur ce réseau.
export function substituer(texte, nom, handle) {
  const source = String(texte ?? '');
  const cible = fold(nom);
  if (!cible) return null;
  const plat = fold(source);
  const lettre = /[\p{L}\p{N}]/u;
  for (let at = plat.indexOf(cible); at >= 0; at = plat.indexOf(cible, at + 1)) {
    const avant = source[at - 1] ?? '';
    const apres = source[at + cible.length] ?? '';
    // jamais à l'intérieur d'un hashtag, d'une mention, ni au milieu d'un mot plus long
    if (avant === '#' || avant === '@' || lettre.test(avant) || lettre.test(apres)) continue;
    return `${source.slice(0, at)}@${handle}${source.slice(at + cible.length)}`;
  }
  return null;
}
