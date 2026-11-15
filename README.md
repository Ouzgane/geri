# Pilotage des projets

Version en ligne du tableau de pilotage du portefeuille de projets : revenus, briefing du jour, matrice d'arbitrage en 3D, fiches projets et trajectoires. Une assistante, Geri (prononcé « Jéri »), répond aux questions sur le tableau, par écrit et à voix haute.

## Règle primordiale : pilotage seulement

Ce dépôt, le site et le projet Claude « GERI » servent uniquement au pilotage et au suivi des projets : lire leur état, le tenir à jour dans Notion, aider à arbitrer. Toute action sur un projet (contenu, code, site, tâche planifiée, compte) se mène dans l'espace de ce projet, jamais ici, et deux projets ne se mélangent jamais dans une même session (règle du porteur du 15 novembre 2026, détaillée dans `CLAUDE.md`). Geri applique la même règle : elle recommande et dit dans quel projet agir, elle n'agit pas.

## Confidentialité

- Ce dépôt est public, mais il ne contient **aucune donnée lisible**. Les données sont dans `donnees/pilotage.chiffre.json`, chiffrées en AES-GCM 256 bits avec une clé dérivée du mot de passe (PBKDF2-SHA256, 310 000 itérations, sel et vecteur aléatoires à chaque publication).
- La page les déchiffre dans le navigateur. Le mot de passe n'est ni dans ce dépôt ni envoyé à un serveur. S'il est mémorisé (« Se souvenir sur cet appareil »), il reste dans ce navigateur, et le bouton « Verrouiller » l'efface.
- Le site demande aux moteurs de recherche de ne pas l'indexer (`robots.txt` et balise `noindex`).

## Mise à jour

Le site lit Notion en direct, par le relais de Geri (`GET /projets`, jeton requis) : à l'ouverture, au retour sur l'onglet, toutes les 2 minutes et après chaque enregistrement par Geri. L'en-tête indique l'heure de la dernière synchronisation.

- Base **Projets** : décision, statut et objectif toujours repris ; les autres champs dès que la fiche a été modifiée après la publication de la copie chiffrée. Un projet créé dans Notion apparaît aussitôt.
- Base **Rapports du matin** : briefing du jour (titre, synthèse, arbitrages, alertes), ce qui a changé depuis la veille, revue du dimanche, indicateurs du pilotage, avancement de chaque projet jour après jour et journal des encaissements.
- Base **Mesures** : relevés datés de l'indicateur clé et de l'entonnoir de chaque projet (audience, intention, vente, dossier). Écrite chaque matin par le relais (Plausible) et par le rapport du matin.
- Base **Actions** : « Ta liste », ce qui attend ta main ou celle d'un tiers, avec l'espace du projet où le mener. « C'est fait » sur le site la coche ici.
- Base **Décisions** : journal de tes décisions (choix, raison, résultat attendu, date de revue). Geri y écrit chaque décision que tu confirmes.
- Base **Revenus** : les ventes Payhip y arrivent seules ; le site les ajoute au journal des encaissements du rapport, sans doublon.

Chaque matin, la tâche planifiée « Pilotage des projets : rapport quotidien » met à jour le tableau de bord dans Claude et écrit le rapport du jour dans ces deux bases : il apparaît sur le site sans republier la copie chiffrée. Une tâche planifiée n'a accès qu'aux dépôts GitHub de la conversation où elle a été créée, et ce réglage ne se modifie pas ensuite : la tâche a été recréée le 15 novembre 2026 depuis une conversation qui avait les dépôts des projets (pare-72h, epargne-site, raphael-video, trading5, tablee, larmina, kitvital-actualites), qu'elle lit sans y écrire. Pour lui donner un nouveau dépôt, il faut la recréer de la même façon. Elle ne lit ni Plausible, ni Payhip, ni KDP, ni Partenaires Amazon : ces chiffres viennent des sessions de travail, notés et datés dans le journal des fiches.

Geri accueille avec le rapport le plus récent lu dans Notion (elle attend cette lecture 5 secondes au plus). « Décisions en attente » et « … attend ta décision » comptent les projets dont la Décision est vide ou « À arbitrer » ; Geri signale aussi les projets où la recommandation du rapport diffère de la décision prise.

La copie chiffrée (`donnees/pilotage.chiffre.json`) sert de base de départ et de secours si Notion ne répond pas. Publication manuelle, à partir des quatre fichiers du tableau de bord (`projets.json`, `rapports.json`, `syntheses.json`, `revenus.csv`) copiés dans `clair/`, un dossier ignoré par Git :

```sh
PILOTAGE_MDP='…' node outils/publier.mjs clair
PILOTAGE_MDP='…' node outils/verifier.mjs
```

Pour changer de mot de passe : republier avec le nouveau, mettre à jour la tâche planifiée, puis l'empreinte de l'assistant (voir plus bas).

## Ta liste, gouvernance et traction (15 novembre 2026)

- **Ta liste** (section 02 et indicateur « Ta liste » autour de Geri) : les actions à faire, triées par qui doit agir, par impact (revenu, décision, obligation, vérification), puis par retard. Chacune a une référence (A1, A2…) que Geri connaît : « j'ai fait A3 » propose une carte à confirmer. À côté : les pull requests ouvertes et les échecs de workflows des 7 derniers jours, lus sur GitHub.
- **Gouvernance** (section 03) : projets ouverts face au plafond (`plafondProjets` dans `config.js`, 3 par défaut), décisions qui t'attendent, écarts entre recommandation et décision, décisions arrivées à leur date de revue, objectifs et critères d'arrêt fixés, capital en jeu. Un simulateur montre ce que libérerait la mise en pause d'un projet (rien n'est écrit). La fraîcheur de chaque source est affichée.
- **Traction** (dans chaque fiche) : l'indicateur clé du projet, sa cible, sa courbe et, dès 3 jours de relevés, la date où la cible serait atteinte à ce rythme ; puis l'entonnoir audience → intention → vente.
- **Briefing** : « Ce qui a changé depuis hier », la revue du dimanche, et les alertes marquées « Nouveau » ou avec leur nombre de jours.
- Les calculs sont dans `pilotage.js`, partagés par le tableau et par Geri ; tests : `node --test outils/pilotage.test.mjs`.

## Connexions du pilotage

Toutes lisent sans rien modifier dans les projets ; seules les bases Notion du pilotage reçoivent des écritures. Chaque clé est un secret GitHub de ce dépôt (Settings → Secrets and variables → Actions), posé dans le relais au déploiement ; sans elle, la connexion reste éteinte et le site l'indique.

| Connexion | Secret | Ce qu'elle fait |
|---|---|---|
| Payhip | `PAYHIP_CLE` (clé API, Settings → Developer) | Payhip envoie un webhook signé à chaque vente ou remboursement vers `…workers.dev/payhip` ; le relais vérifie la signature (SHA-256 de la clé) et inscrit la ligne dans « Revenus », sans e-mail ni IP de l'acheteur, sans doublon. L'adresse se règle dans le compte Payhip (Settings → Developer → Webhook URL, événements paid et refunded). |
| Plausible | `PLAUSIBLE_CLE` (clé « Stats API », lecture seule) | Chaque matin à 5 h 17 UTC, le relais relève visites et visiteurs (jour, 7 et 30 jours) et les objectifs des sites de `PLAUSIBLE_SITES`, dans « Mesures ». `POST /releve` relance le relevé à la demande. |
| GitHub | `GITHUB_LECTURE` (jeton fin en lecture : Contents, Pull requests, Actions) | `GET /suivi` lit les dépôts de `GITHUB_DEPOTS` : pull requests ouvertes, dernier commit, échecs récents (gardé 10 minutes). |
| Google Drive | aucun (connecteur du rapport du matin) | Dossier « GERI : relevés à déposer » : tu y déposes les exports qu'aucun agent ne peut lire (KDP, Partenaires Amazon) ; le rapport du matin les reporte dans « Mesures ». |

Les nouvelles bases (Mesures, Actions, Décisions, Revenus) doivent être partagées avec l'intégration Notion de Geri, comme Projets et Rapports du matin ; sinon le site affiche « base non lisible » et le reste fonctionne.

## Assistant IA

On écrit à l'assistant, il répond par écrit et à voix haute, et propose des relances à cliquer. Il n'utilise jamais le micro. La voix est la synthèse vocale du navigateur, elle ne coûte rien ; le bouton haut-parleur la coupe. Une voix féminine française est choisie automatiquement parmi celles de l'appareil ; `voixNom` dans `config.js` en impose une. Sur Mac, la meilleure (Audrey ou Aurélie, en qualité Premium) s'installe dans Réglages Système → Accessibilité → Contenu énoncé → Voix du système → Gérer les voix.

```
navigateur ──(question + résumé des données)──▶ relais Cloudflare ──▶ modèle
```

- Le **relais** (`relais/`) est un petit Cloudflare Worker. Il garde les clés, choisit le modèle et lui donne ses consignes. Le site ne connaît que l'adresse du relais : **changer de modèle ne touche pas au site**.
- **Accès** : le navigateur dérive un jeton du mot de passe (PBKDF2, 310 000 itérations) ; le relais n'en connaît que l'empreinte (`JETON_EMPREINTE`). Sans le mot de passe, le relais refuse tout. Il n'accepte aussi que les appels venant de `ouzgane.github.io`.
- **Données** : à chaque question, le navigateur envoie un résumé des données déchiffrées (environ 11 000 caractères). Le relais ne stocke rien.

### Voix, sous-titres et sphère

- La voix est **Piper « Siwis »**, une voix féminine française générée directement dans le navigateur, sans compte ni coût. Au premier usage, le navigateur télécharge environ 90 Mo (voix 63 Mo, moteur et prononciation), puis les garde en cache. Si elle ne peut pas se charger, Geri utilise la voix du système. Réglages dans `config.js` : `voixPiper` (`fr_FR-siwis-low`, plus légère) et `voixVitesse`.
- Ce que Geri dit s'affiche aussi **sous la sphère, mot à mot**, comme des sous-titres, même voix coupée. Le texte reste dans le chat.
- La sphère suit le **vrai niveau sonore** de la voix ; les indicateurs évoqués s'allument au fil de la phrase.

### Musique (Spotify)

Demande « mets du jazz », « de quoi me concentrer » ou colle un lien Spotify : le lecteur Spotify s'ouvre sous la sphère. Morceaux complets si tu es connecté à Spotify dans ce navigateur, extraits de 30 secondes sinon. La musique se met en pause quand Geri parle. Les playlists proposées se règlent dans `config.js` (`playlists`).

### Notion

Quand tu annonces une décision ou un changement (« je mets Tablée en pause jusqu'en janvier »), Geri propose une carte **« Enregistrer dans Notion »** : rien n'est écrit sans ton clic. Champs modifiables : Décision, Statut, Prochaine étape, Échéance, Blocages, Résumé, Objectif revenu mensuel, Critère d'arrêt et Date du critère, dans la base **Projets** de la page « Pilotage des projets ». Une décision confirmée entre aussi au journal **Décisions**, avec sa raison et le résultat attendu si tu les as dits, et une date de revue (14 jours par défaut). Quand tu dis avoir fait une action de ta liste, Geri propose une carte **« C'est fait »**. Le tableau se met à jour aussitôt ; le rapport du matin reprend ces valeurs depuis Notion.

Mise en service : créer une intégration Notion interne (notion.so/profile/integrations, droits « lire » et « modifier le contenu »), lui donner accès aux bases « Projets » et « Rapports du matin » (onglet « Content access »), mettre son secret dans le secret GitHub `NOTION_CLE`, puis relancer le workflow « Relais IA ». Les identifiants des deux bases sont `NOTION_SOURCE` et `NOTION_RAPPORTS` dans `relais/wrangler.toml`.

### Modèle actuel

Cloudflare Workers AI, modèle `@cf/openai/gpt-oss-120b`. Gratuit dans la limite de 10 000 neurones par jour, soit environ 50 à 60 questions par jour avec ce modèle. Au-delà, l'assistant l'annonce et reprend le lendemain (0 h UTC) : aucun frais possible sur le plan gratuit. Cloudflare n'utilise pas les requêtes pour entraîner des modèles.

### Changer de modèle

Tout se règle dans `relais/wrangler.toml`. On pousse, le relais se redéploie seul.

1. Changer `IA_FOURNISSEUR` (et `IA_MODELE` pour un autre modèle que celui par défaut).
2. Hors Cloudflare : ajouter la clé du fournisseur dans le secret GitHub `IA_CLE`.

| `IA_FOURNISSEUR` | Modèle par défaut | Clé `IA_CLE` | Remarque |
|---|---|---|---|
| `cloudflare` | `@cf/openai/gpt-oss-120b` | aucune | Autre choix économique : `@cf/google/gemma-4-26b-a4b-it`, environ 3 fois plus de questions par jour. |
| `anthropic` | `claude-haiku-5-5` | console.anthropic.com | Payant à l'usage. |
| `openai` | `gpt-5-mini` | platform.openai.com | Payant à l'usage. |
| `mistral` | `mistral-small-latest` | console.mistral.ai | Payant à l'usage, hébergé en Europe. |
| `groq` | `openai/gpt-oss-120b` | console.groq.com | Gratuit avec limites. |
| `gemini` | `gemini-flash-latest` | aistudio.google.com | Offre gratuite : Google peut utiliser les échanges pour améliorer ses produits. |
| `openrouter` | `openai/gpt-oss-120b` | openrouter.ai | Des centaines de modèles avec une seule clé. |
| `compatible` | à indiquer | selon le service | Toute API compatible OpenAI : renseigner aussi `IA_URL` (…/chat/completions). |

Avec Cloudflare, si gpt-oss renvoie une réponse inutilisable (son raisonnement qui fuit, ou une réponse en anglais), le relais repose la question à un modèle de secours, `@cf/mistralai/mistral-small-3.1-24b-instruct` par défaut, réglable avec `IA_MODELE_SECOURS` (« aucun » pour le désactiver).

Les noms de modèles par défaut changent avec le temps : en cas d'erreur, vérifier le nom exact chez le fournisseur et le mettre dans `IA_MODELE`. Pour ajouter un fournisseur : une ligne dans `PRESETS` (`relais/src/fournisseurs.js`).

### Mise en service (une seule fois)

1. Compte Cloudflare gratuit sur dash.cloudflare.com. Ouvrir une fois **Workers & Pages** pour choisir le sous-domaine `….workers.dev`.
2. **Account ID** : visible dans **Workers & Pages**, colonne de droite.
3. **Jeton d'API** : My Profile → API Tokens → Create Token → modèle **Edit Cloudflare Workers**, puis ajouter la permission **Account · Workers AI · Read**.
4. Dans GitHub, dépôt larmina → Settings → Secrets and variables → Actions : créer `CLOUDFLARE_API_TOKEN` et `CLOUDFLARE_ACCOUNT_ID`.
5. Onglet Actions → **Relais IA** → Run workflow. Le workflow teste le relais, le déploie, puis écrit son adresse dans `config.js` : le site est branché.

### Vérifier

```sh
cd relais && npm test                          # tests du relais, sans réseau
curl https://larmina-ia.<sous-domaine>.workers.dev/   # fournisseur et modèle actifs
```

Si le mot de passe du site change : `PILOTAGE_MDP='…' node outils/empreinte-ia.mjs`, recopier la valeur dans `JETON_EMPREINTE`, pousser.

## Fichiers

- `index.html` : la page, son écran d'accès et le panneau de l'assistant.
- `app.js` : calculs et dessins, repris du tableau de bord Claude, plus ta liste, la gouvernance et la traction.
- `pilotage.js` : calculs partagés par le tableau et Geri (liste et références, traction, gouvernance, sources, simulation, fusion des revenus).
- `dash-shim.js` : fournit les données déchiffrées à `app.js`.
- `acces.js` : téléchargement, déchiffrement et mémorisation du mot de passe.
- `geri.js` : la sphère de Geri au centre de la page, ses ondes quand elle parle, et la mise en lumière des indicateurs qu'elle évoque.
- `assistant.js` : le chat, les relances, les cartes Notion et le résumé des données envoyé au relais.
- `voix.js`, `voix-worker.js` : la voix Piper (synthèse hors de la page, lecture et niveau sonore).
- `musique.js` : le lecteur Spotify.
- `config.js` : adresse du relais, nom de l'assistante, sa prononciation et sa voix.
- `relais/` : le relais IA (Cloudflare Worker) et ses tests : `src/notion.js` (lectures et écritures Notion), `src/payhip.js` (ventes), `src/releve.js` (Plausible), `src/github.js` (suivi en lecture).
- `.github/workflows/relais.yml` : déploiement automatique du relais.
- `vendor/` : D3, onnxruntime-web et piper-phonemize (voir `vendor/LICENCES.md`).
- `outils/` : publication et vérification du fichier chiffré, empreinte de l'assistant (Node 20 ou plus, sans dépendance).
