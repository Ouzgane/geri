// Les six bases Notion du pilotage, telles que le relais les lit et les écrit (relais/src/notion.js).
// Sert à l'installation d'une copie de GERI (outils/installer.mjs) : les bases sont créées sous la
// page « Pilotage des projets » avec exactement ces noms de propriétés.

const texte = { rich_text: {} };
const date = { date: {} };
const nombre = { number: { format: 'number' } };
const euros = { number: { format: 'euro' } };
const choix = (...options) => ({ select: { options: options.map(([name, color]) => ({ name, color })) } });
const lien = (projets) => ({ relation: { data_source_id: projets, type: 'single_property', single_property: {} } });

const DECISIONS = [['À arbitrer', 'orange'], ['Accélérer', 'blue'], ['Maintenir', 'green'], ['Mettre en pause', 'yellow'], ['Arrêter', 'red']];

// cle : nom de la variable du relais qui reçoit l'identifiant de la source de données.
export const BASES = [
  {
    cle: 'NOTION_SOURCE',
    titre: 'Projets',
    description: 'Une fiche par projet. Décision, Statut, Objectif revenu mensuel, Critère d\'arrêt et Date du critère sont à toi (tu peux les dicter à Geri, qui te demande confirmation). Le rapport du matin tient le reste à jour.',
    proprietes: () => ({
      Projet: { title: {} },
      Id: texte,
      'Décision': choix(...DECISIONS),
      Statut: choix(['Actif', 'green'], ['Accéléré', 'blue'], ['En pause', 'yellow'], ['Idée', 'purple'], ['Analyse en cours', 'orange'], ['Arrêté', 'gray']),
      'Objectif revenu mensuel (€)': euros,
      "Critère d'arrêt": texte,
      'Date du critère': date,
      'Prochaine étape': texte,
      'Échéance': date,
      Blocages: texte,
      'Résumé': texte,
      'Coûts mensuels (€)': euros,
      'Capital en jeu (€)': euros,
      'Indicateur clé': texte,
      'Cible indicateur': nombre,
      'Avancement (%)': nombre,
      'Étape': choix(['Idée', 'gray'], ['Conception', 'purple'], ['Construction', 'blue'], ['Lancé', 'green'], ['Premiers revenus', 'yellow'], ['Rentable', 'orange']),
      Dynamique: choix(['En hausse', 'green'], ['Stable', 'blue'], ['Au ralenti', 'yellow'], ['Au point mort', 'red']),
      Recommandation: choix(...DECISIONS),
      Potentiel: nombre,
      'Effort restant': nombre,
      Automatisations: nombre,
      'Dernière activité': date,
      'Modèle de revenu': texte,
      'Pôle': choix(['Média & contenu', 'blue'], ['Produit & tech', 'purple'], ['Services', 'orange'], ['Commerce', 'green'], ['Finance', 'pink'], ['Autre', 'gray']),
      Sources: texte,
      'Fait du jour': texte,
      Risques: texte,
      'Premier euro estimé': texte,
    }),
  },
  {
    cle: 'NOTION_RAPPORTS',
    titre: 'Rapports du matin',
    description: 'Un rapport par jour, écrit par le rapport du matin. Le site affiche le plus récent comme briefing du jour.',
    proprietes: () => ({
      Rapport: { title: {} },
      Date: date,
      Titre: texte,
      'Synthèse': texte,
      Arbitrages: texte,
      Alertes: texte,
      Avancements: texte,
      Encaissements: texte,
      Changements: texte,
      Revue: texte,
      Indicateurs: texte,
    }),
  },
  {
    cle: 'NOTION_MESURES',
    titre: 'Mesures',
    description: 'Une ligne par relevé daté d\'un indicateur de projet (audience, intention, vente, dossier). Le relais y écrit les relevés Plausible ; le rapport du matin y ajoute les autres.',
    proprietes: (projets) => ({
      Mesure: { title: {} },
      Date: date,
      Projet: lien(projets),
      'Projet id': texte,
      Indicateur: texte,
      Valeur: nombre,
      'Étape entonnoir': choix(['Audience', 'blue'], ['Intention', 'purple'], ['Vente', 'green'], ['Revenu', 'orange'], ['Dossier', 'gray']),
      Source: choix(['Plausible', 'blue'], ['Payhip', 'green'], ['GitHub', 'gray'], ['Dépôt Drive', 'yellow'], ['Relevé hebdomadaire', 'purple'], ['Session de travail', 'pink'], ['Rapport du matin', 'brown']),
      Note: texte,
    }),
  },
  {
    cle: 'NOTION_ACTIONS',
    titre: 'Actions',
    description: 'Ta liste : ce qui attend ta main ou celle d\'un tiers, projet par projet, avec l\'espace où le mener. « C\'est fait » sur le site la coche ici.',
    proprietes: (projets) => ({
      Action: { title: {} },
      Projet: lien(projets),
      'Projet id': texte,
      Qui: choix(['Toi', 'orange'], ['Tiers', 'purple'], ['Session du projet', 'blue']),
      Impact: choix(['Revenu', 'green'], ['Décision', 'orange'], ['Obligation', 'red'], ['Vérification', 'gray']),
      Statut: choix(['À faire', 'yellow'], ['Fait', 'green'], ['Abandonnée', 'gray']),
      'Échéance': date,
      'Ouverte le': date,
      'Faite le': date,
      'Où la mener': texte,
      Source: texte,
    }),
  },
  {
    cle: 'NOTION_DECISIONS',
    titre: 'Décisions',
    description: 'Journal de tes décisions : le choix, sa raison, le résultat attendu et la date à laquelle le revoir. Geri l\'écrit quand tu confirmes une décision.',
    proprietes: (projets) => ({
      'Décision': { title: {} },
      Projet: lien(projets),
      'Projet id': texte,
      Date: date,
      Choix: choix(['Accélérer', 'blue'], ['Maintenir', 'green'], ['Mettre en pause', 'yellow'], ['Arrêter', 'red'], ['À arbitrer', 'orange'], ['Autre', 'gray']),
      Raison: texte,
      'Résultat attendu': texte,
      'Revoir le': date,
      Bilan: texte,
      Source: choix(['Geri', 'blue'], ['Notion', 'gray'], ['Rapport du matin', 'purple'], ['Session', 'pink']),
    }),
  },
  {
    cle: 'NOTION_REVENUS',
    titre: 'Revenus',
    description: 'Journal des encaissements : une ligne par entrée d\'argent réelle. Les ventes Payhip y arrivent seules ; les autres se saisissent à la main (Source « Saisie »).',
    proprietes: (projets) => ({
      'Libellé': { title: {} },
      Date: date,
      'Montant (€)': euros,
      'Frais (€)': euros,
      Type: choix(['Vente', 'green'], ['Affiliation', 'blue'], ['Prestation', 'purple'], ['Abonnement', 'orange'], ['Sponsoring', 'pink'], ['Autre', 'gray']),
      Projet: lien(projets),
      'Projet id': texte,
      Source: choix(['Payhip (automatique)', 'green'], ['Saisie', 'gray']),
      'Réf transaction': texte,
      'État': choix(['Encaissé', 'green'], ['Remboursé', 'red']),
      Note: texte,
    }),
  },
];

export const CLES_NOTION = BASES.map((b) => b.cle);
