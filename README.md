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
2. Planification : chaque nouvel article de **moins de 24 h** entre dans la file `state/queue.json` avec une heure prévue par réseau. Elle tombe au moins **3 h** après la publication précédente, jamais entre **23 h et 7 h** (heure de Paris), avec un décalage aléatoire de **5 à 35 min**.
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
  | Instagram | 1ʳᵉ ligne ≤ 125 car. (le reste passe sous « plus », c'est inévitable) | 0–2 | 3 en fin de légende |
  | Facebook | **120 car.** (pas de « Voir plus » sur mobile) | 0–1 | 0 |
  | Bluesky | 260 car. (limite 300) | 0 | 1 de lieu |
  | Threads | 450 car. (limite 500) | 0–1 | 0 dans le texte + 1 sujet Threads (`topic_tag`) |
  | X | 230 car. (limite 280) | 0–1 | 0 |

  Aucun emoji sur un sujet sensible.
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
| Écart min entre publications | 3 h | `config/channels.json` (`gapHours`) |
| Heures creuses | 23 h – 7 h | `config/channels.json` (`quietHours`) |
| Décalage aléatoire | 5 – 35 min | `config/channels.json` (`jitterMinutes`) |
| Publications max / 24 h | 6 | `config/channels.json` (`maxPer24h`) |
| Essais en cas d'erreur | 3 (délai de 30 min × n° d'essai) | `config/channels.json` (`retry`) |
| Largeur min image source | 1200 px | `src/channels/instagram.mjs` |
| Description max | 300 caractères | `src/channels/instagram.mjs` |

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
  - déclencheurs : `schedule` `*/20 * * * *` (peu fiable, sert de secours) et `workflow_dispatch` (utilisé par le cron o2switch et à la main) ;
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
| Vérifier les déclenchements o2switch | lire `~/pa-social-cron.log` (lignes `204`) |
| Voir ce qu'une exécution a fait | Actions → exécution → étape « Publier » |
| Republier un article déjà publié | retirer son entrée de `state/published.json`, committer (attention au doublon Instagram) |
| Mettre à jour les secrets | coller le `.env` complet dans le secret `SOCIAL` |

Commandes locales :

```bash
npm run smoke -- --mode=single        # accès Meta : compte, quota, conteneur, sans publier
npm run smoke -- --mode=carousel      # idem en carrousel ; ajouter --publish pour publier réellement
DRY_RUN=1 DRY_RUN_LATEST=3 node --env-file=.env src/index.mjs   # rendu + FTP des 3 derniers articles, sans publier
npm test                              # tests hors ligne (règles, planificateur, état, 12 articles réels)
npm run preview                       # planches d'aperçu out/preview-*.jpg des articles de test, sans dépôt
npm run preview -- --latest=6         # idem sur les 6 derniers articles du flux
npm run fixtures                      # régénère tests/fixtures/articles.json depuis le flux
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
