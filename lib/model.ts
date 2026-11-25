// Token Launch Radar model (radar-2): one sealed snapshot in, one ranked board out.
//
// The question the board answers: a protocol records no token yet — what would a launch be
// worth if its record stayed as it is, and what should a reader do to farm it before then?
// Nothing here predicts whether or when a token is issued, and no protocol name is ever
// special-cased: the same functions score every row from the snapshot's own figures.
//
// Board membership (a stricter reading than the starter's, and the reason the screenshots
// and the code agree):
//   - pre-token: the record carries no token at all (mcap, gecko_id and symbol all null);
//   - not a wrapped, staked or bridged product of a token that already trades, not a CEX,
//     not a versioned pool of another protocol, not an exchange-branded product — the same
//     exclusions the snapshot's own watchlist rule uses, applied to the whole universe;
//   - every watchlist slug is included (the floor), plus every other protocol that passes
//     the same test (the early radar): 198 rows on this snapshot, no arbitrary cap.
// Live-token protocols are never ranked: they are set aside as the peer set that prices the
// pre-token board, and the dashboard shows them separately with the market's own values.
//
// Implied value, per protocol p:
//   peerMultiple(p)  median mcap/TVL of live-token protocols in p's category (at least 3
//                    peers), shrunk toward the global live median by sample size and
//                    clamped to [0.05, 2.50]; the global median when a category has no
//                    usable peer set. This anchors a launch claim to what the market
//                    actually pays for a dollar of TVL in the same line of business.
//   base             = tvl_usd x peerMultiple
//   growthMult       = 1 + clamp(change_7d, -50, 100)/100 x 0.6  (unreported 7d change
//                    scores 0.97: silence is a small discount, never free momentum)
//   maturityMult     = 0.65 + min(age_days, 1460)/1460 x 0.5  (a longer no-token track
//                    record is worth more; unknown listing date scores as 365 days)
//   breadthMult      = 1 + min(chains - 1, 7) x 0.03  (distribution across chains)
//   implied_value    = round(base x growthMult x maturityMult x breadthMult), at least $1
//
// Confidence (0-100, shown on the board, never inside the price): completeness of the
// record (7d change and listing date reported), TVL scale, peer-set size and chain
// breadth. A thin record can still rank; the reader can see how much to trust the number.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, stated in the dashboard so a reader can re-run the claim. */
export interface ModelConstants {
  peer_min_peers: number;
  peer_shrink_prior: number;
  peer_floor: number;
  peer_cap: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  growth_unreported: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_extra_chains: number;
}

export const MODEL: ModelConstants = {
  peer_min_peers: 3,
  peer_shrink_prior: 3,
  peer_floor: 0.05,
  peer_cap: 2.5,
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 100,
  growth_unreported: 0.97,
  maturity_floor: 0.65,
  maturity_range: 0.5,
  maturity_days: 1460,
  unknown_age_days: 365,
  breadth_per_chain: 0.03,
  breadth_max_extra_chains: 7,
};

/** The model's version label: the dashboard names it beside the formula. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the dashboard's Live set-aside view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One row of board.json: the ranked board's row, with the full model breakdown attached. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  confidence: number;
  model: {
    peer_multiple: number;
    peer_count: number;
    peer_source: 'category' | 'global';
    growth_pct: number | null;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's view of one row: everything the page renders, farm plan included. */
export interface RadarRow extends BoardRow {}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_tvl: number | null;
}

/** One category's peer pricing: how the market values a TVL dollar in that line of work. */
export interface PeerStat {
  category: string;
  peers: number;
  median_multiple: number;
}

/** Everything the dashboard needs: the board, the live set, the peer table and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  scanned_size: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  global_peer_multiple: number;
  total_implied_usd: number;
  median_implied_usd: number;
  peers: PeerStat[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** A whole day count from `listedAt` to `asOf`, clamped at zero; null when either is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list of numbers. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/**
 * Whether a pre-token protocol is a launch candidate of its own, rather than a wrapped,
 * staked, bridged or versioned product of a protocol whose token already trades. This is
 * the watchlist rule's own test, applied to every protocol, not only those above the floor.
 */
export function isLaunchCandidate(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name) || WRAPPED_WORD.test(p.name) || EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** The peer pricing of the whole snapshot: per-category medians plus the global median. */
export interface PeerPricing {
  global: number;
  byCategory: Map<string, PeerStat>;
}

export function peerPricing(snapshot: Snapshot, model: ModelConstants = MODEL): PeerPricing {
  const ratios: number[] = [];
  const byCat = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    ratios.push(ratio);
    if (p.category !== null) {
      const list = byCat.get(p.category) ?? [];
      list.push(ratio);
      byCat.set(p.category, list);
    }
  }
  const global = ratios.length > 0 ? clamp(median(ratios), model.peer_floor, model.peer_cap) : model.peer_floor;
  const byCategory = new Map<string, PeerStat>();
  for (const [category, list] of byCat) {
    byCategory.set(category, { category, peers: list.length, median_multiple: round4(median(list)) });
  }
  return { global, byCategory };
}

/** The peer multiple one protocol is priced with, and where it came from. */
export function peerMultipleFor(p: SnapshotProtocol, pricing: PeerPricing, model: ModelConstants = MODEL): { multiple: number; peers: number; source: 'category' | 'global' } {
  const stat = p.category !== null ? pricing.byCategory.get(p.category) : undefined;
  if (stat !== undefined && stat.peers >= model.peer_min_peers) {
    const shrunk = (stat.peers * stat.median_multiple + model.peer_shrink_prior * pricing.global) / (stat.peers + model.peer_shrink_prior);
    return { multiple: round4(clamp(shrunk, model.peer_floor, model.peer_cap)), peers: stat.peers, source: 'category' };
  }
  return { multiple: round4(pricing.global), peers: stat?.peers ?? 0, source: 'global' };
}

/** A 0-100 confidence in the row's number, from the record's own completeness and scale. */
export function confidenceFor(p: SnapshotProtocol, age: number | null, peers: number): number {
  let score = 30;
  if (p.change_7d !== null) score += 15;
  if (age !== null) score += 15;
  if (p.tvl_usd >= 1_000_000_000) score += 20;
  else if (p.tvl_usd >= 100_000_000) score += 15;
  else if (p.tvl_usd >= 50_000_000) score += 10;
  else score += 5;
  if (peers >= 8) score += 12;
  else if (peers >= 3) score += 8;
  else if (peers >= 1) score += 4;
  score += Math.min(p.chains.length - 1, 4) * 2;
  return Math.min(100, score);
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  pricing: PeerPricing,
  model: ModelConstants = MODEL,
): { implied: number; peer: ReturnType<typeof peerMultipleFor>; growthPct: number | null; growthMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, p.listed_at);
  const peer = peerMultipleFor(p, pricing, model);
  let growthMult: number;
  let growthPct: number | null;
  if (p.change_7d === null) {
    growthMult = model.growth_unreported;
    growthPct = null;
  } else {
    growthPct = clamp(p.change_7d, model.growth_floor, model.growth_cap);
    growthMult = 1 + (growthPct / 100) * model.growth_weight;
  }
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const breadthMult = 1 + Math.min(Math.max(p.chains.length - 1, 0), model.breadth_max_extra_chains) * model.breadth_per_chain;
  const implied = Math.max(1, Math.round(p.tvl_usd * peer.multiple * growthMult * maturityMult * breadthMult));
  return { implied, peer, growthPct, growthMult, maturityMult, breadthMult, age };
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Gas for one transaction on a chain class: Ethereum mainnet is dear, rollups are not. */
function gasFor(chain: string): string {
  if (chain === 'Ethereum') return 'about $12 of gas';
  if (chain === 'Bitcoin' || chain === 'BSC' || chain === 'Binance') return 'about $3 of gas';
  return 'about $1 of gas';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 250_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's core action, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC as collateral to ${name} on ${chain}, then borrow a small amount against it so both sides of the market see the wallet`;
  if (c.includes('dex')) return `Provide $${capital} split between USDC and the pool's paired asset in ${name}'s main ${chain} pool, inside the active price range`;
  if (c.includes('yield') || c.includes('farm')) return `Deposit $${capital} of USDC into ${name}'s highest-TVL vault on ${chain} and keep the vault shares in the same wallet`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name}, then spend the bridged funds inside its app instead of bridging straight back`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the staking receipt unspent`;
  if (c.includes('derivative') || c.includes('perpetual')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position, half long and half short`;
  if (c.includes('prediction')) return `Fund $${capital} on ${name} and take one position in its most liquid market, sized under 5% of that market`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} curated vault on ${chain} and keep the shares through at least two rebalances`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold the minted balance`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield asset on ${chain} and hold it past the first yield distribution`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} for a position you actually hold, and keep the policy to expiry`;
  if (c.includes('basis')) return `Open ${name}'s basis position with $${capital} on ${chain}: spot long and perpetual short in equal size`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} through its main vault or pool and keep the position open`;
}

/** The category's second, diversifying action for step three. */
function secondActionFor(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp')) return `Repay and re-borrow once mid-way so the wallet shows a full lending cycle, not a single deposit`;
  if (c.includes('dex')) return `Make two swaps a week in ${p.name}'s main pool on ${chain}, alternating direction, so the wallet reads as a trader and not only a provider`;
  if (c.includes('bridge')) return `Repeat the bridge run on a second route or a second week, so the wallet has crossings in more than one period`;
  if (c.includes('staking') || c.includes('restak')) return `Claim rewards once and restake them in the same wallet, so the compounding is visible on the record`;
  return `Use one second feature of ${p.name} on ${chain} — a vote, a claim page visit with a signed message, or a smaller second position — so the wallet is not a one-action address`;
}

/**
 * A protocol's farm plan: seven steps, each an action with its cost and its time, derived
 * from the protocol's own record (category, chains, TVL, age), never a hand-written list.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  const steps = [
    `Set up a fresh wallet for ${p.name} only, fund it from your main wallet in one transfer, and store its seed phrase offline. Cost: ${gas} for the funding transfer. Time: 10 minutes.`,
    `${actionFor(p, capital, chain)}. Cost: $${capital} of capital plus ${gas}. Time: 15 minutes to set up.`,
    `${secondActionFor(p, chain)}. Cost: about $2 of gas a week on ${chain}. Time: 10 minutes a week.`,
    `Repeat one qualifying action every week for the whole window — a deposit, a swap, a borrow or a claim — so activity lands in at least four separate weeks. Cost: about $2 of gas a week. Time: 10 minutes a week.`,
    `Hold the position for at least ${hold} days without moving it to another wallet, so it is counted in more than one activity snapshot. Cost: the $${capital} stays in the position. Time: ${hold} days.`,
    `Once a week, open ${p.name}'s own points, rewards or governance page and check the wallet's standing; claim only from a link the protocol itself publishes. Cost: no fee to check, and never pay anyone to claim. Time: 5 minutes a week.`,
    `Log the wallet, the dates and every transaction hash in a farm log; to exit, withdraw in the app's own unwind flow and bridge back last. Cost: ${gas} to unwind. Time: 15 minutes.`,
  ];
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const pricing = peerPricing(snapshot, model);
  const watch = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter((p) => watch.has(p.slug) || isLaunchCandidate(p));
  const scored = chosen.map((p) => {
    const v = impliedValue(p, snapshot.as_of, pricing, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    on_watchlist: watch.has(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    confidence: confidenceFor(s.p, s.age, s.peer.peers),
    model: {
      peer_multiple: s.peer.multiple,
      peer_count: s.peer.peers,
      peer_source: s.peer.source,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's set-aside view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const pricing = peerPricing(snapshot, model);
  const live = liveRows(snapshot);
  const impliedSorted = board.map((r) => r.implied_value_usd).sort((a, b) => a - b);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    scanned_size: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.on_watchlist).length,
    live_size: snapshot.protocols.filter((p) => !isPreToken(p)).length,
    global_peer_multiple: round4(pricing.global),
    total_implied_usd: board.reduce((sum, r) => sum + r.implied_value_usd, 0),
    median_implied_usd: impliedSorted.length > 0 ? impliedSorted[Math.floor(impliedSorted.length / 2)]! : 0,
    peers: [...pricing.byCategory.values()].filter((s) => s.peers >= model.peer_min_peers).sort((a, b) => b.peers - a.peers).slice(0, 10),
    rows: board,
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows, under the 100-row floor`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (slugs.size !== board.length) return 'a slug appears twice on the board';
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
