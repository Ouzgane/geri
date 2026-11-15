// Ventes Payhip : Payhip envoie un webhook signé à chaque paiement (« paid ») et à chaque
// remboursement (« refunded »). Le relais l'inscrit dans la base Notion « Revenus », sans doublon.
// Aucune donnée d'acheteur n'est gardée (ni e-mail, ni adresse IP).

import { creerRevenu, trouverRevenu, jourParis } from './notion.js';

async function sha256(texte) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texte));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function egal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// Corps JSON, ou formulaire au cas où Payhip changerait de format.
export async function lireCorps(request) {
  const brut = (await request.text()).slice(0, 50000);
  try { return JSON.parse(brut); } catch (e) { /* pas du JSON */ }
  const o = {};
  for (const [k, v] of new URLSearchParams(brut)) o[k] = v;
  return o;
}

export function versLigne(o, projet) {
  const id = String(o.id || '').trim();
  if (!/^[A-Za-z0-9_-]{1,60}$/.test(id)) return null;
  const rembourse = o.type === 'refunded';
  const cents = Number(rembourse ? (o.amount_refunded ?? o.price) : o.price);
  const ts = Number(rembourse ? (o.date_refunded || o.date_created || o.date) : (o.date || o.date_created));
  const devise = String(o.currency || 'EUR').toUpperCase();
  const enEuros = devise === 'EUR';
  const items = Array.isArray(o.items) ? o.items : [];
  const produits = items.map((i) => i && i.product_name).filter(Boolean).join(', ').slice(0, 150);
  const coupon = o.used_coupon === true || o.used_coupon === 'true' || items.some((i) => i && (i.used_coupon === true || i.used_coupon === 'true'));
  const frais = (Number(o.payhip_fee) || 0) + (Number(o.stripe_fee) || 0);
  const note = [`Payhip ${id}`, o.payment_type ? String(o.payment_type).slice(0, 30) : '', coupon ? 'coupon' : '',
    !enEuros && Number.isFinite(cents) ? `montant en ${devise} : ${cents / 100}` : ''].filter(Boolean).join(' · ');
  return {
    libelle: (rembourse ? 'Remboursement Payhip' : 'Vente Payhip') + (produits ? ' : ' + produits : ''),
    date: jourParis(Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000) : new Date()),
    montant: enEuros && Number.isFinite(cents) ? (rembourse ? -1 : 1) * cents / 100 : null,
    frais: enEuros && !rembourse && frais > 0 ? frais / 100 : undefined,
    type: 'Vente',
    projet_id: projet,
    source: 'Payhip (automatique)',
    ref: 'payhip:' + id + (rembourse ? ':remboursement' : ''),
    etat: rembourse ? 'Remboursé' : 'Encaissé',
    note,
  };
}

// Réponses : 200 quand c'est fait ou à ignorer (Payhip ne réessaie pas), 5xx pour qu'il réessaie.
export async function recevoirPayhip(request, env) {
  const rep = (o, s) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  if (!env.PAYHIP_CLE || !env.NOTION_CLE || !env.NOTION_REVENUS) return rep({ erreur: 'Réception des ventes Payhip pas encore branchée.' }, 501);
  const o = await lireCorps(request);
  const attendue = await sha256(String(env.PAYHIP_CLE).trim());
  if (!egal(String(o.signature || '').trim().toLowerCase(), attendue)) return rep({ erreur: 'Signature refusée.' }, 401);
  if (o.type !== 'paid' && o.type !== 'refunded') return rep({ ok: true, ignore: String(o.type || '').slice(0, 40) }, 200);
  const ligne = versLigne(o, String(env.PAYHIP_PROJET || 'kitvital'));
  if (!ligne) return rep({ ok: true, ignore: 'transaction sans identifiant' }, 200);
  try {
    if (await trouverRevenu(env, ligne.ref)) return rep({ ok: true, doublon: true }, 200);
    await creerRevenu(env, ligne);
    return rep({ ok: true, ref: ligne.ref }, 200);
  } catch (e) {
    console.error('payhip', e && (e.stack || e.message || e));
    return rep({ erreur: 'Notion n’a pas pu enregistrer la vente.' }, 502);
  }
}
