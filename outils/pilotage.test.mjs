// Tests des calculs partagés du pilotage (pilotage.js) : node --test outils/pilotage.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const P = createRequire(import.meta.url)('../pilotage.js');
const JOUR = '2026-11-15';
const projets = [
  { id: 'kitvital', projet: 'KitVital', statut: 'Accéléré', decision: 'Accélérer', recommandation: 'Accélérer', indicateur_cle: 'Visites 30 j' },
  { id: 'sauvermonepargne', projet: 'sauvermonepargne.fr', statut: 'Accéléré', decision: 'Accélérer', recommandation: 'Maintenir', indicateur_cle: 'Visites 30 j', cible: 5000 },
  { id: 'growth-hiring', projet: 'Growth Hiring', statut: 'Actif', decision: 'Maintenir', recommandation: 'Maintenir', indicateur_cle: 'Reste à financer (€)', cible: 0, capital: 69000 },
  { id: 'super-app', projet: 'Super-app', statut: 'Analyse en cours', decision: null, recommandation: 'Mettre en pause' },
  { id: 'tablee', projet: 'Tablée', statut: 'En pause', decision: 'Mettre en pause', recommandation: 'Mettre en pause' },
];
const actions = [
  { id: '1', titre: 'Dépôt légal', projet_id: 'kitvital', qui: 'Toi', impact: 'Obligation', statut: 'À faire', echeance: '2026-11-12', ouverte: '2026-11-12' },
  { id: '2', titre: 'Comptes réseaux', projet_id: 'kitvital', qui: 'Toi', impact: 'Revenu', statut: 'À faire', echeance: '2026-11-13', ouverte: '2026-11-13' },
  { id: '3', titre: 'Trancher', projet_id: 'super-app', qui: 'Toi', impact: 'Décision', statut: 'À faire', ouverte: '2026-11-10' },
  { id: '4', titre: 'Crédit', projet_id: 'enage-cars', qui: 'Tiers', impact: 'Revenu', statut: 'À faire' },
  { id: '5', titre: 'Prix', projet_id: 'kitvital', qui: 'Toi', impact: 'Décision', statut: 'Fait', faite: '2026-11-14' },
];

test('ta liste : ordre, références, retard', () => {
  const l = P.liste(actions, projets, { jour: JOUR });
  assert.deepEqual(l.map((a) => `${a.ref} ${a.titre}`), ['A1 Comptes réseaux', 'A2 Trancher', 'A3 Dépôt légal', 'A4 Crédit']);
  assert.equal(l[2].retard, 3);
  const r = P.resumeListe(l);
  assert.deepEqual([r.toi, r.tiers, r.en_retard, r.retard_cumule], [3, 1, 2, 5]);
  assert.equal(r.plus_en_retard.titre, 'Dépôt légal');
  assert.equal(P.faites(actions, projets)[0].titre, 'Prix');
});

test('traction : progression, projection, cible en baisse', () => {
  const m = [
    { date: '2026-11-10', projet_id: 'sauvermonepargne', indicateur: 'Visites 30 j', valeur: 20, etape: 'Audience' },
    { date: '2026-11-15', projet_id: 'sauvermonepargne', indicateur: 'Visites 30 j', valeur: 39, etape: 'Audience' },
    { date: '2026-11-15', projet_id: 'growth-hiring', indicateur: 'Reste à financer (€)', valeur: 69000, etape: 'Dossier' },
  ];
  const t = P.traction(projets[1], m, { jour: JOUR });
  assert.equal(t.derniere.valeur, 39);
  assert.ok(Math.abs(t.progression - 39 / 5000) < 1e-9);
  assert.equal(t.horizon, 'au-delà de 3 ans');
  const vite = P.traction(projets[1], [m[0], { ...m[1], valeur: 2520 }], { jour: JOUR });
  assert.equal(vite.projection, '2026-11-20');
  const g = P.traction(projets[2], m);
  assert.equal(g.descend, true);
  assert.equal(g.progression, 0);
  assert.equal(P.traction(projets[0], m).derniere, null);
});

test('gouvernance et simulation', () => {
  const l = P.liste(actions, projets, { jour: JOUR });
  const g = P.gouvernance(projets, [{ projet_id: 'sauvermonepargne', date: '2026-11-10', titre: 'x', revue: '2026-11-14' }], l, { jour: JOUR });
  assert.equal(g.ouverts.length, 4);
  assert.equal(g.depasse, true);
  assert.deepEqual(g.ecarts.map((e) => [e.projet.id, e.depuis]), [['sauvermonepargne', 5]]);
  assert.equal(g.a_revoir.length, 1);
  assert.deepEqual(g.attente.map((p) => p.id), ['super-app']);
  assert.equal(g.capital, 69000);
  assert.deepEqual(P.simuler(projets, l, new Set(['kitvital'])), { ouverts: 3, actions: 1, liberees: 2, retard: 0, capital: 69000 });
});

test('revenus : fusion sans doublon, un pour un', () => {
  const r = P.fusionnerRevenus(
    [{ date: '2026-11-16', projet_id: 'kitvital', montant: '9,9', note: 'vente' }, { date: '2026-11-17', projet_id: 'kitvital', montant: 9.9, note: 'payhip:C' }],
    [{ date: '2026-11-16', projet_id: 'kitvital', montant: 9.9, ref: 'payhip:A' }, { date: '2026-11-16', projet_id: 'kitvital', montant: 9.9, ref: 'payhip:B' }, { date: '2026-11-17', projet_id: 'kitvital', montant: 9.9, ref: 'payhip:C' }],
    projets,
  );
  assert.equal(r.length, 3);
  assert.equal(r.filter((x) => x.source).length, 1);
});

test('alertes nouvelles et sources', () => {
  assert.deepEqual([...P.alertesNouvelles('GitHub refusé (3e jour)\nNouvelle', 'GitHub refusé (2e jour)')], ['Nouvelle']);
  assert.equal(P.alertesNouvelles('a', null).size, 0);
  const s = P.sources({ syntheses: [{ date: JOUR }], mesures: [{ source: 'Plausible', date: '2026-11-10' }], connexions: { plausible: true } }, { jour: JOUR });
  assert.equal(s.find((x) => x.cle === 'rapport').etat, 'ok');
  assert.equal(s.find((x) => x.cle === 'plausible').etat, 'vieux');
  assert.equal(s.find((x) => x.cle === 'payhip').etat, 'eteint');
});
