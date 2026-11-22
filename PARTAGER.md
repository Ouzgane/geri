# Avoir ton propre GERI

GERI est un tableau de pilotage pour un portefeuille de projets : revenus encaissés, audience des sites, décisions à prendre, ta liste d'actions, matrice d'arbitrage. Une assistante, Geri, répond à tes questions sur le tableau, par écrit et à voix haute, et enregistre dans Notion les décisions que tu lui dictes, après ta confirmation.

Ce guide installe **ta propre copie**, sur ton compte GitHub, avec tes projets dans ton Notion. Tout se fait dans le navigateur, sans rien installer sur ton ordinateur. Compte une demi-heure.

| | |
|---|---|
| **Ce que tu obtiens** | Un site à toi (`https://<ton-compte>.github.io/geri/`), protégé par ton mot de passe, et ton assistante. |
| **Coût** | 0 € : GitHub, Cloudflare et Notion en offre gratuite. L'assistante utilise le quota gratuit de Cloudflare Workers AI (de l'ordre de 50 questions par jour avec le modèle par défaut ; au-delà, elle reprend le lendemain, sans frais). |
| **Confidentialité** | Tes projets restent dans ton Notion. Le dépôt est public, mais il ne contient aucune donnée lisible ni aucune clé : les données de départ sont chiffrées avec ton mot de passe, les clés sont des secrets GitHub. |

## Ce qu'il te faut

- Un compte **GitHub** (gratuit) : le site.
- Un compte **Cloudflare** (gratuit) : le relais de l'assistante, qui garde les clés et lit Notion.
- Un compte **Notion** (gratuit) : tes projets, tes décisions, ta liste d'actions.
- Facultatif : **Plausible** (audience de tes sites), **Payhip** (ventes reçues automatiquement), **Claude** avec les tâches planifiées (un briefing écrit chaque matin).

Garde un onglet ouvert sur la page de ton dépôt GitHub : la plupart des étapes y reviennent. Les secrets se créent tous au même endroit : **Settings → Secrets and variables → Actions → New repository secret**.

## 1. Copier le dépôt

1. Ouvre [github.com/Ouzgane/geri](https://github.com/Ouzgane/geri) et clique sur **Fork**, puis **Create fork**. Garde le nom `geri` (ou choisis-en un autre : il apparaîtra dans l'adresse du site).
2. Dans ta copie, ouvre l'onglet **Actions** et clique sur **I understand my workflows, go ahead and enable them**. GitHub désactive les workflows des copies tant qu'on ne les a pas autorisés.

Le dépôt reste public : c'est ce qui rend GitHub Pages gratuit. Rien de lisible n'y sera écrit.

## 2. Choisir ton mot de passe

Crée le secret **`PILOTAGE_MDP`** : le mot de passe de ton site, 12 caractères au moins.

Il chiffre tes données de départ et ouvre l'accès à l'assistante. Il ne quitte jamais ton navigateur et ne peut pas être retrouvé : note-le dans ton gestionnaire de mots de passe. Pour en changer plus tard, modifie le secret puis relance l'étape 5.

## 3. Préparer Notion

1. Dans Notion, crée une page vide nommée **Pilotage des projets**. Tes six bases y seront créées.
2. Va sur [notion.so/profile/integrations](https://www.notion.so/profile/integrations) → **New integration**. Donne-lui un nom (par exemple « Geri »), choisis ton espace de travail et le type **Internal**.
3. Dans **Capabilities**, coche **Read content**, **Update content** et **Insert content**, puis enregistre.
4. Copie l'**Internal Integration Secret** et crée le secret GitHub **`NOTION_CLE`** avec cette valeur.
5. Donne à l'intégration l'accès à ta page : ouvre la page, menu **•••** en haut à droite → **Connections** (Connexions) → ajoute ton intégration. Tu peux aussi le faire depuis l'intégration, onglet **Content access**.
6. Copie le lien de la page (menu **•••** → **Copy link**) : tu le colleras à l'étape 5.

## 4. Préparer Cloudflare

1. Crée un compte sur [dash.cloudflare.com](https://dash.cloudflare.com). Ouvre une fois **Workers & Pages** pour choisir ton sous-domaine `….workers.dev`.
2. Note ton **Account ID** (colonne de droite de **Workers & Pages**) et crée le secret GitHub **`CLOUDFLARE_ACCOUNT_ID`**.
3. Crée un jeton d'API : **My Profile → API Tokens → Create Token**, modèle **Edit Cloudflare Workers**, puis ajoute la permission **Account · Workers AI · Read**. Crée le secret GitHub **`CLOUDFLARE_API_TOKEN`** avec sa valeur.

À ce stade, tu as quatre secrets : `PILOTAGE_MDP`, `NOTION_CLE`, `CLOUDFLARE_ACCOUNT_ID` et `CLOUDFLARE_API_TOKEN`.

## 5. Lancer l'installation

Onglet **Actions** → **Installer GERI** → **Run workflow**. Colle le lien de ta page Notion, choisis le nom de ton assistante (Geri par défaut), puis **Run workflow**.

En deux minutes environ, le workflow :

- crée sous ta page Notion les six bases du pilotage (Projets, Rapports du matin, Mesures, Actions, Décisions, Revenus), avec une fiche « Projet exemple » ;
- écrit tes réglages dans le dossier `perso/` de ta copie (adresse de ton site, empreinte de ton mot de passe, identifiants de tes bases) ;
- chiffre des données de départ avec ton mot de passe ;
- lance le workflow **Relais IA**, qui déploie ton assistante sur Cloudflare et branche ton site dessus.

Les deux workflows doivent finir en vert. Le résumé du premier, en bas de sa page, rappelle l'adresse de ton site et la suite.

Tu peux relancer **Installer GERI** quand tu veux : il retrouve tes bases au lieu de les recréer et garde tes réglages. C'est aussi comme ça qu'on change de mot de passe ou de nom d'assistante, ou qu'on branche Notion plus tard.

## 6. Mettre le site en ligne

**Settings → Pages**. Sous **Build and deployment**, choisis **Deploy from a branch**, la branche **main** et le dossier **/ (root)**, puis **Save**.

Une à deux minutes plus tard, ton site est à l'adresse `https://<ton-compte>.github.io/geri/`. Ouvre-le, saisis ton mot de passe et coche « Se souvenir sur cet appareil » si l'appareil est à toi.

## 7. Ajouter tes projets

Tout part de la base Notion **Projets** : chaque fiche y apparaît sur le site en moins de 2 minutes.

- Renomme la fiche « Projet exemple » avec ton premier projet, ou supprime-la.
- **Id** : un identifiant court, en minuscules, chiffres et tirets (`mon-site`, `appli-recettes`). Il relie la fiche à ses mesures, ses actions et ses revenus.
- Les champs qui sont **à toi** : Décision, Statut, Objectif revenu mensuel, Critère d'arrêt et Date du critère. Tu peux aussi les dicter à l'assistante (« je mets mon-site en pause jusqu'en janvier ») : elle te propose une carte « Enregistrer dans Notion » et n'écrit rien sans ton clic.
- **Indicateur clé** et **Cible indicateur** : la mesure qui mène au premier euro (par exemple « Visites 30 j » et 5000). Le tableau en tire une tendance et une date estimée.
- Un encaissement réel se note dans la base **Revenus** (Montant, Date, Projet id, Source « Saisie »). Le site les additionne ; une estimation n'y a pas sa place.
- Ta liste : la base **Actions** (Statut « À faire », Qui « Toi »). Le bouton « C'est fait » du site la coche.

## 8. Le briefing du matin (facultatif)

Une tâche planifiée Claude peut lire chaque matin tes projets et écrire le rapport du jour dans Notion : synthèse, arbitrages proposés, alertes, avancement de chaque projet. Le site l'affiche comme briefing, et l'assistante t'accueille avec.

1. Dans ta copie, ouvre `perso/rapport-du-matin.md` : c'est le texte de la tâche, déjà rempli avec tes bases Notion et l'adresse de ton site.
2. Dans Claude, avec le connecteur Notion branché, demande : « Crée une tâche planifiée tous les jours à 7 h 45 avec ce texte », et colle-le.

Sans cette tâche, tout fonctionne ; seul le briefing reste celui de l'installation.

## 9. Connexions (facultatif)

Chaque connexion lit sans jamais rien modifier dans tes projets. Elle demande un secret GitHub et, souvent, une ligne dans `perso/relais.json` (bouton crayon sur GitHub, puis **Commit changes** : le relais se redéploie seul). Après l'ajout d'un secret, relance **Actions → Relais IA → Run workflow**.

| Connexion | Secret GitHub | Dans `perso/relais.json` | Ce qu'elle fait |
|---|---|---|---|
| Plausible | `PLAUSIBLE_CLE` (clé « Stats API ») | `PLAUSIBLE_SITES` : `mon-site\|mon-site.fr; boutique\|boutique.fr` (Id du projet, puis domaine) | Relevé des visites chaque matin dans « Mesures », courbes d'audience sur le site. Plausible auto-hébergé : ajoute `PLAUSIBLE_URL`. |
| Payhip | `PAYHIP_CLE` (Settings → Developer) | `PAYHIP_PROJET` : l'Id du projet qui vend | Chaque vente arrive seule dans « Revenus ». Dans Payhip, mets l'adresse du webhook `https://geri-ia.<ton-sous-domaine>.workers.dev/payhip` (événements paid et refunded). |
| GitHub | `GH_LECTURE` (jeton fin en lecture : Contents, Pull requests, Actions) | `GITHUB_DEPOTS` : `depot-du-site=mon-site; autre-depot=appli` | Pull requests ouvertes et échecs de workflows de tes projets, dans ta liste. |
| Autre modèle d'IA | `IA_CLE` | `IA_FOURNISSEUR` (anthropic, openai, mistral, groq, gemini, openrouter…), `IA_MODELE` si besoin | Remplace le modèle gratuit de Cloudflare. Fournisseurs et modèles par défaut : voir le README. |

## Personnaliser

- **Nom de l'assistante** : relance **Installer GERI** avec un autre nom.
- **Autres réglages du site** (plafond de projets ouverts, playlists, voix) : ajoute-les dans `perso/site.js`, sur le modèle de `config.js`, par exemple `plafondProjets: 5,`. Ils remplacent ceux de l'original et sont gardés si tu relances l'installation.
- Le dossier `perso/` t'appartient : `perso/LISEZMOI.md` y décrit chaque fichier.

## Recevoir les nouveautés de l'original

Sur la page de ta copie, **Sync fork → Update branch**. Tes réglages vivent dans `perso/`, que l'original ne modifie jamais : la mise à jour ne les touche pas. Si elle change le relais, il se redéploie seul.

Si GitHub signale un conflit, c'est que tu as modifié un fichier que l'original a aussi changé (souvent `config.js`). Remets ce fichier comme dans l'original, déplace ton réglage dans `perso/site.js`, puis recommence.

## Sécurité

- Le mot de passe ne quitte pas ton navigateur. Le relais n'en connaît qu'une empreinte et refuse tout appel sans lui, ou venant d'un autre site que le tien.
- Les clés (Notion, Cloudflare, Plausible, Payhip…) sont des secrets GitHub, transmis au relais au déploiement. N'en écris jamais dans `perso/` : ce dossier est public.
- L'intégration Notion ne voit que la page que tu lui as partagée.
- Le site demande aux moteurs de recherche de ne pas l'indexer.

## En cas de souci

| Ce que tu vois | Quoi faire |
|---|---|
| Pas de workflow dans l'onglet Actions | Active-les (étape 1.2). |
| « Installer GERI » échoue : « Notion ne trouve pas la page » | Partage la page avec ton intégration (étape 3.5), puis relance. |
| « Installer GERI » échoue sur `PILOTAGE_MDP` | Crée le secret, 12 caractères au moins. |
| « Mot de passe incorrect » juste après une réinstallation | Attends deux minutes que GitHub Pages publie la nouvelle version, puis recharge la page. |
| L'assistante affiche « Aucun modèle branché » | Le relais n'est pas déployé : vérifie les deux secrets Cloudflare, puis **Actions → Relais IA → Run workflow**. |
| « Notion injoignable » en haut du tableau | Vérifie le secret `NOTION_CLE`, puis relance **Relais IA**. |
| Une base affichée « non lisible » | Elle n'est pas sous la page partagée avec l'intégration. |

Pour voir l'état du relais, ouvre `https://geri-ia.<ton-sous-domaine>.workers.dev/` : il répond avec le fournisseur et le modèle actifs, et indique si Notion est branché.

## Ce qui vient de l'original

`README.md` décrit l'instance d'origine et son fonctionnement détaillé (calculs, voix, modèles). `CLAUDE.md` donne à Claude les règles de travail de son auteur, dont « pilotage seulement : on suit les projets ici, on agit dans l'espace de chaque projet ». Garde-les, adapte-les ou supprime-les : c'est ta copie.
