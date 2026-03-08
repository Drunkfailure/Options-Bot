/**
 * Technical indicators for bot strategy (SMA, EMA, RSI, MACD, Bollinger, VWAP).
 * Input: array of bars with { close, high?, low?, volume?, vwap? } (close required).
 */

function sma(closes, period) {
  if (!closes.length || period < 1) return [];
  const out = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { out.push(null); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += closes[j];
    out.push(sum / period);
  }
  return out;
}

function ema(closes, period) {
  if (!closes.length || period < 1) return [];
  const mult = 2 / (period + 1);
  const out = [closes[0]];
  for (let i = 1; i < closes.length; i++) {
    out.push((closes[i] - out[i - 1]) * mult + out[i - 1]);
  }
  return out;
}

function rsi(closes, period = 14) {
  if (!closes.length || period < 1) return [];
  const out = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period) { out.push(null); continue; }
    let gainSum = 0, lossSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const ch = closes[j] - closes[j - 1];
      if (ch > 0) gainSum += ch; else lossSum -= ch;
    }
    const avgGain = gainSum / period, avgLoss = lossSum / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    out.push(100 - 100 / (1 + rs));
  }
  return out;
}

function macdLine(closes, fast = 12, slow = 26) {
  const fastEma = ema(closes, fast);
  const slowEma = ema(closes, slow);
  return fastEma.map((f, i) => (f != null && slowEma[i] != null) ? f - slowEma[i] : null);
}

/** MACD line, signal line (EMA of MACD), and histogram. */
function macdWithSignal(closes, fast = 12, slow = 26, signalPeriod = 9) {
  const line = macdLine(closes, fast, slow);
  const validLine = line.map((v) => (v != null ? v : 0));
  const signal = ema(validLine, signalPeriod);
  const histogram = line.map((v, i) => (v != null && signal[i] != null ? v - signal[i] : null));
  return { line, signal, histogram };
}

function stdDev(arr, period, endIdx) {
  const start = endIdx - period + 1;
  const slice = arr.slice(start, endIdx + 1).filter((x) => x != null);
  if (slice.length < period) return null;
  const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
  const sq = slice.reduce((a, b) => a + (b - avg) ** 2, 0) / slice.length;
  return Math.sqrt(sq);
}

function bollinger(closes, period = 20, mult = 2) {
  const mid = sma(closes, period);
  const upper = [];
  const lower = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1 || mid[i] == null) {
      upper.push(null);
      lower.push(null);
      continue;
    }
    const sd = stdDev(closes, period, i);
    if (sd == null) { upper.push(null); lower.push(null); continue; }
    upper.push(mid[i] + mult * sd);
    lower.push(mid[i] - mult * sd);
  }
  return { mid, upper, lower };
}

function vwapFromBars(bars) {
  if (!bars.length) return [];
  const out = [];
  let cumTpV = 0, cumV = 0;
  for (const b of bars) {
    const tp = (b.high != null && b.low != null) ? (b.high + b.low + b.close) / 3 : b.close;
    const v = Number(b.volume) || 0;
    cumTpV += tp * v;
    cumV += v;
    out.push(cumV > 0 ? cumTpV / cumV : b.vwap != null ? b.vwap : b.close);
  }
  return out;
}

function last(arr) {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i];
  return null;
}

/**
 * Annualized realized volatility from close prices (log returns, 252 trading days).
 * period: number of closes to use (e.g. 20 for ~1 month).
 * Returns null if insufficient data.
 */
function realizedVolatility(closes, period = 20) {
  if (!closes.length || period < 2) return null;
  const start = Math.max(0, closes.length - period);
  const slice = closes.slice(start).filter((x) => x != null && x > 0);
  if (slice.length < 2) return null;
  const logReturns = [];
  for (let i = 1; i < slice.length; i++) logReturns.push(Math.log(slice[i] / slice[i - 1]));
  const n = logReturns.length;
  const mean = logReturns.reduce((a, b) => a + b, 0) / n;
  const variance = logReturns.reduce((a, r) => a + (r - mean) ** 2, 0) / n;
  const dailyVol = Math.sqrt(variance);
  return dailyVol * Math.sqrt(252);
}

function slope(arr, lookback = 5) {
  if (!arr.length || lookback < 2) return null;
  const start = Math.max(0, arr.length - lookback);
  const slice = arr.slice(start).filter((x) => x != null);
  if (slice.length < 2) return null;
  const n = slice.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += slice[i];
    sumXY += i * slice[i];
    sumX2 += i * i;
  }
  const den = n * sumX2 - sumX * sumX;
  return den === 0 ? null : (n * sumXY - sumX * sumY) / den;
}

/** Rolling slope at each index (for chart series). lookback points used per slope. */
function slopeSeries(arr, lookback = 5) {
  if (!arr.length || lookback < 2) return arr.map(() => null);
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const start = Math.max(0, i - lookback + 1);
    const slice = arr.slice(start, i + 1).filter((x) => x != null);
    if (slice.length < 2) { out.push(null); continue; }
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let j = 0; j < slice.length; j++) {
      sumX += j;
      sumY += slice[j];
      sumXY += j * slice[j];
      sumX2 += j * j;
    }
    const n = slice.length;
    const den = n * sumX2 - sumX * sumX;
    out.push(den === 0 ? null : (n * sumXY - sumX * sumY) / den);
  }
  return out;
}

/**
 * Compute all selected indicator values from bars (array of { close, high, low, volume, vwap }).
 * selected: { priceOverEma50, priceOverEma200, ema20MinusEma50, emaSlope, rsi, rsiSlope, rsiDivergence, rsiDistanceFrom50, macdLine, bollinger, vwap }
 */
function computeIndicators(bars, selected = {}) {
  const closes = bars.map((b) => b.close);
  const result = {};
  if (closes.length === 0) return result;

  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const price = closes[closes.length - 1];

  if (selected.priceOverEma50) {
    const e50 = last(ema50);
    result.priceOverEma50 = e50 != null && e50 !== 0 ? (price / e50).toFixed(4) : "—";
  }
  if (selected.priceOverEma200) {
    const e200 = last(ema200);
    result.priceOverEma200 = e200 != null && e200 !== 0 ? (price / e200).toFixed(4) : "—";
  }
  if (selected.ema20MinusEma50) {
    const e20 = last(ema20), e50 = last(ema50);
    result.ema20MinusEma50 = e20 != null && e50 != null ? (e20 - e50).toFixed(2) : "—";
  }
  if (selected.emaSlope) {
    result.emaSlope = slope(ema20.filter((x) => x != null), 5)?.toFixed(4) ?? "—";
  }

  const rsiSeries = rsi(closes, 14);
  const rsiVal = last(rsiSeries);
  if (selected.rsi) result.rsi = rsiVal != null ? rsiVal.toFixed(2) : "—";
  if (selected.rsiSlope) result.rsiSlope = slope(rsiSeries.filter((x) => x != null), 5)?.toFixed(4) ?? "—";
  if (selected.rsiDistanceFrom50) result.rsiDistanceFrom50 = rsiVal != null ? (rsiVal - 50).toFixed(2) : "—";
  if (selected.rsiDivergence) {
    result.rsiDivergence = "—";
  }

  if (selected.macdLine) {
    const macd = macdLine(closes);
    result.macdLine = last(macd)?.toFixed(4) ?? "—";
  }

  if (selected.bollinger) {
    const bb = bollinger(closes, 20, 2);
    const mid = last(bb.mid), upper = last(bb.upper), lower = last(bb.lower);
    result.bollingerMid = mid?.toFixed(2) ?? "—";
    result.bollingerUpper = upper?.toFixed(2) ?? "—";
    result.bollingerLower = lower?.toFixed(2) ?? "—";
  }

  if (selected.vwap) {
    const vw = vwapFromBars(bars);
    result.vwap = last(vw)?.toFixed(2) ?? "—";
  }

  return result;
}

/**
 * Compute indicator signals for strategy/backtest and UI.
 * Returns: { ema, rsi, macd, bollinger, vwap } with human-readable signal labels and metadata.
 */
function computeIndicatorSignals(bars) {
  const closes = bars.map((b) => b.close);
  const result = { ema: {}, rsi: {}, macd: {}, bollinger: {}, vwap: {} };
  if (closes.length < 2) return result;

  const n = closes.length;
  const price = closes[n - 1];
  const prevPrice = closes[n - 2];

  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const e20 = last(ema20);
  const e50 = last(ema50);
  const e20Prev = ema20[n - 2];
  const e50Prev = ema50[n - 2];

  if (e20 != null && e50 != null && e20Prev != null && e50Prev != null) {
    if (e20Prev <= e50Prev && e20 > e50) result.ema.goldenCross = true;
    if (e20Prev >= e50Prev && e20 < e50) result.ema.deathCross = true;
  }
  if (e20 != null && e20 !== 0) result.ema.priceDistanceEma20 = (price - e20) / e20;
  if (e50 != null && e50 !== 0) result.ema.priceDistanceEma50 = (price - e50) / e50;
  const e200 = last(ema(closes, 200));
  if (e200 != null && e200 !== 0) result.ema.priceDistanceEma200 = (price - e200) / e200;

  const rsiSeries = rsi(closes, 14);
  const rsiVal = last(rsiSeries);
  if (rsiVal != null) {
    result.rsi.value = rsiVal;
    if (rsiVal > 70) result.rsi.zone = "overbought";
    else if (rsiVal < 30) result.rsi.zone = "oversold";
    else result.rsi.zone = "neutral";
  }

  const macdData = macdWithSignal(closes, 12, 26, 9);
  const macdLineLast = last(macdData.line);
  const signalLast = last(macdData.signal);
  const histLast = last(macdData.histogram);
  const histPrev = macdData.histogram[n - 2];
  if (macdLineLast != null && signalLast != null) {
    const linePrev = macdData.line[n - 2];
    const sigPrev = macdData.signal[n - 2];
    if (linePrev != null && sigPrev != null) {
      if (linePrev <= sigPrev && macdLineLast > signalLast) result.macd.crossover = "bullish";
      else if (linePrev >= sigPrev && macdLineLast < signalLast) result.macd.crossover = "bearish";
    }
    result.macd.histogram = histLast;
  }
  if (histLast != null && histPrev != null) result.macd.histogramExpanding = Math.abs(histLast) > Math.abs(histPrev);
  const lookback = Math.min(10, Math.floor(n / 2));
  if (lookback >= 2) {
    const priceChg = price - closes[n - 1 - lookback];
    const macdStart = macdData.line[n - 1 - lookback];
    const macdChg = macdLineLast != null && macdStart != null ? macdLineLast - macdStart : null;
    if (macdChg != null && priceChg > 0 && macdChg < 0) result.macd.divergence = "bearish";
    else if (macdChg != null && priceChg < 0 && macdChg > 0) result.macd.divergence = "bullish";
  }

  const bb = bollinger(closes, 20, 2);
  const upper = last(bb.upper);
  const lower = last(bb.lower);
  const mid = last(bb.mid);
  const upperPrev = bb.upper[n - 2];
  const lowerPrev = bb.lower[n - 2];
  if (upper != null && lower != null && mid != null && mid > 0) {
    const width = (upper - lower) / mid;
    const widthPrev = upperPrev != null && lowerPrev != null && mid !== 0 ? (upperPrev - lowerPrev) / mid : null;
    const widths = [];
    for (let i = Math.max(0, n - 20); i < n; i++) {
      if (bb.upper[i] != null && bb.lower[i] != null && bb.mid[i] != null && bb.mid[i] > 0)
        widths.push((bb.upper[i] - bb.lower[i]) / bb.mid[i]);
    }
    const sorted = widths.slice().sort((a, b) => a - b);
    const pctRank = sorted.length ? sorted.filter((w) => w < width).length / sorted.length : 0.5;
    result.bollinger.squeeze = pctRank < 0.2;
    if (price > upper) result.bollinger.breakout = "above";
    else if (price < lower) result.bollinger.breakout = "below";
    if (upperPrev != null && lowerPrev != null) {
      const wasAbove = prevPrice > upperPrev;
      const wasBelow = prevPrice < lowerPrev;
      if ((wasAbove && price <= upper) || (wasBelow && price >= lower)) result.bollinger.meanReversion = true;
    }
  }

  const vw = vwapFromBars(bars);
  const vwapLast = last(vw);
  if (vwapLast != null) result.vwap.signal = price > vwapLast ? "bullish" : "bearish";

  return result;
}

/**
 * For backtest: is the given signal set "bullish" for the selected indicator key?
 * selectedKeys: ['ema','rsi','macd','bollinger','vwap'] (from user checkboxes).
 */
function isSignalBullish(signals, key) {
  if (!signals || !key) return false;
  switch (key) {
    case "ema":
      if (signals.ema.deathCross) return false;
      return signals.ema.goldenCross === true || (signals.ema.priceDistanceEma50 != null && signals.ema.priceDistanceEma50 > 0);
    case "rsi":
      return signals.rsi.zone !== "overbought";
    case "macd":
      return signals.macd.crossover !== "bearish";
    case "bollinger":
      return signals.bollinger.breakout !== "below";
    case "vwap":
      return signals.vwap.signal === "bullish";
    default:
      return false;
  }
}

function isSignalBearish(signals, key) {
  if (!signals || !key) return false;
  switch (key) {
    case "ema":
      return signals.ema.deathCross === true || (signals.ema.priceDistanceEma50 != null && signals.ema.priceDistanceEma50 < 0);
    case "rsi":
      return signals.rsi.zone === "overbought";
    case "macd":
      return signals.macd.crossover === "bearish";
    case "bollinger":
      return signals.bollinger.breakout === "below";
    case "vwap":
      return signals.vwap.signal === "bearish";
    default:
      return false;
  }
}
