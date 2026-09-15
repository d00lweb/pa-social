# pa-social

Republication automatique des articles de **Passion Aquitaine** (passion-aquitaine.ouest-france.fr) en **carrousel Instagram**, avec une **story** envoyée sur Telegram pour publication manuelle.

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
2. Sélection : articles de **moins de 24 h**, **non publiés**, le **plus ancien** d'abord, **un seul par exécution**.
3. Écart minimum : si la dernière publication date de **moins de 3 h**, rien n'est publié (message « en attente » dans le journal, sans alerte).
4. Garde-fous (voir ci-dessous). Si l'un saute : rien n'est publié, alerte Telegram, sortie en erreur.
5. Rendu des 3 visuels (Playwright + Chromium).
6. Dépôt FTPS des 3 JPEG, puis vérification que chaque URL publique répond `200 image/jpeg`.
7. Publication Instagram : 2 conteneurs image → attente `FINISHED` → conteneur carrousel → attente → `media_publish`.
8. Enregistrement dans `state/published.json` (guid, heure, id Instagram), commité par le bot sur `main`.
9. Envoi de la story sur Telegram (image en document + titre + lien de l'article). Un échec ici ne bloque pas.

Légende Instagram :

```
<description de l'article>
⠀
➡️ Article complet sur le site Passion Aquitaine
```

La ligne du milieu contient le caractère invisible U+2800 (Instagram supprime les lignes réellement vides).

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
| Âge max d'un article | 24 h | `src/index.mjs` (`MAX_AGE_HOURS`) |
| Écart min entre publications | 3 h | `src/lib/state.mjs` (`MIN_GAP_HOURS`) |
| Largeur min image source | 1200 px | `src/index.mjs` |
| Description max | 300 caractères | `src/index.mjs` |
| Publications max / 24 h | 6 | `src/index.mjs` |

### Règles rédactionnelles (`src/lib/editorial.mjs`)

- **Lecture du flux** : image = URL de `<enclosure>` (jamais `<media:content>`, vignette 400 px). Description = premier `<p>` de `<description>`, sans le paragraphe « L'article … est apparu en premier sur … », entités décodées, apostrophes typographiques, parenthèse finale de moins de 40 caractères supprimée.
- **Rubrique** (encart rouge) : catégorie géographique (liste des départements et villes de Nouvelle-Aquitaine) > première catégorie qui n'est ni « Actus » ni « Actualités » > première catégorie. Casse d'origine.
- **Titre** : l'amorce géographique qui répète la rubrique est retirée (« En Haute-Vienne, les abeilles… » → « Les abeilles… »).
- **Groupe surligné** : dernier mot, précédé de son déterminant (« les Pyrénées », « d'un siècle », « l'électro »), max 3 mots et 22 caractères. Nombre + unité = un seul mot (« 42 °C »).
- **Typographie** : espace fine insécable avant °C, %, € et en séparateur de milliers ; insécable avant : ; ! ?

---

## Rendu des visuels

Gabarit unique `src/template/card.html`, rendu à ×2 puis réduit (netteté), JPEG qualité 95 en 4:4:4, sRGB, < 8 Mo.

| Visuel | Taille | Contenu |
|---|---|---|
| Slide 1 | 1080×1350 | Photo, dégradé sombre, bandeau logos, rubrique, titre avec surlignage |
| Slide 2 | 1080×1350 | Fond rouge `#CD402C`, bandeau identique au slide 1, description centrée |
| Story | 1080×1920 | Comme le slide 1, bandeau à 140 px du haut (×1,3), bloc titre calé à 380 px du bas (zone sticker lien) |

- **Bandeau** : construit en HTML (logo Ouest-France SVG vectoriel + « avec » en Montserrat + logo Passion Aquitaine PNG 524×205). Position et taille strictement identiques sur les slides 1 et 2.
- **Police** : Montserrat variable (`assets/fonts/`, licence OFL).
- **Tailles automatiques** : titre 44–66 px (4 lignes max), description 40–76 px (9 lignes max), par recherche binaire.
- **Cadrage** (`src/lib/crop.mjs`) : les photos du flux sont en paysage (souvent 16:9). Une carte du sujet (zones détaillées et distinctes du fond) choisit la fenêtre qui garde au moins 70 % du sujet. Si un cadrage plein cadre ne suffit pas, le cadre est élargi et le reste du canevas est rempli par la même photo floutée et assombrie, raccordée en fondu. Fenêtre descendue de 10 % pour que le sujet reste au-dessus du titre.
- **Lisibilité** : si la luminance de la bande 60–100 % dépasse 150/255, le dégradé sombre est renforcé.
- **Surlignage** (`src/lib/brush.mjs`) : texture de pinceau sec générée (fibres, manques laissant voir l'image, bouts effilochés), rouge `#CD402C`, légèrement différente pour chaque titre.

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
```

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
| Commandes `node -e` cassées sous PowerShell 5.1 | guillemets doubles et apostrophes typographiques mal passés | utiliser des backticks JS ou un fichier script |

---

## Limites connues et pistes

- **Alertes répétées** : un article bloqué par un garde-fou redéclenche l'alerte à chaque passage pendant 24 h. Piste : ne signaler qu'une fois et l'ignorer ensuite.
- **Publications de nuit possibles** (écart de 3 h). Piste : plage horaire sans publication (ex. 23 h–7 h).
- **Images qui s'accumulent** sur le FTP (~1 Mo par article). Piste : purge des images de plus de 7 jours.
- **Plus de 8 articles en 24 h** : avec l'écart de 3 h et la fenêtre de 24 h, les plus anciens seraient abandonnés.
- Les posts Instagram publiés à la main ne comptent pas dans l'écart de 3 h.
- Avertissement GitHub : les actions `checkout`, `setup-node`, `cache` en v4 ciblent Node 20 (dépréciation, sans effet actuellement). Piste : passer aux versions supérieures.
- Le surlignage est une texture générée, pas un vrai pinceau. Pour un rendu identique à une maquette, fournir un PNG/SVG de coup de pinceau.
- `assets/bandeau.jpg` n'est plus utilisé (remplacé par le bandeau HTML).

---

## Structure du code

```
.github/workflows/publish.yml   workflow GitHub Actions
src/index.mjs                   orchestrateur (sélection, garde-fous, rendu, dépôt, publication, état)
src/lib/rss.mjs                 lecture et nettoyage du flux
src/lib/editorial.mjs           rubrique, titre, groupe surligné, typographie
src/lib/crop.mjs                cadrage adaptatif, remplissage flouté, JPEG conforme Meta
src/lib/render.mjs              rendu Playwright, ajustement des tailles, assets
src/lib/brush.mjs               texture du surlignage
src/lib/upload.mjs              dépôt FTPS, vérification des URL publiques
src/lib/graph.mjs               appels API Instagram Graph
src/lib/notify.mjs              Telegram (alertes, story)
src/lib/state.mjs               état des publications, écart minimum
src/template/card.html          gabarit des 3 visuels
scripts/smoke-ig.mjs            test d'accès Meta
assets/                         logos, police
state/published.json            publications réalisées (commité par le bot)
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
