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

// ── Audience des sites ───────────────────────────────────────────────────────
test('audience : périodes complètes, progression, tendance, projection vers la cible', () => {
  const jour = '2026-11-17';
  const serie = (f) => Array.from({ length: 91 }, (_, i) => { const n = 90 - i; return { date: P.ajouterJours(jour, -n), visites: f(n), visiteurs: f(n), pages: 2 * f(n) }; });
  const a = { lu_le: '2026-11-17T08:00:00Z', sites: [
    { site: 'kitvital.fr', projet: 'kitvital', jours: serie((n) => (n === 0 ? 3 : n <= 30 ? 4 : 2)), sources: [{ nom: 'Google', visiteurs: 9 }], pages: [{ chemin: '/', visiteurs: 12 }], erreur: null },
    { site: 'sauvermonepargne.fr', projet: 'sauvermonepargne', jours: serie((n) => 91 - n), sources: [], pages: [], erreur: null },
    { site: 'deswatts.fr', projet: 'deswatts', rattache: 'kitvital', jours: [], sources: [], pages: [], erreur: 'Plausible 402' },
  ] };
  const config = [{ site: 'kitvital.fr', projet: 'kitvital' }, { site: 'sauvermonepargne.fr', projet: 'sauvermonepargne' }, { site: 'deswatts.fr', projet: 'deswatts', rattache: 'kitvital' }];
  const mesures = [
    { date: '2026-11-17', projet_id: 'deswatts', indicateur: 'Visites 30 j', valeur: 6, source: 'Plausible' },
    { date: '2026-11-17', projet_id: 'deswatts', indicateur: 'Visites 30 j (préc.)', valeur: 3, source: 'Plausible' },
    { date: '2026-11-16', projet_id: 'deswatts', indicateur: 'Visites 30 j', valeur: 99, source: 'Plausible' },
  ];
  const r = P.audience({ audience: a, mesures, projets, sites: config }, { jour });
  assert.equal(r.source, 'plausible');
  assert.deepEqual(r.sites.map((s) => s.site), ['kitvital.fr', 'sauvermonepargne.fr', 'deswatts.fr']);
  const [kv, sme, dw] = r.sites;
  assert.deepEqual([kv.v30, kv.v30p, kv.v7, kv.v7p, kv.aujourdhui], [120, 60, 28, 28, 3]);
  assert.equal(kv.var30.sens, 'hausse');
  assert.equal(kv.var30.pct, 1);
  assert.equal(kv.var7.sens, 'stable');
  assert.equal(kv.tendance.sens, 'stable');
  assert.equal(kv.serie.length, 90);
  assert.equal(kv.serie.at(-1).date, '2026-11-16');
  assert.equal(kv.serie.at(-1).moyenne, 4);
  assert.equal(kv.meilleur.date, '2026-10-18');
  assert.equal(kv.cible, null);
  assert.equal(kv.analyse[0], 'kitvital.fr : 120 visites sur 30 jours, +100 % par rapport aux 30 jours précédents (60).');
  assert.ok(kv.analyse.includes('Principale source : Google ; page la plus vue : /.'));
  assert.deepEqual([sme.v30, sme.v30p], [2265, 1365]);
  assert.equal(sme.tendance.sens, 'hausse');
  assert.equal(Math.round(sme.tendance.pct_semaine * 100), 9);
  assert.equal(sme.cible.valeur, 5000);
  assert.equal(sme.cible.projection, '2027-02-16');
  assert.match(sme.analyse.at(-1), /^Cible de 5 000 visites sur 30 jours : 45 % atteints, à ce rythme, atteinte vers février 2027\.$/);
  assert.equal(dw.source, 'mesures');
  assert.deepEqual([dw.v30, dw.v30p], [6, 3]);
  assert.equal(dw.var30.sens, 'faible');
  assert.equal(dw.rattache_nom, 'KitVital');
  assert.match(dw.analyse[0], /trop peu de visites/);
  assert.equal(r.total.v30, 2391);
  assert.equal(r.total.v30p, 1428);
  assert.equal(r.total.var30.sens, 'hausse');
  assert.equal(r.total.v7, null);
  assert.equal(r.total.serie.at(-1).visites, 4 + 90);
  assert.equal(Math.round(sme.part * 100), 95);
  assert.deepEqual(r.analyse.slice(0, 2), ['2 391 visites sur 30 jours sur 3 sites, +67 % par rapport aux 30 jours précédents (1 428).', 'sauvermonepargne.fr en apporte 95 %.']);
  assert.equal(r.analyse[2], 'Plus forte progression : kitvital.fr (+100 %).');
  assert.deepEqual(r.total.nouveaux, []);
  // Un site lancé pendant la période : la hausse du total vient de lui ; variation à périmètre constant.
  const lance = P.audience({ audience: { sites: [a.sites[0], { ...a.sites[1], jours: serie((n) => (n <= 30 ? 1 : 0)) }] }, projets, sites: config.slice(0, 2) }, { jour });
  assert.deepEqual(lance.total.nouveaux, ['sauvermonepargne.fr']);
  assert.equal(lance.total.lancement_domine, false);
  assert.equal(lance.total.var30_constant.pct, 1);
  assert.equal(lance.analyse[1], "sauvermonepargne.fr n'avait aucune visite les 30 jours précédents ; il apporte 30 visites. À périmètre constant (kitvital.fr) : 120 visites, +100 % (60).");
  const domine = P.audience({ audience: { sites: [{ ...a.sites[0], jours: serie((n) => (n === 0 ? 0 : 2)) }, { ...a.sites[1], jours: serie((n) => (n <= 30 ? 5 : 0)) }] }, projets, sites: config.slice(0, 2) }, { jour });
  assert.equal(domine.total.lancement_domine, true);
  assert.equal(domine.analyse[1], "sauvermonepargne.fr n'avait aucune visite les 30 jours précédents : la hausse du total vient d'abord de son lancement. À périmètre constant (kitvital.fr) : 60 visites, stable (60).");
});

test('audience : sans historique, relevés de Mesures ; site sans mesure signalé ; règle du bruit', () => {
  const mesures = [
    { date: '2026-11-17', projet_id: 'kitvital', indicateur: 'Visites 30 j', valeur: 80, source: 'Plausible' },
    { date: '2026-11-17', projet_id: 'kitvital', indicateur: 'Visites 30 j (préc.)', valeur: 100, source: 'Plausible' },
    { date: '2026-11-17', projet_id: 'kitvital', indicateur: 'Visites 7 j', valeur: 20, source: 'Plausible' },
    { date: '2026-11-17', projet_id: 'kitvital', indicateur: 'Visites 7 j (préc.)', valeur: 0, source: 'Plausible' },
    { date: '2026-11-16', projet_id: 'kitvital', indicateur: 'Visites (jour)', valeur: 5, source: 'Plausible' },
    { date: '2026-11-17', projet_id: 'kitvital', indicateur: 'Visites 30 j', valeur: 1, source: 'Relevé hebdomadaire' },
  ];
  const r = P.audience({ mesures, projets, sites: [{ site: 'kitvital.fr', projet: 'kitvital' }, { site: 'neuf.fr', projet: 'neuf' }] }, { jour: '2026-11-17' });
  assert.equal(r.source, 'mesures');
  const [kv, neuf] = r.sites;
  assert.equal(kv.var30.sens, 'baisse');
  assert.equal(kv.var30.pct, -0.2);
  assert.equal(kv.var7.sens, 'nouveau');
  assert.equal(kv.serie.length, 1);
  assert.equal(kv.analyse[1], 'Sur 7 jours : 20, contre aucune la semaine précédente.');
  assert.equal(neuf.v30, null);
  assert.equal(neuf.analyse[0], "neuf.fr : pas encore de mesure d'audience.");
  assert.equal(r.total.v30, 80);
  assert.deepEqual(r.analyse, ['80 visites sur 30 jours sur 1 site, −20 % par rapport aux 30 jours précédents (100).']);
  assert.equal(P.variation(9, 4).sens, 'faible');
  assert.equal(P.variation(104, 100).sens, 'stable');
  assert.equal(P.variation(5, null), null);
  assert.equal(P.audience({}, { jour: '2026-11-17' }).source, null);
});
