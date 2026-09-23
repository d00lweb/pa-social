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

export const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

// Limite de Telegram pour le texte d'un bouton copy_text
export const COPIE_MAX = 256;

// Un élément à copier : le message ne porte que la valeur, l'étiquette est sur le bouton.
export function aCopier(etiquette, valeur, { note = null } = {}) {
  const texte = String(valeur ?? '').trim();
  const message = { text: `<code>${esc(texte)}</code>`, options: {} };
  if (note) message.text += `\n<i>${esc(note)}</i>`;
  if ([...texte].length <= COPIE_MAX) {
    message.options.reply_markup = JSON.stringify({ inline_keyboard: [[{ text: `📋 ${etiquette}`, copy_text: { text: texte } }]] });
  }
  return message;
}

// ── Alertes ────────────────────────────────────────────────────────────────────
const euros = (n) => `${Number(n).toFixed(2).replace('.', ',')} $`;

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
  return nom === 'meta'
    ? `🔑 <b>Jeton Meta</b> (Facebook + Instagram)\nAccès aux données jusqu’au ${esc(new Date(jeton.expireLe).toLocaleDateString('fr-FR'))}.\nÀ refaire dans les paramètres Meta, ou passer à un jeton d’utilisateur système, qui n’expire jamais.`
    : `🔑 <b>Jeton Threads</b> — ${jeton.restant} jours restants.\nLancer <code>npm run threads:refresh -- --ecrire</code> puis <code>gh secret set SOCIAL &lt; .env</code> depuis Git Bash.`;
}

export const alerteJetonRefuse = (reseau, detail) =>
  `🔑 <b>Jeton refusé</b> · ${esc(reseau)}\n${esc(detail)}\nLes publications concernées sont reportées d’heure en heure : rien n’est perdu, elles repartiront dès le jeton remplacé.`;

export const alerteThreadsReponse = (titre, texte) =>
  `⚠️ <b>Threads</b> — post publié, réponse (lien) non postée\n${esc(titre)}\n<code>${esc(texte)}</code>`;

// ── Catalogue ──────────────────────────────────────────────────────────────────
// La vue d'ensemble : chaque message que le robot peut envoyer, son déclencheur et sa fréquence.
// Sert de sommaire pour le README et de garde-fou : un message nouveau s'inscrit ici.
export const CATALOGUE = [
  { id: 'apercu', titre: 'Aperçu d’un article', quand: 'à chaque article retenu', frequence: '1 à 3 par jour', copiable: false, module: 'channels/preview.mjs' },
  { id: 'kit-x', titre: 'Kit X', quand: 'au créneau X de l’article', frequence: '1 par article', copiable: true, module: 'channels/x.mjs' },
  { id: 'story', titre: 'Story Instagram', quand: 'après la publication du carrousel', frequence: '1 par article', copiable: true, module: 'channels/instagram.mjs' },
  { id: 'publication', titre: 'Publication faite', quand: 'après chaque publication automatique', frequence: '3 à 8 par jour', copiable: false, module: 'index.mjs' },
  { id: 'bilan-hebdo', titre: 'Bilan de diffusion', quand: 'lundi matin', frequence: '1 par semaine', copiable: false, module: 'measure/diffusion.mjs' },
  { id: 'bilan-mensuel', titre: 'Bilan du mois', quand: 'le 1er du mois', frequence: '1 par mois', copiable: false, module: 'measure/diffusion.mjs' },
  { id: 'conso-hebdo', titre: 'Point conso du rédacteur IA', quand: 'dimanche après 19 h', frequence: '1 par semaine', copiable: false, module: 'brain/couts.mjs' },
  { id: 'budget', titre: 'Alerte budget', quand: '70 % du plafond, puis dépassement', frequence: 'au plus 1 par jour et par seuil', copiable: false, module: 'brain/couts.mjs' },
  { id: 'ia-indisponible', titre: 'Rédacteur IA injoignable', quand: 'panne ou crédit épuisé', frequence: 'au plus 1 par jour', copiable: false, module: 'brain/couts.mjs' },
  { id: 'jeton-echeance', titre: 'Jeton bientôt expiré', quand: 'seuil de jours restants', frequence: 'au plus 1 par semaine et par jeton', copiable: false, module: 'measure/jetons.mjs' },
  { id: 'jeton-refuse', titre: 'Jeton refusé', quand: 'refus du réseau à la publication', frequence: 'au plus 1 par jour', copiable: false, module: 'index.mjs' },
  { id: 'threads-reponse', titre: 'Réponse Threads non postée', quand: 'échec de la réponse portant le lien', frequence: 'rare', copiable: true, module: 'channels/threads.mjs' },
  { id: 'commandes', titre: 'Réponses aux commandes', quand: '/statut /file /pause /reprise /validation /x /aide', frequence: 'à la demande', copiable: false, module: 'core/control.mjs' },
];

