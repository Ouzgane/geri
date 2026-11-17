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

  // ── Audience des sites : deuxième indicateur après le revenu ───────────────
  // Source : l'historique Plausible du relais (/audience, jour par jour) ; à défaut, les relevés
  // quotidiens de la base Mesures (Visites 30 j, 7 j et leurs périodes précédentes).
  // Jours complets seulement (jusqu'à hier) : la journée en cours est mise à part.
  const BRUIT = 10; // sous 10 visites sur les deux périodes comparées, une variation ne dit rien
  const MOIS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const MOIS_COURT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const jourCourt = (d) => (valide(d) ? `${+d.slice(8, 10)} ${MOIS_COURT[+d.slice(5, 7) - 1]}` : '—');
  const moisLong = (d) => (valide(d) ? `${MOIS_FR[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}` : '—');
  const entier = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const pctFr = (x) => (x > 0 ? '+' : x < 0 ? '−' : '') + String(Math.abs(Math.round(x * 100))) + ' %';

  function variation(a, b) {
    if (typeof a !== 'number' || typeof b !== 'number') return null;
    const pct = b > 0 ? (a - b) / b : null;
    const sens = Math.max(a, b) < BRUIT ? 'faible' : b === 0 ? 'nouveau' : Math.abs(pct) < 0.05 ? 'stable' : pct > 0 ? 'hausse' : 'baisse';
    return { actuel: a, precedent: b, ecart: a - b, pct, sens };
  }
  const PERIODES = { 30: ['aux 30 jours précédents', 'les 30 jours précédents'], 7: ['à la semaine précédente', 'la semaine précédente'] };
  const phraseVariation = (v, duree) => {
    if (!v) return '';
    const [rapport, avant] = PERIODES[duree];
    if (v.sens === 'faible') return ' (trop peu de visites pour parler de progression)';
    if (v.sens === 'nouveau') return `, contre aucune ${avant}`;
    if (v.sens === 'stable') return `, stable par rapport ${rapport} (${entier(v.precedent)})`;
    return `, ${pctFr(v.pct)} par rapport ${rapport} (${entier(v.precedent)})`;
  };
  // Pente des moindres carrés d'une série de nombres (par pas).
  const pente = (ys) => {
    const n = ys.length;
    if (n < 2) return 0;
    const mx = (n - 1) / 2, my = ys.reduce((t, y) => t + y, 0) / n;
    let num = 0, den = 0;
    ys.forEach((y, i) => { num += (i - mx) * (y - my); den += (i - mx) * (i - mx); });
    return den ? num / den : 0;
  };

  function siteDepuisJours(s, jour) {
    const hier = ajouterJours(jour, -1);
    const par = new Map((s.jours || []).filter((x) => x && valide(x.date)).map((x) => [x.date, x]));
    const val = (n, cle = 'visites') => { const x = par.get(ajouterJours(jour, -n)); return x ? Number(x[cle]) || 0 : 0; };
    const somme = (de, a, cle) => { let t = 0; for (let n = de; n >= a; n--) t += val(n, cle); return t; };
    const premier = [...par.keys()].sort()[0] || hier;
    const profondeur = Math.max(0, jours(premier, jour)); // nombre de jours complets connus
    const serie = [];
    for (let n = Math.min(90, profondeur); n >= 1; n--) {
      const d = ajouterJours(jour, -n);
      const x = par.get(d) || {};
      serie.push({ date: d, visites: Number(x.visites) || 0, visiteurs: Number(x.visiteurs) || 0, pages: Number(x.pages) || 0 });
    }
    serie.forEach((x, i) => { x.moyenne = i >= 6 ? serie.slice(i - 6, i + 1).reduce((t, y) => t + y.visites, 0) / 7 : null; });
    const v30 = somme(30, 1), v7 = somme(7, 1);
    const v30p = profondeur >= 60 ? somme(60, 31) : null, v7p = profondeur >= 14 ? somme(14, 8) : null;
    // Tendance : pente des visites par jour sur 4 semaines, rapportée à la moyenne, par semaine.
    const quatre = serie.slice(-28).map((x) => x.visites);
    const moy = quatre.length ? quatre.reduce((t, y) => t + y, 0) / quatre.length : 0;
    const total28 = quatre.reduce((t, y) => t + y, 0);
    const parSemaine = moy > 0 && quatre.length >= 14 ? (pente(quatre) * 7) / moy : null;
    const tendance = { pct_semaine: parSemaine, sens: quatre.length < 14 ? 'court' : total28 < 2 * BRUIT ? 'faible' : parSemaine === null ? 'stable' : parSemaine > 0.05 ? 'hausse' : parSemaine < -0.05 ? 'baisse' : 'stable' };
    // Cumul glissant sur 30 jours, jour après jour (pour la projection vers une cible).
    const cumul = [];
    for (let n = 28; n >= 1; n--) if (profondeur >= n + 29) { let t = 0; for (let k = n; k < n + 30; k++) t += val(k); cumul.push(t); }
    const meilleur = serie.slice(-30).reduce((m, x) => (x.visites > (m ? m.visites : 0) ? x : m), null);
    const aujourdhuiEnCours = par.get(jour) ? Number(par.get(jour).visites) || 0 : null;
    return { v30, v30p, v7, v7p, visiteurs30: somme(30, 1, 'visiteurs'), pages30: somme(30, 1, 'pages'), serie, tendance, cumul, meilleur, aujourdhui: aujourdhuiEnCours, dernier_jour: hier, profondeur };
  }

  function siteDepuisMesures(projet, mesures) {
    const siennes = (mesures || []).filter((m) => m && m.projet_id === projet && m.source === 'Plausible' && valide(m.date) && typeof m.valeur === 'number')
      .sort((a, b) => a.date.localeCompare(b.date));
    if (!siennes.length) return null;
    const der = (ind) => { const l = siennes.filter((m) => m.indicateur === ind); return l.length ? l[l.length - 1] : null; };
    const v30 = der('Visites 30 j');
    if (!v30) return null;
    const meme = (ind) => { const m = der(ind); return m && m.date === v30.date ? m.valeur : null; };
    const serie = siennes.filter((m) => m.indicateur === 'Visites (jour)').map((m) => ({ date: m.date, visites: m.valeur, visiteurs: null, pages: null, moyenne: null }));
    return { v30: v30.valeur, v30p: meme('Visites 30 j (préc.)'), v7: meme('Visites 7 j'), v7p: meme('Visites 7 j (préc.)'), visiteurs30: meme('Visiteurs 30 j'), pages30: meme('Pages vues 30 j'),
      serie, tendance: { pct_semaine: null, sens: 'court' }, cumul: [], meilleur: null, aujourdhui: null, dernier_jour: ajouterJours(v30.date, -1), profondeur: 0, releve_le: v30.date };
  }

  function audience({ audience: a, mesures, projets, sites: config } = {}, { jour = aujourdhui() } = {}) {
    const fiches = new Map((projets || []).map((p) => [p.id, p]));
    const nomProjet = (id) => { const p = fiches.get(id); return p ? p.nom_court || p.projet : id; };
    // Liste et ordre des sites : ceux du relais (ordre de PLAUSIBLE_SITES), sinon ceux de l'historique.
    const declares = (Array.isArray(config) ? config : []).filter((x) => x && typeof x === 'object' && x.site);
    const lus = a && Array.isArray(a.sites) ? a.sites : [];
    const liste = declares.length ? declares.map((d) => ({ ...d, ...(lus.find((x) => x.site === d.site) || {}) })) : lus.slice();
    if (!liste.length) {
      // Sans relais : les projets qui ont des relevés Plausible dans Mesures.
      [...new Set((mesures || []).filter((m) => m && m.source === 'Plausible').map((m) => m.projet_id))].filter(Boolean).forEach((p) => liste.push({ site: p, projet: p }));
    }
    const sites = liste.map((s, ordre) => {
      const viaJours = Array.isArray(s.jours) && s.jours.length && !s.erreur;
      const st = viaJours ? siteDepuisJours(s, jour) : siteDepuisMesures(s.projet, mesures);
      const nom = s.site;
      const base = { site: s.site, projet: s.projet || null, rattache: s.rattache || null, nom, ordre,
        projet_nom: s.projet && fiches.has(s.projet) ? nomProjet(s.projet) : null, rattache_nom: s.rattache ? nomProjet(s.rattache) : null,
        source: viaJours ? 'plausible' : st ? 'mesures' : null, erreur: s.erreur || null,
        sources: Array.isArray(s.sources) ? s.sources : [], pages: Array.isArray(s.pages) ? s.pages : [] };
      if (!st) return { ...base, v30: null, v30p: null, v7: null, v7p: null, var30: null, var7: null, serie: [], tendance: null, analyse: [`${nom} : pas encore de mesure d'audience${s.erreur ? ' (' + s.erreur + ')' : ''}.`] };
      const fiche = s.projet ? fiches.get(s.projet) : null;
      let cible = null;
      if (fiche && typeof fiche.cible === 'number' && /visite/i.test(String(fiche.indicateur_cle || ''))) {
        const c = { valeur: fiche.cible, progression: fiche.cible > 0 ? Math.min(1, st.v30 / fiche.cible) : 1, projection: null, horizon: null };
        const p = pente(st.cumul);
        if (st.v30 >= fiche.cible) c.horizon = 'atteinte';
        else if (st.cumul.length < 14) c.horizon = null;
        else if (p > 0) { const n = Math.ceil((fiche.cible - st.v30) / p); if (n <= 3 * 365) c.projection = ajouterJours(st.dernier_jour, n); else c.horizon = 'au-delà de 3 ans'; }
        else c.horizon = 'pas de progression';
        cible = c;
      }
      const var30 = variation(st.v30, st.v30p), var7 = variation(st.v7, st.v7p);
      const analyse = [`${nom} : ${entier(st.v30)} visite${st.v30 > 1 ? 's' : ''} sur 30 jours${phraseVariation(var30, 30)}.`];
      if (typeof st.v7 === 'number') analyse.push(`Sur 7 jours : ${entier(st.v7)}${phraseVariation(var7, 7)}.`);
      const t = st.tendance;
      if (t && t.sens === 'hausse') analyse.push(`Tendance sur 4 semaines : en hausse, environ ${pctFr(t.pct_semaine)} par semaine.`);
      else if (t && t.sens === 'baisse') analyse.push(`Tendance sur 4 semaines : en baisse, environ ${pctFr(t.pct_semaine)} par semaine.`);
      else if (t && t.sens === 'stable') analyse.push('Tendance sur 4 semaines : stable.');
      else if (t && t.sens === 'faible') analyse.push('Tendance sur 4 semaines : trop peu de visites pour en dégager une.');
      if (st.meilleur && st.meilleur.visites > 0) analyse.push(`Meilleur jour sur 30 jours : le ${jourCourt(st.meilleur.date)} (${entier(st.meilleur.visites)} visite${st.meilleur.visites > 1 ? 's' : ''}).`);
      const src = base.sources[0], pg = base.pages[0];
      if (src || pg) analyse.push([src ? `Principale source : ${src.nom}` : '', pg ? `page la plus vue : ${pg.chemin}` : ''].filter(Boolean).join(' ; ') + '.');
      if (cible) {
        const ou = cible.horizon === 'atteinte' ? 'atteinte' : cible.projection ? `à ce rythme, atteinte vers ${moisLong(cible.projection)}` : cible.horizon ? `à ce rythme : ${cible.horizon}` : 'projection dès 6 semaines d’historique';
        analyse.push(`Cible de ${entier(cible.valeur)} visites sur 30 jours : ${Math.round(cible.progression * 100)} % atteints, ${ou}.`);
      }
      if (s.rattache) analyse.push(`Rattaché à la fiche ${base.rattache_nom}.`);
      return { ...base, ...st, var30, var7, cible, analyse };
    });
    // Portefeuille : somme des sites mesurés.
    const mesures30 = sites.filter((s) => typeof s.v30 === 'number');
    const somme = (cle) => (mesures30.length && mesures30.every((s) => typeof s[cle] === 'number') ? mesures30.reduce((t, s) => t + s[cle], 0) : null);
    const total = { v30: somme('v30'), v30p: somme('v30p'), v7: somme('v7'), v7p: somme('v7p'), aujourdhui: somme('aujourdhui') };
    total.var30 = variation(total.v30, total.v30p);
    total.var7 = variation(total.v7, total.v7p);
    mesures30.forEach((s) => { s.part = total.v30 > 0 ? s.v30 / total.v30 : null; });
    const dates = [...new Set(sites.flatMap((s) => (s.source === 'plausible' ? s.serie.map((x) => x.date) : [])))].sort();
    total.serie = dates.map((d) => ({ date: d, visites: sites.reduce((t, s) => t + ((s.serie.find((x) => x.date === d) || {}).visites || 0), 0) }));
    total.serie.forEach((x, i) => { x.moyenne = i >= 6 ? total.serie.slice(i - 6, i + 1).reduce((t, y) => t + y.visites, 0) / 7 : null; });
    const analyse = [];
    if (typeof total.v30 === 'number') {
      analyse.push(`${entier(total.v30)} visite${total.v30 > 1 ? 's' : ''} sur 30 jours sur ${mesures30.length} site${mesures30.length > 1 ? 's' : ''}${phraseVariation(total.var30, 30)}.`);
      const tete = mesures30.slice().sort((x, y) => y.v30 - x.v30)[0];
      if (tete && mesures30.length > 1 && total.v30 > 0) analyse.push(`${tete.nom} en apporte ${Math.round(tete.part * 100)} %.`);
      const lisibles = mesures30.length > 1 ? mesures30.filter((s) => s.var30 && (s.var30.sens === 'hausse' || s.var30.sens === 'baisse')) : [];
      const haut = lisibles.filter((s) => s.var30.sens === 'hausse').sort((x, y) => y.var30.pct - x.var30.pct)[0];
      const bas = lisibles.filter((s) => s.var30.sens === 'baisse').sort((x, y) => x.var30.pct - y.var30.pct)[0];
      if (haut) analyse.push(`Plus forte progression : ${haut.nom} (${pctFr(haut.var30.pct)}).`);
      if (bas) analyse.push(`En recul : ${bas.nom} (${pctFr(bas.var30.pct)}).`);
    }
    const via = sites.some((s) => s.source === 'plausible') ? 'plausible' : sites.some((s) => s.source === 'mesures') ? 'mesures' : null;
    return { source: via, jour, dernier_jour: ajouterJours(jour, -1), sites, total, analyse, lu_le: (a && a.lu_le) || null };
  }

  // Alertes nouvelles depuis le rapport précédent (le compteur « (3e jour) » est ignoré).
  const normAlerte = (s) => String(s || '').replace(/\(\s*\d+\s*(e|er|ème)?\s*jour\s*\)/gi, '').replace(/\s+/g, ' ').trim().toLowerCase();
  function alertesNouvelles(actuelles, precedentes) {
    if (precedentes === null || precedentes === undefined) return new Set();
    const avant = new Set(String(precedentes).split(/\n+/).map(normAlerte).filter(Boolean));
    return new Set(String(actuelles || '').split(/\n+/).map((s) => s.trim()).filter((s) => s && !avant.has(normAlerte(s))));
  }

  const api = { aujourdhui, jours, ajouterJours, liste, faites, resumeListe, traction, gouvernance, simuler, sources, fusionnerRevenus, alertesNouvelles, ouvert, enAttente,
    audience, variation, jourCourt, moisLong };
  racine.PILOTAGE_CALCULS = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
