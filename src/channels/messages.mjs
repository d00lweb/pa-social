// Tout ce que le robot dit sur Telegram s'écrit ici, et nulle part ailleurs.
//
// Refonte du 22/11/2026 (« j'en reçois trop, en doublon ; que des messages pertinents ») :
// trois familles, un gabarit.
//  📌 À faire : ce que toi seul peux publier (kit X, story Instagram). Un message par article et
//     par moment : l'image, la consigne, les textes, chaque élément à copier sur un bouton.
//  ⚠️ Problème : seulement quand une action de toi est nécessaire. Un message, un rappel par
//     semaine au plus tant que ça dure, puis ✅ « Réglé » quand ça disparaît (src/channels/problemes.mjs).
//  Réponses aux commandes (/statut, /aide…).
// Plus aucune statistique ni « publication faite » : les chiffres vivent dans le dashboard.
//
// Règles du gabarit, vérifiées par tests/messages.test.mjs :
//  1. HTML valide, tout texte venu d'ailleurs passé par esc().
//  2. Première ligne : le pictogramme, ce qu'il faut savoir en gras, le sujet après « · ».
//  3. Un texte à copier est sur un bouton (copy_text, 256 caractères au plus) ; au-delà, il est dans
//     le message, en <code>, qu'un appui copie.
//  4. Les liens directs sont des boutons. Tutoiement, rien de superflu.

import { readFileSync } from 'node:fs';
import { fromRoot } from '../core/config.mjs';

export const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

// Limite de Telegram pour le texte d'un bouton copy_text, et pour la légende d'une image
export const COPIE_MAX = 256;
export const LEGENDE_MAX = 1000; // 1 024 chez Telegram, avec une marge
export const PICTOS = { afaire: '📌', probleme: '⚠️', regle: '✅' };

// Les montants sont relevés en dollars et annoncés en euros (1 € = 1,0989 $)
export const DOLLARS_PAR_EURO = 1.0989;
export const euros = (dollars) => `${(Number(dollars) / DOLLARS_PAR_EURO).toFixed(2).replace('.', ',')} €`;

// ── Le gabarit ─────────────────────────────────────────────────────────────────
const net = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const court = (s, n = 160) => { const t = net(s); return [...t].length > n ? `${[...t].slice(0, n - 1).join('')}…` : t; };

// Bouton qui copie ; rien si le texte dépasse ce que Telegram accepte
export const copie = (etiquette, valeur) => {
  const v = String(valeur ?? '').trim();
  return v && [...v].length <= COPIE_MAX ? { text: `📋 ${etiquette}`, copy_text: { text: v } } : null;
};
export const lien = (texte, url) => (/^https:\/\//.test(String(url ?? '')) ? { text: texte, url } : null);

// Longueur vue par Telegram (en unités UTF-16, comme lui : un emoji en compte deux) : balises retirées, entités décodées
export const longueurVisible = (html) => String(html).replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').length;

// { text, reply_markup } : la tête (pictogramme, quoi, sujet), les lignes, les boutons par rangée
export function gabarit({ famille, quoi, sujet = null, lignes = [], boutons = [] }) {
  const tete = `${PICTOS[famille]} <b>${quoi}</b>${sujet ? ` · ${esc(court(sujet, 120))}` : ''}`;
  const text = [tete, ...lignes.filter((l) => l !== null && l !== undefined && l !== false)].join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const rangees = boutons.map((r) => r.filter(Boolean)).filter((r) => r.length);
  return { text, ...(rangees.length ? { reply_markup: JSON.stringify({ inline_keyboard: rangees }) } : {}) };
}
const parTrois = (boutons) => boutons.filter(Boolean).reduce((r, b, i) => (i % 3 ? r[r.length - 1].push(b) : r.push([b]), r), []);
const phrase = (texte) => `Écris à Claude, dans le dashboard : « ${texte} ».`;

// ── 📌 À faire ─────────────────────────────────────────────────────────────────
const CONSIGNES_X = {
  image: 'Enregistre l’image, touche « Publier sur X », joins-la et publie.',
  lien: 'Touche « Publier sur X » et publie : X affiche l’aperçu du lien (l’image reste là si tu la préfères).',
  reponse: 'Enregistre l’image, touche « Publier sur X », joins-la et publie ; puis réponds à ton post avec la réponse.',
};

// Kit X : UN message, l'image avec sa légende et ses boutons (avant le 22/11 : jusqu'à neuf messages)
export function kitX({ titre, mode = 'reponse', texte, longueur, reponse = null, intent, comptes = [], aChercher = [], lieu = null, lieuSecours = null, alt = null }) {
  return gabarit({
    famille: 'afaire',
    quoi: 'À publier sur X',
    sujet: titre,
    lignes: [
      CONSIGNES_X[mode] ?? CONSIGNES_X.image,
      '',
      `<b>Texte</b> (${longueur}/280)`,
      `<code>${esc(texte)}</code>`,
      reponse && '<b>Réponse</b>',
      reponse && `<code>${esc(reponse)}</code>`,
      comptes.length ? `<b>À taguer sur l’image</b> : ${comptes.map((c) => `@${esc(c.handle)}`).join(', ')}` : null,
      aChercher.length ? `<b>À chercher sur X</b> : ${aChercher.map((c) => `${esc(c.nom)} (@${esc(c.handle)} ailleurs)`).join(', ')}` : null,
      lieu ? `<b>Lieu</b> : ${esc(lieu)}${lieuSecours ? ` (sinon ${esc(lieuSecours)})` : ''}` : null,
    ],
    boutons: [
      [lien('✍️ Publier sur X', intent)],
      [copie('Texte', texte), copie('Réponse', reponse)],
      ...parTrois(comptes.map((c) => copie(`@${c.handle}`, `@${c.handle}`))),
      [copie('Lieu', lieu), copie('Description de l’image', alt)],
    ],
  });
}

// Story Instagram : UN message, l'image et ses boutons (avant : l'image puis un message par élément)
export function story({ titre, lienArticle, comptes = [], lieu = null }) {
  return gabarit({
    famille: 'afaire',
    quoi: 'Story Instagram à poster',
    sujet: titre,
    lignes: [
      'Publie l’image en story, puis pose le sticker lien avec l’adresse du bouton.',
      // adresse trop longue pour un bouton : dans le message, un appui la copie
      [...String(lienArticle ?? '')].length > COPIE_MAX ? `<b>Lien</b> : <code>${esc(lienArticle)}</code>` : null,
      comptes.length ? `<b>À mentionner</b> : ${comptes.map((h) => `@${esc(h)}`).join(', ')}` : null,
      lieu ? `<b>Lieu</b> : ${esc(lieu)}` : null,
    ],
    boutons: [
      [copie('Lien du sticker', lienArticle)],
      ...parTrois(comptes.map((h) => copie(`@${h}`, `@${h}`))),
      [copie('Lieu', lieu)],
    ],
  });
}

// La story n'a pas pu partir sur Telegram : l'image et le lien, pour la poster quand même
export const storyNonEnvoyee = ({ titre, imageUrl, lienArticle }) => gabarit({
  famille: 'probleme',
  quoi: 'Story Instagram non envoyée',
  sujet: titre,
  lignes: ['Le carrousel est en ligne. Ouvre l’image de la story, enregistre-la et publie-la avec le sticker lien.'],
  boutons: [[lien('Ouvrir l’image de la story', imageUrl)], [copie('Lien du sticker', lienArticle)]],
});

// ── ⚠️ Problèmes ───────────────────────────────────────────────────────────────
// Raison d'un échec, en mots simples
export function raisonCourte(err) {
  const m = String(err?.message ?? err ?? '');
  if (/^Image \d{3}/.test(m)) return 'l’image de l’article ne répond plus sur le site';
  if (Array.isArray(err?.problems) && err.problems.length) return court(err.problems.join(' ; '), 140);
  if (/access token|session has expired|oauthexception/i.test(m)) return 'jeton refusé par le réseau';
  return court(m.split('\n')[0], 140);
}

// Un article qui n'est pas parti, sur un ou plusieurs réseaux (le message se complète en place)
export function publicationRatee({ titre, lienArticle, reseaux }) {
  const noms = reseaux.map((r) => r.nom);
  const liste = noms.length > 1 ? `${noms.slice(0, -1).join(', ')} et ${noms.at(-1)}` : noms[0];
  return gabarit({
    famille: 'probleme',
    quoi: `Pas parti sur ${esc(liste)}`,
    sujet: titre,
    lignes: [
      ...reseaux.map((r) => `• ${esc(r.nom)} : ${esc(r.raison)}`),
      phrase('Relance l’article bloqué sur les réseaux sociaux'),
    ],
    boutons: [[lien('Ouvrir l’article', lienArticle)], [copie('Phrase pour Claude', 'Relance l’article bloqué sur les réseaux sociaux')]],
  });
}

// Lien non posté sous une publication déjà en ligne (premier commentaire Facebook, réponse Threads)
export function lienNonPoste({ reseau, titre, texte, lienPost }) {
  const ou = reseau === 'Facebook' ? 'en premier commentaire' : 'en réponse';
  return gabarit({
    famille: 'probleme',
    quoi: `${esc(reseau)} : lien non posté ${ou}`,
    sujet: titre,
    lignes: [`La publication est en ligne. Ouvre-la et colle ce texte ${ou} :`, `<code>${esc(texte)}</code>`],
    boutons: [[lien('Ouvrir la publication', lienPost)], [copie('Texte à coller', texte)]],
  });
}

const QUI = { meta: ['Meta', 'Facebook et Instagram'], threads: ['Threads', 'Threads'] };
export function jetonRefuse(nom) {
  const [jeton, reseaux] = QUI[nom] ?? [nom, nom];
  const demande = `Aide-moi à refaire le jeton ${jeton}`;
  return gabarit({
    famille: 'probleme',
    quoi: `Jeton ${esc(jeton)} refusé`,
    sujet: `${reseaux} en attente`,
    lignes: ['Rien n’est perdu : les publications repartent dès le jeton refait.', phrase(demande)],
    boutons: [[copie('Phrase pour Claude', demande)]],
  });
}

export function jetonEcheance(nom, { expireLe, restant }) {
  const [jeton, reseaux] = QUI[nom] ?? [nom, nom];
  const demande = nom === 'threads' ? 'Renouvelle le jeton Threads' : `Aide-moi à refaire le jeton ${jeton}`;
  const fin = expireLe ? new Date(expireLe).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'long' }) : null;
  return gabarit({
    famille: 'probleme',
    quoi: `Jeton ${esc(jeton)} : fin ${fin ? `le ${esc(fin)}` : 'proche'}`,
    sujet: `dans ${restant} jour${restant > 1 ? 's' : ''}`,
    lignes: [nom === 'threads' ? 'Sans lui, Threads s’arrête. Son renouvellement automatique n’a pas fonctionné.' : `Sans lui, ${reseaux} s’arrêtent. Il faut le refaire avant.`, phrase(demande)],
    boutons: [[copie('Phrase pour Claude', demande)]],
  });
}

export function pauseAuto(nom, id, detail) {
  return gabarit({
    famille: 'probleme',
    quoi: `${esc(nom)} en pause par sécurité`,
    sujet: 'le réseau signale une limite ou une restriction',
    lignes: [`<i>${esc(court(detail, 200))}</i>`, 'Vérifie le compte dans l’application, puis envoie la commande ci-dessous.'],
    boutons: [[copie(`/reprise ${id}`, `/reprise ${id}`)]],
  });
}

export const flux = (heures, detail) => gabarit({
  famille: 'probleme',
  quoi: 'Flux du site injoignable',
  sujet: heures < 48 ? `depuis ${Math.max(1, Math.round(heures))} h` : `depuis ${Math.round(heures / 24)} jours`,
  lignes: ['Aucun nouvel article n’entre en file ; ce qui est déjà prévu part normalement.', `<i>${esc(court(detail, 200))}</i>`],
  boutons: [[lien('Ouvrir le site', 'https://passion-aquitaine.ouest-france.fr/')]],
});

export function ia(message, { manqueDeCredit }) {
  return manqueDeCredit
    ? gabarit({
      famille: 'probleme',
      quoi: 'Plus de crédit sur la clé Claude',
      sujet: 'publications en version de secours',
      lignes: ['Recharge le crédit : les articles en attente repartiront tout seuls, avec leurs textes travaillés.'],
      boutons: [[lien('Ouvrir la console Anthropic', 'https://console.anthropic.com/settings/billing')]],
    })
    : gabarit({
      famille: 'probleme',
      quoi: 'Rédacteur IA injoignable',
      sujet: 'publications en version de secours',
      lignes: [`<i>${esc(court(message, 200))}</i>`, 'Si ça dure, écris à Claude, dans le dashboard : « Le rédacteur des réseaux sociaux ne répond plus ».'],
    });
}

export function budget(etat, { couperAuPlafond }) {
  return gabarit({
    famille: 'probleme',
    quoi: 'Budget du rédacteur dépassé',
    sujet: `${euros(etat.depense)} sur ${euros(etat.budget)} ce mois-ci`,
    lignes: [couperAuPlafond
      ? 'Le rédacteur n’est plus appelé : les publications partent en version de secours jusqu’au 1er du mois.'
      : 'Le rédacteur continue d’écrire. Pour relever ou tenir le plafond, règle-le dans l’onglet Réseaux sociaux du dashboard.'],
  });
}

export const facebookInvisible = (combien) => gabarit({
  famille: 'probleme',
  quoi: 'Facebook : aucune vue',
  sujet: `sur les ${combien} dernières publications`,
  lignes: ['Elles ne sont sans doute pas visibles du public.', phrase('Facebook n’est plus visible, aide-moi')],
  boutons: [[copie('Phrase pour Claude', 'Facebook n’est plus visible, aide-moi')]],
});

export const passageEnEchec = (message) => gabarit({
  famille: 'probleme',
  quoi: 'La publication automatique s’arrête',
  sujet: 'erreur à chaque passage',
  lignes: [`<i>${esc(court(message, 200))}</i>`, phrase('Les réseaux sociaux ne publient plus, aide-moi')],
  boutons: [[copie('Phrase pour Claude', 'Les réseaux sociaux ne publient plus, aide-moi')]],
});

// ── ✅ Réglé, et rappel ────────────────────────────────────────────────────────
// `texte` : nos mots, déjà échappés s'il le faut
export const messageRegle = (texte) => ({ text: `${PICTOS.regle} <b>Réglé</b> · ${texte}` });

// Le même message, signalé comme toujours en cours
export function rappel(message, depuis) {
  const jour = new Date(depuis).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'long' });
  return { ...message, text: String(message.text).replace(/^⚠️ /, `⚠️ <b>Rappel</b>, depuis le ${jour} · `) };
}

// ── Catalogue ──────────────────────────────────────────────────────────────────
// La vue d’ensemble : chaque message que le robot peut envoyer, son déclencheur, sa fréquence, et
// s’il se coupe. Elle vit dans config/notifications.json, que le dashboard lit et modifie aussi.
// Garde-fou : un message nouveau s’y inscrit (tests/messages.test.mjs, tests/notifications.test.mjs).
function lireCatalogue() {
  try {
    const { messages } = JSON.parse(readFileSync(fromRoot('config/notifications.json'), 'utf8').replace(/^﻿/, ''));
    return Array.isArray(messages) ? messages : [];
  } catch (e) {
    // fichier absent ou abîmé : aucun message n'est coupé, et le passage continue
    console.error(`config/notifications.json illisible (${e.message}) : tous les messages partent`);
    return [];
  }
}
export const CATALOGUE = lireCatalogue();

// Un message coupé ne part pas. Seul un message réglable se coupe : un livrable à publier, une
// réponse à une commande ou une mise en pause de sécurité partent toujours, quoi que dise le fichier.
export function notificationActive(id, catalogue = CATALOGUE) {
  const message = catalogue.find((m) => m.id === id);
  return !message || !message.reglable || message.actif !== false;
}
