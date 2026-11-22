// Copie de GERI : applique les réglages de perso/relais.json à relais/wrangler.toml, sur la machine
// de déploiement seulement (le fichier n'est pas commité). Ainsi wrangler.toml reste celui de
// l'original, et les mises à jour de l'original (« Sync fork ») ne touchent jamais tes réglages.
//   node outils/appliquer-perso.mjs perso/relais.json relais/wrangler.toml
// Appelé par le workflow « Relais IA » quand perso/relais.json existe.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Réglages propres à chaque propriétaire : vides s'ils manquent, pour ne jamais garder ceux de l'original.
export const PERSONNELS = ['ORIGINES', 'JETON_EMPREINTE', 'NOTION_SOURCE', 'NOTION_RAPPORTS', 'NOTION_MESURES', 'NOTION_ACTIONS',
  'NOTION_DECISIONS', 'NOTION_REVENUS', 'PAYHIP_PROJET', 'PLAUSIBLE_SITES', 'GITHUB_PROPRIETAIRE', 'GITHUB_DEPOTS'];
// Réglages communs : ceux de l'original sauf si la copie en donne un.
export const FACULTATIFS = ['IA_FOURNISSEUR', 'IA_MODELE', 'IA_MODELE_SECOURS', 'IA_URL', 'MAX_TOKENS', 'PLAUSIBLE_URL'];
export const NOM_RELAIS = 'geri-ia';

const chaine = (v) => '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

export function verifier(perso) {
  const erreurs = [];
  if (!perso || typeof perso !== 'object' || Array.isArray(perso)) return ['perso/relais.json doit contenir un objet JSON.'];
  for (const [k, v] of Object.entries(perso)) {
    if (typeof v === 'string' && /[\r\n]/.test(v)) erreurs.push(`${k} : une seule ligne attendue.`);
  }
  if (!/^https:\/\/[a-z0-9.-]+$/.test(String(perso.ORIGINES || '').split(',')[0].trim())) erreurs.push('ORIGINES doit être l’adresse du site, par exemple https://ton-compte.github.io.');
  if (!/^[0-9a-f]{64}$/.test(String(perso.JETON_EMPREINTE || ''))) erreurs.push('JETON_EMPREINTE manque : relance le workflow « Installer GERI ».');
  if (perso.nom_relais !== undefined && !/^[a-z0-9][a-z0-9-]{0,62}$/.test(String(perso.nom_relais))) erreurs.push('nom_relais : lettres minuscules, chiffres et tirets.');
  return erreurs;
}

export function appliquer(toml, perso) {
  const valeurs = new Map();
  for (const k of PERSONNELS) valeurs.set(k, perso[k] === undefined || perso[k] === null ? '' : String(perso[k]));
  for (const k of FACULTATIFS) if (perso[k] !== undefined && perso[k] !== null && perso[k] !== '') valeurs.set(k, String(perso[k]));
  const nom = String(perso.nom_relais || NOM_RELAIS);
  const vues = new Set();
  const lignes = toml.split('\n');
  let section = '', finVars = -1;
  for (let i = 0; i < lignes.length; i++) {
    const l = lignes[i];
    const s = /^\s*\[([^\]]+)\]\s*$/.exec(l);
    if (s) { section = s[1].trim(); continue; }
    if (section === '' && /^\s*name\s*=/.test(l)) { lignes[i] = `name = ${chaine(nom)}`; continue; }
    if (section !== 'vars') continue;
    finVars = i;
    const m = /^\s*([A-Z0-9_]+)\s*=/.exec(l);
    if (m && valeurs.has(m[1])) { lignes[i] = `${m[1]} = ${chaine(valeurs.get(m[1]))}`; vues.add(m[1]); }
  }
  if (finVars < 0) throw new Error('Section [vars] introuvable dans wrangler.toml.');
  // Les clés absentes du fichier vont à la fin de [vars] (avant la section suivante).
  while (finVars > 0 && !lignes[finVars].trim()) finVars--;
  const ajouts = [...valeurs].filter(([k]) => !vues.has(k)).map(([k, v]) => `${k} = ${chaine(v)}`);
  lignes.splice(finVars + 1, 0, ...ajouts);
  return lignes.join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [, , fichierPerso = 'perso/relais.json', fichierToml = 'relais/wrangler.toml'] = process.argv;
  const perso = JSON.parse(readFileSync(fichierPerso, 'utf8'));
  const erreurs = verifier(perso);
  if (erreurs.length) {
    for (const e of erreurs) console.log(`::error::${e}`);
    process.exit(1);
  }
  writeFileSync(fichierToml, appliquer(readFileSync(fichierToml, 'utf8'), perso));
  console.log(`Réglages de la copie appliqués : relais « ${perso.nom_relais || NOM_RELAIS} », site ${perso.ORIGINES}, ` +
    `${['NOTION_SOURCE', 'NOTION_RAPPORTS', 'NOTION_MESURES', 'NOTION_ACTIONS', 'NOTION_DECISIONS', 'NOTION_REVENUS'].filter((k) => perso[k]).length} base(s) Notion.`);
}
