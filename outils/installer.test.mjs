// Tests de l'installation d'une copie de GERI (sans réseau) : node --test outils/installer.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appliquer, verifier, PERSONNELS } from './appliquer-perso.mjs';
import { BASES } from './notion-bases.mjs';
import { empreinte, chiffrer, dechiffrer, idPage, siteDe, siteJs, majSiteJs, relaisDeSiteJs, preparerNotion, installer, paquetDeDepart, rapportDuMatin } from './installer.mjs';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOML = readFileSync(join(RACINE, 'relais', 'wrangler.toml'), 'utf8');
const MDP = 'un mot de passe solide';

// Faux Notion : garde les bases et les pages créées.
function fauxNotion({ enfants = [] } = {}) {
  const appels = [];
  let n = 0;
  const rep = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });
  const fetchImpl = async (url, init = {}) => {
    const chemin = url.replace('https://api.notion.com/v1', '');
    const corps = init.body ? JSON.parse(init.body) : null;
    appels.push({ chemin, methode: init.method || 'GET', corps, entetes: init.headers });
    if (chemin.startsWith('/pages/')) return rep({ object: 'page', id: chemin.slice(7) });
    if (chemin.startsWith('/blocks/')) return rep({ results: enfants, has_more: false });
    if (chemin.startsWith('/databases/')) return rep({ object: 'database', id: chemin.slice(11), data_sources: [{ id: 'ds-de-' + chemin.slice(11), name: 'x' }] });
    if (chemin === '/databases') { n++; return rep({ object: 'database', id: 'db' + n, data_sources: [{ id: 'ds' + n, name: corps.title[0].text.content }] }); }
    if (chemin === '/pages') return rep({ object: 'page', id: 'page-exemple' });
    return rep({ message: 'inconnu' }, 400);
  };
  return { appels, fetchImpl };
}

function copieDuDepot() {
  const d = mkdtempSync(join(tmpdir(), 'geri-'));
  mkdirSync(join(d, 'modeles'));
  cpSync(join(RACINE, 'modeles', 'rapport-du-matin.md'), join(d, 'modeles', 'rapport-du-matin.md'));
  return d;
}

test('réglages de la copie appliqués à wrangler.toml : plus rien du propriétaire d’origine', () => {
  const perso = { ORIGINES: 'https://alice.github.io', JETON_EMPREINTE: 'b'.repeat(64), NOTION_SOURCE: 'ds-projets', PLAUSIBLE_URL: 'https://stats.alice.fr', IA_FOURNISSEUR: 'mistral' };
  const t = appliquer(TOML, perso);
  assert.match(t, /^name = "geri-ia"$/m);
  assert.match(t, /^ORIGINES = "https:\/\/alice\.github\.io"$/m);
  assert.match(t, /^NOTION_SOURCE = "ds-projets"$/m);
  assert.match(t, /^NOTION_MESURES = ""$/m);
  assert.match(t, /^PLAUSIBLE_SITES = ""$/m);
  assert.match(t, /^GITHUB_DEPOTS = ""$/m);
  assert.match(t, /^IA_FOURNISSEUR = "mistral"$/m);
  assert.match(t, /^PLAUSIBLE_URL = "https:\/\/stats\.alice\.fr"$/m);
  // Ce qui n'est pas personnel reste celui de l'original.
  assert.match(t, /^RELEVE_CRONS = "17 5 \* \* \*;19 5 \* \* \*;21 5 \* \* \*"$/m);
  assert.match(t, /^crons = \["17 5 \* \* \*", "19 5 \* \* \*", "21 5 \* \* \*"\]$/m);
  assert.match(t, /^\[ai\]$/m);
  for (const trace of ['Ouzgane', 'ouzgane', 'kitvital|', 'sauvermonepargne|', '419e1d65', 'de823e47', '6ef0f110']) {
    assert.ok(!t.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n').includes(trace), trace);
  }
  // La clé ajoutée reste dans [vars], avant [triggers].
  assert.ok(t.indexOf('PLAUSIBLE_URL') < t.indexOf('\n[triggers]'));
  assert.equal(appliquer(t, perso), t, 'deux passages donnent le même fichier');
});

test('contrôle de perso/relais.json', () => {
  assert.deepEqual(verifier({ ORIGINES: 'https://alice.github.io', JETON_EMPREINTE: 'a'.repeat(64) }), []);
  assert.equal(verifier([]).length, 1);
  assert.ok(verifier({ ORIGINES: 'http://x', JETON_EMPREINTE: 'a'.repeat(64) }).some((e) => e.includes('ORIGINES')));
  assert.ok(verifier({ ORIGINES: 'https://alice.github.io', JETON_EMPREINTE: '' }).some((e) => e.includes('JETON')));
  assert.ok(verifier({ ORIGINES: 'https://alice.github.io', JETON_EMPREINTE: 'a'.repeat(64), GITHUB_DEPOTS: 'a\nb' }).some((e) => e.includes('une seule ligne')));
  assert.ok(verifier({ ORIGINES: 'https://alice.github.io', JETON_EMPREINTE: 'a'.repeat(64), nom_relais: 'Mon Relais' }).some((e) => e.includes('nom_relais')));
});

test('empreinte identique à celle de outils/empreinte-ia.mjs', async () => {
  const sortie = execFileSync(process.execPath, [join(RACINE, 'outils', 'empreinte-ia.mjs')], { env: { ...process.env, PILOTAGE_MDP: MDP } }).toString();
  assert.equal(`JETON_EMPREINTE = "${await empreinte(MDP)}"\n`, sortie);
});

test('données de départ : chiffrées, relues par outils/verifier.mjs', async () => {
  const d = mkdtempSync(join(tmpdir(), 'geri-'));
  const f = join(d, 'pilotage.chiffre.json');
  const paquet = paquetDeDepart('Nova', new Date('2026-11-22T10:00:00Z'));
  writeFileSync(f, JSON.stringify(await chiffrer(paquet, MDP)) + '\n');
  assert.deepEqual(await dechiffrer(JSON.parse(readFileSync(f, 'utf8')), MDP), paquet);
  await assert.rejects(dechiffrer(JSON.parse(readFileSync(f, 'utf8')), 'autre mot de passe'));
  const ok = execFileSync(process.execPath, [join(RACINE, 'outils', 'verifier.mjs'), f], { env: { ...process.env, PILOTAGE_MDP: MDP } }).toString();
  assert.match(ok, /^OK : .*0 projets, rapport du 2026-11-22 \(« Nova est installée/);
});

test('lien de page Notion, adresse du site, site.js', () => {
  assert.equal(idPage('https://www.notion.so/alice/Pilotage-des-projets-413e1d65c588817da6a2e660b521548b?pvs=4'), '413e1d65-c588-817d-a6a2-e660b521548b');
  assert.equal(idPage('413e1d65-c588-817d-a6a2-e660b521548b'), '413e1d65-c588-817d-a6a2-e660b521548b');
  assert.equal(idPage('pas un lien'), null);
  assert.equal(siteDe('Alice', 'geri'), 'https://alice.github.io/geri/');
  assert.equal(siteDe('Alice', 'alice.github.io'), 'https://alice.github.io/');
  const js = siteJs({ relais: 'https://geri-ia.alice.workers.dev', nom: 'Nova' });
  assert.equal(relaisDeSiteJs(js), 'https://geri-ia.alice.workers.dev');
  const fenetre = { PILOTAGE_IA: { nom: 'Geri', voix: true } };
  new Function('window', js)(fenetre);
  assert.deepEqual(fenetre.PILOTAGE_IA, { nom: 'Nova', voix: true, relais: 'https://geri-ia.alice.workers.dev', prononciation: 'Nova', donnees: 'perso/pilotage.chiffre.json' });
  const maj = majSiteJs(js.replace("  donnees:", "  playlists: {},\n  donnees:"), 'Geri');
  const f2 = { PILOTAGE_IA: {} };
  new Function('window', maj)(f2);
  assert.deepEqual(f2.PILOTAGE_IA, { relais: 'https://geri-ia.alice.workers.dev', nom: 'Geri', prononciation: 'Jéri', playlists: {}, donnees: 'perso/pilotage.chiffre.json' });
  assert.equal(majSiteJs('// fichier de l’original', 'Geri'), null);
  // Le workflow « Relais IA » réécrit la ligne « relais » avec ce motif sed.
  const sed = execFileSync('sed', ['-E', "s#^([[:space:]]*relais:[[:space:]]*)'[^']*'#\\1'https://neuf.workers.dev'#"], { input: siteJs({ nom: 'Geri' }) }).toString();
  assert.equal(relaisDeSiteJs(sed), 'https://neuf.workers.dev');
});

test('Notion : six bases créées sous la page, reliées à Projets, puis une fiche d’exemple', async () => {
  const { appels, fetchImpl } = fauxNotion();
  const ids = await preparerNotion({ cleNotion: 'secret', page: 'page-1', fetchImpl });
  assert.deepEqual(ids, { NOTION_SOURCE: 'ds1', NOTION_RAPPORTS: 'ds2', NOTION_MESURES: 'ds3', NOTION_ACTIONS: 'ds4', NOTION_DECISIONS: 'ds5', NOTION_REVENUS: 'ds6',
    creees: ['Projets', 'Rapports du matin', 'Mesures', 'Actions', 'Décisions', 'Revenus'] });
  const creations = appels.filter((a) => a.chemin === '/databases');
  assert.equal(creations.length, 6);
  assert.equal(appels[0].entetes['Notion-Version'], '2025-09-03');
  for (const c of creations) {
    assert.deepEqual(c.corps.parent, { type: 'page_id', page_id: 'page-1' });
    const pr = c.corps.initial_data_source.properties;
    assert.equal(Object.values(pr).filter((p) => 'title' in p).length, 1);
    if (c.corps.title[0].text.content !== 'Projets' && c.corps.title[0].text.content !== 'Rapports du matin') {
      assert.deepEqual(pr.Projet, { relation: { data_source_id: 'ds1', type: 'single_property', single_property: {} } });
    }
  }
  const exemple = appels.find((a) => a.chemin === '/pages');
  assert.equal(exemple.corps.parent.data_source_id, 'ds1');
  assert.equal(exemple.corps.properties.Id.rich_text[0].text.content, 'exemple');
});

test('Notion : les noms de propriétés sont ceux que lit le relais', () => {
  const source = readFileSync(join(RACINE, 'relais', 'src', 'notion.js'), 'utf8');
  const lus = new Set([...source.matchAll(/L\.(?:t|choix|nombre|date|relation)\((['"])(.+?)\1\)/g)].map((m) => m[2]));
  const definis = new Set(BASES.flatMap((b) => Object.keys(b.proprietes('ds'))));
  for (const nom of lus) assert.ok(definis.has(nom), `propriété « ${nom} » absente des bases créées`);
  for (const nom of ['Avancements', 'Encaissements', 'Synthèse', 'Titre', 'Changements', 'Revue', 'Indicateurs', 'Réf transaction', 'Mesure']) assert.ok(definis.has(nom), nom);
});

test('Notion : bases déjà là retrouvées par leur titre, rien de recréé', async () => {
  const enfants = BASES.map((b, i) => ({ type: 'child_database', id: 'db-' + i, child_database: { title: b.titre } }));
  const { appels, fetchImpl } = fauxNotion({ enfants });
  const ids = await preparerNotion({ cleNotion: 'secret', page: 'page-1', connus: { NOTION_SOURCE: 'deja' }, fetchImpl });
  assert.equal(ids.NOTION_SOURCE, 'deja');
  assert.equal(ids.NOTION_REVENUS, 'ds-de-db-5');
  assert.deepEqual(ids.creees, []);
  assert.equal(appels.filter((a) => a.methode === 'POST').length, 0);
});

test('installation complète, relancée, puis recopiée par un autre compte', async () => {
  const d = copieDuDepot();
  const { fetchImpl } = fauxNotion();
  const env = { PILOTAGE_MDP: MDP, NOTION_CLE: 'secret', PAGE_NOTION: 'https://www.notion.so/Pilotage-413e1d65c588817da6a2e660b521548b', NOM: 'Nova', PROPRIETAIRE: 'Alice-B', DEPOT: 'geri' };
  const r1 = await installer({ racine: d, env, fetchImpl, journal: () => {} });
  assert.equal(r1.site, 'https://alice-b.github.io/geri/');
  const reglages = JSON.parse(readFileSync(join(d, 'perso', 'relais.json'), 'utf8'));
  for (const k of PERSONNELS) assert.ok(k in reglages, k);
  assert.equal(reglages.ORIGINES, 'https://alice-b.github.io');
  assert.equal(reglages.JETON_EMPREINTE, await empreinte(MDP));
  assert.equal(reglages.GITHUB_PROPRIETAIRE, 'Alice-B');
  assert.equal(reglages.NOTION_REVENUS, 'ds6');
  assert.equal(reglages.installe_pour, 'Alice-B');
  assert.deepEqual(verifier(reglages), []);
  const paquet = await dechiffrer(JSON.parse(readFileSync(join(d, 'perso', 'pilotage.chiffre.json'), 'utf8')), MDP);
  assert.deepEqual(paquet.projets, []);
  const rapport = readFileSync(join(d, 'perso', 'rapport-du-matin.md'), 'utf8');
  assert.ok(rapport.includes('collection://ds1') && rapport.includes('collection://ds6') && rapport.includes('https://alice-b.github.io/geri/') && rapport.includes('Nova'));
  assert.ok(!/\{\{[A-Z_]+\}\}/.test(rapport), 'plus aucun champ à remplir');
  assert.ok(existsSync(join(d, 'perso', 'LISEZMOI.md')));

  // Le relais a été branché entre-temps, un réglage ajouté au site et un site Plausible au relais, à la main.
  const fSite = join(d, 'perso', 'site.js');
  writeFileSync(fSite, readFileSync(fSite, 'utf8').replace("relais: ''", "relais: 'https://geri-ia.alice.workers.dev'").replace("  donnees:", "  plafondProjets: 5,\n  donnees:"));
  writeFileSync(join(d, 'perso', 'relais.json'), JSON.stringify({ ...reglages, PLAUSIBLE_SITES: 'site|site.fr' }));
  const avant = readFileSync(join(d, 'perso', 'pilotage.chiffre.json'), 'utf8');
  const { appels: appels2, fetchImpl: f2 } = fauxNotion();
  const r2 = await installer({ racine: d, env, fetchImpl: f2, journal: () => {} });
  assert.equal(r2.relais, 'https://geri-ia.alice.workers.dev');
  assert.match(readFileSync(fSite, 'utf8'), /plafondProjets: 5,/, 'réglage du site gardé');
  assert.equal(appels2.filter((a) => a.methode === 'POST').length, 0, 'aucune base recréée');
  assert.equal(readFileSync(join(d, 'perso', 'pilotage.chiffre.json'), 'utf8'), avant, 'données gardées');
  assert.equal(JSON.parse(readFileSync(join(d, 'perso', 'relais.json'), 'utf8')).PLAUSIBLE_SITES, 'site|site.fr');

  // Nouveau mot de passe : données de départ refaites, nouvelle empreinte.
  await installer({ racine: d, env: { ...env, PILOTAGE_MDP: 'nouveau mot de passe', PAGE_NOTION: '' }, fetchImpl: f2, journal: () => {} });
  assert.notEqual(readFileSync(join(d, 'perso', 'pilotage.chiffre.json'), 'utf8'), avant);
  assert.equal(JSON.parse(readFileSync(join(d, 'perso', 'relais.json'), 'utf8')).JETON_EMPREINTE, await empreinte('nouveau mot de passe'));

  // Dépôt recopié par quelqu'un d'autre : rien de la copie précédente n'est gardé.
  const { fetchImpl: f3 } = fauxNotion();
  await installer({ racine: d, env: { PILOTAGE_MDP: MDP, PROPRIETAIRE: 'bob', DEPOT: 'pilotage' }, fetchImpl: f3, journal: () => {} });
  const bob = JSON.parse(readFileSync(join(d, 'perso', 'relais.json'), 'utf8'));
  assert.equal(bob.ORIGINES, 'https://bob.github.io');
  assert.equal(bob.NOTION_SOURCE, '');
  assert.equal(bob.PLAUSIBLE_SITES, '');
  assert.equal(bob.GITHUB_PROPRIETAIRE, 'bob');
  assert.equal(relaisDeSiteJs(readFileSync(fSite, 'utf8')), '');
});

test('installation refusée sans mot de passe solide ou avec un lien Notion illisible', async () => {
  const d = copieDuDepot();
  await assert.rejects(installer({ racine: d, env: { PILOTAGE_MDP: 'court', PROPRIETAIRE: 'a', DEPOT: 'geri' } }), /PILOTAGE_MDP/);
  await assert.rejects(installer({ racine: d, env: { PILOTAGE_MDP: MDP, PROPRIETAIRE: 'a', DEPOT: 'geri', PAGE_NOTION: 'n’importe quoi' } }), /Notion illisible/);
  await assert.rejects(installer({ racine: d, env: { PILOTAGE_MDP: MDP, PROPRIETAIRE: 'a', DEPOT: 'geri', NOM: '<script>' } }), /Nom/);
});

test('modèle du rapport du matin sans Notion branché : champs signalés', () => {
  const modele = readFileSync(join(RACINE, 'modeles', 'rapport-du-matin.md'), 'utf8');
  const t = rapportDuMatin(modele, { site: 'https://a.github.io/geri/', nom: 'Geri', page: null, reglages: {} });
  assert.ok(t.includes('collection://<identifiant de la base, à remplir>'));
  assert.ok(!/\{\{[A-Z_]+\}\}/.test(t));
});
