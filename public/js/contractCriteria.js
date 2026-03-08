/**
 * Contract selection criteria for bots: IV (rank, percentile, vs realized), Greeks, liquidity.
 * Used in historical backtesting and (when implemented) live trading to choose which option contracts to trade.
 *
 * Alpaca snapshot: greeks (delta, gamma, theta, vega), impliedVolatility, latestQuote (bp, ap), latestTrade (p, s),
 * dailyBar (v = volume). Open interest is not in Alpaca snapshot — use null or external source.
 */

/** OCC symbol: call ends with C + 8-digit strike, put with P */
function isCall(occSymbol) {
  const s = String(occSymbol);
  if (s.length < 9) return false;
  return s.charAt(s.length - 9) === "C";
}

/**
 * IV rank = (current IV - 52w low) / (52w high - 52w low) * 100.
 * historicalIvSeries: array of IV values (e.g. daily IV over last 252 days). Decimals (e.g. 0.30 for 30%).
 */
function computeIvRank(currentIv, historicalIvSeries) {
  if (currentIv == null || !historicalIvSeries?.length) return null;
  const valid = historicalIvSeries.filter((v) => v != null && Number.isFinite(v));
  if (valid.length === 0) return null;
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  if (max === min) return 50;
  return Math.max(0, Math.min(100, ((currentIv - min) / (max - min)) * 100));
}

/**
 * IV percentile = % of observations in history that are below current IV.
 */
function computeIvPercentile(currentIv, historicalIvSeries) {
  if (currentIv == null || !historicalIvSeries?.length) return null;
  const valid = historicalIvSeries.filter((v) => v != null && Number.isFinite(v));
  if (valid.length === 0) return null;
  const below = valid.filter((v) => v < currentIv).length;
  return (below / valid.length) * 100;
}

/**
 * Enrich one contract from Alpaca snapshot entry.
 * Optional: realizedVol (annualized), historicalIvSeries (array of IVs for same underlying/expiry).
 * Returns object with all metrics bots use for selection (nulls where unavailable).
 */
function enrichContractFromSnapshot(snap, occSymbol, options = {}) {
  const { realizedVol = null, historicalIvSeries = null } = options;
  const q = snap.latestQuote || {};
  const g = snap.greeks || {};
  const bid = q.bp != null ? Number(q.bp) : null;
  const ask = q.ap != null ? Number(q.ap) : null;
  const iv = snap.impliedVolatility != null ? Number(snap.impliedVolatility) : null;
  const dailyBar = snap.dailyBar || {};
  const volume = dailyBar.v != null ? Number(dailyBar.v) : (snap.latestTrade?.s != null ? Number(snap.latestTrade.s) : null);

  const bidAskSpread = bid != null && ask != null ? ask - bid : null;
  const ivRank = iv != null ? computeIvRank(iv, historicalIvSeries) : null;
  const ivPercentile = iv != null ? computeIvPercentile(iv, historicalIvSeries) : null;
  let ivVsRealized = null;
  if (iv != null && realizedVol != null && realizedVol > 0) {
    ivVsRealized = iv / realizedVol; // ratio; >1 means IV above realized
  }

  return {
    symbol: occSymbol,
    call: isCall(occSymbol),
    // Implied volatility
    iv,
    ivRank,
    ivPercentile,
    ivVsRealized,
    // Greeks
    delta: g.delta != null ? Number(g.delta) : null,
    gamma: g.gamma != null ? Number(g.gamma) : null,
    theta: g.theta != null ? Number(g.theta) : null,
    vega: g.vega != null ? Number(g.vega) : null,
    // Liquidity
    bidAskSpread,
    openInterest: null, // Alpaca snapshot does not provide; plug from elsewhere if needed
    volume,
    bid,
    ask,
    last: snap.latestTrade?.p != null ? Number(snap.latestTrade.p) : null,
  };
}

/**
 * Enrich full snapshot map into array of enriched contracts.
 * underlyingBars: optional array of { close } for realized vol (e.g. last 20 days).
 * historicalIvBySymbol: optional Map<occSymbol, number[]> for IV rank/percentile per contract.
 */
function enrichSnapshotContracts(snapshots, options = {}) {
  const { underlyingBars = [], historicalIvBySymbol = null } = options;
  let realizedVol = null;
  if (typeof realizedVolatility === "function" && underlyingBars.length) {
    const closes = underlyingBars.map((b) => b.close);
    realizedVol = realizedVolatility(closes, Math.min(20, closes.length));
  }
  const contracts = [];
  for (const [sym, snap] of Object.entries(snapshots || {})) {
    const histIv = historicalIvBySymbol?.get?.(sym) ?? null;
    const c = enrichContractFromSnapshot(snap, sym, { realizedVol, historicalIvSeries: histIv });
    contracts.push(c);
  }
  return contracts;
}

/**
 * Default criteria limits used by bots when selecting contracts (backtest and live).
 * Bots can override these per strategy.
 */
const DEFAULT_CRITERIA = {
  // Liquidity: avoid wide spreads and zero volume
  maxBidAskSpreadPct: 20,       // max spread as % of mid (e.g. 20 = 20%)
  minVolume: 0,
  minOpenInterest: 0,           // ignored if OI always null
  // IV: optional caps (e.g. avoid selling when IV rank too high)
  maxIvRank: 100,
  maxIvPercentile: 100,
  // Greeks: optional bounds (e.g. delta for directional plays)
  minDelta: -1,
  maxDelta: 1,
  minDeltaAbs: null,             // e.g. 0.15 to avoid deep ITM/OTM
  // IV vs realized: e.g. only sell when IV > realized (ivVsRealized >= 1)
  minIvVsRealized: null,
  maxIvVsRealized: null,
};

/**
 * Score a single contract for bot selection (higher = better for typical use).
 * Penalizes wide spread, zero volume; can favor certain delta/IV. Bots may use score to rank then pick top N.
 */
function scoreContract(c, criteria = {}) {
  const cr = { ...DEFAULT_CRITERIA, ...criteria };
  let score = 100;
  const mid = c.bid != null && c.ask != null ? (c.bid + c.ask) / 2 : c.last;
  if (mid != null && mid > 0 && c.bidAskSpread != null) {
    const spreadPct = (c.bidAskSpread / mid) * 100;
    if (spreadPct > cr.maxBidAskSpreadPct) score -= (spreadPct - cr.maxBidAskSpreadPct) * 2;
  }
  if (c.volume != null && c.volume < cr.minVolume) score -= 30;
  if (c.openInterest != null && c.openInterest < cr.minOpenInterest) score -= 20;
  if (c.ivRank != null && c.ivRank > cr.maxIvRank) score -= 10;
  if (c.ivPercentile != null && c.ivPercentile > cr.maxIvPercentile) score -= 10;
  if (c.delta != null) {
    if (c.delta < cr.minDelta || c.delta > cr.maxDelta) score -= 25;
    if (cr.minDeltaAbs != null && Math.abs(c.delta) < cr.minDeltaAbs) score -= 15;
  }
  if (c.ivVsRealized != null) {
    if (cr.minIvVsRealized != null && c.ivVsRealized < cr.minIvVsRealized) score -= 15;
    if (cr.maxIvVsRealized != null && c.ivVsRealized > cr.maxIvVsRealized) score -= 15;
  }
  return score;
}

/**
 * Filter and rank contracts for bot use (backtest or live).
 * Returns list of enriched contracts that pass criteria, sorted by score descending.
 */
function selectContracts(enrichedContracts, criteria = {}) {
  const cr = { ...DEFAULT_CRITERIA, ...criteria };
  const filtered = enrichedContracts.filter((c) => {
    if (c.bidAskSpread != null && cr.maxBidAskSpreadPct != null) {
      const mid = (c.bid + c.ask) / 2;
      if (mid > 0 && (c.bidAskSpread / mid) * 100 > cr.maxBidAskSpreadPct) return false;
    }
    if (cr.minVolume != null && (c.volume ?? 0) < cr.minVolume) return false;
    if (cr.minOpenInterest != null && (c.openInterest ?? 0) < cr.minOpenInterest) return false;
    if (c.ivRank != null && cr.maxIvRank != null && c.ivRank > cr.maxIvRank) return false;
    if (c.ivPercentile != null && cr.maxIvPercentile != null && c.ivPercentile > cr.maxIvPercentile) return false;
    if (c.delta != null) {
      if (c.delta < cr.minDelta || c.delta > cr.maxDelta) return false;
      if (cr.minDeltaAbs != null && Math.abs(c.delta) < cr.minDeltaAbs) return false;
    }
    if (c.ivVsRealized != null) {
      if (cr.minIvVsRealized != null && c.ivVsRealized < cr.minIvVsRealized) return false;
      if (cr.maxIvVsRealized != null && c.ivVsRealized > cr.maxIvVsRealized) return false;
    }
    return true;
  });
  return filtered
    .map((c) => ({ ...c, _score: scoreContract(c, cr) }))
    .sort((a, b) => (b._score ?? 0) - (a._score ?? 0));
}
