// Connexions du pilotage : Payhip, Plausible, GitHub, Ta liste, journal des décisions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import relais from '../src/index.js';
import { analyser, validerNotion, consignes } from '../src/consignes.js';
import { versLigne } from '../src/payhip.js';
import { lireIndicateurs, jourParis } from '../src/notion.js';
import { sitesPlausible } from '../src/releve.js';
import { depotsSuivis } from '../src/github.js';

const JETON = 'a'.repeat(64);
const EMPREINTE = createHash('sha256').update(JETON).digest('hex');
const ORIGINE = 'https://ouzgane.github.io';
const sha = (s) => createHash('sha256').update(s).digest('hex');
const repJson = (o, statut = 200) => new Response(JSON.stringify(o), { status: statut });
const t = (s) => [{ plain_text: s }];

const BASES = { NOTION_CLE: 'secret_x', NOTION_SOURCE: 'projets-1', NOTION_MESURES: 'mesures-1', NOTION_ACTIONS: 'actions-1', NOTION_DECISIONS: 'decisions-1', NOTION_REVENUS: 'revenus-1' };
const envDe = (extra = {}) => ({ IA_FOURNISSEUR: 'cloudflare', ORIGINES: ORIGINE, JETON_EMPREINTE: EMPREINTE, ...extra });

function requete(corps, { jeton = JETON, origine = ORIGINE, methode = 'POST', chemin } = {}) {
  const h = { 'Content-Type': 'application/json' };
  if (origine) h.Origin = origine;
  if (jeton) h.Authorization = 'Bearer ' + jeton;
  return new Request('https://larmina-ia.exemple.workers.dev' + chemin, { method: methode, headers: h, body: methode === 'POST' ? JSON.stringify(corps) : undefined });
}

// Remplace fetch le temps d'un test ; « routeur » répond selon l'adresse.
async function avecFetch(routeur, fn) {
  const avant = globalThis.fetch;
  const vus = [];
  globalThis.fetch = async (url, init = {}) => {
    const corps = init.body ? JSON.parse(init.body) : null;
    vus.push({ url: String(url), methode: init.method || 'GET', corps, init });
    return routeur(String(url), init.method || 'GET', corps);
  };
  try { return await fn(vus); } finally { globalThis.fetch = avant; }
}

// ── Payhip ───────────────────────────────────────────────────────────────────
const VENTE = { id: 'ZGjVj5x4GN', email: 'acheteur@example.com', ip_address: '1.2.3.4', currency: 'EUR', price: 990, payment_type: 'card', stripe_fee: 48, payhip_fee: 33,
  items: [{ product_name: 'Livret KitVital', used_coupon: false }], date: 1763208000, type: 'paid' };

test('payhip : sans clé, signature fausse ou absente : refus, rien n’est écrit', async () => {
  await avecFetch(() => repJson({}), async (vus) => {
    const sansCle = await relais.fetch(requete(VENTE, { chemin: '/payhip', origine: null, jeton: null }), envDe(BASES));
    assert.equal(sansCle.status, 501);
    const env = envDe({ ...BASES, PAYHIP_CLE: 'cle-payhip' });
    assert.equal((await relais.fetch(requete({ ...VENTE, signature: 'faux' }, { chemin: '/payhip', origine: null, jeton: null }), env)).status, 401);
    assert.equal((await relais.fetch(requete(VENTE, { chemin: '/payhip', origine: null, jeton: null }), env)).status, 401);
    assert.equal((await relais.fetch(requete(VENTE, { chemin: '/payhip', methode: 'GET', origine: null, jeton: null }), env)).status, 405);
    assert.equal(vus.length, 0);
  });
});

test('payhip : une vente signée va dans Revenus, sans e-mail ni IP, une seule fois', async () => {
  const env = envDe({ ...BASES, PAYHIP_CLE: 'cle-payhip', PAYHIP_PROJET: 'kitvital' });
  let deja = false;
  await avecFetch((url, methode, corps) => {
    if (url.endsWith('/data_sources/revenus-1/query')) return repJson({ results: deja ? [{ id: 'r1' }] : [] });
    if (url.endsWith('/data_sources/projets-1/query')) return repJson({ results: [{ id: 'page-kitvital' }] });
    if (url.endsWith('/pages') && methode === 'POST') { deja = true; return repJson({ id: 'r1', url: 'https://notion.so/r1' }); }
    return repJson({}, 500);
  }, async (vus) => {
    const r = await relais.fetch(requete({ ...VENTE, signature: sha('cle-payhip') }, { chemin: '/payhip', origine: null, jeton: null }), env);
    assert.equal(r.status, 200, await r.clone().text());
    const creation = vus.find((v) => v.url.endsWith('/pages'));
    assert.deepEqual(creation.corps.parent, { type: 'data_source_id', data_source_id: 'revenus-1' });
    const p = creation.corps.properties;
    assert.equal(p['Montant (€)'].number, 9.9);
    assert.equal(p['Frais (€)'].number, 0.81);
    assert.equal(p['Réf transaction'].rich_text[0].text.content, 'payhip:ZGjVj5x4GN');
    assert.equal(p.Source.select.name, 'Payhip (automatique)');
    assert.equal(p['État'].select.name, 'Encaissé');
    assert.deepEqual(p.Projet.relation, [{ id: 'page-kitvital' }]);
    assert.equal(p.Date.date.start, '2025-11-15');
    assert.ok(!JSON.stringify(creation.corps).includes('acheteur@example.com'));
    assert.ok(!JSON.stringify(creation.corps).includes('1.2.3.4'));
    const vus1 = vus.length;
    const re = await relais.fetch(requete({ ...VENTE, signature: sha('cle-payhip') }, { chemin: '/payhip', origine: null, jeton: null }), env);
    assert.equal((await re.json()).doublon, true);
    assert.equal(vus.filter((v) => v.url.endsWith('/pages')).length, 1);
    assert.ok(vus.length > vus1);
  });
});

test('payhip : remboursement en ligne négative, devise étrangère sans montant en euros', () => {
  const r = versLigne({ ...VENTE, type: 'refunded', amount_refunded: 990, date_refunded: 1763294400 }, 'kitvital');
  assert.equal(r.montant, -9.9);
  assert.equal(r.etat, 'Remboursé');
  assert.equal(r.ref, 'payhip:ZGjVj5x4GN:remboursement');
  assert.equal(r.frais, undefined);
  const usd = versLigne({ ...VENTE, currency: 'USD' }, 'kitvital');
  assert.equal(usd.montant, null);
  assert.match(usd.note, /montant en USD : 9.9/);
  const test0 = versLigne({ ...VENTE, price: 0, items: [{ product_name: 'Livret', used_coupon: true }] }, 'kitvital');
  assert.equal(test0.montant, 0);
  assert.match(test0.note, /coupon/);
  assert.equal(versLigne({ ...VENTE, id: '../x' }, 'kitvital'), null);
});

// ── Ta liste ─────────────────────────────────────────────────────────────────
test('action : seule une page de la base Actions peut être cochée', async () => {
  const env = envDe(BASES);
  const ID = '419e1d65c5888176aaa4efed8a90c12d';
  let parent = 'autre-base';
  await avecFetch((url, methode) => {
    if (url.endsWith('/pages/' + ID) && methode === 'GET') return repJson({ id: ID, parent: { type: 'data_source_id', data_source_id: parent } });
    if (url.endsWith('/pages/' + ID) && methode === 'PATCH') return repJson({ id: ID, url: 'https://notion.so/' + ID });
    return repJson({}, 500);
  }, async (vus) => {
    assert.equal((await relais.fetch(requete({ id: ID, statut: 'Fait' }, { chemin: '/action' }), env)).status, 403);
    parent = 'actions-1';
    const r = await relais.fetch(requete({ id: ID, statut: 'Fait' }, { chemin: '/action' }), env);
    assert.equal(r.status, 200);
    const patch = vus.find((v) => v.methode === 'PATCH');
    assert.equal(patch.corps.properties.Statut.select.name, 'Fait');
    assert.equal(patch.corps.properties['Faite le'].date.start, jourParis());
    assert.equal((await relais.fetch(requete({ id: 'pas-un-id', statut: 'Fait' }, { chemin: '/action' }), env)).status, 400);
    assert.equal((await relais.fetch(requete({ id: ID, statut: 'Supprimée' }, { chemin: '/action' }), env)).status, 400);
    assert.equal((await relais.fetch(requete({ id: ID, statut: 'Fait' }, { chemin: '/action', jeton: 'c'.repeat(64) }), env)).status, 401);
  });
});

test('Geri : FAIT et journal de décision lus et validés', () => {
  const brut = 'Bravo.\nFAIT: {"action":"a3"}\nFAIT: {"action":"A3"}\nFAIT: {"action":"x"}\nNOTION: {"projet":"kitvital","decision":"Accélérer","raison":"Lancement du 20/11","revue":"2026-12-01","objectif_mensuel":"300 €"}\nSUGGESTIONS: Et après ?';
  const a = analyser(brut);
  assert.deepEqual(a.faits, [{ action: 'A3' }]);
  assert.deepEqual(a.actions[0], { projet: 'kitvital', champs: { decision: 'Accélérer', objectif_mensuel: 300 }, journal: { raison: 'Lancement du 20/11', revue: '2026-12-01' } });
  assert.equal(a.texte, 'Bravo.');
  // Sans décision, pas de journal ; critère et date acceptés.
  assert.deepEqual(validerNotion({ projet: 'kitvital', critere_arret: 'Moins de 3 ventes', date_critere: '2026-12-31', raison: 'x' }), { projet: 'kitvital', champs: { critere_arret: 'Moins de 3 ventes', date_critere: '2026-12-31' } });
  assert.equal(validerNotion({ projet: 'kitvital', objectif_mensuel: -5 }), null);
  assert.match(consignes({ nom: 'Geri', date: 'lundi', contexte: '', notion: true, liste: true }), /FAIT: \{"action":"A3"\}/);
  assert.doesNotMatch(consignes({ nom: 'Geri', date: 'lundi', contexte: '', notion: true, liste: false }), /FAIT:/);
});

test('notion : une décision confirmée entre aussi au journal des décisions', async () => {
  const env = envDe(BASES);
  await avecFetch((url, methode) => {
    if (url.endsWith('/data_sources/projets-1/query')) return repJson({ results: [{ id: 'page-kv', url: 'https://notion.so/page-kv' }] });
    if (url.endsWith('/pages/page-kv')) return repJson({ id: 'page-kv', url: 'https://notion.so/page-kv' });
    if (url.endsWith('/pages') && methode === 'POST') return repJson({ id: 'd1', url: 'https://notion.so/d1' });
    return repJson({}, 500);
  }, async (vus) => {
    const r = await relais.fetch(requete({ projet: 'kitvital', projet_nom: 'KitVital', champs: { decision: 'Accélérer' }, journal: { raison: 'Lancement', attendu: 'Premières ventes' } }, { chemin: '/notion' }), env);
    const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    assert.equal(j.journal.ok, true);
    const d = vus.find((v) => v.url.endsWith('/pages') && v.methode === 'POST').corps;
    assert.equal(d.parent.data_source_id, 'decisions-1');
    assert.equal(d.properties['Décision'].title[0].text.content, 'KitVital : Accélérer');
    assert.equal(d.properties.Choix.select.name, 'Accélérer');
    assert.equal(d.properties.Raison.rich_text[0].text.content, 'Lancement');
    assert.equal(d.properties['Revoir le'].date.start, jourParis(new Date(), 14));
    assert.equal(d.properties.Source.select.name, 'Geri');
  });
});

// ── Lectures ─────────────────────────────────────────────────────────────────
test('projets : mesures, actions, décisions et revenus servis ; une base illisible ne bloque rien', async () => {
  const env = envDe({ ...BASES, PLAUSIBLE_CLE: 'p' });
  const pg = (id, props) => ({ object: 'page', id, url: 'https://notion.so/' + id, properties: props });
  await avecFetch((url) => {
    if (url.includes('/projets-1/')) return repJson({ results: [pg('p1', { Projet: { title: t('KitVital') }, Id: { rich_text: t('KitVital') }, 'Indicateur clé': { rich_text: t('Visites 30 j') }, 'Cible indicateur': { number: 5000 } })] });
    if (url.includes('/mesures-1/')) return repJson({ results: [pg('m1', { Date: { date: { start: '2026-11-15' } }, 'Projet id': { rich_text: t('kitvital') }, Indicateur: { rich_text: t('Visites 30 j') }, Valeur: { number: 69 }, 'Étape entonnoir': { select: { name: 'Audience' } }, Source: { select: { name: 'Plausible' } } }), pg('m2', { Date: { date: null } })] });
    if (url.includes('/actions-1/')) return repJson({ results: [pg('a1', { Action: { title: t('Dépôt légal') }, 'Projet id': { rich_text: t('kitvital') }, Qui: { select: { name: 'Toi' } }, Impact: { select: { name: 'Obligation' } }, Statut: { select: { name: 'À faire' } }, 'Échéance': { date: { start: '2026-11-12' } } })] });
    if (url.includes('/decisions-1/')) return repJson({ message: 'Could not find' }, 404);
    if (url.includes('/revenus-1/')) return repJson({ results: [pg('r1', { 'Libellé': { title: t('Vente') }, Date: { date: { start: '2026-11-16' } }, 'Montant (€)': { number: 9.9 }, 'Projet id': { rich_text: t('kitvital') }, Source: { select: { name: 'Payhip (automatique)' } }, 'Réf transaction': { rich_text: t('payhip:X') } })] });
    return repJson({ results: [] });
  }, async (vus) => {
    const r = await relais.fetch(requete(null, { methode: 'GET', chemin: '/projets' }), env);
    const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    assert.equal(j.projets[0].id, 'kitvital');
    assert.equal(j.projets[0].cible, 5000);
    assert.deepEqual(j.mesures, [{ date: '2026-11-15', projet_id: 'kitvital', indicateur: 'Visites 30 j', valeur: 69, etape: 'Audience', source: 'Plausible', note: '' }]);
    assert.equal(j.actions[0].titre, 'Dépôt légal');
    assert.equal(j.actions[0].echeance, '2026-11-12');
    assert.deepEqual(j.decisions, []);
    assert.equal(j.revenus[0].montant, 9.9);
    assert.equal(j.revenus[0].ref, 'payhip:X');
    assert.deepEqual(j.bases, { mesures: 'ok', actions: 'ok', decisions: 'erreur', revenus: 'ok' });
    assert.deepEqual(j.connexions, { payhip: false, plausible: true, github: false });
    const filtreActions = vus.find((v) => v.url.includes('/actions-1/')).corps.filter;
    assert.equal(filtreActions.or[0].select.equals, 'À faire');
  });
});

test('indicateurs du rapport : clé=valeur, nombres reconnus', () => {
  assert.deepEqual(lireIndicateurs('retard_cumule=37; actions_toi=21\nfiabilite=82 %; plafond=3/5; x'), { retard_cumule: 37, actions_toi: 21, fiabilite: 82, plafond: '3/5' });
});

// ── Plausible ────────────────────────────────────────────────────────────────
test('relevé Plausible : indicateurs écrits dans Mesures, ligne du jour mise à jour si elle existe', async () => {
  const env = envDe({ ...BASES, PLAUSIBLE_CLE: 'cle-plausible', PLAUSIBLE_SITES: 'kitvital|kitvital.fr; faux site; sauvermonepargne|sauvermonepargne.fr' });
  assert.equal(sitesPlausible(env).length, 2);
  const maintenant = new Date('2026-11-16T05:17:00Z');
  await avecFetch((url, methode, corps) => {
    if (url === 'https://plausible.io/api/v2/query') {
      if (corps.site_id === 'sauvermonepargne.fr') return repJson({ error: 'Plan sans API' }, 402);
      if (corps.dimensions) return repJson({ results: [{ dimensions: ['Clic livret'], metrics: [4] }] });
      if (corps.date_range === '30d') return repJson({ results: [{ metrics: [60, 72, 150], dimensions: [] }] });
      if (corps.date_range === '7d') return repJson({ results: [{ metrics: [35, 40], dimensions: [] }] });
      return repJson({ results: [{ metrics: [5, 6], dimensions: [] }] });
    }
    if (url.endsWith('/data_sources/projets-1/query')) return repJson({ results: [{ id: 'page-kv' }] });
    if (url.endsWith('/data_sources/mesures-1/query')) {
      const date = corps.filter.and[0].date.equals;
      return repJson({ results: date === '2026-11-16' ? [{ object: 'page', id: 'm-exist', properties: { Indicateur: { rich_text: t('Visites 30 j') } } }] : [] });
    }
    if (url.endsWith('/pages/m-exist') || url.endsWith('/pages')) return repJson({ id: 'ok' });
    return repJson({}, 500);
  }, async (vus) => {
    const { releverPlausible } = await import('../src/releve.js');
    const r = await releverPlausible(env, { maintenant });
    assert.equal(r.date, '2026-11-16');
    assert.equal(r.sites[0].ok, true);
    assert.equal(r.sites[0].ecrites, 6);
    assert.equal(r.sites[1].ok, false);
    assert.match(r.sites[1].erreur, /402/);
    assert.equal(r.ok, false);
    const ecrits = vus.filter((v) => /\/pages(\/m-exist)?$/.test(v.url));
    assert.equal(ecrits.filter((v) => v.methode === 'PATCH').length, 1);
    const parIndicateur = Object.fromEntries(ecrits.map((v) => [v.corps.properties.Indicateur.rich_text[0].text.content, v.corps.properties]));
    assert.equal(parIndicateur['Visites 30 j'].Valeur.number, 72);
    assert.equal(parIndicateur['Visiteurs 7 j'].Valeur.number, 35);
    assert.equal(parIndicateur['Visiteurs (jour)'].Date.date.start, '2026-11-15');
    assert.equal(parIndicateur['Objectif « Clic livret » 7 j']['Étape entonnoir'].select.name, 'Intention');
    assert.equal(vus.find((v) => v.url.includes('plausible')).init.headers.Authorization, 'Bearer cle-plausible');
  });
  const sans = await (await import('../src/releve.js')).releverPlausible(envDe(BASES));
  assert.equal(sans.ok, false);
});

test('relevé : le déclencheur programmé lance le relevé', async () => {
  let attendu = null;
  await relais.scheduled({}, envDe(BASES), { waitUntil: (p) => { attendu = p; } });
  assert.ok(attendu && typeof attendu.then === 'function');
  await attendu;
});

// ── GitHub ───────────────────────────────────────────────────────────────────
test('suivi GitHub : pull requests ouvertes, dernier commit et échecs récents, en lecture seule', async () => {
  const env = envDe({ ...BASES, GITHUB_LECTURE: 'ghp_lecture', GITHUB_DEPOTS: 'pare-72h=kitvital; ../x=y; trading5=trader5' });
  assert.equal(depotsSuivis(env).length, 2);
  assert.equal((await relais.fetch(requete(null, { methode: 'GET', chemin: '/suivi' }), envDe(BASES))).status, 501);
  const recent = new Date(Date.now() - 86400000).toISOString();
  await avecFetch((url, methode) => {
    assert.equal(methode, 'GET');
    if (url.includes('/trading5/')) return repJson({ message: 'Not Found' }, 404);
    if (url.includes('/pulls')) return repJson([{ number: 17, title: 'Nouveau guide', created_at: '2026-11-12T05:55:00Z', html_url: 'https://github.com/o/r/pull/17', draft: false }]);
    if (url.includes('/commits')) return repJson([{ commit: { message: 'Rédaction\n\ncorps', committer: { date: '2026-11-15T13:00:00Z' } }, html_url: 'https://github.com/o/r/commit/1' }]);
    if (url.includes('/actions/runs')) return repJson({ workflow_runs: [{ name: 'Demande', conclusion: 'failure', created_at: recent, html_url: 'u' }, { name: 'Vieux', conclusion: 'failure', created_at: '2026-01-01T00:00:00Z' }] });
    return repJson({}, 500);
  }, async (vus) => {
    const r = await relais.fetch(requete(null, { methode: 'GET', chemin: '/suivi' }), env);
    const j = await r.json();
    assert.equal(r.status, 200);
    assert.equal(j.depots[0].prs[0].numero, 17);
    assert.equal(j.depots[0].dernier_commit.message, 'Rédaction');
    assert.equal(j.depots[0].echecs.length, 1);
    assert.equal(j.depots[1].erreur, 'GitHub 404');
    assert.ok(vus.every((v) => v.init.headers.Authorization === 'Bearer ghp_lecture'));
    assert.ok(vus.every((v) => v.url.startsWith('https://api.github.com/repos/Ouzgane/')));
  });
});
