# pa-social

Republication automatique des articles de **Passion Aquitaine** (passion-aquitaine.ouest-france.fr) en **carrousel Instagram**, avec une **story** envoyée sur Telegram pour publication manuelle.

> **Vue centrale** : ouvrir [pilotage.html](pilotage.html) dans un navigateur (réseaux, formats, avancement, leviers). Ses **aperçus par réseau**, avec filtre et choix de l'article, se mettent à jour avec `npm run preview -- --latest=6`, qui écrit `out/preview-data.js` (fichier local, non versionné).
>
> **Chantier en cours** : relais réseaux sociaux intelligent (Bluesky, Facebook, Threads, kit X, IA éditoriale), suivi dans [docs/ROADMAP.md](docs/ROADMAP.md).
>
> **Règle de maintenance** : ce document est la mémoire du projet. Il doit être mis à jour après chaque fonctionnalité ou modification importante (sections concernées + [Journal des évolutions](#journal-des-évolutions)). Dépôt public : n'y écrire **aucun secret** (mot de passe, token, identifiant de compte).

---

## Sommaire

1. [En bref](#en-bref)
2. [Fonctionnement d'une exécution](#fonctionnement-dune-exécution)
3. [Règles de publication](#règles-de-publication)
4. [Rendu des visuels](#rendu-des-visuels)
5. [Infrastructure et comptes](#infrastructure-et-comptes)
6. [Configuration (.env)](#configuration-env)
7. [Opérations courantes](#opérations-courantes)
8. [Reprise sur un nouveau poste](#reprise-sur-un-nouveau-poste)
9. [Dépannage : problèmes déjà rencontrés](#dépannage--problèmes-déjà-rencontrés)
10. [Limites connues et pistes](#limites-connues-et-pistes)
11. [Structure du code](#structure-du-code)
12. [Journal des évolutions](#journal-des-évolutions)

---

## En bref

| | |
|---|---|
| Statut | **En production depuis le 15/09/2026** |
| Compte Instagram | @lovaquitaine |
| Source | Flux RSS `https://passion-aquitaine.ouest-france.fr/feed/` |
| Exécution | GitHub Actions, dépôt public `d00lweb/pa-social` |
| Déclenchement | Tâche cron o2switch toutes les 20 min (principal) + cron GitHub (secours) |
| Images | Déposées en FTPS sur o2switch, servies depuis `https://passion-aquitaine.ouest-france.fr/social/` |
| Publication | API Instagram Graph (carrousel 2 images) |
| Story | Envoyée sur Telegram par le bot @PA_aquibot, à poster à la main avec un sticker lien |
| Coût | **0 €** (Actions gratuites en dépôt public, API Meta gratuite, hébergement déjà payé) |
| Interrupteur | Variable GitHub `PUBLISH_ENABLED` (supprimée = plus aucune publication) |

---

## Fonctionnement d'une exécution

1. Lecture du flux RSS.
2. Planification : chaque nouvel article de **moins de 24 h** entre dans la file `state/queue.json` avec une heure prévue par réseau. Elle tombe **3 h à 4 h 30** après la publication précédente (écart tiré au hasard), jamais entre **23 h et 7 h** (heure de Paris), avec un décalage aléatoire de **5 à 40 min**. La reprise du matin est elle aussi variable, entre 7 h 10 et 8 h 35.
3. Exécution : au plus **une publication due par réseau** à chaque passage. L'écart et les heures creuses sont revérifiés au moment de publier.
4. Garde-fous (voir ci-dessous). Si l'un saute, l'article est **bloqué**, avec une seule alerte Telegram. Une erreur passagère donne lieu à **3 essais** espacés, avec une alerte au premier et au dernier. Si le quota Instagram est atteint, la publication est reportée d'1 h.
5. Rendu des 3 visuels (Playwright + Chromium).
6. Dépôt FTPS des 3 JPEG, puis vérification que chaque URL publique répond `200 image/jpeg`.
7. Publication Instagram : 2 conteneurs image → attente `FINISHED` → conteneur carrousel → attente → `media_publish`.
8. Enregistrement dans `state/published.json` (guid, réseau, heure, id), puis retrait de la file. Le dossier `state/` est commité par le bot sur `main`.
9. Envoi de la story sur Telegram (image en document + titre + lien de l'article). Un échec ici ne bloque pas.

Légende Instagram :

```
<accroche rédigée par l'IA>
⠀
➡️ Article complet sur le site Passion Aquitaine
⠀
#Lieu #Sujet #Thème
```

Les lignes « vides » contiennent le caractère invisible U+2800, car Instagram supprime les lignes réellement vides.

### Bluesky (`src/channels/bluesky.mjs`)

API AT Protocol officielle et gratuite : connexion par **mot de passe d'application** (`BLUESKY_HANDLE`, `BLUESKY_APP_PASSWORD`). Le canal reste **inactif tant que ces deux variables manquent** (`requiresEnv`).

**Rotation de 3 formats** (`formats` dans `config/channels.json`), tirée d'après l'identifiant de l'article, donc stable pour un même article :

- **carte de lien** avec notre visuel en 1200×627 (1,91:1, moins de 1 Mo). La carte affiche le titre et la description de l'article, et le texte ne contient pas d'URL.
- **image 4:5** (1080×1350) avec texte alternatif, puis « ➡️ Lire l'article » à la ligne, rendu cliquable.
- **image 4:5, lien en réponse** : le post ne porte aucun lien, une réponse à notre propre post apporte le lien, précédé d'une formule tournante (« 📖 L'article complet : »…). Protège la portée du post, au prix des clics : l'étape 9 tranchera avec nos chiffres.
- **Texte :** hashtag du lieu cliquable, intégré au texte, 300 caractères maximum, langue du post déclarée en français.
- **Réglages :** validation Telegram, écart de 2 h 30 à 4 h, rien entre 22 h et 8 h, attente aléatoire avant publication.
- **Coupe-circuit** en cas de limite (HTTP 429) ou de sanction du compte.
- **Test d'accès, sans publier :** `npm run smoke:bsky`.
- **Identifiant de domaine :** `@passion-aquitaine.ouest-france.fr` (depuis le 15/09/2026), vérifié par le fichier `https://passion-aquitaine.ouest-france.fr/.well-known/atproto-did`, qui contient `did:plc:ypqeiof554p2x7wxn5syoq7o`. Ce fichier est dans le dossier `.well-known` à la racine du site. **Ne jamais le supprimer**, sinon l'identifiant retombe en invalide.

### Kit X (`src/channels/x.mjs`)

Pas d'API, qui est payante : X est un canal « manuel » de la file (`manual: true`), avec la même validation que les autres réseaux, et rien n'est envoyé entre 22 h et 7 h. Une fois l'article validé, le bot envoie sur Telegram :
- le **visuel titre en 4:5 (1080×1350)**, le même que le slide 1 d'Instagram, en fichier pour garder la qualité d'origine ;
- le **post**, qui se copie d'un appui : texte avec le hashtag du lieu intégré, puis à la ligne « ➡️ lien », avec le compteur X sur 280 (un lien compte 23, un emoji 2) ;
- un bouton **« ✍️ Publier sur X »**, un lien `x.com/intent/post` qui ouvre X avec le post pré-rempli. Il ne reste qu'à joindre l'image.

Format décidé par l'utilisateur le 15/09/2026, sur le modèle des posts du Figaro : image 4:5, texte, puis lien à la ligne. Les études (Buffer, Nieman Lab) indiquent qu'un lien réduit la portée sur X ; à surveiller à l'étape 9.

Variante du visuel sans le logo Ouest-France : `"hideOuestFrance": true` dans `config/channels.json`.

### Facebook (`src/channels/facebook.mjs`)

Page Passion Aquitaine, **inactif tant que `FB_PAGE_ID` et `FB_TOKEN` ne sont pas renseignés**.

- **Une seule image** 4:5 en 1440×1800, déposée sur le site puis publiée par son URL (Meta la télécharge).
- **Texte de 120 caractères maximum**, lu en entier sans « Voir plus », sans lien ni hashtag dans le corps.
- **Le lien part en premier commentaire**, 1 à 3 minutes après le post, précédé d'une formule tournante. Si le commentaire échoue, le post reste en ligne et une alerte Telegram le signale : la publication n'est jamais rejouée, sous peine de doublon.
- **Lieu** : même identifiant que sur Instagram ; s'il est refusé, le post part sans lieu.
- **Rythme** : un post par jour au plus (écart de 20 à 26 h), jamais entre 22 h et 8 h — la montée en charge se règle en abaissant `gapHours`.
- **Mentions** : reportées. Facebook exige l'identifiant numérique de la page mentionnée, que notre application ne peut pas encore lire.

### Threads (`src/channels/threads.mjs`)

Compte `@lovaquitaine`, **inactif tant que `THREADS_USER_ID` et `THREADS_TOKEN` ne sont pas renseignés**. Publication en deux temps : un conteneur, 30 secondes d'attente (recommandation de Meta), puis la publication.

- **Rotation de 3 formats** : image 4:5 + lien dans le texte · lien seul, avec l'aperçu natif de l'article · image dont le lien part **en réponse** à notre propre post, 1 à 3 minutes après.
- **500 caractères maximum**, un sujet Threads (`topic_tag`), texte alternatif sur l'image.
- **Mentions** : seulement en remplaçant un nom déjà écrit, et seulement si le compte possède un vrai profil Threads — sinon un @ n'est que du texte mort.
- **3 publications par jour au plus**, 2 h 30 à 4 h d'écart, jamais entre 22 h et 8 h.
- Si la réponse échoue, le post reste en ligne et une alerte Telegram le signale : la publication n'est jamais rejouée.
- **Jeton à durée de vie limitée** : 60 jours, renouvelable par `npm run threads:refresh`. Passé ce délai sans renouvellement, il est perdu et il faut réautoriser l'application.

### Mesure et rapports (`src/measure/`)

**Aucun réglage n'est jamais modifié automatiquement.** Les rapports observent, comparent et conseillent ; c'est toi qui décides d'appliquer ou non.

- **Relevés** : pour chaque publication, les interactions sont relevées à **J+1** et **J+7** (`state/mesures.json`). Disponible sans permission supplémentaire : likes et commentaires sur Instagram, likes, commentaires et partages sur Facebook, likes, reposts, réponses et citations sur Bluesky. La **portée** demande `instagram_manage_insights`, `read_insights` et `threads_manage_insights`, qui se cochent sans validation de Meta pour nos propres comptes.
- **Rapport hebdomadaire** : envoyé sur Telegram **le lundi après 8 h**, une seule fois (un marqueur d'état empêche les envois répétés du cron). Court : classements par réseau, par format et par créneau, meilleur et moins bon post, effet des mentions, puis des conseils chiffrés.
- **Rapports mensuels** : figés le 1er du mois dans `state/rapports/AAAA-MM.json` et consultables depuis `pilotage.html`.
- **Surveillance des jetons** : alerte Telegram 30 jours avant la fin de l'accès Meta, 15 jours avant l'échéance Threads, une fois par semaine au maximum.

### Pilotage en direct

`pilotage.html` lit `state/pilotage.json` **à chaque ouverture**, directement depuis GitHub (dépôt public, lecture autorisée entre domaines). La page affiche donc l'état réel : rythme du jour par réseau, prochaines publications, dernières publications, alertes, interactions moyennes et rapports mensuels. Aucun serveur, aucun coût.

### Page de l'équipe (publique)

`site/reseaux-sociaux.html` est la vitrine destinée aux rédacteurs et à Ouest-France : communauté totale, abonnés et progression des **cinq comptes** (X compris), planning à venir, meilleurs horaires avec l'heure courante, derniers articles relayés, bilan de chaque mois. **Elle se téléverse à la racine du site** (`https://passion-aquitaine.ouest-france.fr/reseaux-sociaux.html`) ; ses données se mettent ensuite à jour seules.

- **Données** : `src/measure/public.mjs` construit `reseaux.json` par **liste blanche** et le dépose à chaque passage dans `/social/` (même FTPS que les visuels). Seuls y entrent des titres, heures, chiffres et liens publics ; ni identifiant, ni erreur, ni pause, ni validation, ni raison de report. Ce qui attend un feu vert n'est pas annoncé. Liens et visuels sont limités à nos domaines.
- **Publications manuelles** : le kit X et la story Instagram sont publiés à la main dès leur réception sur Telegram. Le planning les annonce à cette heure-là, avec la mention « Publication manuelle » ; la story suit chaque carrousel.
- **Abonnés X** : X n'a pas d'API gratuite. Envoyer **`/x 2940`** au bot Telegram de temps en temps : le chiffre est rangé au jour de la saisie dans `state/abonnes.json`, et la page est à jour au passage suivant. Une saisie n'empêche pas le relevé automatique des autres réseaux ce jour-là.
- **Dernières publications** : une carte par article, illustrée par son visuel 4:5 (rubrique, titre, fond rouge), servi en vignette de 600 × 750 (une soixantaine de Ko au lieu de 300 à 950) créée et déposée à côté du visuel au premier besoin. Chaque pastille ouvre **le post lui-même** ; pour les publications d'avant le 18/09/2026, `src/measure/liens.mjs` retrouve le lien à partir de l'identifiant (12 par passage, un seul essai). X ne donne pas le lien de ses posts : sa pastille ouvre le compte.
- **Bilans mensuels** : recalculés tant que l'historique les contient et archivés dans `state/mois-publics.json` ; un sélecteur permet de revenir sur chaque mois passé.
- **Sécurité** : aucune ressource extérieure (police servie par le site), aucune insertion de HTML, politique CSP stricte à empreintes, `noindex`, aucun référent transmis. Aucune mention du dépôt ni de l'outillage : `tests/page-equipe.test.mjs` refuse les mots de l'envers du décor et les adresses inattendues.
- **Après toute modification de la page** : `node scripts/page-equipe.mjs` recalcule les empreintes CSP (sinon le navigateur refuse le script ; les tests le signalent), puis re-téléverser le fichier.
- `pilotage.html` reste la page interne, inchangée.

### Mentions de comptes et localisation

**Principe : le texte ne porte jamais une liste de comptes.** Une mention n'apparaît dans un texte que si elle remplace un nom déjà écrit (« la boulangerie @lamidupain17 ») ; sinon elle passe par un canal invisible, ou elle n'a pas lieu.

| Réseau | Mentions | Localisation |
|---|---|---|
| Instagram | tag sur la 1ʳᵉ image du carrousel, invisible dans le texte | portée par le carrousel |
| Bluesky | dans le texte, par substitution du nom, sinon aucune | impossible, la fonction n'existe pas |
| X | comptes fournis dans le kit, tagués sur l'image (0 caractère) | lieu fourni dans le kit |
| Threads | dans le texte, et seulement si le compte a un profil Threads | après autorisation Meta |
| Facebook | premier commentaire, avec le lien | portée par le post |

**Comment un compte est trouvé** (`src/brain/comptes.mjs`), sans annuaire figé et sans rien deviner :

1. l'IA fournit des **noms d'entités**, jamais des pseudos (`entites`, avec un rôle : sujet, acteur, tutelle, thème) ;
2. la fiche Wikidata de l'entité donne ses comptes déclarés et son **site officiel** ; le site donne le pseudo réel, réseau par réseau (il diffère souvent : *danslenoirbordeaux* sur Facebook, *danslenoirgroup* sur Instagram) ;
3. sur Bluesky, la recherche publique propose des comptes, et seuls ceux dont **tous les mots du nom** correspondent sont retenus, comparés en mots entiers (sans quoi « ami » se reconnaît dans « g**ami**ng », et une équipe d'e-sport se retrouve taguée) ;
4. un compte de fans, une parodie ou un profil vide sont écartés ; sur Threads, la présence d'un vrai profil est vérifiée ;
5. deux comptes au maximum, le sujet avant le thème, **et zéro quand rien n'est sûr**.

`config/comptes.json` ne sert qu'en dernier recours, pour les douze départements de notre zone : leurs sites chargent parfois leurs réseaux en JavaScript, invisibles au balayage. Ces comptes ont été relevés sur les sites officiels puis vérifiés par Meta. Tout le reste est trouvé dynamiquement — cette table complète la recherche, elle ne la remplace pas.

Trois pièges rencontrés en conditions réelles, chacun devenu un test : « ami » se reconnaissait dans « g**ami**ng » (d'où une équipe d'e-sport taguée), « Ville de Bordeaux » désignait un cargo sur Wikidata, et « Département de la Gironde » menait à un journal du XIXᵉ numérisé par Gallica, dont les comptes appartiennent à la BnF.

Si Meta refuse une mention (compte renommé ou passé en privé), la publication part sans elle : une mention n'empêche jamais un post.

**Localisation** (`src/brain/lieux.mjs`) : lieu précis nommé → ville → département → rien. Meta n'accepte que les identifiants longs (13 chiffres et plus) ; les identifiants courts hérités de l'ancien Instagram sont systématiquement refusés. Les villes viennent de Wikidata, les départements de `config/lieux.json`.

### Publication automatique (décision du 15/09/2026)

**Aucune validation manuelle.** Instagram, Bluesky et tous les réseaux ajoutés ensuite publient automatiquement (`"validation": false` dans `config/channels.json`). Telegram ne reçoit plus que :
- le **kit X**, à publier à la main ;
- la **story Instagram**, avec le sticker lien à poser à la main ;
- les **alertes** : garde-fou, échec, coupe-circuit.

Les aperçus restent désactivés, mais l'**avis de publication est actif** (`"telegram": { "previews": false, "publishedNotice": true }`) : dès qu'un post part, le bot envoie un message court avec un **bouton « Voir sur … »** qui ouvre la publication d'une seule touche. Le lien n'est jamais placé dans le texte ni dans une balise `<code>` : sous Telegram, une URL en `<code>` se copie mais ne se clique pas. Repasser `publishedNotice` à `false` suffit à tout couper. Les commandes `/statut`, `/file`, `/pause` et `/reprise` restent disponibles. `/validation <réseau> on` réactive la validation d'un réseau, mais sans aperçu il n'y aurait rien à valider : il faudrait aussi remettre `previews` à `true`.

### Centre de contrôle Telegram (bot @PA_aquibot)

Pas de serveur : le bot lit boutons et commandes à **chaque passage du cron** (toutes les 20 min environ), avec `getUpdates`. Le curseur de lecture est dans `state/telegram.json`. Seuls les messages du chat `TELEGRAM_CHAT_ID` sont pris en compte.

- **Aperçu de chaque nouvel article :** les 2 visuels, puis les textes des 5 réseaux (citations repliables) avec l'heure prévue.
  - En **mode validation**, statut `awaiting` : boutons ✅ Valider, ❌ Refuser, 🔁 Régénérer les textes (nouvel appel IA, puis nouvel aperçu).
  - En automatique : boutons ❌ Annuler et 🔁 Régénérer.
  - Un garde-fou détecté au moment de l'aperçu bloque l'article tout de suite.
- **Commandes :**
  - `/statut`, `/file` ;
  - `/pause <réseau|tout>`, `/reprise <réseau|tout>` ;
  - `/validation <réseau> on|off` ;
  - `/aide`.

  Les réglages sont stockés dans `state/controls.json` et priment sur `config/channels.json`.
- **Notifications :** 📣 publié, ⌛ non validé avant 24 h (article abandonné), ❌ échec, ⛔ bloqué, et la story à poster.
- **Mode validation par défaut :** `"validation": true` par réseau dans `config/channels.json`. Instagram est en validation depuis le 15/09/2026 ; pour le repasser en automatique : `/validation instagram off`.
- **Test :** `npm run telegram:test` installe le menu de commandes et envoie un aperçu d'exemple, dont les boutons restent sans effet.

### Rédacteur en chef IA (`src/brain/`)

À la planification, **un appel Claude par article** (`claude-opus-5`, effort bas) produit un **dossier de publication**, conservé dans la file :
- nature (actu chaude, actu, intemporel) et sensibilité ;
- rubrique identitaire ;
- titre adapté au visuel et groupe surligné, **texte de la 2ᵉ image** (220 caractères max) ;
- texte alternatif ;
- textes Instagram (+ 3 hashtags), Facebook, Bluesky (+ hashtag), Threads et X.

- **Données fournies :** titre, description, catégories et date du flux seulement, plus le lieu détecté par `config/geo.json`, un angle d'accroche différent par réseau (rotation dans `config/editorial.json`) et les 10 dernières accroches par réseau (`state/memory.json`).
- **Contrôles** (`guards.mjs`) :
  - longueurs ;
  - surlignage copié du titre, sans petit mot en bordure ;
  - rubrique jamais générique ni interne (« Actus », « … LOI ») ;
  - 3 hashtags valides ;
  - **aucun chiffre ni nom propre absent des données** ;
  - aucun emoji sur un sujet sensible ;
  - pas de tournures reprises entre réseaux ni depuis les accroches récentes.

  Jusqu'à 3 essais avec les corrections, sinon **règles de secours** (`fallback.mjs` : lexique géographique, thèmes, surlignage chiffre > nom propre > fin de titre).
- **Jamais de texte tronqué par un réseau :**

  | Réseau | Longueur max | Emojis | Hashtags |
  |---|---|---|---|
  | Instagram | 1ʳᵉ ligne ≤ 125 car. (le reste passe sous « plus », c'est inévitable) | 1–3 | 3 en fin de légende |
  | Facebook | **120 car.** (pas de « Voir plus » sur mobile) | 1–2 | 0 |
  | Bluesky | 260 car. (limite 300) | 1 | 1 de lieu |
  | Threads | 450 car. (limite 500) | 1–2 | 0 dans le texte + 1 sujet Threads (`topic_tag`) |
  | X | 230 car. + « ➡️ lien » à la ligne | 1–2 | 1 de lieu, s'il figure dans le texte |

  **Emojis stratégiques :** au moins un par texte, choisi selon le sujet (🐝, 🏰, 🍷…), placé à des endroits variés (en tête, en fin de phrase, devant une information clé). Contrôles : pas les mêmes emojis que dans les 2 derniers posts du réseau, et sur un sujet sensible un seul emoji sobre (📍 🗞️ 📰 ℹ️). Les règles de secours ajoutent l'emoji du thème.
- **Mise en forme par le code** (`src/brain/compose.mjs`) :
  - Instagram : ligne blanche entre chaque paragraphe.
  - Bluesky : le hashtag remplace le mot du lieu s'il figure déjà dans le texte, sinon il est ajouté à la fin.
  - X : hashtag du lieu seulement s'il figure déjà dans le texte (jamais ajouté), puis « ➡️ lien » à la ligne.
  - Facebook : premier commentaire = formule variée (« 📖 L'article complet : »…) + lien.
- **Anti-appât** (règle Meta sur l'« engagement bait ») :
  - questions limitées : seulement quand l'angle est « question », ou 1 article sur 3 pour Facebook et Threads ;
  - formules interdites : commentez, partagez, taguez, likez, cliquez… ;
  - jamais de point juste avant un emoji.
- **Charte éditoriale modifiable sans code :** `prompts/editorial.md`. Réglages : `config/editorial.json` (modèle, angles, limites, mots vides, thèmes, hashtags interdits). Zones identitaires : `config/geo.json` (Pays basque, Béarn, Médoc, Périgord…).
- **Coût mesuré :** environ 3 100 tokens en entrée et 750 en sortie, soit **~0,03 $ par article** (~2,5–3 €/mois).
- **Sans `ANTHROPIC_API_KEY`**, ou si l'API est indisponible : règles de secours, la publication continue.

---

## Règles de publication

### Garde-fous (vérifiés avant toute publication)

- image source absente (balise `<enclosure>`) ou de moins de **1200 px** de large ;
- description vide ou de plus de **300 caractères** ;
- titre qui ne tient pas à **44 px** sur 4 lignes ;
- description qui ne tient pas à **40 px** sur 9 lignes ;
- **6 publications ou plus** sur les dernières 24 h (`content_publishing_limit`) ;
- guid déjà présent dans l'état.

### Constantes

| Règle | Valeur | Fichier |
|---|---|---|
| Âge max d'un article | 24 h | `config/channels.json` (`maxAgeHours`) |
| Écart entre publications | 3 h – 4 h 30, tiré au hasard | `config/channels.json` (`gapHours`) |
| Heures creuses | 23 h – 7 h | `config/channels.json` (`quietHours`) |
| Décalage aléatoire | 5 – 40 min | `config/channels.json` (`jitterMinutes`) |
| Reprise du matin | 7 h + 10 à 95 min | `config/channels.json` (`morningJitterMinutes`) |
| Attente avant publication | 0 – 9 min | `config/channels.json` (`publishDelayMinutes`) |
| Coupe-circuit | codes Meta 4, 17, 32, 368, 613 (+ sous-codes de blocage) | `config/channels.json` (`restriction`) |
| Publications max / jour | Instagram 2 · Facebook 2 · Bluesky 3 · kit X 3 | `config/channels.json` (`maxPerDay`) |
| Quota Meta / 24 h | 6 (limite d'Instagram elle-même) | `config/channels.json` (`maxPer24h`) |
| Essais en cas d'erreur | 3 (délai de 30 min × n° d'essai) | `config/channels.json` (`retry`) |
| Largeur min image source | 1200 px | `src/channels/instagram.mjs` |
| Description max | 300 caractères | `src/channels/instagram.mjs` |

### Protection anti-bannissement

- **API officielles uniquement**, aucune interaction automatique (likes, abonnements, réponses).
- **Heures imprévisibles :**
  - écart variable entre deux posts ;
  - décalage aléatoire, reprise du matin variable ;
  - **attente aléatoire de 0 à 9 min au moment de publier**, pour que les posts ne tombent pas sur les minutes fixes du cron (:00, :20) ;
  - plafond quotidien par réseau, compté à l'heure de Paris et remis à zéro chaque jour.
- **Réserve (entonnoir) :** quand le plafond du jour est atteint, l'article n'est ni perdu ni forcé — il reste en file et part au premier créneau du lendemain. Un flux chargé s'écoule ainsi sur plusieurs jours, au rythme choisi, sans jamais publier en rafale.
- **Textes toujours différents :**
  - angles en rotation, contrôle des tournures reprises ;
  - questions limitées, formules d'appât interdites ;
  - formules de commentaire Facebook en rotation.
- **Coupe-circuit :** si Meta renvoie une erreur de limite ou de restriction, le réseau est **mis en pause automatiquement** avec une alerte Telegram, et la reprise se fait à la main avec `/reprise <réseau>`.
- **Volume :** au plus 6 posts par 24 h par réseau, un article par passage.
- **À faire côté humain :**
  - ouvrir régulièrement les apps depuis les mêmes appareils ;
  - répondre soi-même aux commentaires ;
  - publier de temps en temps un contenu à la main (coulisses, story, sondage) ;
  - garder la double authentification et des profils complets.

### Règles rédactionnelles (`src/brain/editorial.mjs`)

- **Lecture du flux** : image = URL de `<enclosure>` (jamais `<media:content>`, vignette 400 px). Description = premier `<p>` de `<description>`, sans le paragraphe « L'article … est apparu en premier sur … », entités décodées, apostrophes typographiques, parenthèse finale de moins de 40 caractères supprimée.
- **Rubrique** (encart rouge) : catégorie géographique (liste des départements et villes de Nouvelle-Aquitaine) > première catégorie qui n'est ni « Actus » ni « Actualités » > première catégorie. Casse d'origine.
- **Titre** : l'amorce géographique qui répète la rubrique est retirée (« En Haute-Vienne, les abeilles… » → « Les abeilles… »).
- **Groupe surligné** : dernier mot, précédé de son déterminant (« les Pyrénées », « d'un siècle », « l'électro »), max 3 mots et 22 caractères. Nombre + unité = un seul mot (« 42 °C »).
- **Typographie** : espace fine insécable avant °C, %, € et en séparateur de milliers ; insécable avant : ; ! ?

---

## Rendu des visuels

Gabarit unique `src/media/templates/card.html`, mis en page en 1080×1350 (px CSS), rendu à ×2 puis réduit à la taille livrée, JPEG qualité 95 en 4:4:4, sRGB, < 8 Mo.

| Visuel | Taille | Contenu |
|---|---|---|
| Slide 1 | 1440×1800 | Photo, dégradé sombre, bandeau logos, rubrique, titre avec surlignage |
| Slide 2 | 1440×1800 | Fond rouge `#CD402C`, bandeau identique au slide 1, description centrée |
| Story | 1080×1920 | Comme le slide 1, bandeau à 140 px du haut (×1,3), bloc titre calé à 380 px du bas (zone sticker lien) |

- **Bandeau** : construit en HTML (logo Ouest-France SVG vectoriel + « avec » en Montserrat + logo Passion Aquitaine PNG 524×205). Position et taille strictement identiques sur les slides 1 et 2.
- **Police** : Montserrat variable (`assets/fonts/`, licence OFL).
- **Tailles automatiques** : titre 44–66 px (4 lignes max), description 40–76 px (9 lignes max), par recherche binaire.
- **Cadrage** (`src/media/crop.mjs`) : les photos du flux sont en paysage (souvent 16:9). Une carte du sujet (zones détaillées et distinctes du fond) choisit la fenêtre qui garde au moins 70 % du sujet. Si un cadrage plein cadre ne suffit pas, le cadre est élargi et le reste du canevas est rempli par la même photo floutée et assombrie, raccordée en fondu. Fenêtre descendue de 10 % pour que le sujet reste au-dessus du titre.
- **Lisibilité** : si la luminance de la bande 60–100 % dépasse 150/255, le dégradé sombre est renforcé.
- **Surlignage** (`src/media/brush.mjs`) : texture de pinceau sec générée (fibres, manques laissant voir l'image, bouts effilochés), rouge `#CD402C`, légèrement différente pour chaque titre.

---

## Infrastructure et comptes

Les valeurs sensibles ne sont **jamais** dans ce dépôt. Elles sont dans le secret GitHub `SOCIAL` et doivent être conservées dans un gestionnaire de mots de passe (GitHub ne permet pas de relire un secret).

### GitHub

- Dépôt **public** `d00lweb/pa-social` : minutes Actions illimitées et gratuites (en privé, le quota gratuit serait dépassé). Aucun secret dans le code ; `.env` et `out/` sont ignorés.
- Workflow `.github/workflows/publish.yml` :
  - déclencheurs : `schedule` `*/10 * * * *` et `workflow_dispatch` (utilisé par le cron o2switch et à la main). **Le `schedule` n'est pas une horloge** : mesuré le 18/09/2026, GitHub n'a exécuté que 2 des 48 passages demandés, à des minutes arbitraires. On demande donc le plus court intervalle utile, non pour tenir une cadence mais pour multiplier les chances le jour où o2switch s'interrompt. La cadence réelle vient d'o2switch, à :00 et :20 ;
  - case « Test à blanc » au lancement manuel (`dry_run`) ;
  - `concurrency` : jamais deux exécutions simultanées ;
  - Node 24, cache npm et cache du navigateur Playwright ;
  - le secret `SOCIAL` est écrit dans `.env` au début, supprimé à la fin.
- **Secret `SOCIAL`** : contenu complet du fichier `.env` (voir [Configuration](#configuration-env)).
- **Variable `PUBLISH_ENABLED`** = `true` : sans elle, aucune publication, quel que soit le déclencheur. Seul le test à blanc reste possible.

### o2switch (hébergement du site)

- **Compte FTP dédié** (cPanel → Comptes FTP), enfermé dans le dossier `social` qui se trouve **à côté de `wp-config.php`** (racine du site passion-aquitaine.ouest-france.fr). Le dossier contient un `index.html` vide.
- **Connexion** : FTPS explicite, port 21. Le serveur doit être désigné par **`pasta.o2switch.net`** (nom inscrit sur son certificat TLS ; `ftp.passion-aquitaine.fr` pointe sur la même machine mais le certificat est refusé).
- SSH/SFTP (port 22) est fermé par o2switch aux IP non autorisées : inutilisable depuis GitHub Actions.
- **Tâche cron** (cPanel → Tâches cron) : déclenche le workflow via l'API GitHub avec un token à droits limités (fine-grained, dépôt `pa-social` seul, permission *Actions : Read and write*, sans expiration). Le token est stocké dans `~/.pa-social-token` (permissions 600). Commande (les `\%` sont obligatoires en cron) :

  ```
  echo "$(date '+\%F \%T') $(curl -sS -o /dev/null -w '\%{http_code}' -X POST -H "Accept: application/vnd.github+json" -H "Authorization: Bearer $(cat $HOME/.pa-social-token)" https://api.github.com/repos/d00lweb/pa-social/actions/workflows/publish.yml/dispatches -d '{"ref":"main"}' 2>&1)" >> $HOME/pa-social-cron.log
  ```

  Chaque passage ajoute une ligne dans `~/pa-social-cron.log` : `204` = OK. Réglage actuel : minutes 00 et 20 (le passage de la minute 40 ne part pas ; choix assumé, retard max 40 min).

### Meta / Instagram

- Application Meta : **« Passion Aquitaine Social »**.
- Compte Instagram professionnel @lovaquitaine, lié à la Page Facebook.
- Token : token de **Page** (`EA…`, API `graph.facebook.com`, version `v23.0`), permissions `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`, `business_management`.
- Le token n'expire pas, mais **son accès aux données expirait le 13/12/2026** lors de la dernière vérification (15/09/2026). Un token d'**utilisateur système** (Meta Business Suite → Paramètres de l'entreprise → Utilisateurs système) n'a pas cette limite. Vérification :

  ```
  GET https://graph.facebook.com/v23.0/debug_token?input_token=<TOKEN>&access_token=<TOKEN>
  ```

  Regarder `expires_at` (0 = jamais) et `data_access_expires_at`.

### Telegram

- Bot **@PA_aquibot** (créé via @BotFather), qui écrit dans un chat privé.
- Reçoit : les alertes (garde-fous, erreurs) et la story (fichier image + titre + lien pour le sticker).
- Facultatif : sans `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`, les messages sont seulement écrits dans le journal.

---

## Configuration (.env)

Modèle : `.env.example`. Le même contenu est stocké dans le secret GitHub `SOCIAL`.

| Variable | Rôle | Où trouver la valeur |
|---|---|---|
| `IG_USER_ID` | Id du compte Instagram professionnel | Graph API Explorer : `me/accounts?fields=instagram_business_account` |
| `IG_TOKEN` | Token de Page Meta | App « Passion Aquitaine Social » / utilisateur système |
| `GRAPH_VERSION` | Version d'API | `v23.0` par défaut |
| `RSS_URL` | Flux | défaut : `https://passion-aquitaine.ouest-france.fr/feed/` |
| `SFTP_HOST` | Serveur FTPS (nom historique) | `pasta.o2switch.net` |
| `SFTP_USER` / `SFTP_PASS` | Compte FTP dédié | cPanel → Comptes FTP |
| `SFTP_DIR` | Dossier dans le compte FTP | `/` (le compte démarre déjà dans `social`) |
| `PUBLIC_BASE_URL` | URL publique du dossier | `https://passion-aquitaine.ouest-france.fr/social` |
| `TELEGRAM_BOT_TOKEN` | Token du bot | @BotFather |
| `TELEGRAM_CHAT_ID` | Chat destinataire | `getUpdates` du bot après lui avoir écrit |
| `ANTHROPIC_API_KEY` | Clé API Claude (rédacteur IA) | console.anthropic.com → API Keys (clé « pa-social ») |
| `BLUESKY_HANDLE` | Identifiant Bluesky | `passion-aquitaine.ouest-france.fr` |
| `BLUESKY_APP_PASSWORD` | Mot de passe d'application | App Bluesky → Réglages → Confidentialité et sécurité → Mots de passe d'application |
| `FB_PAGE_ID` | Id de la Page Facebook | `227437307428711` |
| `FB_TOKEN` | Token **de Page** avec `pages_manage_posts` et `pages_manage_engagement` | `GET /me/accounts?fields=name,access_token` avec le token utilisateur. Un token d'utilisateur est refusé : « Unpublished posts must be posted to a page as the page itself ». `npm run smoke:fb` affiche `type : PAGE` quand c'est le bon. |
| `THREADS_USER_ID` | Id du compte Threads | `GET https://graph.threads.net/v1.0/me?fields=id,username` |
| `THREADS_TOKEN` | Jeton Threads longue durée (60 jours, à rafraîchir) | produit par `npm run threads:setup -- <jeton-court>` |
| `THREADS_APP_SECRET` | Clé secrète de l'app Threads | App Dashboard → Paramètres → Général. Sert uniquement à l'échange en jeton longue durée |
| `TEST_IMAGE` | Image publique pour `smoke-ig.mjs` | une ou plusieurs URL, séparées par des virgules |

Variables de test : `DRY_RUN=1` (rendu + FTP, sans Instagram ni Telegram ni état) et `DRY_RUN_LATEST=n` (avec `DRY_RUN`, traite les n derniers articles du flux).

---

## Opérations courantes

| Besoin | Action |
|---|---|
| Couper toutes les publications | GitHub → Settings → Secrets and variables → Actions → Variables → supprimer `PUBLISH_ENABLED` |
| Réactiver | recréer `PUBLISH_ENABLED` = `true` |
| Publier tout de suite (respecte les règles) | Actions → Publication Instagram → Run workflow (case décochée) |
| Tester sans publier sur GitHub | Run workflow avec « Test à blanc » cochée |
| Relancer un ancien article (plus de 24 h) | Run workflow, champ « Relancer un ancien article » : mots du titre (`abeilles`), ou l'adresse de l'article. Il est mis en file pour tous les réseaux non encore publiés, dès que les règles d'écart et d'heures creuses le permettent |
| Vérifier les déclenchements o2switch | lire `~/pa-social-cron.log` (lignes `204`) |
| Voir ce qu'une exécution a fait | Actions → exécution → étape « Publier » |
| Republier un article déjà publié | retirer son entrée de `state/published.json`, committer (attention au doublon Instagram) |
| Activer Facebook | renseigner `FB_PAGE_ID` et `FB_TOKEN` dans `.env` **et** dans le secret `SOCIAL`, vérifier avec `npm run smoke:fb` |
| Mettre à jour les secrets | coller le `.env` complet dans le secret `SOCIAL`. En ligne de commande, **depuis Git Bash** : `gh secret set SOCIAL < .env`. Jamais via un tube PowerShell (`Get-Content \| gh secret set`) : il ajoute un marqueur d'encodage invisible qui casse la première variable, et toutes les exécutions échouent sur `Variables manquantes : IG_USER_ID`. |

Commandes locales :

```bash
npm run smoke -- --mode=single        # accès Meta : compte, quota, conteneur, sans publier
npm run smoke -- --mode=carousel      # idem en carrousel ; ajouter --publish pour publier réellement
DRY_RUN=1 DRY_RUN_LATEST=3 node --env-file=.env src/index.mjs   # rendu + FTP des 3 derniers articles, sans publier
npm test                              # tests hors ligne (règles, planificateur, état, 12 articles réels)
npm run preview                       # planches d'aperçu out/preview-*.jpg des articles de test, sans dépôt
npm run preview -- --latest=6         # idem sur les 6 derniers articles du flux
npm run fixtures                      # régénère tests/fixtures/articles.json depuis le flux
npm run smoke:fb                      # jeton Facebook : Page, permissions, brouillon accepté — sans rien publier
npm run threads:setup -- <jeton-court> # échange le jeton du tableau de bord en jeton 60 jours + écrit THREADS_TOKEN et THREADS_USER_ID
npm run threads:setup                 # idem, en lisant le jeton dans THREADS_SHORT_TOKEN (.env) : rien ne transite par la ligne de commande
npm run smoke:threads                 # jeton Threads : profil, conteneur accepté — sans rien publier
npm run threads:refresh -- --ecrire   # prolonge le jeton Threads de 60 jours et l'écrit dans .env
```

La file d'attente se lit dans `state/queue.json` : heure prévue (`dueAt`), statut `pending` (en attente), `blocked` (garde-fou) ou `failed` (3 essais échoués), dernière erreur. Les entrées bloquées ou en échec sont effacées après 7 jours.

Sous PowerShell : `$env:DRY_RUN='1'; $env:DRY_RUN_LATEST='3'; node --env-file=.env src/index.mjs`. Les images sont écrites dans `out/`.

---

## Reprise sur un nouveau poste

1. Installer Node.js 24 et git.
2. `git clone https://github.com/d00lweb/pa-social.git && cd pa-social`
3. `npm ci` puis `npx playwright install chromium`
4. Recréer `.env` à partir de `.env.example` avec les valeurs du gestionnaire de mots de passe.
5. Vérifier : `npm run smoke -- --mode=single` puis un test à blanc (`DRY_RUN=1`).

La production ne dépend pas du poste : elle tourne entièrement sur GitHub et o2switch.

---

## Dépannage : problèmes déjà rencontrés

| Symptôme | Cause | Solution |
|---|---|---|
| `npm install` : ERESOLVE sharp | ancienne dépendance smartcrop-sharp exigeait sharp 0.32 | smartcrop retiré ; sharp épinglé en `^0.32.6` |
| Meta `(#100) nonexisting field (content_publishing_limit)` | `IG_USER_ID` erroné (pas l'id du compte Instagram professionnel) | utiliser l'id `instagram_business_account` du bon compte |
| Garde-fou « image trop petite : 400 px » | image lue dans `<media:content>` (vignette) | lire `<enclosure>` |
| Publications en retard, `essais: 0`, exécution bloquée sur « Publier » | attentes aléatoires cumulées d'un réseau à l'autre dépassant la limite du travail ; le verrou de concurrence met alors tous les passages suivants en file | budget d'attente partagé (`execute`), limite du travail à 30 min, délais d'expiration sur tous les appels réseau |
| Exécution en échec dès l'envoi, sans journal d'étape, « workflow file issue » | condition d'étape testant `env.X` alors que `X` est défini dans le bloc `env` de cette même étape : GitHub refuse le fichier | poser le drapeau dans une étape dédiée (`id`, `$GITHUB_OUTPUT`) puis tester `steps.<id>.outputs.<nom>` |
| FTP : `Timed out while waiting for handshake` (port 22) | SSH fermé par o2switch | passage en FTPS port 21 (`basic-ftp`) |
| FTPS : `ERR_TLS_CERT_ALTNAME_INVALID` | certificat émis pour `pasta.o2switch.net` | `SFTP_HOST=pasta.o2switch.net` |
| FTP `530 Login authentication failed` | identifiant FTP d'un ancien compte | identifiant exact du compte (inclut `@domaine`) |
| FTP `421 Home directory not available` | dossier du compte FTP inexistant | créer le dossier ou corriger le répertoire du compte |
| Images déposées mais URL en 301 puis 404 | compte FTP pointant vers un autre dossier `social` que celui du site | recréer le compte FTP sur le dossier à côté de `wp-config.php` |
| Article non publié pendant des heures | cron GitHub quasi pas déclenché (2 passages en 9 h) | déclenchement par tâche cron o2switch |
| Passage de la minute 40 absent | réglage des minutes de la tâche o2switch | assumé (mettre `0,20,40` pour le rétablir) |
| Dépôt FTP bloqué depuis le poste de bureau (TCP et bannière OK, connexion chiffrée qui ne répond plus) | réseau local qui bloque le FTPS ; GitHub n'est pas concerné | valider le dépôt par un test à blanc lancé sur GitHub (Run workflow, case cochée) |
| Commandes `node -e` cassées sous PowerShell 5.1 | guillemets doubles et apostrophes typographiques mal passés | utiliser des backticks JS ou un fichier script |

---

## Limites connues et pistes

- **Images qui s'accumulent** sur le FTP (~1 Mo par article). Piste : purge des images de plus de 7 jours.
- **Plus de 8 articles en 24 h** : avec l'écart de 3 h et la fenêtre de 24 h, les plus anciens seraient abandonnés.
- Les posts Instagram publiés à la main ne comptent pas dans l'écart de 3 h.
- Avertissement GitHub : les actions `checkout`, `setup-node`, `cache` en v4 ciblent Node 20 (dépréciation, sans effet actuellement). Piste : passer aux versions supérieures.
- Le surlignage est une texture générée, pas un vrai pinceau. Pour un rendu identique à une maquette, fournir un PNG/SVG de coup de pinceau.
- `assets/bandeau.jpg` n'est plus utilisé (remplacé par le bandeau HTML).

---

## Structure du code

```
.github/workflows/publish.yml   workflow GitHub Actions (tests puis publication)
config/channels.json            réseaux actifs, écart, heures creuses, décalage, quota, essais
src/index.mjs                   orchestrateur : planifie la file, exécute ce qui est dû
src/core/config.mjs             configuration, chemins, mode DRY_RUN
src/core/scheduler.mjs          calcul des heures prévues (pur, testé)
src/core/state.mjs              historique par réseau et file d'attente
src/core/errors.mjs             GuardError (bloqué) et DeferError (reporté)
src/sources/rss.mjs             lecture et nettoyage du flux
src/brain/editorial.mjs         règles : rubrique, amorce géographique, surlignage, typographie
src/brain/dossier.mjs           dossier de publication : IA contrôlée, sinon règles de secours
src/brain/ai.mjs                appel Claude (JSON contraint par schéma, repli serveur)
src/brain/schema.mjs            schéma du dossier
src/brain/guards.mjs            contrôles du dossier (anti-invention, diversité…)
src/brain/fallback.mjs          dossier sans IA
src/brain/geo.mjs               détection des zones identitaires
src/brain/memory.mjs            rotation des angles, accroches récentes
config/editorial.json           réglages éditoriaux
config/geo.json                 lexique géographique
prompts/editorial.md            charte éditoriale de l'IA
state/memory.json               accroches récentes (commité par le bot)
src/media/crop.mjs              cadrage adaptatif, remplissage flouté, JPEG conforme Meta
src/media/render.mjs            rendu Playwright, ajustement des tailles, assets
src/media/brush.mjs             texture du surlignage
src/media/templates/card.html   gabarit des 3 visuels
src/storage/ftp.mjs             dépôt FTPS, vérification des URL publiques
src/channels/instagram.mjs      canal Instagram : prepare (rendu + garde-fous), stage (dépôt), publish
src/channels/meta-graph.mjs     client API Graph (Instagram, Facebook)
src/channels/telegram.mjs       client Telegram (messages, photos, boutons, commandes, story)
src/channels/preview.mjs        message d'aperçu et boutons
src/channels/x.mjs              kit X : visuel 4:5, post avec lien, lien de rédaction pré-remplie
src/channels/bluesky.mjs        Bluesky : 3 formats (carte, image, lien en réponse), facettes, AT Protocol
src/channels/facebook.mjs       Facebook : image 4:5, lieu, lien en premier commentaire
scripts/smoke-bsky.mjs          test de connexion Bluesky
src/core/control.mjs            commandes, pause, validation, décisions (logique pure)
scripts/telegram-test.mjs       menu du bot + aperçu d'exemple
state/controls.json             pauses et validation réglées par Telegram (commité par le bot)
state/telegram.json             curseur de lecture des messages Telegram (commité par le bot)
tests/                          tests node:test + fixtures/articles.json (12 articles réels)
scripts/smoke-ig.mjs            test d'accès Meta
scripts/preview.mjs             planches d'aperçu
scripts/capture-fixtures.mjs    capture des articles de test
assets/                         logos, police
state/published.json            publications réalisées, par réseau (commité par le bot)
state/queue.json                file d'attente planifiée (commitée par le bot)
```

Dépendances : `fast-xml-parser`, `sharp`, `playwright`, `basic-ftp`. Node 24, ESM (`.mjs`), sans TypeScript ni framework.

---

## Journal des évolutions

| Date | Évolution |
|---|---|
| 14/09/2026 | Création du projet : flux RSS, rendu, publication carrousel, story Telegram, workflow GitHub. |
| 14/09/2026 | Dépôt SFTP remplacé par FTPS (`pasta.o2switch.net`) ; image lue dans `<enclosure>` ; mode `DRY_RUN`. |
| 14/09/2026 | Cadrage adaptatif avec remplissage flouté (smartcrop retiré) ; positions de la story ; légende « ➡️ Article complet… ». |
| 14/09/2026 | Bandeau HTML haute définition identique sur les slides 1 et 2 ; rendu ×2 ; texte du slide 2 agrandi ; rubrique agrandie ; surlignage en texture de pinceau sec. |
| 14/09/2026 | Workflow : secret unique `SOCIAL`, verrou `PUBLISH_ENABLED`, test à blanc manuel, Node 24. Code poussé sur GitHub. |
| 15/09/2026 | Écart minimum de 3 h entre deux publications ; état enrichi (heure, id Instagram). |
| 15/09/2026 | Première publication (00h14, Montaigne), puis « matrimoine ». Cron GitHub jugé non fiable → déclenchement par tâche cron o2switch ; verrou appliqué à tous les déclenchements. |
| 15/09/2026 | Création de ce README. |
| 15/09/2026 | Stratégie multi-réseaux validée (Bluesky, Facebook 1 image + lien en commentaire, Threads, X en kit Telegram, IA éditoriale) et feuille de route technique `docs/ROADMAP.md`. |
| 15/09/2026 | Feuille de route ajustée : IA limitée au flux RSS (titre, description, catégories), URL réelle au lieu d'un lien court, dimensions d'images vérifiées (4:5 en 1440×1800, carte Bluesky 1200×627, X 1600×900), comptes Bluesky et Threads créés. |
| 15/09/2026 | Étape 1 : socle modulaire (config, planificateur par réseau avec heures creuses 23 h–7 h et décalage aléatoire, file d'attente, canal Instagram isolé), article bloqué signalé une seule fois, 3 essais sur erreur passagère, report si quota atteint, visuels 4:5 en 1440×1800, 27 tests et 12 articles de test, planches d'aperçu. |
| 15/09/2026 | Étape 2 : rédacteur en chef IA (dossier par article, textes différents par réseau, contrôles anti-invention et diversité, règles de secours), lexique géographique (Pays basque, Béarn…), rubrique jamais « Actus », surlignage chiffre > nom propre > fin de titre sans petit mot, guillemets insécables, nouvelle légende Instagram avec 3 hashtags. |
| 15/09/2026 | Étape 3 : centre de contrôle Telegram (aperçu visuels + textes des 5 réseaux, validation ✅/❌/🔁, commandes /statut /file /pause /reprise /validation, notification de publication, expiration à 24 h). Instagram passe en mode validation. |
| 15/09/2026 | Textes jamais tronqués (Facebook ≤ 120 car.), texte IA pour la 2ᵉ image du carrousel, sujet Threads, plafond d'emojis par réseau, hashtags interdits dans le corps des textes (charte v2). |
| 15/09/2026 | Charte v3 : ligne blanche entre paragraphes Instagram, hashtag Bluesky intégré au texte, lien X à la suite, formule avant le lien en commentaire Facebook, questions limitées et formules d'appât interdites, pas de point avant un emoji. |
| 15/09/2026 | Anti-bannissement renforcé : écart variable 3 h – 4 h 30, reprise du matin variable, attente aléatoire de 0 à 9 min avant publication, coupe-circuit (pause automatique sur erreur de limite ou de restriction Meta). Hashtag du lieu intégré au texte X. Étape 4 annulée : URL réelle partout, sans suivi des clics. |
| 15/09/2026 | Étape 5 : kit X sur Telegram (visuel 16:9 1600×900, texte copiable avec lien, bouton de rédaction pré-remplie), canal X manuel dans la file avec validation, variante sans logo Ouest-France prête. |
| 15/09/2026 | Kit X revu d'après les données (Buffer, Nieman Lab) : post natif texte + image sans lien, lien publié en réponse. Visuel X : bandeau centré, titre sur toute la largeur, dégradé bas. |
| 15/09/2026 | Charte v4, décisions utilisateur : X en image 4:5 (1080×1350) + texte + « ➡️ lien » à la ligne ; au moins un emoji stratégique dans chaque texte de chaque réseau (choisi selon le sujet, placement varié, non répété, sobre si sujet sensible). |
| 15/09/2026 | Charte v5 : placement de l'emoji imposé par réseau, en rotation. Étape 6 : canal Bluesky livré (carte de lien 1200×627 ou image 4:5 + lien, hashtag cliquable, validation Telegram, coupe-circuit), inactif tant que les identifiants manquent. |
| 15/09/2026 | Bluesky en production (identifiant certifié @passion-aquitaine.ouest-france.fr). Publication automatique sur tous les réseaux, sans validation ; Telegram limité au kit X, à la story Instagram et aux alertes. |
| 18/09/2026 | **Suivi des abonnés, et rapport mensuel refondu.** Le jour où la stratégie de publication est posée, le robot commence à relever chaque jour les abonnés de chaque compte (`src/measure/abonnes.mjs`, `state/abonnes.json`, ajouté à la fusion d'état). Ligne de départ du 18/09/2026 : Facebook 42 626, Instagram 10 146, Threads 1 144, Bluesky 1 ; X n'a pas d'API gratuite et n'est pas suivi. Un jour illisible reste vide : les comparaisons prennent la valeur réellement relevée la plus proche, jamais un chiffre inventé. Le tableau des réseaux gagne une colonne « Abonnés » (total et gain des 7 derniers jours, ou depuis le début du suivi) et un total sous le tableau ; le message Telegram du lundi, une ligne « Abonnés ». Le **rapport mensuel** devient court et lisible : quatre chiffres clés (abonnés gagnés, posts publiés, interactions, meilleur engagement), un tableau par réseau (abonnés, évolution, posts, interactions par post, **taux d'engagement** — interactions rapportées aux abonnés, seul chiffre qui compare honnêtement 42 000 et 1 000 abonnés, ignoré sous 100 abonnés), ce qui a le mieux marché (meilleur post, **meilleur créneau de chaque réseau**, qui vérifie la stratégie horaire) et quatre conseils au plus, jamais appliqués. Le conseil obsolète sur les « heures creuses à resserrer » disparaît. Le **mois en cours** est calculé à chaque passage et consultable dès aujourd'hui ; le 1er, le bilan est figé et résumé sur Telegram. |
| 18/09/2026 | **La file dit toujours la vérité : plus de « reporté », plus de « en retard ».** Cause du défaut, répété plusieurs fois : deux sources de vérité. Le robot ne recalculait l'heure d'un post qu'à son échéance, si bien que la file gardait des heures calculées selon d'anciennes règles (un Threads à 15:46) ; la page, elle, rejouait les règles pour deviner l'heure réelle, et se trompait dès que son instantané avait une version de retard (« 16:00, en retard » pour un post qui ne pouvait partir que le lendemain matin). Désormais, à **chaque passage**, avant et après les publications, `ordonnerFile` (`src/core/scheduler.mjs`) revalide **toute** la file : créneau terminé, heure hors créneau, créneau déjà occupé, plafond du jour, écart minimum, heures creuses pour une actualité chaude. Une heure juste ne bouge plus ; une heure fausse est recalculée aussitôt, l'ancienne et la raison conservées (`prevuInitialement`, `raison`). Chaque post reçoit **à l'avance sa minute exacte** (3 à 15 min après son passage, à 3 min au moins d'un autre réseau ; le kit X part au passage), et le robot attend précisément cette minute pour publier, dans l'ordre des minutes. La page affiche l'heure de la file telle quelle, sans rien recalculer : « publication en cours » quand le passage a commencé, et une note discrète « heure recalculée : prévu initialement … — raison » quand il y a eu correction. Un test « propriété » tire 200 files au hasard et vérifie qu'elles ressortent conformes à toutes les règles ; il a débusqué deux incohérences avant la mise en production (heure d'un kit X non alignée sur le passage, minute venue d'ailleurs qui aurait fait attendre le robot trop longtemps). |
| 18/09/2026 | **Minute de départ tirée au hasard pour chaque réseau.** Mesure sur les 24 publications passées : 7 paires de réseaux parties à moins de 2 min d'intervalle, dont Instagram, Bluesky et le kit X à la même minute (16/09, 20:08), et 21 posts sur 24 dans la première demi-heure. En cause, une réserve d'attente commune de 6 min par passage : le premier réseau l'épuisait, les suivants partaient aussitôt. Désormais, dans chaque passage, chaque réseau tire sa propre minute de départ entre 2 et 14 min après le début, au moins 1 à 3 min (tirées elles aussi) après le réseau précédent (`tirerDepart`, `src/core/scheduler.mjs`) : jamais pile à l'heure, jamais deux réseaux à la même minute, jamais le même écart. Le temps passé à publier compte dans l'attente, si bien que la durée d'un passage reste bornée ; l'exécution GitHub passe à 40 min de délai par sécurité. Le kit X, publié à la main, n'attend pas. L'ancien réglage `publishDelayMinutes` disparaît. Le tableau de bord ne garde que la frise des meilleurs horaires ; raisons et sources restent dans la configuration et ce journal. |
| 18/09/2026 | **Moteur des meilleurs horaires, étendu à tous les réseaux.** Chaque réseau a ses créneaux, autant que de posts autorisés par jour, choisis d'après les études d'audience et le rythme quotidien français : **Instagram** 12 h – 13 h 30 et 18 h – 19 h 30 (pics d'usage mobile Médiamétrie 12 h – 14 h et 18 h – 19 h, Buffer 9,6 M de posts) ; **Facebook** 8 h – 9 h 30 et 20 h – 21 h 30 ; **Bluesky** 8 h – 9 h 30, 12 h – 13 h 30, 18 h – 19 h 30 (fil chronologique : un post n'est vu que des abonnés en ligne ; aucune étude rigoureuse n'existe, calé sur les pics français) ; **Threads** 7 h – 8 h 30, 10 h – 11 h 30, 13 h – 14 h 30 (Buffer, 2,5 M de posts : les matinées dominent, les soirées sous-performent) ; **X** 9 h – 10 h 30, 12 h – 13 h 30, 16 h – 17 h 30 (Buffer, 8,7 M de posts ; publication à la main, donc aussi dans la journée de travail de l'équipe). Un post au plus par créneau, à un passage réel du robot tiré au hasard ; `ecartMinHeures` garantit l'espacement entre deux posts d'un même réseau. **Une actualité chaude part au passage suivant sans attendre de créneau** — hors nuit, à l'écart minimum du dernier post publié, sans se ranger derrière les posts prévus plus tard, qui lui cèdent la place : la fraîcheur prime sur l'horaire, comme dans une rédaction. Conséquence voulue : un même article vit de 7 h à 21 h 30 au lieu de partir partout d'un coup. Les posts déjà en file sont recalés d'eux-mêmes au moment de publier. Vingt tests : un créneau par post autorisé, aucun la nuit, espacement tenu, pas de soirée pour Threads et X, actualité chaude, changement d'heure. Le tableau de bord gagne une section « Meilleurs horaires » : frise de la journée par réseau, tableau des raisons et des sources, et comment le moteur choisit l'heure. Limites assumées : mêmes créneaux le week-end, les études divergeant ; le rapport mensuel par créneau et les statistiques des comptes diront s'il faut ajuster, avec validation. |
| 18/09/2026 | **Facebook : un post le matin, un en fin de journée.** Deux créneaux, 8 h – 9 h 30 et 20 h – 21 h 30, un post au plus par créneau (`creneaux` dans `config/channels.json`). Choix sourcé : le matin suit les études au taux d'engagement (Hootsuite 8 h, Buffer 9 h), fil encore peu chargé à l'heure où l'on lit l'actualité ; le soir, les études au volume (Sprout Social, jusqu'à 20 h) et françaises (20 h – 23 h), heures de loisir où l'on prépare ses sorties — ce que confirment les sources tourisme et B2C. L'heure est tirée au hasard **parmi les passages réels du robot** que contient le créneau (8:00, 8:20, 9:00, 9:20 / 20:00, 20:20, 21:00, 21:20) : un instant tiré entre deux passages ne partirait qu'au suivant, parfois hors créneau. Au moment de publier, le robot revérifie qu'il est dans un créneau encore libre, avec 15 min de tolérance pour un passage lent ; sinon il reporte au créneau suivant. Changement d'heure couvert par les tests. Le week-end reste sur les mêmes créneaux : les études divergent, le rapport mensuel (par créneau) et les statistiques Meta de la page trancheront, avec votre validation. **Page de pilotage refaite** : état global et points à traiter en tête, tableau des réseaux dépliable avec liens vers les comptes, planning par jour aux heures réelles, 5 dernières publications avec lien direct vers chaque post, activité sur 7 jours, bibliothèque de lieux, rapports mensuels, « Que faire si… » avec commandes Telegram copiables ; actualisation automatique toutes les 2 min. Le rythme affiché est lu dans la configuration via l'instantané, plus recopié dans la page. |
| 18/09/2026 | **Localisation propre à chaque réseau, et bibliothèque de lieux qui apprend seule.** Chaque réseau prend ce qu'il sait faire : identifiant de lieu pour les posts Instagram et Facebook ; **nom du lieu** pour la story et le kit X, où l'on tague à la main, même sans identifiant ; **commune** en sujet Threads et en hashtag Bluesky, ce dernier placé dans le texte seulement si la commune y figure telle quelle (jamais d'orthographe inventée, jamais « d'#Espelette »). La **récolte** relit chaque heure les lieux tagués sur la page Facebook — seul réseau qui rend ce champ en lecture, et dont les identifiants sont ceux d'Instagram — et apprend chacun pour toujours après l'avoir fait accepter par Instagram sur un conteneur jamais publié. Premier passage : 550 publications, 41 lieux distincts, **31 appris** — dont 6 communes nouvelles (Sarlat-la-Canéda, Domme, Anglet, Saint-Jean-de-Luz, Châtelaillon-Plage, et Gamarde-les-Bains, premier lieu des Landes) et 25 lieux précis (Dune du Pilat, Lascaux, La Rhune, Fêtes de Bayonne…). 3 lieux présents sur de vrais posts Facebook ont été refusés par Instagram (sous-code 2207019), ce qui justifie la validation préalable. Garde-fous tirés de cet inventaire : un établissement est rangé sous son propre nom, jamais sous sa commune (« Martell » ne tague pas Cognac) ; un nom de département n'est jamais appris, ses pages Facebook étant mal localisées (« Dordogne » à Die, « Lot-et-Garonne » à Saint-Nicolas-de-la-Grave) ; un département n'est plus jamais tenté comme commune (Corrèze est aussi un village). Les lieux appris vivent dans `state/lieux-appris.json`, ajouté à la fusion d'état, et un message Telegram annonce chaque apprentissage. Écartés après test : la recherche de lieux Facebook (supprimée pour les tiers en v8.0) et celle de Threads (identifiants refusés par Instagram, 0 sur 6). |
| 18/09/2026 | **Le pilotage annonce l'heure réelle, plus l'heure théorique.** La file donne une échéance (« 12:22 ») mais le robot ne tourne qu'aux passages du cron o2switch, à :00 et :20 : ce post part en fait à 13:00. La page affiche donc le prochain passage possible, et « en retard, part vers … » quand l'échéance est dépassée. Le calcul est fait **dans la page** et non repris de l'instantané, qui serait déjà périmé à l'ouverture ; la règle de référence et ses tests vivent dans `src/measure/pilotage.mjs`. Le cron GitHub peut déclencher plus tôt, mais il est trop irrégulier pour qu'on promette son heure. |
| 18/09/2026 | **Textes alternatifs sur tous les réseaux.** Ils n'existaient que sur Threads et Bluesky. Vérifié auprès des API : Instagram accepte `alt_text` sur chaque image d'un carrousel, Facebook accepte `alt_text_custom` et le restitue mot pour mot. La 1ʳᵉ image porte la description du sujet, la 2ᵉ — qui n'est que du texte — porte ce texte même. Le kit X reçoit un champ prêt à coller dans le bouton « ALT » de l'application. La charte impose désormais une phrase orale commençant par le sujet concret (« Le château de Hautefort domine la vallée, en Périgord »), sans « Visuel avec… » ni mention de la rubrique, et sans détail visuel inventé puisque l'IA ne voit pas la photo. Les stories Instagram en sont exclues : le réseau n'y accepte pas de texte alternatif. |
| 18/09/2026 | **Avis de publication cliquable sur Telegram.** Dès qu'un post part, le bot envoie « 📣 Publié sur … » avec un bouton qui ouvre la publication d'une touche — même mécanisme que le bouton du kit X. Chaque réseau rend son permalien au moment où il publie, stocké en `lienPost` dans l'historique, ce qui rend aussi les publications vérifiables après coup : Instagram, Facebook et Threads le demandent à leur API, Bluesky le construit sans aucun appel. X en est exclu, sa publication restant manuelle. Le lien Facebook ne peut pas être fabriqué à la main : Meta y emploie un identifiant de page différent de `FB_PAGE_ID`. Un permalien manquant n'empêche jamais l'avis ni la publication. Coût nul. |
| 18/09/2026 | **Localisation étendue.** La recherche d'un identifiant de lieu suit une règle unique : **on ne peut qu'élargir**, c'est-à-dire remplacer un lieu sans identifiant par celui qui le contient — la ville par son département, la zone identitaire par le sien. Jamais un voisin, jamais un morceau : taguer Bayonne pour un article du Pays basque, ou Périgueux pour un article du Périgord, serait faux. Une ville nommée mais non résolue interdit d'ailleurs toute retombée sur une autre commune (un article sur Pessac ne doit pas finir tagué « Bordeaux »). La correspondance zone → département est lue dans `config/geo.json`, seule source, alias compris (« Sarlat » → Dordogne) ; la charte impose le nom administratif dans `lieu.departement` et la commune dès qu'elle est nommée. **12 identifiants sont figés dans `config/lieux.json` après confirmation par Meta** (Bordeaux, Arcachon, Périgueux, Bayonne, Biarritz, La Rochelle, Saintes, Cognac, Poitiers, Limoges, et les départements Haute-Vienne et Deux-Sèvres) ; un identifiant court sert de témoin et est bien rejeté. Limite assumée : Wikidata ne publie un identifiant que pour une poignée de communes notables (1 sur 45 testées), et quatre départements n'ont aucun lieu exploitable (Landes, Lot-et-Garonne, Corrèze, Creuse). Aucun repli sur la préfecture : taguer Bordeaux pour un article du Médoc serait faux. Pour compléter la table à la main, voir `_ajouter` dans `config/lieux.json`. |
| 18/09/2026 | **Attente partagée entre réseaux.** L'attente aléatoire de 0 à 9 min s'appliquait à chaque réseau l'un après l'autre : trois réseaux dus au même passage pouvaient cumuler 27 min, dépasser la limite de 25 min du travail et le faire tuer avant la fin — en bloquant au passage tous les passages suivants (verrou de concurrence). Budget de 6 min désormais partagé, limite portée à 30 min, et délais d'expiration ajoutés sur deux appels réseau qui n'en avaient pas. |
| 18/09/2026 | **Cadence corrigée.** Le cron o2switch ne déclenche qu'à :00 et :20, jamais à :40 : une publication due à 8 h 29 attendait le passage de 9 h 00. Le cron GitHub passe à :10 et :40, ce qui donne :00, :10, :20, :40 et ramène l'attente maximale à 20 minutes. Le pilotage affiche « en attente depuis » au lieu de « prévu » quand l'heure est dépassée. |
| 18/09/2026 | **Mentions fiabilisées.** Un commerce absent de Wikidata n'était pas trouvé (Morimoto, Mondrian Bordeaux) : le pseudo est désormais dérivé du nom exact de l'entité (`morimotobordeaux`, `morimoto_bordeaux`, `morimoto.bordeaux`) puis **confirmé par Meta**, qui refuse un compte inexistant ou privé. En sens inverse, un nom d'un seul mot est désormais ignoré : « Morimoto » avait retenu un compte personnel thaïlandais nommé « Morimoto🌱 », qui serait parti publiquement. La charte impose des noms qualifiés (« Morimoto Bordeaux »). |
| 18/09/2026 | Telegram : le lien de la story part seul dans son message, copiable d'un geste ; le visuel X est fourni quels que soient les formats ; le kit X propose le compte vérifié sur Instagram quand aucun compte X n'est connu. Pilotage : les publications à venir sont marquées « prévu ». |
| 18/09/2026 | **Page publique de l'équipe** `site/reseaux-sociaux.html`, à téléverser une fois à la racine du site : communauté totale, abonnés et progression, planning, meilleurs horaires en direct, derniers articles relayés, bilan du mois. Données par liste blanche (`src/measure/public.mjs` → `/social/reseaux.json`, déposé à chaque passage), aucune ressource extérieure, CSP à empreintes (`scripts/page-equipe.mjs`), aucune mention interne (vérifié par `tests/page-equipe.test.mjs`). `pilotage.html` inchangé. |
| 18/09/2026 | Page de l'équipe, retours : **X parmi nos réseaux** (abonnés saisis par la commande Telegram `/x 2940`, 2 940 au 18/09), publications manuelles (X, story Instagram) annoncées dans le planning, heures du planning toutes en rouge, **visuels 4:5** en vignettes légères, **pastilles vers le post lui-même** (liens des anciennes publications retrouvés par l'API ; la fusion de l'état complète désormais une fiche au lieu d'ignorer l'ajout), **sélecteur de mois** avec archive `state/mois-publics.json`. |
| 18/09/2026 | Page de l'équipe, mise en page : en-tête plus compact, répartition des cinq réseaux sur une seule rangée, **les cinq comptes sur une même ligne** (la courbe cède la place à l'évolution chiffrée : 7 derniers jours et depuis le début du suivi, en nombre et en %), « En direct · à jour à » donne l'heure de la dernière vérification de la page, textes des sections sur toute la largeur. |
| 23/09/2026 | **Jeton Meta invalidé sans préavis** (code 190, sous-code 460 : mot de passe changé ou session coupée par Meta) alors que `state/jetons.json` annonçait encore 86 jours restants. Deux correctifs : un jeton refusé **ne consomme plus d'essai** — la publication est reportée d'heure en heure (48 au plus) et repart seule dès le jeton remplacé, au lieu d'être abandonnée au 3ᵉ échec ; la surveillance lit la **validité** et non plus seulement l'échéance, rappelle le jeton refusé chaque jour, revérifie à chaque passage tant qu'il l'est, et ne marque le passage en échec qu'une fois par jour. |
| 17/09/2026 | Pilotage épuré et vivant : plus d'historique ni de feuille de route dans la page, les aperçus montrent **les derniers articles réellement publiés** (texte et visuel capturés au moment du post), et seules les prochaines publications sont listées. Renouvellement automatique du jeton Threads par `maintenance.yml` (nécessite le secret `GH_PAT`). |
| 17/09/2026 | Étape 9 : mesure et rapports. Relevés J+1 et J+7, rapport Telegram le lundi, rapports mensuels, surveillance des jetons, et pilotage qui lit l'état réel à chaque ouverture. **Les conseils ne sont jamais appliqués sans validation.** |
| 17/09/2026 | **Facebook et Threads en production.** Les cinq réseaux sont actifs. Piège rencontré : le générateur de jetons du tableau de bord Meta délivre déjà un jeton Threads de 60 jours, que l'échange refuse (« Session key invalid ») — la mise en service gère désormais les deux cas. Jeton Threads à renouveler avant le 16/11/2026. |
| 17/09/2026 | Étape 8 : canal Threads livré (rotation de 3 formats, sujet, texte alternatif, lien en réponse, mentions vérifiées, 3 posts par jour). Renouvellement du jeton outillé. Inactif tant que le jeton n'est pas fourni. |
| 17/09/2026 | Plafond quotidien par réseau (Instagram 2, Facebook 2, Bluesky 3, kit X 3) et réserve : le surplus reste en file et part au premier créneau du lendemain. Facebook passe à 2 posts par jour espacés de 3 h minimum. |
| 17/09/2026 | Étape 7 : canal Facebook livré (image 4:5, texte sans lien, URL en premier commentaire 1 à 3 min après, lieu, 1 post par jour). Inactif tant que le jeton de Page n'est pas fourni. |
| 17/09/2026 | **Publication en double corrigée.** Une exécution mise en file d'attente repartait du dépôt tel qu'il était à son déclenchement (`actions/checkout` se cale sur la révision d'origine) : elle ne voyait pas les publications faites entre-temps et les refaisait, puis échouait à enregistrer son état sur un conflit. Désormais l'état publié est repris juste avant de publier, l'enregistrement fusionne les historiques au lieu de les écraser (`scripts/fusion-etat.mjs`, 3 tentatives), et le cron GitHub passe à une fois par heure pour ne plus croiser celui d'o2switch. |
| 17/09/2026 | Telegram : un message par élément (texte, réponse, chaque compte, lieu), pour copier chacun d'une seule touche. |
| 17/09/2026 | Mentions de comptes et localisation : l'IA fournit des noms d'entités, les comptes viennent de Wikidata puis du site officiel, et sont vérifiés avant publication (mots entiers, écart des comptes de fans et des homonymes). Tags invisibles sur l'image Instagram, lieu sur le carrousel (lieu précis → ville → département), mention par substitution du nom sur Bluesky, comptes et lieu fournis dans le kit X et la story. |
| 17/09/2026 | Rotation de 3 formats sur Bluesky (carte de lien · image + lien · image avec lien en réponse) et sur le kit X (image + lien · lien seul · image avec lien en réponse), formule avant le lien tournante par article et par réseau. Le kit Telegram donne un champ copiable par élément. |
| 17/09/2026 | Relance manuelle d'un ancien article : champ « Relancer un ancien article » au déclenchement du workflow (mots du titre ou adresse), l'âge de 24 h est ignoré, les règles anti-bannissement restent appliquées. |
