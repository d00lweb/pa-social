# pa-social — consignes de session

- Lire `README.md` avant toute action : c'est la mémoire du projet (fonctionnement, comptes, dépannage, historique).
- Chantier réseaux sociaux : suivre `docs/ROADMAP.md`. Ne lire que l'étape en cours, respecter son test d'acceptation, cocher l'étape une fois validée.
- `pilotage.html` (racine) est la vue centrale de l'utilisateur : mettre à jour statuts, formats, chiffres clés et feuille de route à chaque étape. Ses aperçus par réseau lisent `out/preview-data.js` : relancer `npm run preview -- --latest=6` après toute modification de rendu ou de textes, et ajouter le rendu de chaque nouveau réseau ou format dans son script.
- Après chaque fonctionnalité ou modification importante : mettre à jour les sections concernées de `README.md` et ajouter une ligne au « Journal des évolutions », dans le même commit.
- Production active : tout push sur `main` part en production au prochain passage du cron. Tester d'abord en local avec `DRY_RUN=1` (et `DRY_RUN_LATEST=n`).
- Dépôt public : aucun secret, mot de passe, token ou identifiant de compte dans le code, le README ou les commits. `.env` et `out/` restent ignorés.
- Le bot commite `state/published.json` : faire `git pull` avant de committer.
- Poste Windows / PowerShell 5.1 : dans `node -e`, utiliser des backticks JS (pas de guillemets doubles ni d'apostrophes typographiques), ou un fichier script.
