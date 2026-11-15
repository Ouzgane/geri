// Calculs du pilotage partagés par le tableau (app.js) et par Geri (assistant.js) :
// ta liste et ses références (A1, A2…), traction et entonnoir, gouvernance, fraîcheur des sources,
// simulation d'arbitrage et fusion des revenus. Fonctions pures, sans dessin ni réseau.
(function (racine) {
  const JOUR = 86400000;
  const aujourdhui = (d = new Date()) => d.toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
  const valide = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
  // Nombre de jours de a à b (b − a), dates AAAA-MM-JJ.
  const jours = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / JOUR);
  const ajouterJours = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * JOUR).toISOString().slice(0, 10);
  const IMPACT = { Revenu: 0, 'Décision': 1, Obligation: 2, 'Vérification': 3 };
  const QUI = { Toi: 0, Tiers: 1, 'Session du projet': 2 };
  const OUVERTS = new Set(['Actif', 'Accéléré', 'Analyse en cours']);
  const enAttente = (d) => !d || d === 'À décider' || d === 'À arbitrer';
  const nomDe = (projets) => {
    const m = new Map((projets || []).map((p) => [p.id, p.nom_court || p.projet]));
    return (id) => (id === 'pilotage' ? 'Pilotage' : m.get(id) || id || '—');
  };

  // ── Ta liste ───────────────────────────────────────────────────────────────
  // Ordre : ce qui t'attend d'abord, puis par impact sur le revenu, retard, échéance proche, ancienneté.
  function liste(actions, projets, { jour = aujourdhui() } = {}) {
    const nom = nomDe(projets);
    const l = (actions || []).filter((a) => a && a.titre && a.statut === 'À faire').map((a) => {
      const retard = valide(a.echeance) ? Math.max(0, jours(a.echeance, jour)) : 0;
      return {
        ...a,
        projet_nom: nom(a.projet_id),
        retard,
        dans: valide(a.echeance) && jours(jour, a.echeance) >= 0 ? jours(jour, a.echeance) : null,
        age: valide(a.ouverte) ? Math.max(0, jours(a.ouverte, jour)) : null,
      };
    });
    l.sort((x, y) => (QUI[x.qui] ?? 3) - (QUI[y.qui] ?? 3) || (IMPACT[x.impact] ?? 4) - (IMPACT[y.impact] ?? 4)
      || y.retard - x.retard || (x.dans ?? 1e9) - (y.dans ?? 1e9) || (y.age ?? -1) - (x.age ?? -1) || String(x.titre).localeCompare(String(y.titre)));
    l.forEach((a, i) => { a.ref = 'A' + (i + 1); });
    return l;
  }

  function faites(actions, projets) {
    const nom = nomDe(projets);
    return (actions || []).filter((a) => a && a.statut === 'Fait').map((a) => ({ ...a, projet_nom: nom(a.projet_id) }))
      .sort((a, b) => String(b.faite || '').localeCompare(String(a.faite || '')));
  }

  function resumeListe(l) {
    const toi = (l || []).filter((a) => a.qui === 'Toi');
    const retard = toi.filter((a) => a.retard > 0);
    const plusVieille = (xs) => xs.filter((a) => a.age !== null).sort((a, b) => b.age - a.age)[0] || null;
    const decisions = toi.filter((a) => a.impact === 'Décision');
    return {
      toi: toi.length,
      tiers: (l || []).filter((a) => a.qui === 'Tiers').length,
      en_retard: retard.length,
      retard_cumule: retard.reduce((t, a) => t + a.retard, 0),
      plus_ancienne: plusVieille(toi),
      plus_en_retard: retard.slice().sort((a, b) => b.retard - a.retard)[0] || null,
      decisions: decisions.length,
      decision_plus_ancienne: plusVieille(decisions),
      prochaine: toi.filter((a) => a.dans !== null).sort((a, b) => a.dans - b.dans)[0] || null,
    };
  }

  // ── Traction ───────────────────────────────────────────────────────────────
  const ETAPES = ['Audience', 'Intention', 'Vente', 'Revenu', 'Dossier'];
  function traction(projet, mesures, { jour = aujourdhui() } = {}) {
    const siennes = (mesures || []).filter((m) => m && m.projet_id === projet.id && valide(m.date) && typeof m.valeur === 'number')
      .sort((a, b) => a.date.localeCompare(b.date));
    const dernieres = new Map();
    for (const m of siennes) dernieres.set(m.indicateur, m);
    const etapes = ETAPES.map((e) => ({ etape: e, mesures: [...dernieres.values()].filter((m) => (m.etape || 'Audience') === e) })).filter((x) => x.mesures.length);
    const cle = projet.indicateur_cle || null;
    const cible = typeof projet.cible === 'number' ? projet.cible : null;
    const serie = cle ? siennes.filter((m) => m.indicateur === cle) : [];
    const derniere = serie[serie.length - 1] || null;
    let progression = null, pente = null, projection = null, horizon = null;
    // Cible en baisse (reste à financer → 0) ou en hausse (visites → 5 000).
    const descend = derniere && cible !== null ? cible < serie[0].valeur : false;
    if (derniere && cible !== null) {
      if (!descend) progression = cible > 0 ? Math.max(0, Math.min(1, derniere.valeur / cible)) : 1;
      else progression = Math.max(0, Math.min(1, (serie[0].valeur - derniere.valeur) / (serie[0].valeur - cible)));
    }
    if (serie.length >= 2 && jours(serie[0].date, derniere.date) >= 3) {
      pente = (derniere.valeur - serie[0].valeur) / jours(serie[0].date, derniere.date);
      if (cible !== null) {
        const reste = cible - derniere.valeur;
        if (reste === 0) projection = derniere.date;
        else if (pente !== 0 && Math.sign(reste) === Math.sign(pente)) {
          const n = Math.ceil(reste / pente);
          if (n <= 3 * 365) projection = ajouterJours(derniere.date, n);
          else horizon = 'au-delà de 3 ans';
        } else horizon = 'pas de progression';
      }
    }
    return { cle, cible, serie, derniere, descend, progression, pente, projection, horizon, etapes, age: derniere ? jours(derniere.date, jour) : null };
  }

  // ── Gouvernance ────────────────────────────────────────────────────────────
  const ouvert = (p) => OUVERTS.has(p.statut) || (!p.statut && (p.decision === 'Accélérer' || p.decision === 'Maintenir'));
  function gouvernance(projets, decisions, l, { jour = aujourdhui(), plafond = 3 } = {}) {
    projets = projets || [];
    const journal = (decisions || []).filter((d) => valide(d.date));
    const derniere = (id) => journal.filter((d) => d.projet_id === id).sort((a, b) => b.date.localeCompare(a.date))[0] || null;
    const ouverts = projets.filter(ouvert);
    const attente = projets.filter((p) => enAttente(p.decision));
    const ecarts = projets.filter((p) => p.recommandation && !enAttente(p.decision) && p.decision !== 'Arrêter' && p.recommandation !== p.decision)
      .map((p) => { const d = derniere(p.id); return { projet: p, decision: d, depuis: d ? jours(d.date, jour) : null }; });
    const aRevoir = journal.filter((d) => valide(d.revue) && d.revue <= jour && !d.bilan).sort((a, b) => a.revue.localeCompare(b.revue));
    const prochaineRevue = journal.filter((d) => valide(d.revue) && d.revue > jour && !d.bilan).sort((a, b) => a.revue.localeCompare(b.revue))[0] || null;
    const decisionsListe = (l || []).filter((a) => a.qui === 'Toi' && a.impact === 'Décision');
    const sansObjectif = ouverts.filter((p) => typeof p.objectif_mensuel !== 'number');
    const sansCritere = ouverts.filter((p) => !p.critere_arret);
    const criteresEchus = projets.filter((p) => p.critere_arret && valide(p.date_critere) && p.date_critere <= jour);
    const capital = ouverts.reduce((t, p) => t + (typeof p.capital === 'number' ? p.capital : 0), 0);
    const couts = projets.reduce((t, p) => t + (typeof p.couts_mensuels === 'number' ? p.couts_mensuels : 0), 0);
    return { ouverts, plafond, depasse: ouverts.length > plafond, attente, ecarts, a_revoir: aRevoir, prochaine_revue: prochaineRevue,
      decisions_liste: decisionsListe, sans_objectif: sansObjectif, sans_critere: sansCritere, criteres_echus: criteresEchus, capital, couts, derniere };
  }

  // Ce que donnerait la mise en pause de certains projets (ensemble d'identifiants).
  function simuler(projets, l, pauses) {
    const p = pauses instanceof Set ? pauses : new Set(pauses || []);
    const ouverts = (projets || []).filter(ouvert);
    const restants = ouverts.filter((x) => !p.has(x.id));
    const toi = (l || []).filter((a) => a.qui === 'Toi');
    const gardees = toi.filter((a) => !p.has(a.projet_id));
    return {
      ouverts: restants.length,
      actions: gardees.length,
      liberees: toi.length - gardees.length,
      retard: gardees.reduce((t, a) => t + (a.retard || 0), 0),
      capital: restants.reduce((t, x) => t + (typeof x.capital === 'number' ? x.capital : 0), 0),
    };
  }

  // ── Fraîcheur des sources ──────────────────────────────────────────────────
  function sources({ syntheses, mesures, revenus, suivi, connexions, bases } = {}, { jour = aujourdhui() } = {}) {
    const c = connexions || {}, b = bases || {};
    const der = (src) => (mesures || []).filter((m) => m.source === src && valide(m.date)).map((m) => m.date).sort().pop() || null;
    const etat = (date, max, branche = true) => (!branche ? 'eteint' : !date ? 'attente' : jours(date, jour) <= max ? 'ok' : 'vieux');
    const rapport = (syntheses || []).map((s) => s.date).filter(valide).sort().pop() || null;
    const payhip = (revenus || []).filter((r) => /payhip/i.test(String(r.source || '')) && valide(r.date)).map((r) => r.date).sort().pop() || null;
    const gh = suivi && suivi.lu_le ? String(suivi.lu_le).slice(0, 10) : null;
    const ghErreurs = suivi && Array.isArray(suivi.depots) ? suivi.depots.filter((d) => d.erreur).length : 0;
    return [
      { cle: 'rapport', nom: 'Rapport du matin', date: rapport, etat: etat(rapport, 1) },
      { cle: 'plausible', nom: 'Plausible (audience du jour)', date: der('Plausible'), etat: b.mesures === 'erreur' ? 'erreur' : etat(der('Plausible'), 2, !!c.plausible) },
      { cle: 'hebdo', nom: 'Relevé hebdomadaire KitVital', date: der('Relevé hebdomadaire'), etat: etat(der('Relevé hebdomadaire'), 8) },
      { cle: 'payhip', nom: 'Payhip (ventes en direct)', date: payhip, etat: b.revenus === 'erreur' ? 'erreur' : c.payhip ? 'ok' : 'eteint', note: c.payhip ? (payhip ? 'dernière vente reçue' : 'aucune vente reçue') : '' },
      { cle: 'github', nom: 'GitHub (dépôts des projets)', date: gh, etat: !c.github ? 'eteint' : ghErreurs ? 'erreur' : etat(gh, 1), note: ghErreurs ? `${ghErreurs} dépôt${ghErreurs > 1 ? 's' : ''} refusé${ghErreurs > 1 ? 's' : ''}` : '' },
      { cle: 'drive', nom: 'Dossier de dépôt Drive (KDP, Amazon)', date: der('Dépôt Drive'), etat: etat(der('Dépôt Drive'), 35) },
    ];
  }

  // ── Revenus : journal du tableau de bord + base Notion « Revenus », sans doublon ──
  // Une ligne Notion est déjà dans le journal si sa référence y figure, ou si une ligne du journal
  // a la même date, le même projet et le même montant (appariement un pour un).
  function fusionnerRevenus(journal, notion, projets) {
    const nom = nomDe(projets);
    const base = (journal || []).map((r) => ({ ...r }));
    const libres = base.map(() => true);
    const sortie = base.slice();
    for (const r of notion || []) {
      if (!r || !valide(r.date) || typeof r.montant !== 'number') continue;
      let i = r.ref ? base.findIndex((x, k) => libres[k] && String(x.note || '').includes(r.ref)) : -1;
      if (i < 0) i = base.findIndex((x, k) => libres[k] && x.date === r.date && x.projet_id === r.projet_id && Math.abs(Number(String(x.montant).replace(',', '.')) - r.montant) < 0.005);
      if (i >= 0) { libres[i] = false; continue; }
      sortie.push({ date: r.date, projet_id: r.projet_id, projet: nom(r.projet_id), montant: r.montant, type: r.type || '', note: [r.libelle, r.ref].filter(Boolean).join(' · '), source: r.source || 'Notion' });
    }
    return sortie.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }

  // Alertes nouvelles depuis le rapport précédent (le compteur « (3e jour) » est ignoré).
  const normAlerte = (s) => String(s || '').replace(/\(\s*\d+\s*(e|er|ème)?\s*jour\s*\)/gi, '').replace(/\s+/g, ' ').trim().toLowerCase();
  function alertesNouvelles(actuelles, precedentes) {
    if (precedentes === null || precedentes === undefined) return new Set();
    const avant = new Set(String(precedentes).split(/\n+/).map(normAlerte).filter(Boolean));
    return new Set(String(actuelles || '').split(/\n+/).map((s) => s.trim()).filter((s) => s && !avant.has(normAlerte(s))));
  }

  const api = { aujourdhui, jours, ajouterJours, liste, faites, resumeListe, traction, gouvernance, simuler, sources, fusionnerRevenus, alertesNouvelles, ouvert, enAttente };
  racine.PILOTAGE_CALCULS = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
