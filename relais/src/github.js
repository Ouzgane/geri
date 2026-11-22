// Suivi GitHub en lecture seule : pull requests ouvertes (en attente de ta décision), dernier commit
// et échecs de workflows des 7 derniers jours, dépôt par dépôt. Jeton fin en lecture : secret GitHub GH_LECTURE, reçu par le relais sous le nom GITHUB_LECTURE.
// Rien n'est écrit sur GitHub.

// GITHUB_DEPOTS = "pare-72h=kitvital; epargne-site=sauvermonepargne; …"
export function depotsSuivis(env) {
  return String(env.GITHUB_DEPOTS || '').split(/[;\n]+/).map((s) => s.trim()).filter(Boolean).map((s) => {
    const [depot, projet] = s.split('=').map((x) => x.trim());
    return /^[A-Za-z0-9._-]{1,100}$/.test(depot || '') && /^[a-z0-9-]{1,40}$/.test(projet || '') ? { depot, projet } : null;
  }).filter(Boolean);
}

async function gh(env, chemin) {
  const r = await fetch('https://api.github.com' + chemin, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_LECTURE}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'larmina-pilotage',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error('GitHub ' + r.status);
  return r.json();
}

export async function suiviGithub(env, { maintenant = new Date() } = {}) {
  const proprio = String(env.GITHUB_PROPRIETAIRE || '').trim();
  const depuis = maintenant.getTime() - 7 * 86400000;
  const depots = await Promise.all(depotsSuivis(env).map(async ({ depot, projet }) => {
    const base = `/repos/${encodeURIComponent(proprio)}/${encodeURIComponent(depot)}`;
    const ligne = { depot, projet_id: projet, prs: [], dernier_commit: null, echecs: [], erreur: null };
    if (!proprio) { ligne.erreur = 'GITHUB_PROPRIETAIRE manquant'; return ligne; }
    try {
      const [prs, commits, runs] = await Promise.all([
        gh(env, base + '/pulls?state=open&per_page=30'),
        gh(env, base + '/commits?per_page=1'),
        gh(env, base + '/actions/runs?per_page=20').catch(() => ({ workflow_runs: [] })),
      ]);
      ligne.prs = (Array.isArray(prs) ? prs : []).map((p) => ({
        numero: p.number, titre: String(p.title || '').slice(0, 160), ouverte_le: p.created_at, url: p.html_url, brouillon: !!p.draft,
      }));
      const c = Array.isArray(commits) && commits[0];
      if (c) ligne.dernier_commit = { date: (c.commit && c.commit.committer && c.commit.committer.date) || null, message: String((c.commit && c.commit.message) || '').split('\n')[0].slice(0, 140), url: c.html_url };
      ligne.echecs = ((runs && runs.workflow_runs) || [])
        .filter((w) => w.conclusion === 'failure' && Date.parse(w.created_at) >= depuis)
        .slice(0, 5)
        .map((w) => ({ nom: String(w.name || '').slice(0, 80), date: w.created_at, url: w.html_url }));
    } catch (e) {
      ligne.erreur = String((e && e.message) || e).slice(0, 80);
    }
    return ligne;
  }));
  return { depots, lu_le: maintenant.toISOString() };
}
