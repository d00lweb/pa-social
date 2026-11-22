// Tout ce que le robot dit sur Telegram s'écrit ici, et nulle part ailleurs.
//
// Quatre règles, valables pour chaque message. Elles sont vérifiées par tests/messages.test.mjs.
//
//  1. HTML partout. Telegram n'interprète les balises que si l'envoi passe `parse_mode: HTML` :
//     un message parti sans lui affiche « <b>Budget</b> » en clair. C'est pourquoi `alert()` et
//     `send()` envoient désormais tous les deux en HTML, avec repli en texte nu si Telegram refuse.
//  2. Tout texte venu d'ailleurs (titre d'article, message d'erreur, nom de lieu) passe par esc().
//     Un titre contenant « & » ou « < » ferait échouer l'envoi entier.
//  3. Un message à copier ne contient QUE ce qu'il faut copier. Pas d'étiquette, pas d'emoji, pas
//     de compteur : l'étiquette est portée par le bouton. Sinon une copie du message ramène le
//     titre avec, qu'il faut effacer à la main — et la ligne vide laissée derrière fait commencer
//     le post par un saut de ligne.
//  4. Un seul geste. Le bouton « copier » (copy_text, Bot API 8.0) met le texte exact dans le
//     presse-papier ; il ne passe pas 256 caractères, au-delà le message reste copiable à l'appui.

import { readFileSync } from 'node:fs';
import { fromRoot } from '../core/config.mjs';

export const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

// Limite de Telegram pour le texte d'un bouton copy_text
export const COPIE_MAX = 256;

// Un élément à copier : le message ne porte que la valeur, l'étiquette est sur le bouton.
// `lien` ajoute un second bouton à côté — « Publier sur X » se trouve ainsi contre le texte
// qu'il faut y coller, et non trois messages plus haut.
export function aCopier(etiquette, valeur, { note = null, lien = null } = {}) {
  const texte = String(valeur ?? '').trim();
  const message = { text: `<code>${esc(texte)}</code>`, options: {} };
  if (note) message.text += `\n<i>${esc(note)}</i>`;
  const boutons = [];
  if ([...texte].length <= COPIE_MAX) boutons.push({ text: `📋 ${etiquette}`, copy_text: { text: texte } });
  if (lien) boutons.push({ text: lien.texte, url: lien.url });
  if (boutons.length) message.options.reply_markup = JSON.stringify({ inline_keyboard: [boutons] });
  return message;
}

// ── Publication ────────────────────────────────────────────────────────────────
// Message envoyé après chaque publication automatique. Le lien part dans un bouton : une URL
// noyée dans un texte ne se clique pas d'un geste, et Telegram en ferait un aperçu encombrant.
export function messagePublie(reseau, titre, lien) {
  const text = `📣 <b>Publié sur ${esc(reseau)}</b>\n${esc(titre)}`;
  if (!lien) return { text, options: {} };
  return { text, options: { reply_markup: JSON.stringify({ inline_keyboard: [[{ text: `👁️ Voir sur ${reseau}`, url: lien }]] }) } };
}

// ── Alertes ────────────────────────────────────────────────────────────────────
// Les montants sont relevés en dollars et annoncés en euros (1 € = 1,0989 $)
export const DOLLARS_PAR_EURO = 1.0989;
export const euros = (dollars) => `${(Number(dollars) / DOLLARS_PAR_EURO).toFixed(2).replace('.', ',')} €`;

export function alerteBudget(etat, { couperAuPlafond }) {
  if (!etat.depasse) {
    return `⚠️ <b>Budget IA : ${Math.round(etat.part * 100)} % consommés</b> — ${euros(etat.depense)} sur ${euros(etat.budget)}.`
      + (couperAuPlafond ? '\nAu-delà, les publications passeront en version de secours.' : '\nAu-delà, tu seras prévenu : le rédacteur continuera d’écrire normalement.');
  }
  return couperAuPlafond
    ? `🛑 <b>Budget IA du mois atteint</b> — ${euros(etat.depense)} sur ${euros(etat.budget)}.\nLe rédacteur n’est plus appelé : les publications partent en version de secours jusqu’au 1er du mois.\nPour relever le plafond : <code>budgetMensuelUSD</code> dans config/channels.json.`
    : `🛑 <b>Budget IA du mois dépassé</b> — ${euros(etat.depense)} sur ${euros(etat.budget)}.\nLe rédacteur continue d’écrire : rien n’est dégradé. Pour qu’il s’arrête au plafond, passer <code>couperAuPlafond</code> à <code>true</code> dans config/channels.json.`;
}

export function alerteIa(message, { manqueDeCredit }) {
  return manqueDeCredit
    ? '🧠 <b>Plus de crédit sur la clé Claude</b>\nLe rédacteur ne tourne plus : les publications partent en version de secours, sans accroche travaillée, sans mention de compte.\n\nRecharger sur console.anthropic.com → Plans & Billing. Les articles en attente repartiront ensuite tout seuls.'
    : `🧠 <b>Rédacteur IA injoignable</b>\n${esc(String(message ?? '').slice(0, 200))}\n\nLes publications partent en version de secours en attendant.`;
}

export function alerteJeton(nom, jeton) {
  if (jeton.invalide || !jeton.expireLe) {
    const qui = nom === 'meta' ? 'Meta (Facebook + Instagram)' : 'Threads';
    return `🔑 <b>Jeton ${qui} refusé</b>\nLes publications concernées attendent. Écris à Claude, dans le dashboard : « Aide-moi à refaire le jeton ${nom === 'meta' ? 'Meta' : 'Threads'} ».`;
  }
  return nom === 'meta'
    ? `🔑 <b>Jeton Meta</b> (Facebook + Instagram)
Il s’arrête le ${esc(new Date(jeton.expireLe).toLocaleDateString('fr-FR'))} (${jeton.restant} jours).
Il faut le refaire avant. Écris à Claude, dans le dashboard : « Aide-moi à refaire le jeton Meta ».`
    : `🔑 <b>Jeton Threads</b> — ${jeton.restant} jours restants.
Son renouvellement automatique n’a pas fonctionné. Écris à Claude, dans le dashboard : « Renouvelle le jeton Threads ».`;
}

// Des publications que personne ne voit : le 22/11/2026, 88 publications Facebook avaient 0 vue
// depuis deux mois, parce que l’application Meta était restée en mode développement.
export const alerteFacebookInvisible = (combien) =>
  `👻 <b>Facebook : aucune vue</b> sur les ${combien} dernières publications mesurées.
Elles ne sont sans doute pas visibles du public. Écris à Claude, dans le dashboard : « Facebook n’est plus visible, aide-moi ».`;

export const alerteFlux = (heures, detail) =>
  `📡 <b>Flux RSS du site injoignable</b> depuis ${Math.max(1, Math.round(heures))} h\n${esc(String(detail ?? '').slice(0, 200))}\nLes publications déjà programmées partent normalement ; aucun nouvel article n’entre en file tant que le flux ne répond pas.`;

export const alerteJetonRefuse = (reseau, detail) =>
  `🔑 <b>Jeton refusé</b> · ${esc(reseau)}\n${esc(detail)}\nLes publications concernées sont reportées d’heure en heure : rien n’est perdu, elles repartiront dès le jeton remplacé.`;

export const alerteThreadsReponse = (titre, texte) =>
  `⚠️ <b>Threads</b> — post publié, réponse (lien) non postée\n${esc(titre)}\n<code>${esc(texte)}</code>`;

// ── Catalogue ──────────────────────────────────────────────────────────────────
// La vue d’ensemble : chaque message que le robot peut envoyer, son déclencheur, sa fréquence, et
// s’il se coupe. Elle vit dans config/notifications.json, que le dashboard lit et modifie aussi.
// Garde-fou : un message nouveau s’y inscrit (tests/messages.test.mjs, tests/notifications.test.mjs).
function lireCatalogue() {
  try {
    const { messages } = JSON.parse(readFileSync(fromRoot('config/notifications.json'), 'utf8').replace(/^\uFEFF/, ''));
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
