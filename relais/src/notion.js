// Notion : lectures pour le site et écritures confirmées (page « Pilotage des projets »).
// Bases : Projets, Rapports du matin, Mesures, Actions, Décisions et Revenus.
// Seuls les champs que l'utilisateur pilote sont modifiables depuis Geri ; les ventes Payhip
// et les relevés d'audience sont écrits par le relais lui-même.

export class ErreurNotion extends Error {
  constructor(message, statut) { super(message); this.statut = statut; }
}

const VERSION = '2025-09-03';
const texte = (v) => ({ rich_text: [{ type: 'text', text: { content: String(v).slice(0, 1900) } }] });
const titre = (v) => ({ title: [{ type: 'text', text: { content: String(v).slice(0, 200) } }] });
const jour = (v) => ({ date: v ? { start: v } : null });
const choixP = (v) => ({ select: v ? { name: v } : null });
const PROPRIETES = {
  decision: (v) => ['Décision', { select: { name: v } }],
  statut: (v) => ['Statut', { select: { name: v } }],
  prochaine_etape: (v) => ['Prochaine étape', texte(v)],
  blocages: (v) => ['Blocages', texte(v)],
  resume: (v) => ['Résumé', texte(v)],
  echeance: (v) => ['Échéance', { date: { start: v } }],
  objectif_mensuel: (v) => ['Objectif revenu mensuel (€)', { number: v }],
  critere_arret: (v) => ["Critère d'arrêt", texte(v)],
  date_critere: (v) => ['Date du critère', { date: { start: v } }],
};

// Date du jour à Paris (AAAA-MM-JJ), décalée de « jours » si besoin.
export function jourParis(quand = new Date(), jours = 0) {
  const d = new Date((quand instanceof Date ? quand.getTime() : Number(quand)) + jours * 86400000);
  return d.toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
}

const sansTirets = (id) => String(id || '').replace(/-/g, '').toLowerCase();

export async function appel(env, chemin, methode, corps, quoi = 'La base Projets') {
  let rep;
  try {
    rep = await fetch('https://api.notion.com/v1' + chemin, {
      method: methode,
      headers: { Authorization: `Bearer ${env.NOTION_CLE}`, 'Notion-Version': VERSION, 'Content-Type': 'application/json' },
      body: corps ? JSON.stringify(corps) : undefined,
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    throw new ErreurNotion('Notion est injoignable pour le moment.', 504);
  }
  const j = await rep.json().catch(() => ({}));
  if (rep.status === 401) throw new ErreurNotion('La clé Notion est refusée : vérifie le secret NOTION_CLE.', 502);
  if (rep.status === 404) throw new ErreurNotion(`${quoi} n’est pas partagée avec l’intégration Notion de Geri.`, 502);
  if (!rep.ok) throw new ErreurNotion('Notion a refusé la demande : ' + String(j.message || rep.status).slice(0, 200), 502);
  return j;
}

// Requête paginée sur une base ; les pages à la corbeille ou archivées sont écartées.
async function interroger(env, source, corps, { pages = 5, quoi } = {}) {
  const sortie = [];
  let curseur;
  for (let i = 0; i < pages; i++) {
    const r = await appel(env, `/data_sources/${source}/query`, 'POST', { page_size: 100, ...(corps || {}), ...(curseur ? { start_cursor: curseur } : {}) }, quoi);
    for (const p of r.results || []) if (p && p.object === 'page' && !p.in_trash && !p.archived) sortie.push(p);
    if (!r.has_more || !r.next_cursor) break;
    curseur = r.next_cursor;
  }
  return sortie;
}

// Lecteurs de propriétés.
const brut = (p) => (p ? (p.title || p.rich_text || []).map((t) => t.plain_text || '').join('').trim() : '');
const lire = (pr) => ({
  t: (n) => brut(pr[n]),
  choix: (n) => (pr[n] && pr[n].select && pr[n].select.name) || null,
  nombre: (n) => (pr[n] && typeof pr[n].number === 'number' ? pr[n].number : null),
  date: (n) => (pr[n] && pr[n].date && pr[n].date.start ? String(pr[n].date.start).slice(0, 10) : null),
  relation: (n) => ((pr[n] && pr[n].relation) || []).map((r) => r.id),
});

export async function trouverPage(env, nomProjet) {
  const r = await appel(env, `/data_sources/${env.NOTION_SOURCE}/query`, 'POST', {
    filter: { property: 'Projet', title: { equals: nomProjet } },
    page_size: 2,
  });
  const page = (r.results || [])[0];
  if (!page) throw new ErreurNotion(`Le projet « ${nomProjet} » est introuvable dans Notion.`, 404);
  return page;
}

// Fiche du projet par son identifiant court (champ « Id »), pour les relations.
export async function pageProjetParId(env, id, cache) {
  if (!id || !env.NOTION_SOURCE) return null;
  if (cache && cache.has(id)) return cache.get(id);
  let page = null;
  try {
    const r = await appel(env, `/data_sources/${env.NOTION_SOURCE}/query`, 'POST', { filter: { property: 'Id', rich_text: { equals: id } }, page_size: 2 });
    page = (r.results || [])[0] || null;
  } catch (e) { page = null; }
  if (cache) cache.set(id, page);
  return page;
}

export async function ecrireNotion(env, nomProjet, champs) {
  const page = await trouverPage(env, nomProjet);
  const properties = {};
  for (const [cle, valeur] of Object.entries(champs)) {
    if (PROPRIETES[cle]) { const [nom, val] = PROPRIETES[cle](valeur); properties[nom] = val; }
  }
  const maj = await appel(env, `/pages/${page.id}`, 'PATCH', { properties });
  return { id: maj.id || page.id, url: maj.url || page.url };
}

// ── Lectures pour le site ─────────────────────────────────────────────────────
export async function lireProjets(env) {
  const fiches = [];
  for (const page of await interroger(env, env.NOTION_SOURCE, {})) {
    const pr = page.properties || {};
    const L = lire(pr);
    const nom = L.t('Projet');
    if (!nom) continue;
    const lien = ((pr.Sources && pr.Sources.rich_text) || []).map((t) => t.href || (t.text && t.text.link && t.text.link.url)).find((h) => /^https:\/\//.test(h || '')) || null;
    fiches.push({
      nom,
      url: page.url,
      modifie_le: page.last_edited_time || null,
      // Champs de l'utilisateur.
      decision: L.choix('Décision'),
      statut: L.choix('Statut'),
      objectif_mensuel: L.nombre('Objectif revenu mensuel (€)'),
      critere_arret: L.t("Critère d'arrêt"),
      date_critere: L.date('Date du critère'),
      // Champs partagés.
      prochaine_etape: L.t('Prochaine étape'),
      echeance: L.date('Échéance'),
      blocages: L.t('Blocages'),
      resume: L.t('Résumé'),
      couts_mensuels: L.nombre('Coûts mensuels (€)'),
      capital: L.nombre('Capital en jeu (€)'),
      // Champs tenus par le rapport du matin.
      avancement: L.nombre('Avancement (%)'),
      etape: L.choix('Étape'),
      dynamique: L.choix('Dynamique'),
      recommandation: L.choix('Recommandation'),
      potentiel: L.nombre('Potentiel'),
      effort: L.nombre('Effort restant'),
      automatisations: L.nombre('Automatisations'),
      derniere_activite: L.date('Dernière activité'),
      modele_revenu: L.t('Modèle de revenu'),
      pole: L.choix('Pôle'),
      lien,
      // Rapport du matin, projet par projet.
      fait: L.t('Fait du jour'),
      risques: L.t('Risques'),
      // Traction.
      id: L.t('Id').toLowerCase() || null,
      indicateur_cle: L.t('Indicateur clé'),
      cible: L.nombre('Cible indicateur'),
      premier_euro: L.t('Premier euro estimé'),
    });
  }
  return fiches;
}

// Rapports du matin (une fiche par jour) : le site affiche le plus récent comme briefing du jour,
// même quand la copie chiffrée du dépôt n'a pas pu être republiée.
export async function lireRapports(env, nombre = 100) {
  const r = await appel(env, `/data_sources/${env.NOTION_RAPPORTS}/query`, 'POST', {
    page_size: Math.min(Math.max(nombre, 1), 100),
    sorts: [{ property: 'Date', direction: 'descending' }],
  }, 'La base Rapports du matin');
  const rapports = [];
  for (const page of r.results || []) {
    if (!page || page.object !== 'page' || page.in_trash || page.archived) continue;
    const pr = page.properties || {};
    const date = pr.Date && pr.Date.date && pr.Date.date.start ? String(pr.Date.date.start).slice(0, 10) : null;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const avancements = {};
    for (const morceau of brut(pr.Avancements).split(/[;\n]+/)) {
      const m = /^\s*([a-z0-9-]{1,40})\s*[=:]\s*(\d{1,3})\s*%?\s*$/i.exec(morceau);
      if (m) avancements[m[1].toLowerCase()] = Math.min(100, Number(m[2]));
    }
    // Encaissements : null si le champ est vide (inconnu), [] pour « aucun ».
    const brutEnc = brut(pr.Encaissements);
    let encaissements = null;
    if (/^\s*aucun\s*\.?\s*$/i.test(brutEnc)) encaissements = [];
    else if (brutEnc) {
      encaissements = [];
      for (const ligne of brutEnc.split(/\n+/)) {
        const [d, id, montant, type, ...note] = ligne.split(';').map((x) => x.trim());
        const m = Number(String(montant || '').replace(/\s/g, '').replace(',', '.').replace(/€$/, ''));
        if (/^\d{4}-\d{2}-\d{2}$/.test(d || '') && /^[a-z0-9-]{1,40}$/i.test(id || '') && Number.isFinite(m)) {
          encaissements.push({ date: d, projet_id: id.toLowerCase(), montant: m, type: type || '', note: note.join(';') });
        }
      }
    }
    const rapport = {
      date,
      modifie_le: page.last_edited_time || null,
      encaissements,
      titre: brut(pr.Titre),
      synthese: brut(pr['Synthèse']),
      arbitrages: brut(pr.Arbitrages),
      alertes: brut(pr.Alertes),
      avancements,
    };
    // Champs ajoutés le 15/11/2026 : présents seulement s'ils sont remplis.
    const changements = brut(pr.Changements), revue = brut(pr.Revue), indicateurs = lireIndicateurs(brut(pr.Indicateurs));
    if (changements) rapport.changements = changements;
    if (revue) rapport.revue = revue;
    if (Object.keys(indicateurs).length) rapport.indicateurs = indicateurs;
    rapports.push(rapport);
  }
  return rapports;
}

// « cle=valeur; cle2=12 » → { cle: 'valeur', cle2: 12 }
export function lireIndicateurs(s) {
  const sortie = {};
  for (const morceau of String(s || '').split(/[;\n]+/)) {
    const m = /^\s*([a-z0-9_-]{1,40})\s*=\s*(.{1,80}?)\s*$/i.exec(morceau);
    if (!m) continue;
    const n = Number(m[2].replace(',', '.').replace(/\s*%$/, ''));
    sortie[m[1].toLowerCase()] = Number.isFinite(n) && /^-?[\d\s.,]+%?$/.test(m[2]) ? n : m[2];
  }
  return sortie;
}

export async function lireMesures(env, { jours = 120 } = {}) {
  const depuis = jourParis(new Date(), -jours);
  const pages = await interroger(env, env.NOTION_MESURES, {
    filter: { property: 'Date', date: { on_or_after: depuis } },
    sorts: [{ property: 'Date', direction: 'ascending' }],
  }, { quoi: 'La base Mesures' });
  const sortie = [];
  for (const page of pages) {
    const L = lire(page.properties || {});
    const date = L.date('Date'), indicateur = L.t('Indicateur'), valeur = L.nombre('Valeur'), projet = L.t('Projet id').toLowerCase();
    if (!date || !indicateur || valeur === null || !projet) continue;
    sortie.push({ date, projet_id: projet, indicateur, valeur, etape: L.choix('Étape entonnoir'), source: L.choix('Source'), note: L.t('Note') });
  }
  return sortie;
}

export async function lireActions(env) {
  const depuis = jourParis(new Date(), -14);
  const pages = await interroger(env, env.NOTION_ACTIONS, {
    filter: { or: [
      { property: 'Statut', select: { equals: 'À faire' } },
      { and: [{ property: 'Statut', select: { equals: 'Fait' } }, { property: 'Faite le', date: { on_or_after: depuis } }] },
    ] },
  }, { pages: 3, quoi: 'La base Actions' });
  return pages.map((page) => {
    const L = lire(page.properties || {});
    return {
      id: page.id, url: page.url, titre: L.t('Action'), projet_id: L.t('Projet id').toLowerCase() || null,
      qui: L.choix('Qui'), impact: L.choix('Impact'), statut: L.choix('Statut'),
      echeance: L.date('Échéance'), ouverte: L.date('Ouverte le'), faite: L.date('Faite le'),
      ou: L.t('Où la mener'), source: L.t('Source'),
    };
  }).filter((a) => a.titre);
}

export async function lireDecisions(env) {
  const pages = await interroger(env, env.NOTION_DECISIONS, { sorts: [{ property: 'Date', direction: 'descending' }] }, { pages: 1, quoi: 'La base Décisions' });
  return pages.map((page) => {
    const L = lire(page.properties || {});
    return {
      id: page.id, titre: L.t('Décision'), projet_id: L.t('Projet id').toLowerCase() || null, date: L.date('Date'),
      choix: L.choix('Choix'), raison: L.t('Raison'), attendu: L.t('Résultat attendu'), revue: L.date('Revoir le'),
      bilan: L.t('Bilan'), source: L.choix('Source'),
    };
  }).filter((d) => d.date);
}

export async function lireRevenus(env) {
  const pages = await interroger(env, env.NOTION_REVENUS, { sorts: [{ property: 'Date', direction: 'ascending' }] }, { quoi: 'La base Revenus' });
  return pages.map((page) => {
    const L = lire(page.properties || {});
    return {
      id: page.id, date: L.date('Date'), projet_id: L.t('Projet id').toLowerCase() || null, montant: L.nombre('Montant (€)'),
      type: L.choix('Type') || '', libelle: L.t('Libellé'), note: L.t('Note'), source: L.choix('Source'),
      ref: L.t('Réf transaction'), frais: L.nombre('Frais (€)'), etat: L.choix('État'),
    };
  }).filter((r) => r.date && typeof r.montant === 'number');
}

// ── Écritures ────────────────────────────────────────────────────────────────
const relation = (page) => ({ relation: page ? [{ id: page.id }] : [] });

// Une action de « Ta liste » passe à Fait (ou revient à faire), seulement dans la base Actions.
export const STATUTS_ACTION = ['À faire', 'Fait', 'Abandonnée'];
export async function majAction(env, id, statut) {
  if (!/^[0-9a-f]{32}$/.test(sansTirets(id)) || !STATUTS_ACTION.includes(statut)) throw new ErreurNotion('Action inconnue.', 400);
  const page = await appel(env, `/pages/${sansTirets(id)}`, 'GET', null, 'La base Actions');
  const parent = page.parent || {};
  if (sansTirets(parent.data_source_id) !== sansTirets(env.NOTION_ACTIONS)) throw new ErreurNotion('Cette page n’est pas une action de ta liste.', 403);
  const maj = await appel(env, `/pages/${page.id}`, 'PATCH', { properties: {
    Statut: { select: { name: statut } },
    'Faite le': jour(statut === 'Fait' ? jourParis() : null),
  } }, 'La base Actions');
  return { id: maj.id || page.id, url: maj.url || page.url, statut };
}

// Journal des décisions : une ligne par décision confirmée.
export async function creerDecision(env, { page, projetId, projetNom, choix, raison, attendu, revue, source = 'Geri' }) {
  const date = jourParis();
  const properties = {
    'Décision': titre(`${projetNom} : ${choix}`),
    Projet: relation(page),
    'Projet id': texte(projetId || ''),
    Date: jour(date),
    Choix: choixP(['Accélérer', 'Maintenir', 'Mettre en pause', 'Arrêter', 'À arbitrer'].includes(choix) ? choix : 'Autre'),
    'Revoir le': jour(revue || jourParis(new Date(), 14)),
    Source: choixP(source),
  };
  if (raison) properties.Raison = texte(raison);
  if (attendu) properties['Résultat attendu'] = texte(attendu);
  const p = await appel(env, '/pages', 'POST', { parent: { type: 'data_source_id', data_source_id: env.NOTION_DECISIONS }, properties }, 'La base Décisions');
  return { id: p.id, url: p.url };
}

export async function trouverRevenu(env, ref) {
  const r = await appel(env, `/data_sources/${env.NOTION_REVENUS}/query`, 'POST', { filter: { property: 'Réf transaction', rich_text: { equals: ref } }, page_size: 1 }, 'La base Revenus');
  return (r.results || []).find((p) => p && !p.in_trash && !p.archived) || null;
}

export async function creerRevenu(env, l) {
  const page = await pageProjetParId(env, l.projet_id);
  const properties = {
    'Libellé': titre(l.libelle),
    Date: jour(l.date),
    'Montant (€)': { number: typeof l.montant === 'number' ? Math.round(l.montant * 100) / 100 : null },
    Type: choixP(l.type || 'Vente'),
    Projet: relation(page),
    'Projet id': texte(l.projet_id || ''),
    Source: choixP(l.source),
    'Réf transaction': texte(l.ref),
    'État': choixP(l.etat),
  };
  if (typeof l.frais === 'number') properties['Frais (€)'] = { number: Math.round(l.frais * 100) / 100 };
  if (l.note) properties.Note = texte(l.note);
  const p = await appel(env, '/pages', 'POST', { parent: { type: 'data_source_id', data_source_id: env.NOTION_REVENUS }, properties }, 'La base Revenus');
  return { id: p.id, url: p.url };
}

// Relevés d'un projet pour une source : une ligne par (date, indicateur), mise à jour si elle existe déjà.
export async function ecrireMesures(env, { projet, source, lignes, note }, cache = new Map()) {
  if (!lignes.length) return { ecrites: 0 };
  const page = await pageProjetParId(env, projet, cache);
  const dates = [...new Set(lignes.map((l) => l.date))];
  const existantes = new Map();
  for (const d of dates) {
    const pages = await interroger(env, env.NOTION_MESURES, { filter: { and: [
      { property: 'Date', date: { equals: d } },
      { property: 'Projet id', rich_text: { equals: projet } },
      { property: 'Source', select: { equals: source } },
    ] } }, { pages: 1, quoi: 'La base Mesures' });
    for (const p of pages) existantes.set(d + '|' + brut((p.properties || {}).Indicateur), p.id);
  }
  let ecrites = 0;
  for (const l of lignes) {
    if (typeof l.valeur !== 'number' || !Number.isFinite(l.valeur)) continue;
    const [a, m, j] = l.date.split('-');
    const properties = {
      Mesure: titre(`${projet} · ${l.indicateur} · ${j}/${m}/${a}`),
      Date: jour(l.date), Projet: relation(page), 'Projet id': texte(projet), Indicateur: texte(l.indicateur),
      Valeur: { number: l.valeur }, 'Étape entonnoir': choixP(l.etape || 'Audience'), Source: choixP(source),
      Note: texte(l.note || note || source),
    };
    const id = existantes.get(l.date + '|' + l.indicateur);
    if (id) await appel(env, `/pages/${id}`, 'PATCH', { properties }, 'La base Mesures');
    else await appel(env, '/pages', 'POST', { parent: { type: 'data_source_id', data_source_id: env.NOTION_MESURES }, properties }, 'La base Mesures');
    ecrites++;
  }
  return { ecrites };
}
