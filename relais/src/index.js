// Relais IA du tableau de pilotage.
// POST /discuter  { messages: [{ role, content }], contexte, nom }  →  { reponse, suggestions, fournisseur, modele }
// GET  /          état du relais (fournisseur et modèle actifs), sans aucune donnée.
// GET  /projets   fiches Notion et rapports du matin, lus en direct (jeton requis).
// POST /notion    mise à jour d'une fiche, confirmée par l'utilisateur (jeton requis) ; une décision
//                 confirmée est aussi inscrite au journal des décisions.
// POST /action    une action de « Ta liste » passe à Fait (ou revient à faire), au clic (jeton requis).
// GET  /suivi     GitHub en lecture : pull requests ouvertes, dernier commit, échecs (jeton requis).
// POST /releve    relève l'audience Plausible tout de suite (jeton requis), un site par appel (?site=) ;
//                 sinon chaque matin, un passage par site à partir de 5 h 17 UTC.
// GET  /audience  historique de l'audience : visites jour par jour sur 90 jours, sources, pages (jeton requis).
// POST /payhip    webhook signé de Payhip : une vente ou un remboursement va dans la base Revenus.

import { appeler, decrireFournisseur, ErreurConfig, ErreurQuota } from './fournisseurs.js';
import { consignes, analyser, validerNotion } from './consignes.js';
import { ecrireNotion, lireProjets, lireRapports, lireMesures, lireActions, lireDecisions, lireRevenus, majAction, creerDecision, ErreurNotion } from './notion.js';
import { recevoirPayhip } from './payhip.js';
import { releverPlausible, audience, sitesPlausible } from './releve.js';
import { suiviGithub } from './github.js';

const LIMITES = { corps: 96000, historique: 14, message: 2000, contexte: 30000 };

export default {
  // Relevé du matin (déclencheur programmé de wrangler.toml), avant le rapport de 7 h 47.
  // Un passage par site (crons de wrangler.toml, dans l'ordre de PLAUSIBLE_SITES) : chaque passage
  // reste loin de la limite de sous-requêtes d'une exécution.
  async scheduled(event, env, ctx) {
    const crons = String(env.RELEVE_CRONS || '17 5 * * *;19 5 * * *;21 5 * * *').split(';').map((c) => c.trim());
    const rang = crons.indexOf(String(event && event.cron || '').trim());
    ctx.waitUntil(releverPlausible(env, { rang: rang >= 0 ? rang : null }).then((r) => console.log('releve', JSON.stringify(r))).catch((e) => console.error('releve', e && (e.stack || e.message || e))));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    // Webhook de Payhip : appel de serveur à serveur, authentifié par sa signature.
    if (url.pathname === '/payhip') {
      if (request.method !== 'POST') return json({ erreur: 'Méthode non autorisée.' }, 405);
      return recevoirPayhip(request, env);
    }
    const origine = request.headers.get('Origin');
    const cors = entetesCors(origine, env);

    if (request.method === 'OPTIONS') {
      return cors ? new Response(null, { status: 204, headers: cors }) : new Response(null, { status: 403 });
    }
    if (origine && !cors) return json({ erreur: 'Origine non autorisée.' }, 403);

    if (request.method === 'GET' && url.pathname === '/') {
      try {
        const cfg = decrireFournisseur(env);
        return json({ service: 'Relais IA du pilotage', fournisseur: cfg.nom, modele: cfg.modele, notion: !!(env.NOTION_CLE && env.NOTION_SOURCE), pret: true }, 200, cors);
      } catch (e) {
        return json({ service: 'Relais IA du pilotage', pret: false, erreur: e.message }, 200, cors);
      }
    }
    if (url.pathname === '/projets' && request.method === 'GET') {
      if (!(await jetonValide(request, env))) return json({ erreur: 'Accès refusé.' }, 401, cors);
      if (!env.NOTION_CLE || !env.NOTION_SOURCE) return json({ erreur: 'Notion n’est pas encore branché.' }, 501, cors);
      try {
        // Les bases autres que Projets sont un plus : illisibles, elles ne bloquent pas les fiches.
        const facultatif = (base, lecture, nom) => (base ? lecture(env).catch((e) => { console.error('notion ' + nom, e && e.message); return null; }) : Promise.resolve(undefined));
        const [projets, rapports, mesures, actions, decisions, revenus] = await Promise.all([
          lireProjets(env),
          env.NOTION_RAPPORTS ? lireRapports(env).catch((e) => { console.error('notion rapports', e && e.message); return null; }) : Promise.resolve([]),
          facultatif(env.NOTION_MESURES, lireMesures, 'mesures'),
          facultatif(env.NOTION_ACTIONS, lireActions, 'actions'),
          facultatif(env.NOTION_DECISIONS, lireDecisions, 'decisions'),
          facultatif(env.NOTION_REVENUS, lireRevenus, 'revenus'),
        ]);
        const etat = (v) => (v === undefined ? 'absent' : v === null ? 'erreur' : 'ok');
        return json({
          projets, rapports: rapports || [], rapports_ok: rapports !== null,
          mesures: mesures || [], actions: actions || [], decisions: decisions || [], revenus: revenus || [],
          bases: { mesures: etat(mesures), actions: etat(actions), decisions: etat(decisions), revenus: etat(revenus) },
          connexions: { payhip: !!env.PAYHIP_CLE, plausible: !!env.PLAUSIBLE_CLE, github: !!env.GITHUB_LECTURE, plausible_sites: env.PLAUSIBLE_CLE ? sitesPlausible(env) : [] },
          lu_le: new Date().toISOString(),
        }, 200, cors);
      } catch (e) {
        console.error('notion', e && (e.stack || e.message || e));
        if (e instanceof ErreurNotion) return json({ erreur: e.message }, e.statut || 502, cors);
        return json({ erreur: 'Notion n’a pas répondu.' }, 502, cors);
      }
    }
    if (url.pathname === '/notion' && request.method === 'POST') {
      if (!(await jetonValide(request, env))) return json({ erreur: 'Accès refusé.' }, 401, cors);
      return enregistrerNotion(request, env, cors);
    }
    if (url.pathname === '/action' && request.method === 'POST') {
      if (!(await jetonValide(request, env))) return json({ erreur: 'Accès refusé.' }, 401, cors);
      if (!env.NOTION_CLE || !env.NOTION_ACTIONS) return json({ erreur: 'La base Actions n’est pas branchée.' }, 501, cors);
      let corps;
      try { corps = JSON.parse((await request.text()).slice(0, 2000)); } catch (e) { return json({ erreur: 'Requête illisible.' }, 400, cors); }
      try {
        return json({ ok: true, ...(await majAction(env, corps && corps.id, corps && corps.statut)) }, 200, cors);
      } catch (e) {
        console.error('action', e && (e.message || e));
        if (e instanceof ErreurNotion) return json({ erreur: e.message }, e.statut || 502, cors);
        return json({ erreur: 'Notion n’a pas répondu.' }, 502, cors);
      }
    }
    if (url.pathname === '/suivi' && request.method === 'GET') {
      if (!(await jetonValide(request, env))) return json({ erreur: 'Accès refusé.' }, 401, cors);
      if (!env.GITHUB_LECTURE) return json({ erreur: 'Suivi GitHub pas encore branché (secret GitHub GH_LECTURE).' }, 501, cors);
      return json(await suiviEnCache(env), 200, cors);
    }
    if (url.pathname === '/releve' && request.method === 'POST') {
      if (!(await jetonValide(request, env))) return json({ erreur: 'Accès refusé.' }, 401, cors);
      const site = url.searchParams.get('site');
      return json(await releverPlausible(env, site ? { site } : {}), 200, cors);
    }
    if (url.pathname === '/audience' && request.method === 'GET') {
      if (!(await jetonValide(request, env))) return json({ erreur: 'Accès refusé.' }, 401, cors);
      if (!env.PLAUSIBLE_CLE) return json({ erreur: 'Audience pas encore branchée (secret PLAUSIBLE_CLE).' }, 501, cors);
      return json(await audience(env), 200, cors);
    }
    if (url.pathname !== '/discuter') return json({ erreur: 'Adresse inconnue.' }, 404, cors);
    if (request.method !== 'POST') return json({ erreur: 'Méthode non autorisée.' }, 405, cors);

    if (!(await jetonValide(request, env))) return json({ erreur: 'Accès refusé.' }, 401, cors);

    let corps;
    try {
      const brut = await request.text();
      if (brut.length > LIMITES.corps) return json({ erreur: 'Message trop long.' }, 413, cors);
      corps = JSON.parse(brut);
    } catch (e) {
      return json({ erreur: 'Requête illisible.' }, 400, cors);
    }

    const messages = normaliser(corps && corps.messages);
    if (!messages.length || messages[messages.length - 1].role !== 'user') return json({ erreur: 'Aucune question à traiter.' }, 400, cors);
    if (messages.some((m) => m.role === 'user' && m.content.length > LIMITES.message)) return json({ erreur: `Un message dépasse ${LIMITES.message} caractères.` }, 413, cors);

    const contexte = typeof corps.contexte === 'string' ? corps.contexte.slice(0, LIMITES.contexte) : '';
    const nom = typeof corps.nom === 'string' && /^[\p{L}][\p{L}\p{N} .'-]{0,23}$/u.test(corps.nom.trim()) ? corps.nom.trim() : 'Geri';
    const date = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });

    let cfg;
    try {
      cfg = decrireFournisseur(env);
      const maxTokens = Math.min(Math.max(parseInt(env.MAX_TOKENS, 10) || 1200, 200), 4000);
      const playlists = Array.isArray(corps.playlists) ? corps.playlists.slice(0, 20).filter((p) => p && /^[a-z0-9-]{1,30}$/.test(p.cle)).map((p) => ({ cle: p.cle, nom: String(p.nom || p.cle).slice(0, 40) })) : [];
      const notion = !!(env.NOTION_CLE && env.NOTION_SOURCE);
      const requete = { systeme: consignes({ nom, date, contexte, playlists, notion, liste: notion && !!env.NOTION_ACTIONS }), messages, maxTokens };
      const brut = await appeler(cfg, requete, env);
      const { texte, suggestions, musique, actions, faits } = analyser(brut);
      const cles = new Set(playlists.map((p) => p.cle));
      return json({
        reponse: texte || (notion && actions.length ? 'Voici ce que je te propose d’enregistrer dans Notion. Confirme pour que je l’écrive.' : 'C’est noté.'),
        suggestions,
        musique: musique && (musique === 'stop' || cles.has(musique)) ? musique : null,
        actions: notion ? actions : [],
        faits: notion && env.NOTION_ACTIONS ? faits : [],
        fournisseur: cfg.nom,
        modele: requete.modeleUtilise || cfg.modele,
      }, 200, cors);
    } catch (e) {
      console.error('relais', cfg && cfg.nom, e && (e.stack || e.message || e));
      if (e instanceof ErreurQuota) return json({ erreur: e.message, code: 'quota' }, 429, cors);
      if (e instanceof ErreurConfig) return json({ erreur: e.message, code: 'config' }, 500, cors);
      return json({ erreur: 'Le modèle n’a pas répondu. Réessaie dans un instant.', code: 'fournisseur' }, 502, cors);
    }
  },
};

// Enregistre dans Notion une mise à jour confirmée par l'utilisateur.
async function enregistrerNotion(request, env, cors) {
  if (!env.NOTION_CLE || !env.NOTION_SOURCE) return json({ erreur: 'Notion n’est pas encore branché : ajoute le secret NOTION_CLE.' }, 501, cors);
  let corps;
  try { corps = JSON.parse((await request.text()).slice(0, 20000)); } catch (e) { return json({ erreur: 'Requête illisible.' }, 400, cors); }
  const action = validerNotion({ projet: corps && corps.projet, ...((corps && corps.champs) || {}), ...((corps && corps.journal) || {}) });
  const nomProjet = typeof corps.projet_nom === 'string' ? corps.projet_nom.trim().slice(0, 200) : '';
  if (!action || !nomProjet) return json({ erreur: 'Mise à jour incomplète.' }, 400, cors);
  try {
    const page = await ecrireNotion(env, nomProjet, action.champs);
    // Une décision confirmée entre au journal des décisions ; un échec ici ne défait pas la fiche.
    let journal = null;
    if (action.champs.decision && env.NOTION_DECISIONS) {
      try {
        const d = await creerDecision(env, { page, projetId: action.projet, projetNom: nomProjet, choix: action.champs.decision, ...(action.journal || {}) });
        journal = { ok: true, url: d.url };
      } catch (e) {
        console.error('journal', e && (e.message || e));
        journal = { ok: false, erreur: e instanceof ErreurNotion ? e.message : 'Journal des décisions injoignable.' };
      }
    }
    return json({ ok: true, url: page.url, champs: action.champs, journal }, 200, cors);
  } catch (e) {
    console.error('notion', e && (e.stack || e.message || e));
    if (e instanceof ErreurNotion) return json({ erreur: e.message }, e.statut || 502, cors);
    return json({ erreur: 'Notion n’a pas répondu. Réessaie dans un instant.' }, 502, cors);
  }
}

// Le suivi GitHub est gardé 10 minutes : le site le redemande à chaque synchronisation.
async function suiviEnCache(env) {
  const cache = typeof caches !== 'undefined' && caches.default ? caches.default : null;
  const cle = new Request('https://cache.larmina.invalid/suivi');
  if (cache) {
    const vu = await cache.match(cle).catch(() => null);
    if (vu) return vu.json();
  }
  const suivi = await suiviGithub(env);
  if (cache) await cache.put(cle, new Response(JSON.stringify(suivi), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=600' } })).catch(() => {});
  return suivi;
}

// Garde les rôles utiles, fusionne les tours consécutifs du même rôle, commence par une question.
export function normaliser(liste) {
  if (!Array.isArray(liste)) return [];
  const sortie = [];
  for (const m of liste.slice(-LIMITES.historique * 2)) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') continue;
    const content = m.content.trim();
    if (!content) continue;
    const dernier = sortie[sortie.length - 1];
    if (dernier && dernier.role === m.role) dernier.content += '\n\n' + content;
    else sortie.push({ role: m.role, content });
  }
  while (sortie.length && sortie[0].role !== 'user') sortie.shift();
  // Une longue réponse passée de l'assistant ne doit pas bloquer la suite : on l'abrège.
  for (const m of sortie) if (m.role === 'assistant' && m.content.length > LIMITES.message) m.content = m.content.slice(0, LIMITES.message - 1) + '…';
  return sortie.slice(-LIMITES.historique);
}

function entetesCors(origine, env) {
  if (!origine) return null;
  const permises = String(env.ORIGINES || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
  if (!permises.includes(origine)) return null;
  return {
    'Access-Control-Allow-Origin': origine,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

async function jetonValide(request, env) {
  const attendu = String(env.JETON_EMPREINTE || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(attendu)) return false; // pas d'empreinte configurée : tout est refusé
  const m = /^Bearer\s+([0-9a-f]{64})$/i.exec(request.headers.get('Authorization') || '');
  if (!m) return false;
  const empreinte = await sha256(m[1].toLowerCase());
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= empreinte.charCodeAt(i) ^ attendu.charCodeAt(i);
  return diff === 0;
}

async function sha256(texte) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texte));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function json(objet, statut, cors) {
  return new Response(JSON.stringify(objet), {
    status: statut,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(cors || {}) },
  });
}
