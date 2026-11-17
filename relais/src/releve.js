// Audience des sites (Plausible, lecture seule).
// - Relevé quotidien écrit dans la base Notion « Mesures » : un passage programmé par site
//   (wrangler.toml), avant le rapport du matin, ou à la demande (POST /releve?site=…).
// - Historique servi au site (GET /audience) : visites jour par jour sur 90 jours, sources et pages.

import { ecrireMesures, jourParis } from './notion.js';

// PLAUSIBLE_SITES = "kitvital|kitvital.fr; sauvermonepargne|sauvermonepargne.fr; deswatts|deswatts.fr|kitvital"
// (projet id | domaine | fiche Notion de rattachement, facultative)
export function sitesPlausible(env) {
  return String(env.PLAUSIBLE_SITES || '').split(/[;\n]+/).map((s) => s.trim()).filter(Boolean).map((s) => {
    const [projet, site, rattache] = s.split('|').map((x) => x.trim());
    if (!/^[a-z0-9-]{1,40}$/.test(projet || '') || !/^[a-z0-9.-]{3,100}$/i.test(site || '')) return null;
    return { projet, site, rattache: /^[a-z0-9-]{1,40}$/.test(rattache || '') ? rattache : null };
  }).filter(Boolean);
}

async function plausible(env, corps) {
  const base = String(env.PLAUSIBLE_URL || 'https://plausible.io').replace(/\/+$/, '');
  const r = await fetch(base + '/api/v2/query', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.PLAUSIBLE_CLE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(corps),
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Plausible ${r.status} : ${String(j.error || '').slice(0, 160)}`);
  return j;
}

const valeur = (j, i) => {
  const r = (j && j.results && j.results[0]) || null;
  const v = r && Array.isArray(r.metrics) ? Number(r.metrics[i]) : NaN;
  return Number.isFinite(v) ? v : null;
};

// Visiteurs, visites et pages vues jour par jour (les jours sans visite manquent : 0).
async function parJour(env, site, du, au) {
  const j = await plausible(env, { site_id: site, metrics: ['visitors', 'visits', 'pageviews'], date_range: [du, au], dimensions: ['time:day'] });
  const jours = new Map();
  for (const r of j.results || []) {
    const d = String((r.dimensions || [])[0] || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    const [visiteurs, visites, pages] = (r.metrics || []).map((x) => Number(x) || 0);
    jours.set(d, { date: d, visiteurs, visites, pages });
  }
  return jours;
}

// Classement sur une dimension (sources, pages), du plus au moins visité.
async function classement(env, site, dimension, du, au, n = 6) {
  const base = { site_id: site, metrics: ['visitors'], date_range: [du, au], dimensions: [dimension] };
  let j;
  try { j = await plausible(env, { ...base, order_by: [['visitors', 'desc']], pagination: { limit: n } }); } catch (e) { j = await plausible(env, base); }
  return (j.results || []).map((r) => ({ nom: String((r.dimensions || [])[0] ?? '').slice(0, 120), visiteurs: Number((r.metrics || [])[0]) || 0 }))
    .filter((r) => r.nom).sort((a, b) => b.visiteurs - a.visiteurs).slice(0, n);
}

const somme = (jours, du, au, cle = 'visites') => [...jours.values()].filter((x) => x.date >= du && x.date <= au).reduce((t, x) => t + x[cle], 0);

async function releverSite(env, { projet, site }, maintenant, cache) {
  const J = (n) => jourParis(maintenant, -n);
  const aujourdHui = J(0), hier = J(1);
  // Jours complets seulement (jusqu'à hier), périodes en cours et précédentes pour la progression.
  const [jours, v30, v7] = await Promise.all([
    parJour(env, site, J(60), hier),
    plausible(env, { site_id: site, metrics: ['visitors'], date_range: [J(30), hier] }),
    plausible(env, { site_id: site, metrics: ['visitors'], date_range: [J(7), hier] }),
  ]);
  let objectifs = [];
  try {
    const o = await plausible(env, { site_id: site, metrics: ['visitors'], date_range: [J(7), hier], dimensions: ['event:goal'] });
    objectifs = (o.results || []).filter((r) => r && Array.isArray(r.dimensions) && r.dimensions[0])
      .sort((a, b) => (Number(b.metrics && b.metrics[0]) || 0) - (Number(a.metrics && a.metrics[0]) || 0)).slice(0, 3);
  } catch (e) { objectifs = []; }
  const h = jours.get(hier) || { visiteurs: 0, visites: 0 };
  const note = `Plausible ${site}, jours complets jusqu'au ${hier}, relevé du ${aujourdHui}`;
  const lignes = [
    { date: aujourdHui, indicateur: 'Visites 30 j', valeur: somme(jours, J(30), hier), etape: 'Audience' },
    { date: aujourdHui, indicateur: 'Visites 30 j (préc.)', valeur: somme(jours, J(60), J(31)), etape: 'Audience' },
    { date: aujourdHui, indicateur: 'Visites 7 j', valeur: somme(jours, J(7), hier), etape: 'Audience' },
    { date: aujourdHui, indicateur: 'Visites 7 j (préc.)', valeur: somme(jours, J(14), J(8)), etape: 'Audience' },
    { date: aujourdHui, indicateur: 'Visiteurs 30 j', valeur: valeur(v30, 0), etape: 'Audience' },
    { date: aujourdHui, indicateur: 'Visiteurs 7 j', valeur: valeur(v7, 0), etape: 'Audience' },
    { date: aujourdHui, indicateur: 'Pages vues 30 j', valeur: somme(jours, J(30), hier, 'pages'), etape: 'Audience' },
    { date: hier, indicateur: 'Visiteurs (jour)', valeur: h.visiteurs, etape: 'Audience' },
    { date: hier, indicateur: 'Visites (jour)', valeur: h.visites, etape: 'Audience' },
    ...objectifs.map((r) => ({ date: aujourdHui, indicateur: `Objectif « ${String(r.dimensions[0]).slice(0, 60)} » 7 j`, valeur: Number(r.metrics && r.metrics[0]), etape: 'Intention' })),
  ].filter((l) => typeof l.valeur === 'number' && Number.isFinite(l.valeur));
  const { ecrites } = await ecrireMesures(env, { projet, source: 'Plausible', lignes, note }, cache);
  return ecrites;
}

// Un site (rang = position dans PLAUSIBLE_SITES, ou domaine) ou tous.
export async function releverPlausible(env, { maintenant = new Date(), rang = null, site = null } = {}) {
  if (!env.PLAUSIBLE_CLE) return { ok: false, raison: 'Clé Plausible absente (secret PLAUSIBLE_CLE).' };
  if (!env.NOTION_CLE || !env.NOTION_MESURES) return { ok: false, raison: 'Base Mesures non branchée.' };
  let liste = sitesPlausible(env);
  if (site) liste = liste.filter((s) => s.site === site);
  else if (Number.isInteger(rang)) liste = liste.slice(rang, rang + 1);
  if (!liste.length) return { ok: false, raison: 'Aucun site à relever.' };
  const cache = new Map();
  const sites = [];
  for (const s of liste) {
    try {
      sites.push({ projet: s.projet, site: s.site, ok: true, ecrites: await releverSite(env, s, maintenant, cache) });
    } catch (e) {
      console.error('plausible', s.site, e && (e.message || e));
      sites.push({ projet: s.projet, site: s.site, ok: false, erreur: String((e && e.message) || e).slice(0, 200) });
    }
  }
  return { ok: sites.every((s) => s.ok), date: jourParis(maintenant), sites };
}

// Historique pour le site : 90 jours par jour, puis aujourd'hui (en cours) ; sources et pages sur 30 jours complets.
export async function audience(env, { maintenant = new Date(), jours = 90 } = {}) {
  const J = (n) => jourParis(maintenant, -n);
  const sites = await Promise.all(sitesPlausible(env).map(async (s) => {
    const ligne = { site: s.site, projet: s.projet, rattache: s.rattache, jours: [], sources: [], pages: [], erreur: null };
    try {
      const [parJ, sources, pages] = await Promise.all([
        parJour(env, s.site, J(jours), J(0)),
        classement(env, s.site, 'visit:source', J(30), J(1)).catch(() => []),
        classement(env, s.site, 'event:page', J(30), J(1)).catch(() => []),
      ]);
      // Série complète : un jour sans visite vaut 0 (Plausible ne le renvoie pas).
      for (let n = jours; n >= 0; n--) { const d = J(n); ligne.jours.push(parJ.get(d) || { date: d, visiteurs: 0, visites: 0, pages: 0 }); }
      ligne.sources = sources;
      ligne.pages = pages.map((p) => ({ chemin: p.nom, visiteurs: p.visiteurs }));
    } catch (e) {
      ligne.erreur = String((e && e.message) || e).slice(0, 160);
    }
    return ligne;
  }));
  return { sites, du: J(jours), au: J(0), aujourdhui: J(0), lu_le: maintenant.toISOString() };
}
