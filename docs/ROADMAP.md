# Feuille de route : relais réseaux sociaux intelligent

Objectif : faire de Passion Aquitaine un média de référence sur les réseaux, observé par ses concurrents. Chaque article est adapté au réseau (texte, visuel, lien, horaire) par un rédacteur en chef IA, publié sans risque de bannissement, puis mesuré pour s'améliorer.

Stratégie détaillée et données : note « Plan Bluesky, Threads, X » (v2, 15/09/2026).

## Comment utiliser ce document (économe en tokens)

- **1 étape = 1 session.** Démarrer la session par : « Étape N de docs/ROADMAP.md ». Ne lire que le README et l'étape en cours.
- Chaque étape a une **action de ta part** (à faire avant), des **livrables**, un **test d'acceptation**. Ne passer à la suivante que si le test passe.
- Validation visuelle en **une seule image** : le script d'aperçu produit une planche récapitulative (`out/preview.jpg`) plutôt que des dizaines de fichiers.
- Travailler hors ligne avec des **articles d'exemple enregistrés** (`tests/fixtures/`) : pas de relecture du flux ni d'appel IA inutile.
- En fin d'étape : cocher la case, mettre à jour le README (sections concernées + journal), commit, push.

## État

- [x] 1. Socle modulaire (15/09/2026)
- [x] 2. Rédacteur en chef IA + nouvelle légende Instagram (15/09/2026)
- [x] 3. Centre de contrôle Telegram (15/09/2026)
- [x] 4. Liens : annulée le 15/09/2026 (URL réelle partout, sans suivi des clics)
- [x] 5. Kit X (15/09/2026)
- [x] 6. Bluesky (en production depuis le 15/09/2026, identifiant certifié)
- [x] 6 bis. Rotation de 3 formats, mentions de comptes et localisation (17/09/2026)
- [ ] 7. Facebook
- [ ] 8. Threads
- [ ] 9. Mesure et apprentissage
- [ ] 10. Accélérateurs « média de référence »

---

> **Décision du 15/09/2026 :** plus aucune validation Telegram. Chaque réseau mis en production publie automatiquement dès son activation ; les « 2 semaines en mode validation » prévues ci-dessous ne s'appliquent plus. Telegram ne reçoit que le kit X, la story Instagram et les alertes.

## Architecture cible

Principe : **un article → un « dossier de publication » unique → des canaux indépendants**. Ajouter un réseau = ajouter un fichier de canal, sans toucher au reste.

```
config/
  channels.json        réseaux actifs, écarts, heures creuses, poids des formats, montée en charge
  geo.json             lexique géographique (département → Pays basque, Béarn, Médoc…)
  hashtags.json        hashtags autorisés / interdits, casse (#PaysBasque)
prompts/
  editorial.md         charte éditoriale de l'IA (modifiable sans toucher au code)
src/
  index.mjs            orchestrateur : lit la file, exécute ce qui est dû
  core/                config, planificateur, état par canal, alertes, coupe-circuits, journal
  sources/rss.mjs      lecture du flux + texte complet de l'article
  brain/
    ai.mjs             appel Claude, sortie JSON validée par schéma
    schema.mjs         schéma du dossier de publication
    guards.mjs         contrôles (longueurs, chiffres présents dans l'article, surlignage ⊂ titre…)
    fallback.mjs       repli sans IA (règles actuelles)
    memory.mjs         dernières accroches par réseau (anti-répétition)
  media/
    render.mjs, crop.mjs, brush.mjs
    templates/         ig-slide.html, ig-desc.html, story.html, card-1200x630.html, x-16x9.html
  brain/compose.mjs    mise en forme par réseau (hashtags intégrés, liens, commentaire Facebook)
  storage/ftp.mjs      dépôt des visuels
  channels/            instagram, facebook, bluesky, threads, x-kit, telegram
                       interface commune : prepare(dossier) → publish() → verify()
state/
  queue.json           plan de publication par article et par canal (heure prévue, statut)
  published.json       historique (guid, canal, id, heure)
tests/
  fixtures/            articles réels enregistrés (cas normaux et cas limites)
  *.test.mjs           node:test (règles, planificateur, schéma, gardes)
scripts/
  preview.mjs          planche d'aperçu de tous les canaux pour un article
  smoke-*.mjs          test d'accès par réseau
.github/workflows/
  publish.yml          cron 20 min (déclenché par o2switch)
  maintenance.yml      hebdo : renouvellement token Threads, purge FTP > 7 j, rapport
```

Règles de conception :

- **Idempotence** : l'état est indexé par `guid + canal`. Relancer ne republie jamais.
- **Isolation** : l'échec d'un canal n'arrête pas les autres ; chaque canal a son interrupteur (`config/channels.json` + variable GitHub globale `PUBLISH_ENABLED`).
- **Planification à l'ingestion** : dès qu'un article est détecté, le planificateur fixe l'heure de chaque canal (priorité, écart, heures creuses, décalage aléatoire). Le cron n'exécute que ce qui est dû.
- **Configuration et charte hors du code** : ton, lexique, hashtags, poids des formats se modifient dans `config/` et `prompts/`.
- **Tout testable hors ligne** : `DRY_RUN` + fixtures, aucun appel réseau dans les tests.

---

## Étape 1 · Socle modulaire

**Action de ta part :** aucune.

**Livrables**
- Réorganisation selon l'architecture cible, **sans changement visible** pour Instagram.
- `core/scheduler` : file par canal, écart minimum, heures creuses 23 h–7 h, décalage aléatoire 5–35 min, priorités (voir étape 2).
- État migré : `published.json` actuel conservé, `queue.json` créé.
- Visuels 4:5 produits en **1440×1800** (largeur maximale acceptée par les API Instagram et Threads, recommandée par Meta), même mise en page qu'aujourd'hui.
- `tests/fixtures/` : 12 articles réels couvrant les cas limites (titre très long, guillemets, chiffres, Pyrénées-Atlantiques, hors région, fait divers, événement daté, catégorie « Actus » seule…).
- `scripts/preview.mjs` : planche d'aperçu unique.
- Tests `node:test` + exécution dans le workflow avant publication.

**Test d'acceptation :** tests verts ; un `DRY_RUN` produit des visuels Instagram identiques à ceux d'aujourd'hui ; publication réelle suivante inchangée.

---

## Étape 2 · Rédacteur en chef IA + nouvelle légende Instagram

**Action de ta part :** créer une clé API Anthropic (console.anthropic.com), l'ajouter au secret `SOCIAL` (`ANTHROPIC_API_KEY=`) et à ton `.env`.

**Principe :** un seul appel Claude par article produit tout le dossier de publication, en JSON validé. Modèle `claude-opus-5`, effort bas. **L'IA ne dispose que des données du flux RSS** (pas de lecture de l'article). Coût estimé : ~0,03 $ par article, soit **~2,5–3 € par mois** pour ~90 articles ; l'essentiel du coût vient des 5 textes produits, pas de la lecture.

**Entrées :** titre, description, catégories et date du flux ; zone géographique détectée par le lexique ; angle d'accroche imposé par réseau ; 10 dernières accroches par réseau, en version compacte (anti-répétition).

**Diversité garantie par le code, pas seulement par l'IA :** pour chaque article, le programme attribue à chaque réseau un angle différent, tiré en rotation (question, chiffre ou fait marquant, lieu en tête, surprise, bénéfice pour le lecteur, citation, « le saviez-vous »). L'IA doit s'y conformer.

**Sortie (schéma) :**
- `nature` : `actu_chaude` · `actu` · `evergreen` ; `sensible` (décès, accident, justice, drame) ; `ton` : `sobre` · `standard` · `léger`
- `lieu` : rubrique affichée (terme identitaire), zone, hashtag de lieu
- `visuel` : titre adapté (≤ 70 caractères, sens intact), groupe surligné (sous-chaîne exacte), texte alternatif
- `instagram` : accroche (première ligne ≤ 125 caractères, avant le « plus »), 3 hashtags
- `facebook`, `bluesky`, `threads`, `x` : texte propre à chaque réseau
- `threads.format` suggéré ; `slug` du lien court (≤ 14 caractères)
- `faits` : liste des faits de l'article réellement utilisés

**Nouvelle légende Instagram :**
```
<description ou accroche IA>
⠀
➡️ Article complet sur le site Passion Aquitaine
⠀
#Bordeaux #Matrimoine #Histoire
```

**Gardes automatiques (sinon 1 nouvel essai, puis repli sur les règles actuelles) :**
- longueurs par réseau respectées ; surlignage présent dans le titre ; 3 hashtags au format `#MotCamelCase`
- **tout chiffre, date ou nom propre des textes doit figurer dans le titre, la description ou les catégories du flux** (anti-invention)
- **textes différents entre réseaux** : similarité entre deux textes du même article inférieure à un seuil (mots en commun), sinon régénération
- article `sensible` : aucun emoji, aucune formule légère, pas de question racoleuse
- aucune accroche identique ou quasi identique aux 30 précédentes du réseau
- jamais de promesse absente de l'article, jamais de « vous ne devinerez jamais »

**Cas à gérer (dans `prompts/editorial.md` et `config/geo.json`) :**
- **Identité locale plutôt que département** : Pyrénées-Atlantiques → *Pays basque* (Bayonne, Biarritz, Anglet, Saint-Jean-de-Luz, Hendaye, Espelette…) ou *Béarn* (Pau, Oloron, Orthez, Jurançon…) ; Gironde → *Bordeaux*, *Bassin d'Arcachon*, *Médoc*, *Saint-Émilion*, *Entre-deux-Mers* ; Dordogne → *Périgord* (noir, vert, blanc, pourpre), *Sarlat*, *Bergerac* ; Charente-Maritime → *La Rochelle*, *Île de Ré*, *Oléron*, *Royan* ; Landes → *Côte landaise*, *Dax*, *Mont-de-Marsan* ; Lot-et-Garonne → *Agenais* ; Charente → *Cognac*, *Angoulême* ; Deux-Sèvres et Vienne → *Marais poitevin*, *Poitiers*, *Niort* ; Corrèze, Creuse, Haute-Vienne → *Limousin*, *Brive*, *Limoges*, *Aubusson*.
- Article hors région (ex. ville espagnole) : rubrique thématique, pas de lieu inventé.
- Titre trop long pour le visuel : réécriture courte fidèle, jamais tronquée.
- Titre-question, citation entre guillemets, chiffres (« 42 °C », « 400 000 € ») : conserver la forme typographique française.
- Événement daté : date et lieu dans les textes ; priorité avant l'échéance.
- Contenu en partenariat : mention explicite.
- Article mis à jour (même guid) : ne jamais republier.
- Rubrique « Actus » seule : déduire la rubrique du contenu.

**Test d'acceptation :** sur les 12 fixtures, planche d'aperçu validée par toi ; 0 fait inventé détecté ; repli testé en coupant la clé.

---

## Étape 3 · Centre de contrôle Telegram

**Action de ta part :** aucune.

**Livrables**
- Aperçu par article : visuels + textes de chaque réseau dans un seul message.
- **Mode validation** par canal (boutons Valider / Refuser / Régénérer), lu à chaque passage du cron (délai ≤ 20–40 min).
- Commandes : `/statut`, `/pause <réseau>`, `/reprise <réseau>`, `/file` (prochaines publications).
- Alertes : erreurs, coupe-circuit déclenché, quotas.

**Test d'acceptation :** un article en mode validation n'est publié qu'après ton clic ; `/pause instagram` bloque le canal au passage suivant.

---

## Étape 4 · Liens (annulée)

**Décision du 15/09/2026 :** pas de suivi des clics. L'URL réelle de l'article est utilisée partout, sans paramètres UTM. La mise en forme des liens par réseau est dans `src/brain/compose.mjs` (lien X à la suite du texte, formule avant le lien en commentaire Facebook). Le texte ci-dessous est conservé pour mémoire.

**Action de ta part :** aucune. Pas de raccourcisseur : on utilise l'URL réelle de l'article partout.

**Règle :**
- Lien **non visible** (carte Bluesky, carte Threads) : URL réelle + UTM (`utm_source=bluesky&utm_medium=social`), pour mesurer les clics dans les statistiques du site.
- Lien **visible** (texte X, texte ou réponse Threads, commentaire Facebook) : URL réelle propre, sans UTM. Les statistiques du site attribuent quand même la visite au réseau d'origine.
- Sur X, toute URL compte pour 23 caractères et s'affiche tronquée (`passion-aquitaine.ouest-france.fr/pourquoi-bor…`). Sur Bluesky, une facette peut afficher un texte court cliquable qui pointe vers l'URL réelle.

**Livrables :** `links/links.mjs`, un seul endroit pour construire les liens selon le réseau et la visibilité.

**Test d'acceptation :** chaque canal reçoit la bonne forme d'URL ; une URL avec UTM ouvre bien l'article.

---

## Étape 5 · Kit X

**Action de ta part :** aucune.

**Livrables :** gabarit `x-16x9` (**1600×900**, le format qui s'affiche sans recadrage sur mobile et ordinateur ; variante sans logo Ouest-France prête si besoin) ; message Telegram : image, texte ≤ 250 caractères + URL réelle dans un bloc copiable, bouton « Publier sur X » (texte et lien pré-remplis).

**Test d'acceptation :** du message Telegram à la publication sur X en moins de 30 secondes.

---

## Étape 6 · Bluesky

**Compte créé :** `passion-aquitaine.bsky.social` (nom, bio et avatar présents ; bannière à ajouter, 1500×500).

**Action de ta part :** créer un mot de passe d'application ; passer l'identifiant en `@passion-aquitaine.fr` (enregistrement DNS guidé).

**Livrables :** gabarit `card-1200x627` (1,91:1, < 1 Mo) ; post carte de lien (vignette = visuel), 1 hashtag de lieu, texte alternatif ; variante image 4:5 en 1440×1800 (< 2 Mo, 20 % des posts) avec lien par facette ; 2 semaines en mode validation puis automatique.

**Visibilité Discover :** publier aux heures d'audience (8 h–20 h), mots-clés du sujet dans le texte, hashtag de lieu, réponses humaines rapides aux premiers commentaires (l'engagement précoce compte).

**Test d'acceptation :** post conforme, carte avec visuel, clic tracé.

---

## Étape 7 · Facebook

**Action de ta part :** ajouter `pages_manage_posts` et `pages_manage_engagement` à l'app Meta, régénérer le token de Page.

**Livrables :** post **1 image** (visuel 4:5 en 1440×1800) + texte 1 à 3 phrases, puis URL réelle en **premier commentaire**, publié automatiquement par la Page ; montée en charge : 1/jour pendant 2 semaines, puis 2, puis 3.

**Risque du commentaire automatique :** faible. Commenter ses propres posts via l'API officielle (`pages_manage_engagement`) est un usage documenté par Meta et proposé par les outils de programmation. Ce qui est sanctionné, ce sont les commentaires automatiques sur les contenus des autres. Garde-fous : un seul commentaire par post, texte variable (« L'article complet : », « À lire ici : »…), publié 1 à 3 minutes après le post.

**Visibilité (recommandations aux non-abonnés) :** contenu visuel original, texte qui appelle le commentaire sans appât (« Vous connaissiez ce lieu ? »), jamais de lien dans le corps.

**Test d'acceptation :** image publiée, commentaire lien posté par la Page, pas de lien dans le corps.

---

## Étape 8 · Threads

**Compte créé :** `@lovaquitaine`.

**Action de ta part :** ajouter le cas d'usage Threads à l'app Meta, autoriser l'app.

**Livrables :** rotation A (image 4:5 1440×1800 + URL dans le texte) / B (texte + carte avec URL réelle) / C (image + URL en réponse) ; 1 sujet ; question ouverte 1 fois sur 3 (jamais si `sensible`) ; `maintenance.yml` renouvelle le token tous les 30 jours avec alerte ; 2 semaines en mode validation.

**Test d'acceptation :** 3 formats publiés correctement ; renouvellement du token testé.

---

## Étape 9 · Mesure et apprentissage

**Action de ta part :** aucune.

**Livrables :** relevé hebdomadaire par post et par réseau (interactions via API, visites par réseau dans les statistiques du site) ; rapport Telegram le lundi (top/flop, meilleurs formats et horaires) ; **boucle d'apprentissage** : les 10 meilleures accroches du mois sont injectées comme exemples dans le prompt ; ajustement des poids de formats dans `config/channels.json`.

**Test d'acceptation :** premier rapport reçu, poids ajustables sans code.

---

## Étape 10 · Accélérateurs « média de référence »

À lancer une fois les étapes 1 à 9 stables.

- **Vidéo courte automatique** 9:16 (8–12 s, visuels animés + sous-titres) pour Reels Instagram et Facebook, Threads, Bluesky : la vidéo est le format le plus engageant sur Threads et Bluesky.
- **Recyclage des articles intemporels** (`evergreen`) : republication espacée de plusieurs mois, avec de nouvelles accroches.
- **File prioritaire « actu chaude »** : publication immédiate, hors créneau habituel (sauf nuit).
- **Séries éditoriales** récurrentes (ex. « Le lieu secret de la semaine »), repérables et attendues.
- **Story Instagram** avec sticker lien : kit Telegram enrichi.

---

## Formats de référence par réseau

| Réseau | Visuel | Texte | Lien | Hashtags | Visibilité / actu |
|---|---|---|---|---|---|
| Instagram | Carrousel 4:5, 1440×1800 | Accroche ≤ 125 car. en tête, mots-clés | Aucun (non cliquable) | 3 intelligents | Enregistrements et partages, texte alternatif, Reels (étape 10) |
| Facebook | 1 image 4:5, 1440×1800 | 1 à 3 phrases | URL réelle en premier commentaire | 0 | Visuel original, conversation, pas de lien dans le corps |
| Bluesky | Carte 1200×627 · 20 % image 4:5 1440×1800 | Accroche 150–250 car., sans emoji | Carte ou facette (URL réelle) | 1 lieu | Heures d'audience, engagement précoce |
| Threads | Rotation image 4:5 1440×1800 / carte / réponse | Conversationnel, question 1/3 | URL réelle | 1 sujet | Réponses, sujets, vidéo (étape 10) |
| X (manuel) | 16:9, 1600×900 | ≤ 250 car. autonome | URL réelle (compte 23 car.) | 0–1 | Rapidité sur l'actu chaude |
| Story Instagram | 9:16, 1080×1920 | — | Sticker à la main | — | Inchangé |

**Dimensions vérifiées (septembre 2026) :**
- **Instagram :** l'app affiche la grille du profil en 3:4 depuis 2025, mais l'API de publication n'accepte que du 4:5 au 1,91:1, avec une largeur de 1440 px maximum. Le 4:5 est donc le plus haut format publiable. Dans la grille, un 4:5 perd environ 34 px de chaque côté : titre, rubrique et bandeau restent à plus de 88 px des bords.
- **Facebook :** 4:5 recommandé pour le fil mobile ; Meta conseille 1440 px de large.
- **Threads :** 1440 px de large maximum, 8 Mo, sRGB.
- **Bluesky :** images jusqu'à 2 Mo, affichées jusqu'à 4000 px (avril 2026) ; vignette de carte en 1,91:1.
- **X :** 16:9 (1600×900), le format qui s'affiche sans recadrage partout. Test d'un 4:5 prévu à l'étape 9.

## Règles anti-bannissement (rappel)

API officielles uniquement · jamais d'interaction automatique · humains derrière chaque compte · démarrage en mode validation · écarts, nuit, décalage aléatoire · textes différents par réseau et par post · URL réelle du site, pas de raccourcisseur · coupe-circuits par canal · accrocheur jamais trompeur.
