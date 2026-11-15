// Relevé quotidien de l'audience (Plausible, lecture seule), écrit dans la base Notion « Mesures ».
// Lancé chaque matin par le déclencheur programmé du relais (wrangler.toml), avant le rapport du matin,
// ou à la demande depuis le site (POST /releve).

import { ecrireMesures, jourParis } from './notion.js';

// PLAUSIBLE_SITES = "kitvital|kitvital.fr; sauvermonepargne|sauvermonepargne.fr"
export function sitesPlausible(env) {
  return String(env.PLAUSIBLE_SITES || '').split(/[;\n]+/).map((s) => s.trim()).filter(Boolean).map((s) => {
    const [projet, site] = s.split('|').map((x) => x.trim());
    return /^[a-z0-9-]{1,40}$/.test(projet || '') && /^[a-z0-9.-]{3,100}$/i.test(site || '') ? { projet, site } : null;
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

export async function releverPlausible(env, { maintenant = new Date() } = {}) {
  if (!env.PLAUSIBLE_CLE) return { ok: false, raison: 'Clé Plausible absente (secret PLAUSIBLE_CLE).' };
  if (!env.NOTION_CLE || !env.NOTION_MESURES) return { ok: false, raison: 'Base Mesures non branchée.' };
  const aujourdHui = jourParis(maintenant), hier = jourParis(maintenant, -1);
  const cache = new Map();
  const sites = [];
  for (const { projet, site } of sitesPlausible(env)) {
    try {
      const q = (c) => plausible(env, { site_id: site, ...c });
      const [m30, m7, j1] = await Promise.all([
        q({ metrics: ['visitors', 'visits', 'pageviews'], date_range: '30d' }),
        q({ metrics: ['visitors', 'visits'], date_range: '7d' }),
        q({ metrics: ['visitors', 'visits'], date_range: [hier, hier] }),
      ]);
      // Objectifs (clics vers le livret, la boutique, les marchands) : sans objectif configuré, rien.
      let objectifs = [];
      try {
        const o = await q({ metrics: ['visitors'], date_range: '7d', dimensions: ['event:goal'] });
        objectifs = (o.results || []).filter((r) => r && Array.isArray(r.dimensions) && r.dimensions[0]).slice(0, 6);
      } catch (e) { objectifs = []; }
      const note = `Plausible ${site}, relevé du ${aujourdHui}`;
      const lignes = [
        { date: aujourdHui, indicateur: 'Visites 30 j', valeur: valeur(m30, 1), etape: 'Audience' },
        { date: aujourdHui, indicateur: 'Visiteurs 30 j', valeur: valeur(m30, 0), etape: 'Audience' },
        { date: aujourdHui, indicateur: 'Pages vues 30 j', valeur: valeur(m30, 2), etape: 'Audience' },
        { date: aujourdHui, indicateur: 'Visiteurs 7 j', valeur: valeur(m7, 0), etape: 'Audience' },
        { date: hier, indicateur: 'Visiteurs (jour)', valeur: valeur(j1, 0), etape: 'Audience' },
        ...objectifs.map((r) => ({ date: aujourdHui, indicateur: `Objectif « ${String(r.dimensions[0]).slice(0, 60)} » 7 j`, valeur: Number(r.metrics && r.metrics[0]), etape: 'Intention' })),
      ].filter((l) => typeof l.valeur === 'number' && Number.isFinite(l.valeur));
      const { ecrites } = await ecrireMesures(env, { projet, source: 'Plausible', lignes, note }, cache);
      sites.push({ projet, site, ok: true, ecrites });
    } catch (e) {
      console.error('plausible', site, e && (e.message || e));
      sites.push({ projet, site, ok: false, erreur: String((e && e.message) || e).slice(0, 200) });
    }
  }
  return { ok: sites.length > 0 && sites.every((s) => s.ok), date: aujourdHui, sites };
}
