/**
 * Wikimedia adapters (free, poolable across users, CC BY-SA / CC0):
 *  - WikimediaPlaceSource: Wikipedia `generator=geosearch` (+ pageprops → Wikidata QID) and
 *    one compact Wikidata SPARQL lookup (instance-of, sitelinks, heritage, area, population,
 *    localized label) → PlaceCandidate with a deterministic significance.
 *  - WikimediaKnowledgeSource: Wikipedia REST summary + a few Wikidata claims (inception,
 *    architect, height, heritage designation, named after, style) → EvidencePack.
 *
 * Global by construction: nothing here knows about any city (D-004). Wikipedia geosearch
 * caps radius at 10 km, so large/corridor queries are covered by at most MAX_CIRCLES
 * sub-queries sampled along the corridor (bounded provider calls, A5).
 *
 * Wikimedia API etiquette: a descriptive User-Agent with contact info is required
 * (https://meta.wikimedia.org/wiki/User-Agent_policy). Configure WIKIMEDIA_CONTACT.
 */
import type { DiscoveryQuery, EvidenceFact, EvidencePack, FactKind, LatLng, Locale, PlaceCandidate, PlaceKind, SourceRef } from '@city/core';
import { destinationPoint, extractEntities, extractNumbers, haversineM, isRussian, polylineLengthM, projectOntoPolyline } from '@city/core';
import { httpJson, type FetchLike } from '../http.js';
import type { CallContext, KnowledgeSource, PlaceSource } from '../types.js';

export const WIKIMEDIA = {
  GEOSEARCH_MAX_RADIUS_M: 10_000,
  GEOSEARCH_LIMIT: 50,
  MAX_CIRCLES: 4,
  TIMEOUT_MS: 6000,
  SPARQL_URL: 'https://query.wikidata.org/sparql',
  /** Sitelink count at which the log-scaled base significance saturates. */
  SITELINKS_SATURATION: 250,
  MAX_SUMMARY_SENTENCES: 6,
} as const;

export function wikimediaUserAgent(contact = process.env.WIKIMEDIA_CONTACT): string {
  return `TelveyCompanion/0.1 (${contact && contact.length > 0 ? contact : 'contact: set WIKIMEDIA_CONTACT'}) node-fetch`;
}

// ─────────────────────────────────────────────── kind mapping (Wikidata P31 → PlaceKind)

interface KindHint {
  kind: PlaceKind;
  tag: string;
}

/** Direct instance-of classes. Generic ontology only — no place-specific entries. */
export const P31_KINDS: Record<string, KindHint> = {
  Q515: { kind: 'city', tag: 'city' },
  Q1549591: { kind: 'city', tag: 'city' },
  Q1093829: { kind: 'city', tag: 'city' },
  Q5119: { kind: 'city', tag: 'capital' },
  Q3957: { kind: 'town', tag: 'town' },
  Q532: { kind: 'town', tag: 'village' },
  Q15127012: { kind: 'town', tag: 'town' },
  Q13218690: { kind: 'town', tag: 'town' },
  Q498162: { kind: 'town', tag: 'census_place' },
  Q123705: { kind: 'neighborhood', tag: 'neighborhood' },
  Q2983893: { kind: 'neighborhood', tag: 'quarter' },
  Q82794: { kind: 'region', tag: 'region' },
  Q35657: { kind: 'region', tag: 'state' },
  Q47168: { kind: 'region', tag: 'county' },
  Q33506: { kind: 'museum', tag: 'museum' },
  Q207694: { kind: 'museum', tag: 'art_museum' },
  Q1007870: { kind: 'museum', tag: 'art_gallery' },
  Q17431399: { kind: 'museum', tag: 'national_museum' },
  Q4989906: { kind: 'monument', tag: 'monument' },
  Q179700: { kind: 'monument', tag: 'statue' },
  Q5003624: { kind: 'memorial', tag: 'memorial' },
  Q575759: { kind: 'memorial', tag: 'war_memorial' },
  Q839954: { kind: 'historic_site', tag: 'archaeology' },
  Q1081138: { kind: 'historic_site', tag: 'historic_site' },
  Q57821: { kind: 'historic_site', tag: 'fortification' },
  Q23413: { kind: 'historic_site', tag: 'castle' },
  Q16560: { kind: 'building', tag: 'palace' },
  Q16970: { kind: 'religious_site', tag: 'church' },
  Q2977: { kind: 'religious_site', tag: 'cathedral' },
  Q32815: { kind: 'religious_site', tag: 'mosque' },
  Q34627: { kind: 'religious_site', tag: 'synagogue' },
  Q44539: { kind: 'religious_site', tag: 'temple' },
  Q44613: { kind: 'religious_site', tag: 'monastery' },
  Q22698: { kind: 'park', tag: 'park' },
  Q1107656: { kind: 'park', tag: 'garden' },
  Q46169: { kind: 'park', tag: 'national_park' },
  Q473972: { kind: 'park', tag: 'protected_area' },
  Q39614: { kind: 'historic_site', tag: 'cemetery' },
  Q12280: { kind: 'bridge', tag: 'bridge' },
  Q158218: { kind: 'bridge', tag: 'bridge' },
  Q12570: { kind: 'bridge', tag: 'bridge' },
  Q11303: { kind: 'building', tag: 'skyscraper' },
  Q41176: { kind: 'building', tag: 'architecture' },
  Q1021645: { kind: 'building', tag: 'office_building' },
  Q16831714: { kind: 'building', tag: 'government_building' },
  Q1497364: { kind: 'building', tag: 'architecture' },
  Q12518: { kind: 'building', tag: 'tower' },
  Q39715: { kind: 'landmark', tag: 'lighthouse' },
  Q483110: { kind: 'venue', tag: 'stadium' },
  Q24354: { kind: 'venue', tag: 'theatre' },
  Q153562: { kind: 'venue', tag: 'opera' },
  Q1060829: { kind: 'venue', tag: 'concert_hall' },
  Q570116: { kind: 'landmark', tag: 'attraction' },
  Q174782: { kind: 'landmark', tag: 'square' },
  Q8502: { kind: 'mountain', tag: 'mountain' },
  Q46831: { kind: 'mountain', tag: 'mountain_range' },
  Q8072: { kind: 'mountain', tag: 'volcano' },
  Q54050: { kind: 'natural_feature', tag: 'hill' },
  Q23397: { kind: 'water', tag: 'lake' },
  Q4022: { kind: 'water', tag: 'river' },
  Q131681: { kind: 'water', tag: 'reservoir' },
  Q34038: { kind: 'natural_feature', tag: 'waterfall' },
  Q35509: { kind: 'natural_feature', tag: 'cave' },
  Q150784: { kind: 'natural_feature', tag: 'canyon' },
  Q8514: { kind: 'natural_feature', tag: 'desert' },
  Q23442: { kind: 'natural_feature', tag: 'island' },
  Q40080: { kind: 'natural_feature', tag: 'beach' },
  Q12323: { kind: 'landmark', tag: 'dam' },
  Q55488: { kind: 'transit', tag: 'railway_station' },
  Q928830: { kind: 'transit', tag: 'metro_station' },
  Q1248784: { kind: 'transit', tag: 'airport' },
  Q34442: { kind: 'road_feature', tag: 'road' },
  Q3977: { kind: 'road_feature', tag: 'road' },
  Q27686: { kind: 'lodging', tag: 'hotel' },
  Q11707: { kind: 'food', tag: 'restaurant' },
  Q213441: { kind: 'shop', tag: 'shop' },
  Q3914: { kind: 'building', tag: 'school' },
  Q3918: { kind: 'building', tag: 'university' },
  Q16917: { kind: 'building', tag: 'hospital' },
};

/** Instance-of classes that are not places (events, people, organisations) — dropped. */
const NON_PLACE_P31 = new Set(['Q5', 'Q1656682', 'Q1190554', 'Q4830453', 'Q43229', 'Q7278', 'Q2085381', 'Q11424', 'Q482994', 'Q7725634']);

const THEME: Partial<Record<PlaceKind, string>> = {
  building: 'architecture',
  bridge: 'engineering',
  memorial: 'history',
  monument: 'history',
  historic_site: 'history',
  museum: 'culture',
  venue: 'culture',
  religious_site: 'faith',
  park: 'nature',
  natural_feature: 'nature',
  water: 'nature',
  mountain: 'nature',
  city: 'settlement',
  town: 'settlement',
  region: 'region',
};

const KIND_BOOST: Partial<Record<PlaceKind, number>> = {
  city: 0.08,
  region: 0.05,
  mountain: 0.05,
  water: 0.05,
  bridge: 0.05,
  memorial: 0.05,
  museum: 0.05,
  monument: 0.04,
  historic_site: 0.04,
  natural_feature: 0.04,
  food: -0.25,
  shop: -0.25,
  lodging: -0.25,
  transit: -0.2,
  road_feature: -0.1,
  other: -0.1,
};

export interface EntityFacts {
  qid: string;
  sitelinks: number;
  instances: string[];
  heritage: boolean;
  areaM2: number | null;
  population: number | null;
  label: string | null;
}

export function kindFor(instances: readonly string[]): KindHint | null {
  for (const q of instances) {
    const k = P31_KINDS[q];
    if (k) return k;
  }
  return null;
}

/** Deterministic 0..1 significance from global signals (never an LLM). */
export function significanceFor(e: Pick<EntityFacts, 'sitelinks' | 'heritage' | 'population'>, kind: PlaceKind): number {
  const base = Math.min(1, Math.log1p(Math.max(0, e.sitelinks)) / Math.log1p(WIKIMEDIA.SITELINKS_SATURATION));
  let s = 0.78 * base + (e.heritage ? 0.1 : 0) + (KIND_BOOST[kind] ?? 0);
  if ((kind === 'city' || kind === 'town') && e.population && e.population > 0) s += Math.max(0, Math.min(0.1, (Math.log10(e.population) - 4) / 30));
  return Math.round(Math.max(0, Math.min(1, s)) * 1000) / 1000;
}

/** Approximate radius of a feature from area, or population for settlements. */
export function extentFor(e: Pick<EntityFacts, 'areaM2' | 'population'>, kind: PlaceKind): number {
  if (e.areaM2 && e.areaM2 > 0) return Math.min(30_000, Math.round(Math.sqrt(e.areaM2 / Math.PI)));
  if ((kind === 'city' || kind === 'town') && e.population && e.population > 0) {
    const areaKm2 = e.population / 2000; // assumed mean urban density; only a fallback for missing P2046
    return Math.min(30_000, Math.round(Math.sqrt(areaKm2 / Math.PI) * 1000));
  }
  return 0;
}

// ─────────────────────────────────────────────── query geometry

/** Sub-circles (≤ 10 km radius) covering the query: center only, or sampled along the corridor. */
export function coverageCircles(q: Pick<DiscoveryQuery, 'center' | 'radiusM' | 'corridor'>, maxCircles: number = WIKIMEDIA.MAX_CIRCLES): Array<{ center: LatLng; radiusM: number }> {
  const R = WIKIMEDIA.GEOSEARCH_MAX_RADIUS_M;
  if (q.radiusM <= R) return [{ center: q.center, radiusM: Math.max(10, Math.round(q.radiusM)) }];
  const line = q.corridor && q.corridor.length >= 2 ? q.corridor : null;
  if (line) {
    const len = polylineLengthM(line);
    const n = Math.max(1, Math.min(maxCircles, Math.ceil(len / (2 * R))));
    const out: Array<{ center: LatLng; radiusM: number }> = [];
    for (let i = 0; i < n; i++) {
      const target = ((i + 0.5) / n) * len;
      out.push({ center: pointAlong(line, target), radiusM: R });
    }
    return out;
  }
  // Radial but larger than 10 km: centre + ring (bounded).
  const out = [{ center: q.center, radiusM: R }];
  const ring = Math.min(maxCircles - 1, 3);
  for (let i = 0; i < ring; i++) out.push({ center: destinationPoint(q.center, (360 / ring) * i, Math.min(q.radiusM - R / 2, R * 1.5)), radiusM: R });
  return out;
}

function pointAlong(line: readonly LatLng[], distM: number): LatLng {
  let acc = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const d = haversineM(a, b);
    if (acc + d >= distM && d > 0) {
      const f = (distM - acc) / d;
      return { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f };
    }
    acc += d;
  }
  return line.at(-1)!;
}

// ─────────────────────────────────────────────── SPARQL

interface SparqlBinding {
  [k: string]: { type: string; value: string } | undefined;
}

function wikiLang(locale: Locale): 'ru' | 'en' {
  return isRussian(locale) ? 'ru' : 'en';
}

export function entitySparql(qids: readonly string[], lang: string): string {
  const values = qids.map((q) => `wd:${q}`).join(' ');
  return `SELECT ?item ?sitelinks (GROUP_CONCAT(DISTINCT STRAFTER(STR(?inst), "entity/"); separator=" ") AS ?insts) (SAMPLE(?her) AS ?heritage) (MAX(?area) AS ?areaM2) (MAX(?pop) AS ?population) (SAMPLE(?lbl) AS ?label) WHERE {
  VALUES ?item { ${values} }
  ?item wikibase:sitelinks ?sitelinks .
  OPTIONAL { ?item wdt:P31 ?inst . }
  OPTIONAL { ?item wdt:P1435 ?her . }
  OPTIONAL { ?item p:P2046/psn:P2046/wikibase:quantityAmount ?area . }
  OPTIONAL { ?item wdt:P1082 ?pop . }
  OPTIONAL { ?item rdfs:label ?lbl . FILTER(LANG(?lbl) = "${lang}") }
} GROUP BY ?item ?sitelinks`;
}

export function parseEntityBindings(bindings: readonly SparqlBinding[]): Map<string, EntityFacts> {
  const out = new Map<string, EntityFacts>();
  for (const b of bindings) {
    const item = b.item?.value ?? '';
    const qid = item.slice(item.lastIndexOf('/') + 1);
    if (!/^Q\d+$/.test(qid)) continue;
    const num = (k: string) => {
      const v = b[k]?.value;
      const n = v === undefined ? NaN : Number(v);
      return Number.isFinite(n) ? n : null;
    };
    out.set(qid, {
      qid,
      sitelinks: num('sitelinks') ?? 0,
      instances: (b.insts?.value ?? '').split(/\s+/).filter((x) => /^Q\d+$/.test(x)),
      heritage: !!b.heritage?.value,
      areaM2: num('areaM2'),
      population: num('population'),
      label: b.label?.value ?? null,
    });
  }
  return out;
}

// ─────────────────────────────────────────────── place source

export interface WikimediaOptions {
  fetchImpl?: FetchLike;
  userAgent?: string;
  timeoutMs?: number;
  /** Wikipedia edition used for discovery (candidates are language-neutral; labels are localized). */
  discoveryWiki?: string;
  clock?: () => number;
}

interface GeoPage {
  pageid: number;
  title: string;
  coordinates?: Array<{ lat: number; lon: number }>;
  pageprops?: { wikibase_item?: string };
}

export class WikimediaPlaceSource implements PlaceSource {
  readonly name = 'wikimedia';
  readonly model = 'api';
  private readonly o: Required<Omit<WikimediaOptions, 'fetchImpl'>> & { fetchImpl?: FetchLike };

  constructor(opts: WikimediaOptions = {}) {
    this.o = { userAgent: opts.userAgent ?? wikimediaUserAgent(), timeoutMs: opts.timeoutMs ?? WIKIMEDIA.TIMEOUT_MS, discoveryWiki: opts.discoveryWiki ?? 'en', clock: opts.clock ?? Date.now, ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}) };
  }

  private http(ctx?: CallContext) {
    return { provider: this.name, timeoutMs: this.o.timeoutMs, ...(this.o.fetchImpl ? { fetchImpl: this.o.fetchImpl } : {}), ...(ctx ? { ctx } : {}) };
  }

  private headers(): Record<string, string> {
    return { 'User-Agent': this.o.userAgent, 'Api-User-Agent': this.o.userAgent, Accept: 'application/json' };
  }

  async geosearch(center: LatLng, radiusM: number, ctx?: CallContext): Promise<GeoPage[]> {
    const p = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      generator: 'geosearch',
      ggscoord: `${center.lat.toFixed(6)}|${center.lng.toFixed(6)}`,
      ggsradius: String(Math.min(WIKIMEDIA.GEOSEARCH_MAX_RADIUS_M, Math.max(10, Math.round(radiusM)))),
      ggslimit: String(WIKIMEDIA.GEOSEARCH_LIMIT),
      ggsprimary: 'primary',
      prop: 'coordinates|pageprops',
      ppprop: 'wikibase_item',
      coprimary: 'primary',
    });
    const res = await httpJson<{ query?: { pages?: GeoPage[] } }>(`https://${this.o.discoveryWiki}.wikipedia.org/w/api.php?${p}`, { headers: this.headers() }, this.http(ctx));
    return res.query?.pages ?? [];
  }

  async entities(qids: readonly string[], lang: string, ctx?: CallContext): Promise<Map<string, EntityFacts>> {
    if (qids.length === 0) return new Map();
    const body = new URLSearchParams({ query: entitySparql(qids, lang), format: 'json' });
    const res = await httpJson<{ results?: { bindings?: SparqlBinding[] } }>(
      WIKIMEDIA.SPARQL_URL,
      { method: 'POST', headers: { ...this.headers(), Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded' }, body },
      this.http(ctx),
    );
    return parseEntityBindings(res.results?.bindings ?? []);
  }

  async query(q: DiscoveryQuery, ctx?: CallContext): Promise<PlaceCandidate[]> {
    const circles = coverageCircles(q);
    const pages = new Map<number, GeoPage>();
    for (const c of circles) for (const p of await this.geosearch(c.center, c.radiusM, ctx)) pages.set(p.pageid, p);
    const qids = [...new Set([...pages.values()].map((p) => p.pageprops?.wikibase_item).filter((x): x is string => !!x && /^Q\d+$/.test(x)))];
    const lang = wikiLang(q.locale);
    const facts = new Map<string, EntityFacts>();
    for (let i = 0; i < qids.length; i += 60) for (const [k, v] of await this.entities(qids.slice(i, i + 60), lang, ctx)) facts.set(k, v);
    return buildCandidates([...pages.values()], facts, q, this.o.clock(), this.o.discoveryWiki);
  }
}

export function buildCandidates(pages: readonly GeoPage[], facts: ReadonlyMap<string, EntityFacts>, q: DiscoveryQuery, now: number, wiki = 'en'): PlaceCandidate[] {
  const out: PlaceCandidate[] = [];
  const seen = new Set<string>();
  for (const p of pages) {
    const co = p.coordinates?.[0];
    if (!co) continue;
    const qid = p.pageprops?.wikibase_item ?? null;
    const e = qid ? facts.get(qid) : undefined;
    if (e && e.instances.some((i) => NON_PLACE_P31.has(i))) continue;
    const hint = e ? kindFor(e.instances) : null;
    const kind: PlaceKind = hint?.kind ?? (e && e.sitelinks >= 20 ? 'landmark' : 'other');
    const ent: EntityFacts = e ?? { qid: qid ?? '', sitelinks: 0, instances: [], heritage: false, areaM2: null, population: null, label: null };
    const significance = significanceFor(ent, kind);
    if (significance < q.minSignificance) continue;
    if (q.kinds && !q.kinds.includes(kind)) continue;
    const location = { lat: co.lat, lng: co.lon };
    const extentM = extentFor(ent, kind);
    if (haversineM(q.center, location) - extentM > q.radiusM) continue;
    if (q.corridor && q.corridor.length >= 2 && q.radiusM > WIKIMEDIA.GEOSEARCH_MAX_RADIUS_M) {
      // corridor sub-queries: keep what lies within one sub-circle of the corridor
      if (projectOntoPolyline(location, q.corridor).crossTrackM - extentM > WIKIMEDIA.GEOSEARCH_MAX_RADIUS_M) continue;
    }
    const id = qid ? `wd:${qid}` : `wp:${wiki}:${p.pageid}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const tags = [kind, ...(hint ? [hint.tag] : []), ...(THEME[kind] ? [THEME[kind]!] : []), ...(ent.heritage ? ['heritage'] : [])];
    const sources: SourceRef[] = [{ provider: 'wikipedia', ref: `${wiki}:${p.title}`, license: 'CC BY-SA 4.0', retrievedAt: now }];
    if (qid) sources.push({ provider: 'wikidata', ref: qid, license: 'CC0', retrievedAt: now });
    out.push({
      id,
      name: ent.label ?? p.title,
      kind,
      location,
      extentM,
      significance,
      tags: [...new Set(tags)],
      externalRefs: { ...(qid ? { wikidataId: qid } : {}), wikipediaTitle: p.title },
      sources,
    });
  }
  // Provider order is irrelevant (ranking is core's job); sort by id for determinism.
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ─────────────────────────────────────────────── knowledge source

interface Summary {
  type?: string;
  title?: string;
  extract?: string;
  description?: string;
}

export interface ClaimFacts {
  inceptionYear: string | null;
  architects: string[];
  heightM: number | null;
  heritage: string | null;
  namedAfter: string | null;
  style: string | null;
}

export function claimsSparql(qid: string, lang: string): string {
  const lbl = (v: string) => `OPTIONAL { ${v} rdfs:label ${v}L . FILTER(LANG(${v}L) = "${lang}") } OPTIONAL { ${v} rdfs:label ${v}E . FILTER(LANG(${v}E) = "en") }`;
  return `SELECT (MIN(YEAR(?inc)) AS ?inception) (GROUP_CONCAT(DISTINCT COALESCE(?archL, ?archE); separator="|") AS ?architects) (MAX(?h) AS ?height) (SAMPLE(COALESCE(?herL, ?herE)) AS ?heritage) (SAMPLE(COALESCE(?namL, ?namE)) AS ?namedAfter) (SAMPLE(COALESCE(?styL, ?styE)) AS ?style) WHERE {
  BIND(wd:${qid} AS ?item)
  OPTIONAL { ?item wdt:P571 ?inc . }
  OPTIONAL { ?item wdt:P84 ?arch . ${lbl('?arch')} }
  OPTIONAL { ?item p:P2048/psn:P2048/wikibase:quantityAmount ?h . }
  OPTIONAL { ?item wdt:P1435 ?her . ${lbl('?her')} }
  OPTIONAL { ?item wdt:P138 ?nam . ${lbl('?nam')} }
  OPTIONAL { ?item wdt:P149 ?sty . ${lbl('?sty')} }
}`;
}

function parseClaims(b: SparqlBinding | undefined): ClaimFacts {
  const v = (k: string) => (b?.[k]?.value ?? '').trim();
  const h = Number(v('height'));
  const inc = v('inception');
  return {
    inceptionYear: /^-?\d{1,4}$/.test(inc) && Number(inc) > 0 ? String(Number(inc)) : null,
    architects: v('architects')
      .split('|')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !/^Q\d+$/.test(s))
      .slice(0, 2),
    heightM: Number.isFinite(h) && h > 0 && h < 10_000 ? Math.round(h) : null,
    heritage: v('heritage') && !/^Q\d+$/.test(v('heritage')) ? v('heritage') : null,
    namedAfter: v('namedAfter') && !/^Q\d+$/.test(v('namedAfter')) ? v('namedAfter') : null,
    style: v('style') && !/^Q\d+$/.test(v('style')) ? v('style') : null,
  };
}

const KIND_CUES: Array<{ kind: FactKind; re: RegExp }> = [
  { kind: 'architecture', re: /\b(design(ed)?|architect\w*|built|constructed|construction|tower|storey|floor|facade|façade|style|dome|span)\b|архитект\p{L}*|построен\p{L}*|проект\p{L}*|стил\p{L}*|этаж\p{L}*/iu },
  { kind: 'event', re: /\b(attack|war|battle|fire|opened|destroyed|collapsed|rebuilt|founded|established|dedicated|inaugurated)\b|открыт\p{L}*|основан\p{L}*|разрушен\p{L}*|войн\p{L}*|битв\p{L}*/iu },
  { kind: 'person', re: /\b(named after|born|died|lived|president|king|queen|poet|painter|writer)\b|назван\p{L}* в честь|родил\p{L}*|жил\p{L}*/iu },
  { kind: 'nature', re: /\b(river|lake|mountain|forest|species|elevation|valley|glacier)\b|рек\p{L}*|озер\p{L}*|гор\p{L}*|лес\p{L}*/iu },
  { kind: 'culture', re: /\b(museum|collection|art|painting|music|film|festival|theatre|theater)\b|музе\p{L}*|коллекц\p{L}*|искусств\p{L}*/iu },
  { kind: 'quantity', re: /\b(\d[\d,.]*\s*(m|km|metres|meters|feet|ft|square|hectares|acres|visitors|people)|tallest|largest|longest)\b|высот\p{L}*|площад\p{L}*|крупнейш\p{L}*/iu },
];

function classify(text: string, index: number): FactKind {
  if (index === 0) return 'identity';
  for (const c of KIND_CUES) if (c.re.test(text)) return c.kind;
  return /\b(1[0-9]{3}|20[0-9]{2})\b/.test(text) ? 'date' : 'trivia';
}

export function splitSummary(extract: string): string[] {
  return extract
    .replace(/\s+/g, ' ')
    .replace(/\s*\([^)]*\)/g, (m) => (/\d{3,4}/.test(m) ? m : '')) // drop pronunciation/alt-name parentheticals without years
    .split(/(?<=[.!?])\s+(?=[\p{Lu}"«(\d])/u)
    .map((s) => s.trim())
    .filter((s) => s.length >= 20 && s.length <= 400);
}

function fact(placeId: string, id: string, kind: FactKind, text: string, locale: Locale, confidence: number, source: SourceRef): EvidenceFact {
  return { id: `${placeId}#${id}`, placeId, kind, text, entities: extractEntities(text, locale), numbers: extractNumbers(text, locale), confidence, source };
}

export function claimFacts(placeId: string, name: string, c: ClaimFacts, locale: Locale, source: SourceRef): EvidenceFact[] {
  const ru = isRussian(locale);
  const out: EvidenceFact[] = [];
  if (c.inceptionYear) out.push(fact(placeId, 'inception', 'date', ru ? `История объекта «${name}» начинается в ${c.inceptionYear} году.` : `${name} dates from ${c.inceptionYear}.`, locale, 0.9, source));
  if (c.architects.length > 0) out.push(fact(placeId, 'architect', 'architecture', ru ? `Автор проекта — ${c.architects.join(' и ')}.` : `${name} was designed by ${c.architects.join(' and ')}.`, locale, 0.9, source));
  if (c.heightM) out.push(fact(placeId, 'height', 'quantity', ru ? `Высота — ${c.heightM} метров.` : `${name} is ${c.heightM} metres tall.`, locale, 0.85, source));
  if (c.heritage) out.push(fact(placeId, 'heritage', 'culture', ru ? `Статус объекта: ${c.heritage}.` : `${name} is listed as ${c.heritage}.`, locale, 0.9, source));
  if (c.namedAfter) out.push(fact(placeId, 'named_after', 'person', ru ? `Назван в честь: ${c.namedAfter}.` : `${name} is named after ${c.namedAfter}.`, locale, 0.9, source));
  if (c.style) out.push(fact(placeId, 'style', 'architecture', ru ? `Архитектурный стиль — ${c.style}.` : `Its architectural style is ${c.style}.`, locale, 0.85, source));
  return out;
}

export class WikimediaKnowledgeSource implements KnowledgeSource {
  readonly name = 'wikimedia';
  readonly model = 'api';
  private readonly o: Required<Omit<WikimediaOptions, 'fetchImpl' | 'discoveryWiki'>> & { fetchImpl?: FetchLike };

  constructor(opts: WikimediaOptions = {}) {
    this.o = { userAgent: opts.userAgent ?? wikimediaUserAgent(), timeoutMs: opts.timeoutMs ?? WIKIMEDIA.TIMEOUT_MS, clock: opts.clock ?? Date.now, ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}) };
  }

  private http(ctx?: CallContext) {
    return { provider: this.name, timeoutMs: this.o.timeoutMs, ...(this.o.fetchImpl ? { fetchImpl: this.o.fetchImpl } : {}), ...(ctx ? { ctx } : {}) };
  }

  private headers(accept = 'application/json'): Record<string, string> {
    return { 'User-Agent': this.o.userAgent, 'Api-User-Agent': this.o.userAgent, Accept: accept };
  }

  /** Localized article title via Wikidata sitelinks (falls back to the discovery title). */
  async titleFor(place: PlaceCandidate, lang: string, ctx?: CallContext): Promise<{ lang: string; title: string } | null> {
    const qid = place.externalRefs.wikidataId;
    if (qid && lang !== 'en') {
      const p = new URLSearchParams({ action: 'wbgetentities', format: 'json', ids: qid, props: 'sitelinks', sitefilter: `${lang}wiki|enwiki` });
      const res = await httpJson<{ entities?: Record<string, { sitelinks?: Record<string, { title: string }> }> }>(`https://www.wikidata.org/w/api.php?${p}`, { headers: this.headers() }, this.http(ctx));
      const sl = res.entities?.[qid]?.sitelinks;
      if (sl?.[`${lang}wiki`]) return { lang, title: sl[`${lang}wiki`]!.title };
      if (sl?.enwiki) return { lang: 'en', title: sl.enwiki.title };
    }
    const t = place.externalRefs.wikipediaTitle;
    return t ? { lang: 'en', title: t } : null;
  }

  async evidence(place: PlaceCandidate, locale: Locale, ctx?: CallContext): Promise<EvidencePack | null> {
    const lang = wikiLang(locale);
    const now = this.o.clock();
    const t = await this.titleFor(place, lang, ctx);
    const facts: EvidenceFact[] = [];
    let placeName = place.name;
    if (t) {
      const url = `https://${t.lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t.title.replace(/ /g, '_'))}`;
      const s = await httpJson<Summary>(url, { headers: this.headers() }, this.http(ctx));
      if (s.type !== 'disambiguation' && s.extract) {
        // Summary sentences are only usable as facts in the narration language.
        if (t.lang === lang) {
          const src: SourceRef = { provider: 'wikipedia', ref: `${t.lang}:${t.title}`, license: 'CC BY-SA 4.0', retrievedAt: now };
          splitSummary(s.extract)
            .slice(0, WIKIMEDIA.MAX_SUMMARY_SENTENCES)
            .forEach((sent, i) => facts.push(fact(place.id, `s${i + 1}`, classify(sent, i), sent, locale, i === 0 ? 0.85 : 0.8, src)));
          if (s.title) placeName = lang === 'ru' ? s.title : place.name;
        }
      }
    }
    const qid = place.externalRefs.wikidataId;
    if (qid) {
      const body = new URLSearchParams({ query: claimsSparql(qid, lang), format: 'json' });
      const res = await httpJson<{ results?: { bindings?: SparqlBinding[] } }>(
        WIKIMEDIA.SPARQL_URL,
        { method: 'POST', headers: { ...this.headers('application/sparql-results+json'), 'Content-Type': 'application/x-www-form-urlencoded' }, body },
        this.http(ctx),
      );
      const src: SourceRef = { provider: 'wikidata', ref: qid, license: 'CC0', retrievedAt: now };
      facts.push(...claimFacts(place.id, placeName, parseClaims(res.results?.bindings?.[0]), locale, src));
    }
    if (facts.length === 0) return null;
    return { placeId: place.id, placeName, facts, fetchedAt: now, thin: isThinFacts(facts) };
  }
}

/** Thin = fewer than two usable facts (same rule as the replay FixtureEvidence). */
export function isThinFacts(facts: readonly EvidenceFact[]): boolean {
  return facts.filter((f) => f.confidence >= 0.5).length < 2;
}
