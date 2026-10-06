import { loadJson, saveJson } from '../core/state.mjs';
import { fold } from './annuaire.mjs';

// Comptes enseignés depuis Telegram. Aucune règle ne connaîtra le terrain comme l'équipe : quand
// le robot manque un compte (@villehendaye64700, le 04/10/2026) ou en répète un qui lasse, une
// commande suffit, et c'est retenu pour toujours.
//   /compte Hendaye @villehendaye64700   ce nom a ce compte Instagram (Threads et Bluesky s'en déduisent)
//   /jamais @fondationdupatrimoine       ce compte n'est plus jamais tagué, sur aucun réseau
//   /oublier Hendaye  ·  /oublier @x     défait l'un ou l'autre
//   /comptes                             ce qui a été enseigné
// Ce qui est enseigné passe avant toute recherche, y compris celles que le robot a mémorisées.

const FICHIER = 'comptes-valides.json';
export const VIDE = () => ({ comptes: {}, exclus: [] });

// Un pseudo Instagram : lettres, chiffres, points et tirets bas, trente signes au plus. Un pseudo
// Bluesky (avec son domaine) est admis pour une exclusion.
const PSEUDO_INSTAGRAM = /^[a-z0-9._]{1,30}$/;
const PSEUDO_EXCLU = /^[a-z0-9._-]{1,60}$/;
const nettoyer = (h) => String(h ?? '').trim().replace(/^@/, '').toLowerCase();
// La clé d'un nom : sans accents, casse ni ponctuation — « Château d'Abbadia » tapé au téléphone
// (apostrophe droite) et « Château d’Abbadia » écrit par l'IA (apostrophe courbe) sont le même.
const cle = (nom) => fold(String(nom ?? '')).replace(/[^a-z0-9]+/g, ' ').trim();

export async function lireEnseignes() {
  const lu = await loadJson(FICHIER, {}).catch(() => ({}));
  return { ...VIDE(), ...lu, comptes: lu?.comptes ?? {}, exclus: lu?.exclus ?? [] };
}
export const enregistrerEnseignes = (table) => saveJson(FICHIER, table);

// Les comptes enseignés pour un nom (entité ou commune), comparés sans accents ni casse
export function comptesEnseignes(table, nom) {
  return table?.comptes?.[cle(nom)]?.instagram ?? [];
}
export const estExclu = (table, handle) => (table?.exclus ?? []).includes(nettoyer(handle));

// Les commandes : chacune rend la table modifiée et la réponse à envoyer, sans rien écrire
export function enseigner(table, args, { jour }) {
  const pseudos = args.filter((a) => a.startsWith('@')).map(nettoyer);
  const nom = args.filter((a) => !a.startsWith('@')).join(' ').trim();
  if (!nom || !pseudos.length) return { table, reponse: 'Exemple : /compte Hendaye @villehendaye64700' };
  const mauvais = pseudos.find((h) => !PSEUDO_INSTAGRAM.test(h));
  if (mauvais) return { table, reponse: `« @${mauvais} » n’est pas un pseudo Instagram valable.` };
  const k = cle(nom);
  const avant = table.comptes[k]?.instagram ?? [];
  const instagram = [...new Set([...avant, ...pseudos])];
  const comptes = { ...table.comptes, [k]: { nom, instagram, le: jour } };
  // enseigner un compte, c'est aussi le sortir des exclusions
  const exclus = table.exclus.filter((h) => !pseudos.includes(h));
  return { table: { ...table, comptes, exclus }, reponse: `✅ Retenu : <b>${nom}</b> → ${instagram.map((h) => `@${h}`).join(', ')}\n<i>Utilisé dès le prochain article qui le nomme.</i>` };
}

export function exclure(table, args) {
  const pseudos = args.map(nettoyer).filter(Boolean);
  if (!pseudos.length) return { table, reponse: 'Exemple : /jamais @fondationdupatrimoine' };
  const mauvais = pseudos.find((h) => !PSEUDO_EXCLU.test(h));
  if (mauvais) return { table, reponse: `« @${mauvais} » n’est pas un pseudo valable.` };
  const exclus = [...new Set([...table.exclus, ...pseudos])];
  // un compte exclu ne reste pas enseigné ailleurs
  const comptes = Object.fromEntries(Object.entries(table.comptes)
    .map(([k, v]) => [k, { ...v, instagram: v.instagram.filter((h) => !pseudos.includes(h)) }])
    .filter(([, v]) => v.instagram.length));
  return { table: { ...table, comptes, exclus }, reponse: `🚫 Plus jamais tagué : ${pseudos.map((h) => `@${h}`).join(', ')}` };
}

export function oublier(table, args) {
  const cible = args.join(' ').trim();
  if (!cible) return { table, reponse: 'Exemple : /oublier Hendaye ou /oublier @fondationdupatrimoine' };
  if (cible.startsWith('@')) {
    const h = nettoyer(cible);
    if (!table.exclus.includes(h)) return { table, reponse: `@${h} n’était pas exclu.` };
    return { table: { ...table, exclus: table.exclus.filter((x) => x !== h) }, reponse: `↩️ @${h} peut de nouveau être tagué.` };
  }
  const k = cle(cible);
  if (!table.comptes[k]) return { table, reponse: `Rien d’enseigné pour « ${cible} ».` };
  const { [k]: retire, ...comptes } = table.comptes;
  return { table: { ...table, comptes }, reponse: `↩️ Oublié : <b>${retire.nom}</b> (${retire.instagram.map((h) => `@${h}`).join(', ')}). La recherche automatique reprend.` };
}

export function texteEnseignes(table) {
  const lignes = Object.values(table.comptes).sort((a, b) => fold(a.nom).localeCompare(fold(b.nom)))
    .map((v) => `• ${v.nom} → ${v.instagram.map((h) => `@${h}`).join(', ')}`);
  return [
    '🏷 <b>Comptes enseignés</b>',
    ...(lignes.length ? lignes : ['<i>aucun</i>']),
    '',
    '🚫 <b>Jamais tagués</b>',
    table.exclus.length ? table.exclus.map((h) => `@${h}`).join(', ') : '<i>aucun</i>',
    '',
    '<i>/compte Nom @pseudo · /jamais @pseudo · /oublier Nom ou @pseudo</i>',
  ].join('\n');
}
