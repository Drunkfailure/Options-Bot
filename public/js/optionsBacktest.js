/**
 * Historical options backtest: use options history + contract selection (IV, Greeks, liquidity).
 * Requires: contractCriteria.js (selectContracts, enrichContractFromSnapshot-style), indicators.js (realizedVolatility).
 * For historical bars we don't have greeks/IV from API; we compute IV and delta via Black-Scholes from option price and underlying.
 */

/** Cumulative normal distribution approximation */
function normCdf(x) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1.0 + sign * y);
}

function blackScholesD1(S, K, T, r, sigma) {
  if (T <= 0 || sigma <= 0) return null;
  return (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / (sigma * Math.sqrt(T));
}

function blackScholesCallPrice(S, K, T, r, sigma) {
  const d1 = blackScholesD1(S, K, T, r, sigma);
  if (d1 == null) return null;
  const d2 = d1 - sigma * Math.sqrt(T);
  return S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2);
}

function blackScholesPutPrice(S, K, T, r, sigma) {
  const d1 = blackScholesD1(S, K, T, r, sigma);
  if (d1 == null) return null;
  const d2 = d1 - sigma * Math.sqrt(T);
  return K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1);
}

function blackScholesDelta(S, K, T, r, sigma, call) {
  const d1 = blackScholesD1(S, K, T, r, sigma);
  if (d1 == null) return null;
  return call ? normCdf(d1) : normCdf(d1) - 1;
}

/** Solve for implied volatility (annual) given option price. Bisection; max 50 iterations. */
function impliedVolatility(optionPrice, S, K, T, call, r = 0.05) {
  if (T <= 0 || optionPrice <= 0 || S <= 0 || K <= 0) return null;
  let low = 0.001, high = 3;
  const price = (sig) => (call ? blackScholesCallPrice(S, K, T, r, sig) : blackScholesPutPrice(S, K, T, r, sig));
  for (let i = 0; i < 50; i++) {
    const mid = (low + high) / 2;
    const p = price(mid);
    if (p == null) return null;
    const diff = p - optionPrice;
    if (Math.abs(diff) < 0.0001) return mid;
    if (diff > 0) high = mid;
    else low = mid;
  }
  return (low + high) / 2;
}

/**
 * Build enriched contract from historical option bar (no snapshot).
 * contract: { symbol, expiration_date, strike_price, type: 'call'|'put' }
 * bar: { c, v } (close, volume)
 * underlyingClose: S for that bar date
 * barDate: Date or ISO string for T
 */
function enrichContractFromHistoricalBar(contract, bar, underlyingClose, barDate) {
  const S = Number(underlyingClose);
  const K = Number(contract.strike_price);
  const expDate = new Date(contract.expiration_date);
  const d = typeof barDate === "string" ? new Date(barDate) : barDate;
  const T = Math.max(0, (expDate - d) / (365 * 24 * 60 * 60 * 1000));
  const call = contract.type === "call";
  const optionPrice = Number(bar.c);
  const r = 0.05;
  const iv = impliedVolatility(optionPrice, S, K, T, call, r);
  const delta = iv != null ? blackScholesDelta(S, K, T, r, iv, call) : null;
  const volume = bar.v != null ? Number(bar.v) : 0;
  return {
    symbol: contract.symbol,
    call,
    iv,
    delta,
    gamma: null,
    theta: null,
    vega: null,
    bidAskSpread: null,
    openInterest: null,
    volume,
    bid: null,
    ask: null,
    last: optionPrice,
    strike: K,
    expiration_date: contract.expiration_date,
  };
}

/**
 * Index option bars by date string (YYYY-MM-DD) for fast lookup.
 * optionsBarsBySymbol: { [optionSymbol]: [ { t, o, h, l, c, v } ] } sorted by t
 * Returns: { [dateStr]: { [optionSymbol]: { c, v } } }
 */
function indexOptionsBarsByDate(optionsBarsBySymbol) {
  const byDate = {};
  for (const [sym, bars] of Object.entries(optionsBarsBySymbol || {})) {
    for (const b of bars) {
      const t = b.t;
      const dateStr = t ? t.slice(0, 10) : "";
      if (!dateStr) continue;
      if (!byDate[dateStr]) byDate[dateStr] = {};
      byDate[dateStr][sym] = { c: b.c, v: b.v ?? 0 };
    }
  }
  return byDate;
}

/**
 * Get bar date string (YYYY-MM-DD) from bar time.
 */
function barDateStr(bar) {
  const t = bar.t;
  return t ? String(t).slice(0, 10) : "";
}

/**
 * Pick best option contract at this bar using current options logic (selectContracts).
 * stockBar: { t, c } (underlying close)
 * optionBarsAtDate: { [symbol]: { c, v } }
 * contracts: array of { symbol, expiration_date, strike_price, type }
 * optionType: 'call' | 'put' — sets delta criteria (calls 0.2–0.8, puts -0.8 to -0.2)
 * Returns selected contract symbol or null.
 */
function pickBestOptionAtBar(stockBar, optionBarsAtDate, contracts, criteria, optionType) {
  if (!optionBarsAtDate || !contracts.length) return null;
  const type = (optionType || "call").toLowerCase();
  const isPut = type === "put";
  const dateStr = barDateStr(stockBar);
  const S = stockBar.c;
  const enriched = [];
  for (const contract of contracts) {
    const bar = optionBarsAtDate[contract.symbol];
    if (!bar || bar.c == null || bar.c <= 0) continue;
    const c = enrichContractFromHistoricalBar(contract, bar, S, dateStr);
    if (c.delta != null && c.iv != null) enriched.push(c);
  }
  if (!enriched.length) return null;
  const criteriaAdjusted = isPut
    ? { minDelta: -0.8, maxDelta: -0.2, minDeltaAbs: 0.15, minVolume: 0, maxBidAskSpreadPct: 100, ...criteria }
    : { minDelta: 0.2, maxDelta: 0.8, minDeltaAbs: 0.15, minVolume: 0, maxBidAskSpreadPct: 100, ...criteria };
  const selected = typeof selectContracts === "function" ? selectContracts(enriched, criteriaAdjusted) : enriched.sort((a, b) => (b.volume || 0) - (a.volume || 0));
  return selected.length ? selected[0].symbol : null;
}
