// Installe une copie de GERI sur le compte GitHub de quelqu'un d'autre.
// Lancé par le workflow « Installer GERI » (Actions → Installer GERI → Run workflow) ; peut être relancé
// sans risque (après un changement de mot de passe, ou pour brancher Notion plus tard).
//
// Entrées (variables d'environnement) :
//   PILOTAGE_MDP   mot de passe du site, 12 caractères au moins (secret GitHub)
//   NOTION_CLE     secret de l'intégration Notion (facultatif, secret GitHub)
//   PAGE_NOTION    lien ou identifiant de la page Notion « Pilotage des projets » (facultatif)
//   NOM            nom de l'assistante (facultatif, « Geri » par défaut)
//   PROPRIETAIRE   compte GitHub (fourni par le workflow)
//   DEPOT          nom du dépôt (fourni par le workflow)
//
// Écrit seulement dans perso/ : relais.json (réglages du relais), site.js (réglages du site),
// pilotage.chiffre.json (données de départ chiffrées), rapport-du-matin.md et LISEZMOI.md.
import { webcrypto as crypto } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BASES, CLES_NOTION } from './notion-bases.mjs';
import { PERSONNELS, verifier } from './appliquer-perso.mjs';

const ITERATIONS = 310000;
const NOTION_VERSION = '2025-09-03';
const hex = (b) => Buffer.from(b).toString('hex');
const b64 = (u8) => Buffer.from(u8).toString('base64');
const u8 = (s) => new Uint8Array(Buffer.from(s, 'base64'));

// ── Mot de passe : empreinte du jeton de l'assistante (même calcul que outils/empreinte-ia.mjs) ──
export async function empreinte(mdp) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(mdp), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode('pilotage-ia-jeton-v1'), iterations: ITERATIONS, hash: 'SHA-256' }, base, 256);
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(hex(bits))));
}

// ── Données chiffrées (même format que outils/publier.mjs) ──
async function cle(mdp, sel, usage) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(mdp), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: sel, iterations: ITERATIONS, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, [usage]);
}

export async function chiffrer(paquet, mdp) {
  const sel = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const donnees = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await cle(mdp, sel, 'encrypt'), new TextEncoder().encode(JSON.stringify(paquet)));
  return { version: 1, algorithme: 'AES-GCM-256', derivation: { nom: 'PBKDF2-SHA256', iterations: ITERATIONS, sel: b64(sel) }, iv: b64(iv), publie_le: paquet.genere_le, donnees: b64(new Uint8Array(donnees)) };
}

export async function dechiffrer(env, mdp) {
  const k = await cle(mdp, u8(env.derivation.sel), 'decrypt');
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u8(env.iv) }, k, u8(env.donnees))));
}

export function paquetDeDepart(nom, quand = new Date()) {
  const jour = quand.toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
  return {
    genere_le: quand.toISOString(),
    projets: [],
    rapports: [],
    syntheses: [{
      date: jour,
      titre: `${nom} est installée : ajoute ton premier projet dans Notion.`,
      synthese: `Ton tableau de pilotage est en ligne. Il lit la base Notion « Projets » toutes les 2 minutes : chaque fiche que tu y crées apparaît ici. Le rapport du matin, si tu le programmes, écrira ensuite un briefing comme celui-ci chaque jour.`,
      arbitrages: '',
      alertes: '',
    }],
    revenus: [],
  };
}

// ── Notion ──
export function idPage(lien) {
  const m = String(lien || '').replace(/-/g, '').match(/([0-9a-f]{32})(?![0-9a-f])/i);
  if (!m) return null;
  const h = m[1].toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function clientNotion(cleNotion, fetchImpl = fetch) {
  return async function appel(chemin, methode = 'GET', corps) {
    const r = await fetchImpl('https://api.notion.com/v1' + chemin, {
      method: methode,
      headers: { Authorization: `Bearer ${cleNotion}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
      body: corps ? JSON.stringify(corps) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) throw new Error('Notion refuse la clé : vérifie le secret NOTION_CLE (secret de ton intégration interne).');
    if (r.status === 404) throw new Error('Notion ne trouve pas la page : ouvre-la, menu ••• → Connexions, et ajoute ton intégration.');
    if (!r.ok) throw new Error(`Notion a refusé (${chemin}) : ${String(j.message || r.status).slice(0, 300)}`);
    return j;
  };
}

const rt = (t) => [{ type: 'text', text: { content: t } }];

// Retrouve les bases déjà créées sous la page (par leur titre) et crée celles qui manquent.
// Renvoie { NOTION_SOURCE: id de source de données, …, creees: [titres] }.
export async function preparerNotion({ cleNotion, page, connus = {}, fetchImpl = fetch, journal = () => {} }) {
  const appel = clientNotion(cleNotion, fetchImpl);
  await appel(`/pages/${page}`);
  const enfants = new Map();
  let curseur;
  do {
    const r = await appel(`/blocks/${page}/children?page_size=100${curseur ? '&start_cursor=' + curseur : ''}`);
    for (const b of r.results || []) if (b.type === 'child_database' && b.child_database && !b.in_trash && !b.archived) enfants.set(b.child_database.title, b.id);
    curseur = r.has_more ? r.next_cursor : null;
  } while (curseur);

  const ids = {};
  const creees = [];
  for (const base of BASES) {
    if (connus[base.cle]) { ids[base.cle] = connus[base.cle]; continue; }
    if (enfants.has(base.titre)) {
      const db = await appel(`/databases/${enfants.get(base.titre)}`);
      const ds = (db.data_sources || [])[0];
      if (ds && ds.id) { ids[base.cle] = ds.id; journal(`Base « ${base.titre} » retrouvée.`); continue; }
    }
    if (base.cle !== 'NOTION_SOURCE' && !ids.NOTION_SOURCE) throw new Error('La base Projets manque : impossible de relier les autres bases.');
    let db = await appel('/databases', 'POST', {
      parent: { type: 'page_id', page_id: page },
      title: rt(base.titre),
      description: rt(base.description),
      initial_data_source: { properties: base.proprietes(ids.NOTION_SOURCE) },
    });
    if (!(db.data_sources || [])[0]) db = await appel(`/databases/${db.id}`);
    ids[base.cle] = db.data_sources[0].id;
    creees.push(base.titre);
    journal(`Base « ${base.titre} » créée.`);
  }
  // Première fiche d'exemple, seulement si la base Projets vient d'être créée.
  if (creees.includes('Projets')) {
    await appel('/pages', 'POST', {
      parent: { type: 'data_source_id', data_source_id: ids.NOTION_SOURCE },
      properties: {
        Projet: { title: rt('Projet exemple') },
        Id: { rich_text: rt('exemple') },
        'Résumé': { rich_text: rt('Fiche créée à l’installation pour te montrer le format. Renomme-la avec ton premier projet (et change son Id), ou supprime-la.') },
        'Prochaine étape': { rich_text: rt('Remplir Décision, Statut et Objectif revenu mensuel ; donner un Indicateur clé et sa cible.') },
        'Étape': { select: { name: 'Idée' } },
        'Avancement (%)': { number: 5 },
      },
    });
    journal('Fiche « Projet exemple » créée.');
  }
  return { ...ids, creees };
}

// ── Fichiers de perso/ ──
export function reglagesRelais({ existant = {}, proprietaire, jeton, notion = {} }) {
  const r = {};
  for (const k of PERSONNELS) r[k] = existant[k] === undefined || existant[k] === null ? '' : String(existant[k]);
  for (const [k, v] of Object.entries(existant)) if (!(k in r)) r[k] = v;
  r.ORIGINES = `https://${String(proprietaire).toLowerCase()}.github.io`;
  r.JETON_EMPREINTE = jeton;
  if (!r.GITHUB_PROPRIETAIRE) r.GITHUB_PROPRIETAIRE = proprietaire;
  for (const k of CLES_NOTION) if (notion[k]) r[k] = notion[k];
  r.nom_relais = existant.nom_relais || 'geri-ia';
  r.installe_pour = proprietaire;
  return r;
}

export function relaisDeSiteJs(texte) {
  const m = /^\s*relais:\s*'([^']*)'/m.exec(String(texte || ''));
  return m ? m[1] : '';
}

export function siteJs({ relais = '', nom = 'Geri' }) {
  const prononciation = nom === 'Geri' ? 'Jéri' : nom;
  return `// Réglages de cette copie de GERI, écrits par le workflow « Installer GERI ».
// Ils complètent config.js sans le modifier : une mise à jour depuis l'original (« Sync fork ») ne les touche pas.
// « relais » est renseigné par le workflow « Relais IA » après le déploiement sur Cloudflare.
Object.assign(window.PILOTAGE_IA = window.PILOTAGE_IA || {}, {
  relais: '${relais.replace(/'/g, '')}',
  nom: ${JSON.stringify(nom)},
  prononciation: ${JSON.stringify(prononciation)},
  donnees: 'perso/pilotage.chiffre.json',
});
`;
}

// site.js déjà personnalisé (plafond, playlists, voix…) : seuls le nom et sa prononciation changent.
export function majSiteJs(texte, nom) {
  const t = String(texte || '');
  if (!/donnees:\s*'perso\//.test(t) || !/^\s*nom:.*,\s*$/m.test(t)) return null;
  const prononciation = nom === 'Geri' ? 'Jéri' : nom;
  let s = t.replace(/^(\s*)nom:.*,\s*$/m, (_, e) => `${e}nom: ${JSON.stringify(nom)},`);
  s = /^\s*prononciation:.*,\s*$/m.test(s)
    ? s.replace(/^(\s*)prononciation:.*,\s*$/m, (_, e) => `${e}prononciation: ${JSON.stringify(prononciation)},`)
    : s.replace(/^(\s*)nom:.*,\s*$/m, (l, e) => `${l}\n${e}prononciation: ${JSON.stringify(prononciation)},`);
  return s;
}

export function siteDe(proprietaire, depot) {
  const compte = String(proprietaire).toLowerCase();
  return String(depot).toLowerCase() === `${compte}.github.io` ? `https://${compte}.github.io/` : `https://${compte}.github.io/${depot}/`;
}

export function rapportDuMatin(modele, { site, nom, page, reglages, plafond = 3 }) {
  const depots = String(reglages.GITHUB_DEPOTS || '').trim()
    ? ` (compte ${reglages.GITHUB_PROPRIETAIRE} ; dépôt=projet : ${reglages.GITHUB_DEPOTS})`
    : ' (liste-les ici sous la forme « dépôt → projet id » ; sans dépôt, saute cette étape)';
  const valeurs = { SITE: site, NOM: nom, PAGE_NOTION: page ? `(https://www.notion.so/${page.replace(/-/g, '')})` : '', DEPOTS: depots, PLAFOND: String(plafond) };
  for (const k of CLES_NOTION) valeurs[k] = reglages[k] || `<identifiant de la base, à remplir>`;
  return modele.replace(/\{\{([A-Z_]+)\}\}/g, (tout, k) => (k in valeurs ? valeurs[k] : tout));
}

const LISEZMOI = (site) => `# Réglages de ta copie de GERI

Ce dossier t'appartient : les mises à jour de l'original (bouton « Sync fork ») ne le modifient jamais.

- \`relais.json\` : réglages du relais (assistante, Notion, connexions). Tu peux le modifier sur GitHub (crayon), puis enregistrer : le relais se redéploie seul.
  - \`PLAUSIBLE_SITES\` : sites suivis, \`projet|domaine\` séparés par \`;\` (ex. \`mon-site|mon-site.fr; boutique|boutique.fr\`). Avec le secret \`PLAUSIBLE_CLE\`.
  - \`GITHUB_DEPOTS\` : dépôts à suivre, \`dépôt=projet\` séparés par \`;\`. Avec le secret \`GH_LECTURE\`.
  - \`PAYHIP_PROJET\` : projet auquel rattacher les ventes Payhip. Avec le secret \`PAYHIP_CLE\`.
  - \`IA_FOURNISSEUR\`, \`IA_MODELE\` : pour changer de modèle (voir le README). Avec le secret \`IA_CLE\`.
  - Ne touche pas à \`ORIGINES\`, \`JETON_EMPREINTE\` ni aux identifiants \`NOTION_…\` : le workflow « Installer GERI » les écrit.
- \`site.js\` : adresse du relais, nom de l'assistante, emplacement des données. Tu peux y ajouter les réglages de \`config.js\` que tu veux changer (\`plafondProjets\`, \`playlists\`, \`voixNom\`, \`voixPiper\`…) : ils remplacent ceux de l'original et sont gardés si tu relances l'installation.
- \`pilotage.chiffre.json\` : données de départ, chiffrées avec ton mot de passe.
- \`rapport-du-matin.md\` : le texte à coller dans une tâche planifiée Claude pour recevoir un briefing chaque matin.

Ton site : ${site}
`;

// ── Programme ──
export async function installer({ racine = '.', env = process.env, fetchImpl = fetch, journal = console.log } = {}) {
  const mdp = env.PILOTAGE_MDP || '';
  const proprietaire = String(env.PROPRIETAIRE || '').trim();
  const depot = String(env.DEPOT || '').trim();
  const nom = String(env.NOM || '').trim().slice(0, 30) || 'Geri';
  if (mdp.length < 12) throw new Error('Ajoute le secret PILOTAGE_MDP (mot de passe du site, 12 caractères au moins) : Settings → Secrets and variables → Actions.');
  if (!/^[A-Za-z0-9-]{1,39}$/.test(proprietaire) || !depot) throw new Error('Compte ou dépôt GitHub inconnu : lance ce programme depuis le workflow « Installer GERI ».');
  if (!/^[\p{L}\p{N} '’-]{1,30}$/u.test(nom)) throw new Error('Nom de l’assistante : lettres, chiffres, espaces et tirets seulement.');

  const dossier = join(racine, 'perso');
  mkdirSync(dossier, { recursive: true });
  const lireJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch (e) { return null; } };
  const fRelais = join(dossier, 'relais.json');
  const existant = lireJson(fRelais) || {};
  // Une copie installée pour un autre compte repart de zéro (dépôt recopié d'une copie).
  const base = existant.installe_pour && existant.installe_pour !== proprietaire ? {} : existant;

  const resume = [];
  // Notion
  let notion = {};
  const page = idPage(env.PAGE_NOTION);
  if (env.PAGE_NOTION && !page) throw new Error('Lien de la page Notion illisible : copie le lien de la page (menu ••• → Copier le lien).');
  if (env.NOTION_CLE && page) {
    notion = await preparerNotion({ cleNotion: env.NOTION_CLE, page, connus: base, fetchImpl, journal });
    resume.push(notion.creees.length ? `Notion : ${notion.creees.length} base(s) créée(s) sous ta page (${notion.creees.join(', ')}).` : 'Notion : les six bases étaient déjà là.');
  } else if (page && !env.NOTION_CLE) {
    resume.push('Notion pas encore branché : ajoute le secret NOTION_CLE, puis relance ce workflow.');
  } else if (!CLES_NOTION.every((k) => base[k])) {
    resume.push('Notion pas encore branché : relance ce workflow avec le lien de ta page Notion (et le secret NOTION_CLE).');
  }

  const reglages = reglagesRelais({ existant: base, proprietaire, jeton: await empreinte(mdp), notion });
  const erreurs = verifier(reglages);
  if (erreurs.length) throw new Error(erreurs.join(' '));
  writeFileSync(fRelais, JSON.stringify(reglages, null, 2) + '\n');

  // Données de départ : gardées si elles s'ouvrent avec ce mot de passe, sinon refaites.
  const fDonnees = join(dossier, 'pilotage.chiffre.json');
  let garder = false;
  if (existsSync(fDonnees) && base === existant) {
    try { await dechiffrer(lireJson(fDonnees), mdp); garder = true; } catch (e) { garder = false; }
  }
  if (!garder) {
    writeFileSync(fDonnees, JSON.stringify(await chiffrer(paquetDeDepart(nom), mdp)) + '\n');
    resume.push('Données de départ chiffrées avec ton mot de passe.');
  }

  const fSite = join(dossier, 'site.js');
  const ancien = base === existant && existsSync(fSite) ? readFileSync(fSite, 'utf8') : '';
  const relais = relaisDeSiteJs(ancien);
  writeFileSync(fSite, majSiteJs(ancien, nom) || siteJs({ relais, nom }));

  const site = siteDe(proprietaire, depot);
  const modele = readFileSync(join(racine, 'modeles', 'rapport-du-matin.md'), 'utf8');
  writeFileSync(join(dossier, 'rapport-du-matin.md'), rapportDuMatin(modele, { site, nom, page, reglages }));
  writeFileSync(join(dossier, 'LISEZMOI.md'), LISEZMOI(site));
  return { site, reglages, resume, relais };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    const { site, resume, relais } = await installer();
    const lignes = [`## ${process.env.NOM || 'Geri'} est installée`, '', `Site : ${site}`, '', ...resume.map((r) => `- ${r}`), '',
      relais ? `- Relais déjà branché : ${relais}` : '- Relais : le workflow « Relais IA » le déploie maintenant si les secrets Cloudflare sont posés.',
      '- Si ce n’est pas déjà fait : Settings → Pages → Deploy from a branch → main, dossier / (root) → Save.',
      '- Le texte du rapport du matin est dans perso/rapport-du-matin.md.'];
    console.log(lignes.join('\n'));
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lignes.join('\n') + '\n');
  } catch (e) {
    console.log(`::error::${e.message}`);
    process.exit(1);
  }
}
