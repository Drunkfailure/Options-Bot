const API = "/api";

// --- Router (hash-based) ---
const viewHome = document.getElementById("view-home");
const viewTicker = document.getElementById("view-ticker");
const viewBotCreator = document.getElementById("view-bot-creator");
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");

function getRoute() {
  const hash = (window.location.hash || "#/").slice(1);
  const parts = hash.split("/").filter(Boolean);
  if (parts[0] === "ticker" && parts[1]) return { view: "ticker", symbol: parts[1].toUpperCase() };
  if (parts[0] === "bot-creator") return { view: "bot-creator", symbol: null };
  return { view: "home", symbol: null };
}

function renderRoute() {
  const route = getRoute();
  viewHome.classList.toggle("hidden", route.view !== "home");
  viewTicker.classList.toggle("hidden", route.view !== "ticker");
  viewBotCreator.classList.toggle("hidden", route.view !== "bot-creator");
  document.querySelectorAll(".topbar-nav .nav-link").forEach((a) => {
    a.classList.toggle("active", (a.getAttribute("href") === "#/" && route.view === "home") || (a.getAttribute("href") === "#/bot-creator" && route.view === "bot-creator"));
  });
  if (route.view === "ticker") {
    if (searchInput) searchInput.value = route.symbol;
    loadTickerPage(route.symbol);
  } else if (route.view === "home") {
    loadHomePage();
  } else if (route.view === "bot-creator") {
    loadBotCreatorPage();
  }
}

window.addEventListener("hashchange", renderRoute);

function navigateToTicker(symbol) {
  const s = String(symbol).trim().toUpperCase();
  if (!s) return;
  window.location.hash = "#/ticker/" + encodeURIComponent(s);
}

searchBtn?.addEventListener("click", () => navigateToTicker(searchInput?.value));
searchInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") navigateToTicker(searchInput.value);
});

// --- Helpers ---
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
/** If the API error clearly indicates OPRA/options agreement, return user-friendly HTML; otherwise return null. */
function opraErrorMessage(apiMessage) {
  const msg = String(apiMessage || "").toLowerCase();
  if (!msg) return null;
  const isOpraError = msg.includes("opra") || msg.includes("option agreement") || msg.includes("options agreement") || (msg.includes("agreement") && msg.includes("option"));
  if (!isOpraError) return null;
  return `<p class="error">Options require the <strong>OPRA agreement</strong> to be signed in your Alpaca account.</p>
    <p class="muted small">Sign in at <a href="https://app.alpaca.markets" target="_blank" rel="noopener">app.alpaca.markets</a> (Paper or Live), go to Profile → Agreements, and complete the Option Agreement. Use the same account type (Paper vs Live) as your API keys. If you just signed, wait a few minutes and try again.</p>`;
}

function fmtMoney(n) {
  if (n == null || n === undefined) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function fmtPct(n) {
  if (n == null || n === undefined) return "—";
  const s = (n * 100).toFixed(2);
  return (n >= 0 ? "+" : "") + s + "%";
}

const ACTIVE_ORDER_STATUSES = new Set(["new", "pending_new", "partially_filled", "accepted", "pending_cancel", "pending_replace", "replaced"]);

// --- Home page ---
const accountSummary = document.getElementById("accountSummary");
const equityChart = document.getElementById("equityChart");
const chartPeriod = document.getElementById("chartPeriod");
const positionsOutput = document.getElementById("positionsOutput");
const activeTradesOutput = document.getElementById("activeTradesOutput");
const previousTradesOutput = document.getElementById("previousTradesOutput");

let selectedPeriod = "1M";
let equityChartInstance = null;

function getChartZoomOptions() {
  return {
    zoom: {
      wheel: { enabled: true },
      pinch: { enabled: true },
      mode: "xy",
    },
    pan: {
      enabled: true,
      mode: "xy",
    },
    limits: { x: { min: "original", max: "original" }, y: { min: "original", max: "original" } },
  };
}

function bindZoomToolbar(getChart, zoomInId, zoomOutId, resetId) {
  const zin = document.getElementById(zoomInId);
  const zout = document.getElementById(zoomOutId);
  const rst = document.getElementById(resetId);
  zin?.addEventListener("click", () => getChart()?.zoom(1.25));
  zout?.addEventListener("click", () => getChart()?.zoom(0.8));
  rst?.addEventListener("click", () => getChart()?.resetZoom());
}

async function loadAccount() {
  if (!accountSummary) return;
  try {
    const res = await fetch(`${API}/account`);
    const data = await res.json();
    if (!res.ok) {
      accountSummary.innerHTML = `<p class="error">${data.message || "Failed to load account"}</p>`;
      return;
    }
    const eq = Number(data.equity);
    const prevEq = Number(data.last_equity);
    const pnl = prevEq ? (eq - prevEq) / prevEq : null;
    accountSummary.innerHTML = `
      <div><span class="label">Equity</span><div class="value">${fmtMoney(eq)}</div></div>
      <div><span class="label">Cash</span><div class="value">${fmtMoney(data.cash)}</div></div>
      <div><span class="label">Buying power</span><div class="value">${fmtMoney(data.buying_power)}</div></div>
      <div><span class="label">Day P/L</span><div class="value ${pnl != null && pnl >= 0 ? "positive" : "negative"}">${pnl != null ? fmtPct(pnl) : "—"}</div></div>
      <div><span class="label">Status</span><div class="value">${data.status || "—"}</div></div>
    `;
  } catch (e) {
    accountSummary.innerHTML = `<p class="error">${e.message}</p>`;
  }
}

function renderEquityChart(history) {
  if (!equityChart) return;
  if (equityChartInstance) {
    equityChartInstance.destroy();
    equityChartInstance = null;
  }
  const timestamps = history?.timestamp || [];
  const equity = history?.equity || [];
  if (timestamps.length === 0 || equity.length === 0) {
    equityChart.innerHTML = "<p class=\"muted\">No portfolio history for this period.</p>";
    document.getElementById("equityChartToolbar")?.style.setProperty("display", "none");
    return;
  }
  const theme = { text: "#e6e9ef", muted: "#8b92a4", grid: "#2a3140", accent: "#00c896", danger: "#f87171" };
  const isPositive = equity[equity.length - 1] >= equity[0];
  const labels = timestamps.map((t) => new Date(t * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" }));
  equityChart.innerHTML = "<canvas id=\"equityChartCanvas\" aria-label=\"Portfolio value\"></canvas>";
  const canvas = document.getElementById("equityChartCanvas");
  if (!canvas) return;
  document.getElementById("equityChartToolbar")?.style.setProperty("display", "flex");
  const ctx = canvas.getContext("2d");
  equityChartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{ label: "Equity", data: equity, borderColor: isPositive ? theme.accent : theme.danger, backgroundColor: (isPositive ? theme.accent : theme.danger) + "20", fill: true, tension: 0.1 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 2.2,
      plugins: { legend: { display: false }, zoom: getChartZoomOptions() },
      scales: {
        x: { grid: { color: theme.grid }, ticks: { color: theme.muted, maxTicksLimit: 10 } },
        y: { grid: { color: theme.grid }, ticks: { color: theme.muted } },
      },
    },
  });
}

async function loadPortfolioHistory() {
  const period = selectedPeriod;
  const timeframe = period === "1W" ? "1H" : "1D";
  try {
    const res = await fetch(`${API}/account/portfolio/history?period=${period}&timeframe=${timeframe}`);
    const data = await res.json();
    if (!res.ok) {
      if (equityChart) equityChart.innerHTML = `<p class="error">${data.message || "Failed"}</p>`;
      return;
    }
    renderEquityChart(data);
  } catch (e) {
    if (equityChart) equityChart.innerHTML = `<p class="error">${e.message}</p>`;
  }
}

async function loadPositions() {
  if (!positionsOutput) return;
  try {
    const res = await fetch(`${API}/positions`);
    const data = await res.json();
    if (!res.ok) {
      positionsOutput.innerHTML = `<p class="error">${data.message || "Failed to load positions"}</p>`;
      return;
    }
    const positions = Array.isArray(data) ? data : [];
    if (positions.length === 0) {
      positionsOutput.innerHTML = "<p class=\"muted\">No open positions.</p>";
      return;
    }
    positionsOutput.innerHTML = `
      <table>
        <thead><tr><th>Symbol</th><th>Qty</th><th>Side</th><th>Avg entry</th><th>Market value</th><th>P/L</th></tr></thead>
        <tbody>
          ${positions.map((p) => `
            <tr>
              <td>${p.symbol || "—"}</td>
              <td>${p.qty ?? "—"}</td>
              <td>${p.side || "—"}</td>
              <td>${fmtMoney(p.avg_entry_price)}</td>
              <td>${fmtMoney(p.market_value)}</td>
              <td class="${Number(p.unrealized_pl) >= 0 ? "positive" : "negative"}">${fmtMoney(p.unrealized_pl)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  } catch (e) {
    positionsOutput.innerHTML = `<p class="error">${e.message}</p>`;
  }
}

async function loadOrders() {
  try {
    const res = await fetch(`${API}/orders?status=all&limit=100`);
    const data = await res.json();
    if (!res.ok) return;
    const orders = Array.isArray(data) ? data : [];
    const active = orders.filter((o) => ACTIVE_ORDER_STATUSES.has(o.status));
    const previous = orders.filter((o) => !ACTIVE_ORDER_STATUSES.has(o.status));

    const table = (list, emptyMsg) => {
      if (list.length === 0) return `<p class="muted">${emptyMsg}</p>`;
      return `
        <table>
          <thead><tr><th>Symbol</th><th>Side</th><th>Qty</th><th>Filled</th><th>Type</th><th>Status</th><th>Time</th></tr></thead>
          <tbody>
            ${list.slice(0, 20).map((o) => `
              <tr>
                <td>${o.symbol || "—"}</td>
                <td>${o.side || "—"}</td>
                <td>${o.qty ?? "—"}</td>
                <td>${o.filled_qty ?? "—"}</td>
                <td>${o.type || "—"}</td>
                <td>${o.status || "—"}</td>
                <td>${o.filled_at ? new Date(o.filled_at).toLocaleString() : (o.created_at ? new Date(o.created_at).toLocaleString() : "—")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `;
    };

    if (activeTradesOutput) activeTradesOutput.innerHTML = table(active, "No active orders.");
    if (previousTradesOutput) previousTradesOutput.innerHTML = table(previous, "No previous orders.");
  } catch (e) {
    if (activeTradesOutput) activeTradesOutput.innerHTML = `<p class="error">${e.message}</p>`;
    if (previousTradesOutput) previousTradesOutput.innerHTML = `<p class="error">${e.message}</p>`;
  }
}

function loadHomePage() {
  loadAccount();
  loadPortfolioHistory();
  loadPositions();
  loadOrders();
}

chartPeriod?.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-period]");
  if (!btn) return;
  chartPeriod.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  selectedPeriod = btn.dataset.period;
  loadPortfolioHistory();
});

// --- Ticker page ---
const tickerSymbolEl = document.getElementById("tickerSymbol");
const tickerPriceOutput = document.getElementById("tickerPriceOutput");
const tickerOptRefresh = document.getElementById("tickerOptRefresh");
const tickerCallsOutput = document.getElementById("tickerCallsOutput");
const tickerPutsOutput = document.getElementById("tickerPutsOutput");
const tickerTimeframe = document.getElementById("tickerTimeframe");
const tickerTodayBarSize = document.getElementById("tickerTodayBarSize");
const tickerBarsChartWrap = document.getElementById("tickerBarsChartWrap");
const tickerBarsOutput = document.getElementById("tickerBarsOutput");

let tickerBarsChartInstance = null;

async function loadTickerPrice(symbol) {
  if (!tickerPriceOutput || !symbol) return;
  tickerPriceOutput.innerHTML = "<p class=\"muted\">Loading…</p>";
  try {
    const [quoteRes, tradeRes] = await Promise.all([
      fetch(`${API}/stocks/quotes/latest?symbols=${encodeURIComponent(symbol)}`),
      fetch(`${API}/stocks/trades/latest?symbol=${encodeURIComponent(symbol)}`),
    ]);
    const quoteData = await quoteRes.json();
    const tradeData = await tradeRes.json();
    const q = quoteData.quotes?.[symbol] || quoteData;
    const t = tradeData.trade || tradeData.trades?.[symbol] || tradeData;
    const bid = q?.bp ?? q?.ap;
    const ask = q?.ap ?? q?.bp;
    const last = t?.p ?? t?.price;
    tickerPriceOutput.innerHTML = `
      <div class="price-item"><span class="label">Bid</span><span class="value">${bid != null ? fmtMoney(bid) : "—"}</span></div>
      <div class="price-item"><span class="label">Ask</span><span class="value">${ask != null ? fmtMoney(ask) : "—"}</span></div>
      <div class="price-item"><span class="label">Last</span><span class="value">${last != null ? fmtMoney(last) : "—"}</span></div>
      <div class="price-item"><span class="label">Spread</span><span class="value">${bid != null && ask != null ? fmtMoney(ask - bid) : "—"}</span></div>
    `;
  } catch (e) {
    tickerPriceOutput.innerHTML = `<p class="error">${e.message}</p>`;
  }
}

// OCC symbol ends with C or P + 8-digit strike; e.g. SPY240419C00500000 = call
function isCall(occSymbol) {
  const s = String(occSymbol);
  if (s.length < 9) return false;
  return s.charAt(s.length - 9) === "C";
}

function renderOptionTable(rows, maxRows = 80, fullCriteria = true) {
  if (!rows.length) return "<p class=\"muted\">None</p>";
  const slice = rows.slice(0, maxRows);
  if (fullCriteria && rows[0]?.spread != null) {
    return `
    <div class="table-wrap">
    <table class="option-chain-table">
      <thead><tr><th>Strike</th><th>Bid</th><th>Ask</th><th>Spread</th><th>Last</th><th>Vol</th><th>Δ</th><th>Γ</th><th>θ</th><th>Vega</th><th>IV</th><th>IV Rank</th><th>IV %</th><th>IV/Real</th></tr></thead>
      <tbody>
        ${slice.map((r) => `<tr><td>${r.strike}</td><td>${r.bid}</td><td>${r.ask}</td><td>${r.spread}</td><td>${r.last}</td><td>${r.vol}</td><td>${r.delta}</td><td>${r.gamma}</td><td>${r.theta}</td><td>${r.vega}</td><td>${r.iv}</td><td>${r.ivRank}</td><td>${r.ivPct}</td><td>${r.ivReal}</td></tr>`).join("")}
      </tbody>
    </table>
    </div>
    ${rows.length > maxRows ? `<p class="muted">Showing ${maxRows} of ${rows.length}</p>` : ""}
  `;
  }
  return `
    <table>
      <thead><tr><th>Strike</th><th>Bid</th><th>Ask</th><th>Last</th><th>Δ</th><th>IV</th></tr></thead>
      <tbody>
        ${slice.map((r) => `<tr><td>${r.strike}</td><td>${r.bid}</td><td>${r.ask}</td><td>${r.last}</td><td>${r.delta}</td><td>${r.iv}</td></tr>`).join("")}
      </tbody>
    </table>
    ${rows.length > maxRows ? `<p class="muted">Showing ${maxRows} of ${rows.length}</p>` : ""}
  `;
}

function updateOptionsAccountStatus() {
  const el = document.getElementById("optionsAccountStatus");
  if (!el) return;
  fetch(`${API}/account`)
    .then((r) => r.json())
    .then((acc) => {
      if (acc.message && !acc.status) {
        el.textContent = "Account: error — " + (acc.message || "check API keys");
        return;
      }
      const level = acc.options_trading_level;
      const levelLabel = level === 0 ? "0 (sign Option Agreement in Alpaca)" : String(level);
      el.textContent = `Account: ${acc.status || "—"} · Options level ${levelLabel}`;
    })
    .catch(() => { if (el) el.textContent = "Account: —"; });
}

async function loadTickerOptionChain(symbol) {
  if ((!tickerCallsOutput && !tickerPutsOutput) || !symbol) return;
  updateOptionsAccountStatus();
  if (tickerCallsOutput) tickerCallsOutput.innerHTML = "<p class=\"muted\">Loading…</p>";
  if (tickerPutsOutput) tickerPutsOutput.innerHTML = "<p class=\"muted\">Loading…</p>";
  try {
    const last = getLastTradingDay();
    const toStr = (d) => d.toISOString().slice(0, 10);
    const start = addTradingDays(last, 20);
    const barsRes = await fetch(`${API}/stocks/bars?symbols=${encodeURIComponent(symbol)}&timeframe=1Day&limit=25&start=${toStr(start)}&end=${toStr(last)}`);
    const barsData = await barsRes.json().catch(() => ({}));
    const underlyingBars = (barsData.bars && barsData.bars[symbol]) ? barsData.bars[symbol].map((b) => ({ close: b.c })) : [];

    const res = await fetch(`${API}/options/snapshots/${encodeURIComponent(symbol)}?limit=500`);
    const data = await res.json();
    if (!res.ok) {
      const rawMsg = data.message || data.error || data.msg || `HTTP ${res.status}`;
      const opraMsg = opraErrorMessage(rawMsg);
      const err = opraMsg
        ? opraMsg + `<p class="muted small">API: ${escapeHtml(String(rawMsg))}</p>`
        : `<p class="error">${escapeHtml(String(rawMsg))}</p>`;
      if (tickerCallsOutput) tickerCallsOutput.innerHTML = err;
      if (tickerPutsOutput) tickerPutsOutput.innerHTML = err;
      return;
    }
    const snapshots = data.snapshots || {};
    const enriched = typeof enrichSnapshotContracts === "function"
      ? enrichSnapshotContracts(snapshots, { underlyingBars })
      : Object.keys(snapshots).map((sym) => {
          const s = snapshots[sym] || {};
          const q = s.latestQuote || {};
          const t = s.latestTrade || {};
          const g = s.greeks || {};
          return { symbol: sym, call: isCall(sym), iv: s.impliedVolatility, delta: g.delta, gamma: g.gamma, theta: g.theta, vega: g.vega, bidAskSpread: q.ap != null && q.bp != null ? q.ap - q.bp : null, volume: null, bid: q.bp, ask: q.ap, last: t?.p, ivRank: null, ivPercentile: null, ivVsRealized: null };
        });

    const fmt = (n, decimals = 2) => n != null && Number.isFinite(n) ? Number(n).toFixed(decimals) : "—";
    const calls = [];
    const puts = [];
    for (const c of enriched) {
      const strikeRaw = c.symbol.length >= 8 ? parseInt(c.symbol.slice(-8), 10) : 0;
      const strike = strikeRaw / 1000;
      const row = {
        symbol: c.symbol,
        strike: strike.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        bid: c.bid != null ? fmt(c.bid, 2) : "—",
        ask: c.ask != null ? fmt(c.ask, 2) : "—",
        spread: c.bidAskSpread != null ? fmt(c.bidAskSpread, 2) : "—",
        last: c.last != null ? fmt(c.last, 2) : "—",
        vol: c.volume != null ? String(c.volume) : "—",
        delta: c.delta != null ? fmt(c.delta, 3) : "—",
        gamma: c.gamma != null ? fmt(c.gamma, 4) : "—",
        theta: c.theta != null ? fmt(c.theta, 4) : "—",
        vega: c.vega != null ? fmt(c.vega, 4) : "—",
        iv: c.iv != null ? (c.iv * 100).toFixed(1) + "%" : "—",
        ivRank: c.ivRank != null ? fmt(c.ivRank, 1) : "—",
        ivPct: c.ivPercentile != null ? fmt(c.ivPercentile, 1) : "—",
        ivReal: c.ivVsRealized != null ? fmt(c.ivVsRealized, 2) : "—",
      };
      if (c.call) calls.push(row);
      else puts.push(row);
    }
    calls.sort((a, b) => parseFloat(a.strike) - parseFloat(b.strike));
    puts.sort((a, b) => parseFloat(a.strike) - parseFloat(b.strike));
    if (tickerCallsOutput) tickerCallsOutput.innerHTML = renderOptionTable(calls, 80, true);
    if (tickerPutsOutput) tickerPutsOutput.innerHTML = renderOptionTable(puts, 80, true);
  } catch (e) {
    const err = `<p class="error">${e.message}</p>`;
    if (tickerCallsOutput) tickerCallsOutput.innerHTML = err;
    if (tickerPutsOutput) tickerPutsOutput.innerHTML = err;
  }
}

/**
 * Get contracts suitable for bot (backtest or live). Fetches snapshots + underlying bars, enriches with
 * IV rank/percentile, IV vs realized, Greeks, liquidity; filters and ranks by DEFAULT_CRITERIA (or custom).
 * Use this when running backtests or live trading to choose which contracts to trade.
 */
async function getContractsForBot(underlyingSymbol, criteria = {}) {
  const last = getLastTradingDay();
  const toStr = (d) => d.toISOString().slice(0, 10);
  const start = addTradingDays(last, 20);
  const [barsRes, snapRes] = await Promise.all([
    fetch(`${API}/stocks/bars?symbols=${encodeURIComponent(underlyingSymbol)}&timeframe=1Day&limit=25&start=${toStr(start)}&end=${toStr(last)}`),
    fetch(`${API}/options/snapshots/${encodeURIComponent(underlyingSymbol)}?limit=500`),
  ]);
  const barsData = await barsRes.json().catch(() => ({}));
  const snapData = await snapRes.json().catch(() => ({}));
  if (!snapRes.ok || !snapData.snapshots) return { calls: [], puts: [], enriched: [] };
  const underlyingBars = (barsData.bars && barsData.bars[underlyingSymbol]) ? barsData.bars[underlyingSymbol].map((b) => ({ close: b.c })) : [];
  const enriched = typeof enrichSnapshotContracts === "function"
    ? enrichSnapshotContracts(snapData.snapshots, { underlyingBars })
    : [];
  const selected = typeof selectContracts === "function" ? selectContracts(enriched, criteria) : enriched;
  const calls = selected.filter((c) => c.call);
  const puts = selected.filter((c) => !c.call);
  return { calls, puts, enriched: selected };
}

// Format ISO timestamp in user's local timezone (browser locale)
function formatLocalTime(isoStr) {
  if (!isoStr) return "—";
  const d = new Date(isoStr);
  const hasTime = isoStr.includes("T");
  return hasTime
    ? d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short", hour12: true })
    : d.toLocaleDateString(undefined, { dateStyle: "short" });
}

function renderTickerBarsChart(rows) {
  if (tickerBarsChartInstance) {
    tickerBarsChartInstance.destroy();
    tickerBarsChartInstance = null;
  }
  if (!tickerBarsChartWrap || !rows.length) {
    document.getElementById("tickerChartToolbar")?.style.setProperty("display", "none");
    return;
  }
  tickerBarsChartWrap.innerHTML = "<canvas id=\"tickerBarsChart\" aria-label=\"Price chart\"></canvas>";
  const canvas = document.getElementById("tickerBarsChart");
  if (!canvas) return;
  const labels = rows.map((r) => {
    const d = new Date(r.time);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: r.time.includes("T") ? "2-digit" : undefined, minute: r.time.includes("T") ? "2-digit" : undefined });
  });
  const closes = rows.map((r) => r.close);
  const theme = { text: "#e6e9ef", muted: "#8b92a4", grid: "#2a3140", accent: "#00c896" };
  const ctx = canvas.getContext("2d");
  tickerBarsChartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{ label: "Close", data: closes, borderColor: theme.accent, backgroundColor: theme.accent + "20", fill: true, tension: 0.1 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 2,
      plugins: { legend: { labels: { color: theme.text } }, zoom: getChartZoomOptions() },
      scales: {
        x: { grid: { color: theme.grid }, ticks: { color: theme.muted, maxTicksLimit: 10 } },
        y: { grid: { color: theme.grid }, ticks: { color: theme.muted } },
      },
    },
  });
  const tickerToolbar = document.getElementById("tickerChartToolbar");
  if (tickerToolbar) tickerToolbar.style.display = "flex";
}

// US market: last trading day (Mon–Fri; if weekend use previous Friday)
function getLastTradingDay() {
  const d = new Date();
  const day = d.getUTCDay();
  if (day === 0) d.setUTCDate(d.getUTCDate() - 2);
  else if (day === 6) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

function addTradingDays(date, numDaysBack) {
  const d = new Date(date);
  let count = 0;
  while (count < numDaysBack) {
    d.setUTCDate(d.getUTCDate() - 1);
    if (d.getUTCDay() >= 1 && d.getUTCDay() <= 5) count++;
  }
  return d;
}

function getBarRangeForPeriod(period, todayBarSize = "5Min") {
  const last = getLastTradingDay();
  const toDateStr = (d) => d.toISOString().slice(0, 10);
  switch (period) {
    case "today": {
      const dayStr = toDateStr(last);
      return { start: dayStr, end: dayStr, timeframe: todayBarSize, limit: 500 };
    }
    case "1w": {
      const start = addTradingDays(last, 5);
      return { start: toDateStr(start), end: toDateStr(last), timeframe: "1Day", limit: 10 };
    }
    case "1m": {
      const start = new Date(last);
      start.setUTCMonth(start.getUTCMonth() - 1);
      return { start: toDateStr(start), end: toDateStr(last), timeframe: "1Day", limit: 31 };
    }
    case "3m": {
      const start = new Date(last);
      start.setUTCMonth(start.getUTCMonth() - 3);
      return { start: toDateStr(start), end: toDateStr(last), timeframe: "1Day", limit: 100 };
    }
    case "ytd": {
      const start = new Date(Date.UTC(last.getUTCFullYear(), 0, 1));
      return { start: toDateStr(start), end: toDateStr(last), timeframe: "1Day", limit: 260 };
    }
    default: {
      return { start: toDateStr(last), end: toDateStr(last), timeframe: todayBarSize, limit: 500 };
    }
  }
}

function getTickerBarRange(period) {
  const todayBarSize = document.getElementById("tickerTodayBarSize")?.value || "5Min";
  return getBarRangeForPeriod(period, todayBarSize);
}

async function loadTickerBars(symbol) {
  if (!tickerBarsOutput || !tickerBarsChartWrap || !symbol) return;
  tickerBarsOutput.innerHTML = "";
  tickerBarsChartWrap.innerHTML = "<p class=\"no-chart\">Loading…</p>";
  document.getElementById("tickerChartToolbar")?.style.setProperty("display", "none");
  const period = tickerTimeframe?.value || "today";
  const { start: startStr, end: endStr, timeframe, limit } = getTickerBarRange(period);
  try {
    const params = new URLSearchParams({
      symbols: symbol,
      timeframe,
      limit: String(limit),
      start: startStr,
      end: endStr,
    });
    const res = await fetch(`${API}/stocks/bars?${params}`);
    const data = await res.json();
    if (!res.ok) {
      tickerBarsChartWrap.innerHTML = `<p class="error">${data.message || res.status}</p>`;
      tickerBarsOutput.innerHTML = `<pre>${JSON.stringify(data, null, 2)}</pre>`;
      return;
    }
    const bars = data.bars || {};
    const syms = Object.keys(bars);
    const rows = [];
    for (const sym of syms) {
      for (const b of bars[sym] || []) {
        rows.push({ symbol: sym, time: b.t || "", open: b.o, high: b.h, low: b.l, close: b.c, volume: (b.v ?? 0).toLocaleString() });
      }
    }
    rows.sort((a, b) => new Date(a.time) - new Date(b.time));
    if (rows.length === 0) {
      tickerBarsChartWrap.innerHTML = "<p class=\"no-chart\">No bars for this range.</p>";
      tickerBarsOutput.innerHTML = "<p class=\"muted\">No historical bars returned.</p>";
      return;
    }
    renderTickerBarsChart(rows);
    tickerBarsOutput.innerHTML = `
      <table>
        <thead><tr><th>Time</th><th>Open</th><th>High</th><th>Low</th><th>Close</th><th>Volume</th></tr></thead>
        <tbody>
          ${rows.map((r) => `<tr><td>${formatLocalTime(r.time)}</td><td>${r.open}</td><td>${r.high}</td><td>${r.low}</td><td>${r.close}</td><td>${r.volume}</td></tr>`).join("")}
        </tbody>
      </table>
    `;
  } catch (e) {
    tickerBarsChartWrap.innerHTML = `<p class="error">${e.message}</p>`;
    tickerBarsOutput.innerHTML = `<p class="error">${e.message}</p>`;
  }
}

function loadTickerPage(symbol) {
  if (!symbol) return;
  if (tickerSymbolEl) tickerSymbolEl.textContent = symbol;
  loadTickerPrice(symbol);
  loadTickerOptionChain(symbol);
  loadTickerBars(symbol);
}

tickerOptRefresh?.addEventListener("click", () => {
  const route = getRoute();
  if (route.view === "ticker" && route.symbol) loadTickerOptionChain(route.symbol);
});

function refreshTickerChart() {
  const route = getRoute();
  if (route.view === "ticker" && route.symbol) loadTickerBars(route.symbol);
}

const tickerTodayBarSizeWrap = document.getElementById("tickerTodayBarSizeWrap");
tickerTimeframe?.addEventListener("change", () => {
  const isToday = tickerTimeframe.value === "today";
  if (tickerTodayBarSizeWrap) tickerTodayBarSizeWrap.style.display = isToday ? "" : "none";
  refreshTickerChart();
});
tickerTodayBarSize?.addEventListener("change", refreshTickerChart);
if (tickerTodayBarSizeWrap) tickerTodayBarSizeWrap.style.display = tickerTimeframe?.value === "today" ? "" : "none";

// --- Bot Creator page ---
const botTickerInput = document.getElementById("botTickerInput");
const botTickerLoad = document.getElementById("botTickerLoad");
const botTickerStatus = document.getElementById("botTickerStatus");
const botChartRange = document.getElementById("botChartRange");
const botTodayBarSizeWrap = document.getElementById("botTodayBarSizeWrap");
const botTodayBarSize = document.getElementById("botTodayBarSize");
const botChartRefresh = document.getElementById("botChartRefresh");
const botChartWrap = document.getElementById("botChartWrap");
const botBacktestStart = document.getElementById("botBacktestStart");
const botBacktestEnd = document.getElementById("botBacktestEnd");
const botBacktestTimeframe = document.getElementById("botBacktestTimeframe");
const botBacktestBudget = document.getElementById("botBacktestBudget");
const botBacktestExitOnSignal = document.getElementById("botBacktestExitOnSignal");
const botBacktestUseOptions = document.getElementById("botBacktestUseOptions");
const botBacktestDirection = document.getElementById("botBacktestDirection");
const botBacktestTakeProfit = document.getElementById("botBacktestTakeProfit");
const botBacktestStopLoss = document.getElementById("botBacktestStopLoss");
const botBacktestOutput = document.getElementById("botBacktestOutput");
const botIndicatorValues = document.getElementById("botIndicatorValues");
const botSignalsOutput = document.getElementById("botSignalsOutput");

let botCreatorChartInstance = null;
let botCreatorSymbol = null;
let lastBotCreatorRows = null;

function renderBotCreatorChart(rows) {
  if (botCreatorChartInstance) {
    botCreatorChartInstance.destroy();
    botCreatorChartInstance = null;
  }
  if (!botChartWrap || !rows.length) return;
  botChartWrap.innerHTML = "<canvas id=\"botCreatorChart\" aria-label=\"Price chart\"></canvas>";
  const canvas = document.getElementById("botCreatorChart");
  if (!canvas) return;
  const labels = rows.map((r) => {
    const d = new Date(r.time);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: r.time.includes("T") ? "2-digit" : undefined, minute: r.time.includes("T") ? "2-digit" : undefined });
  });
  const closes = rows.map((r) => r.close);
  const bars = rows.map((r) => ({ close: r.close, high: r.high, low: r.low, volume: r.volumeNum ?? 0, vwap: r.vwap }));
  const selected = getSelectedIndicators();
  const theme = { text: "#e6e9ef", muted: "#8b92a4", grid: "#2a3140", accent: "#00c896" };
  const colors = {
    close: theme.accent,
    ema50: "#f0a500",
    ema200: "#a78bfa",
    ema20m50: "#22d3ee",
    emaSlope: "#f472b6",
    rsi: "#a3e635",
    rsiSlope: "#4ade80",
    rsiDist50: "#86efac",
    macd: "#fb923c",
    bbUpper: "#94a3b8",
    bbMid: "#64748b",
    bbLower: "#94a3b8",
    vwap: "#e879f9",
  };

  const datasets = [{ label: "Close", data: closes, borderColor: colors.close, backgroundColor: colors.close + "20", fill: true, tension: 0.1, yAxisID: "y" }];

  if (selected.priceOverEma50 && typeof ema === "function") {
    const ema50Series = ema(closes, 50);
    datasets.push({ label: "EMA 50", data: ema50Series, borderColor: colors.ema50, borderDash: [4, 2], tension: 0.1, fill: false, yAxisID: "y" });
  }
  if (selected.priceOverEma200 && typeof ema === "function") {
    const ema200Series = ema(closes, 200);
    datasets.push({ label: "EMA 200", data: ema200Series, borderColor: colors.ema200, borderDash: [4, 2], tension: 0.1, fill: false, yAxisID: "y" });
  }
  if (selected.ema20MinusEma50 && typeof ema === "function") {
    const e20 = ema(closes, 20);
    const e50 = ema(closes, 50);
    const diff = e20.map((v, i) => (v != null && e50[i] != null ? v - e50[i] : null));
    datasets.push({ label: "EMA20 − EMA50", data: diff, borderColor: colors.ema20m50, borderDash: [2, 2], tension: 0.1, fill: false, yAxisID: "y" });
  }
  if (selected.emaSlope && typeof ema === "function" && typeof slopeSeries === "function") {
    const ema20Series = ema(closes, 20);
    const slopeArr = slopeSeries(ema20Series, 5);
    datasets.push({ label: "EMA slope", data: slopeArr, borderColor: colors.emaSlope, borderDash: [2, 2], tension: 0.1, fill: false, yAxisID: "y1" });
  }
  if (selected.rsi && typeof rsi === "function") {
    const rsiSeries = rsi(closes, 14);
    datasets.push({ label: "RSI", data: rsiSeries, borderColor: colors.rsi, tension: 0.1, fill: false, yAxisID: "y1" });
  }
  if (selected.rsiSlope && typeof rsi === "function" && typeof slopeSeries === "function") {
    const rsiSeries = rsi(closes, 14);
    const slopeArr = slopeSeries(rsiSeries, 5);
    datasets.push({ label: "RSI slope", data: slopeArr, borderColor: colors.rsiSlope, borderDash: [2, 2], tension: 0.1, fill: false, yAxisID: "y1" });
  }
  if (selected.rsiDistanceFrom50 && typeof rsi === "function") {
    const rsiSeries = rsi(closes, 14);
    const dist = rsiSeries.map((v) => (v != null ? v - 50 : null));
    datasets.push({ label: "RSI − 50", data: dist, borderColor: colors.rsiDist50, borderDash: [2, 2], tension: 0.1, fill: false, yAxisID: "y1" });
  }
  if (selected.macdLine && typeof macdLine === "function") {
    const macdSeries = macdLine(closes);
    datasets.push({ label: "MACD", data: macdSeries, borderColor: colors.macd, tension: 0.1, fill: false, yAxisID: "y1" });
  }
  if (selected.bollinger && typeof bollinger === "function") {
    const bb = bollinger(closes, 20, 2);
    datasets.push({ label: "BB upper", data: bb.upper, borderColor: colors.bbUpper, borderDash: [1, 1], tension: 0.1, fill: false, yAxisID: "y" });
    datasets.push({ label: "BB lower", data: bb.lower, borderColor: colors.bbLower, borderDash: [1, 1], tension: 0.1, fill: "-1", yAxisID: "y" });
    datasets.push({ label: "BB mid", data: bb.mid, borderColor: colors.bbMid, borderDash: [2, 2], tension: 0.1, fill: false, yAxisID: "y" });
  }
  if (selected.vwap && typeof vwapFromBars === "function") {
    const vwapSeries = vwapFromBars(bars);
    datasets.push({ label: "VWAP", data: vwapSeries, borderColor: colors.vwap, borderWidth: 2, tension: 0.1, fill: false, yAxisID: "y" });
  }

  const ctx = canvas.getContext("2d");
  const hasRightAxis = datasets.some((d) => d.yAxisID === "y1");
  botCreatorChartInstance = new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 2,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { labels: { color: theme.text } }, zoom: getChartZoomOptions() },
      scales: {
        x: { grid: { color: theme.grid }, ticks: { color: theme.muted, maxTicksLimit: 12 } },
        y: { type: "linear", position: "left", grid: { color: theme.grid }, ticks: { color: theme.muted } },
        ...(hasRightAxis ? { y1: { type: "linear", position: "right", grid: { drawOnChartArea: false }, ticks: { color: theme.muted } } } : {}),
      },
    },
  });
  const botToolbar = document.getElementById("botChartToolbar");
  if (botToolbar) botToolbar.style.display = "flex";
}

function getBotCreatorBarRange() {
  const period = botChartRange?.value || "1m";
  const todayBarSize = botTodayBarSize?.value || "5Min";
  return getBarRangeForPeriod(period, todayBarSize);
}

async function loadBotCreatorChart() {
  const symbol = (botTickerInput?.value || "").trim().toUpperCase();
  if (!symbol || !botChartWrap) return;
  botChartWrap.innerHTML = "<p class=\"no-chart\">Loading…</p>";
  const { start: startStr, end: endStr, timeframe, limit } = getBotCreatorBarRange();
  try {
    const params = new URLSearchParams({ symbols: symbol, timeframe, limit: String(limit), start: startStr, end: endStr });
    const res = await fetch(`${API}/stocks/bars?${params}`);
    const data = await res.json();
    if (!res.ok) {
      botChartWrap.innerHTML = `<p class="error">${data.message || res.status}</p>`;
      return;
    }
    const bars = data.bars || {};
    const syms = Object.keys(bars);
    const rows = [];
    for (const sym of syms) {
      for (const b of bars[sym] || []) {
        const v = b.v ?? 0;
        rows.push({
          symbol: sym,
          time: b.t || "",
          open: b.o,
          high: b.h,
          low: b.l,
          close: b.c,
          volume: v.toLocaleString(),
          volumeNum: v,
          vwap: b.vw,
        });
      }
    }
    rows.sort((a, b) => new Date(a.time) - new Date(b.time));
    if (rows.length === 0) {
      lastBotCreatorRows = null;
      if (botCreatorChartInstance) {
        botCreatorChartInstance.destroy();
        botCreatorChartInstance = null;
      }
      botChartWrap.innerHTML = "<p class=\"no-chart\">No bars for this range.</p>";
      document.getElementById("botChartToolbar")?.style.setProperty("display", "none");
      if (botIndicatorValues) botIndicatorValues.innerHTML = "<p class=\"muted\">No data for this range.</p>";
      if (botSignalsOutput) botSignalsOutput.innerHTML = "<p class=\"muted\">No data for this range.</p>";
      return;
    }
    lastBotCreatorRows = rows;
    renderBotCreatorChart(rows);
    updateBotIndicatorValues(rows);
    updateBotSignals(rows);
  } catch (e) {
    botChartWrap.innerHTML = `<p class="error">${e.message}</p>`;
  }
}

function getSelectedIndicators() {
  const idToKey = {
    indPriceOverEma50: "priceOverEma50",
    indPriceOverEma200: "priceOverEma200",
    indEma20MinusEma50: "ema20MinusEma50",
    indEmaSlope: "emaSlope",
    indRsi: "rsi",
    indRsiSlope: "rsiSlope",
    indRsiDivergence: "rsiDivergence",
    indRsiDistanceFrom50: "rsiDistanceFrom50",
    indMacdLine: "macdLine",
    indBollinger: "bollinger",
    indVwap: "vwap",
  };
  const selected = {};
  for (const [id, key] of Object.entries(idToKey)) {
    const el = document.getElementById(id);
    if (el?.checked) selected[key] = true;
  }
  return selected;
}

function updateBotIndicatorValues(rows) {
  if (!botIndicatorValues || typeof computeIndicators !== "function") return;
  const selected = getSelectedIndicators();
  const keys = Object.keys(selected);
  if (keys.length === 0) {
    botIndicatorValues.innerHTML = "<p class=\"muted\">Enable indicators above, then load a ticker.</p>";
    return;
  }
  const barsForIndicators = rows.map((r) => ({
    close: r.close,
    high: r.high,
    low: r.low,
    volume: r.volumeNum ?? 0,
    vwap: r.vwap,
  }));
  const result = computeIndicators(barsForIndicators, selected);
  const labelMap = {
    priceOverEma50: "Price / 50 EMA",
    priceOverEma200: "Price / 200 EMA",
    ema20MinusEma50: "EMA20 − EMA50",
    emaSlope: "EMA slope",
    rsi: "RSI",
    rsiSlope: "RSI slope",
    rsiDivergence: "RSI divergence",
    rsiDistanceFrom50: "RSI dist from 50",
    macdLine: "MACD line",
    bollingerMid: "BB mid",
    bollingerUpper: "BB upper",
    bollingerLower: "BB lower",
    vwap: "VWAP",
  };
  const html = `<div class="indicator-grid">${Object.entries(result).map(([k, v]) => `<div class="indicator-item"><span class="label">${labelMap[k] || k}</span> <span class="value">${v}</span></div>`).join("")}</div>`;
  botIndicatorValues.innerHTML = html;
}

function updateBotSignals(rows) {
  if (!botSignalsOutput || typeof computeIndicatorSignals !== "function") return;
  const bars = rows.map((r) => ({ close: r.close, high: r.high, low: r.low, volume: r.volumeNum ?? 0, vwap: r.vwap }));
  const signals = computeIndicatorSignals(bars);
  const fmtPct = (v) => (v != null && Number.isFinite(v) ? (v * 100).toFixed(2) + "%" : "—");
  const item = (label, value, tag) => `<div class="signal-item"><span class="signal-label">${label}</span><span class="signal-value ${tag || ""}">${value}</span></div>`;

  const emaParts = [];
  const hasEmaData = signals.ema.priceDistanceEma20 != null || signals.ema.priceDistanceEma50 != null || signals.ema.priceDistanceEma200 != null;
  if (signals.ema.goldenCross || signals.ema.deathCross || hasEmaData) {
    emaParts.push(item("Golden cross", signals.ema.goldenCross ? "Yes" : "No", signals.ema.goldenCross ? "signal-bullish" : ""));
    emaParts.push(item("Death cross", signals.ema.deathCross ? "Yes" : "No", signals.ema.deathCross ? "signal-bearish" : ""));
    if (signals.ema.priceDistanceEma20 != null) emaParts.push(item("Price vs EMA20", fmtPct(signals.ema.priceDistanceEma20), ""));
    if (signals.ema.priceDistanceEma50 != null) emaParts.push(item("Price vs EMA50", fmtPct(signals.ema.priceDistanceEma50), ""));
    if (signals.ema.priceDistanceEma200 != null) emaParts.push(item("Price vs EMA200", fmtPct(signals.ema.priceDistanceEma200), ""));
  }

  const rsiParts = [];
  if (signals.rsi.zone) rsiParts.push(item("RSI zone", signals.rsi.zone, signals.rsi.zone === "overbought" ? "signal-bearish" : signals.rsi.zone === "oversold" ? "signal-bullish" : ""));
  if (signals.rsi.value != null) rsiParts.push(item("RSI", signals.rsi.value.toFixed(1), ""));

  const macdParts = [];
  if (signals.macd.crossover) macdParts.push(item("MACD crossover", signals.macd.crossover, signals.macd.crossover === "bullish" ? "signal-bullish" : "signal-bearish"));
  if (signals.macd.histogramExpanding != null) macdParts.push(item("Histogram expanding", signals.macd.histogramExpanding ? "Yes" : "No", ""));
  if (signals.macd.divergence) macdParts.push(item("Divergence", signals.macd.divergence, signals.macd.divergence === "bullish" ? "signal-bullish" : "signal-bearish"));

  const bbParts = [];
  if (signals.bollinger.squeeze != null) bbParts.push(item("Band squeeze", signals.bollinger.squeeze ? "Yes" : "No", ""));
  if (signals.bollinger.breakout) bbParts.push(item("Band breakout", signals.bollinger.breakout, ""));
  if (signals.bollinger.meanReversion) bbParts.push(item("Mean reversion", "Yes", "signal-bullish"));

  const vwapParts = [];
  if (signals.vwap.signal) vwapParts.push(item("VWAP", signals.vwap.signal, signals.vwap.signal === "bullish" ? "signal-bullish" : "signal-bearish"));

  const sections = [
    emaParts.length ? `<div class="signals-group"><h4>EMA</h4>${emaParts.join("")}</div>` : "",
    rsiParts.length ? `<div class="signals-group"><h4>RSI</h4>${rsiParts.join("")}</div>` : "",
    macdParts.length ? `<div class="signals-group"><h4>MACD</h4>${macdParts.join("")}</div>` : "",
    bbParts.length ? `<div class="signals-group"><h4>Bollinger bands</h4>${bbParts.join("")}</div>` : "",
    vwapParts.length ? `<div class="signals-group"><h4>VWAP</h4>${vwapParts.join("")}</div>` : "",
  ].filter(Boolean);

  botSignalsOutput.innerHTML = sections.length ? `<div class="signals-grid">${sections.join("")}</div>` : "<p class=\"muted\">No signals (need more bars).</p>";
}

function getSelectedBacktestIndicatorKeys() {
  const keys = [];
  if (["indPriceOverEma50", "indPriceOverEma200", "indEma20MinusEma50", "indEmaSlope"].some((id) => document.getElementById(id)?.checked)) keys.push("ema");
  if (["indRsi", "indRsiSlope", "indRsiDivergence", "indRsiDistanceFrom50"].some((id) => document.getElementById(id)?.checked)) keys.push("rsi");
  if (document.getElementById("indMacdLine")?.checked) keys.push("macd");
  if (document.getElementById("indBollinger")?.checked) keys.push("bollinger");
  if (document.getElementById("indVwap")?.checked) keys.push("vwap");
  return keys;
}

async function fetchBarsForBacktest(symbol, startStr, endStr, timeframe) {
  const limit = 10000;
  const params = new URLSearchParams({ symbols: symbol, timeframe, limit, start: startStr, end: endStr });
  const res = await fetch(`${API}/stocks/bars?${params}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || "Failed to fetch bars");
  const barList = data.bars?.[symbol] || [];
  let nextToken = data.next_page_token;
  while (nextToken && barList.length < 50000) {
    const nextRes = await fetch(`${API}/stocks/bars?${params}&page_token=${encodeURIComponent(nextToken)}`);
    const nextData = await nextRes.json();
    if (!nextRes.ok) break;
    const nextList = nextData.bars?.[symbol] || [];
    barList.push(...nextList);
    nextToken = nextData.next_page_token;
    if (!nextToken || !nextList.length) break;
  }
  return barList.sort((a, b) => new Date(a.t) - new Date(b.t));
}

async function fetchOptionContracts(underlying, startStr, endStr, type) {
  const endDate = new Date(endStr);
  endDate.setDate(endDate.getDate() + 60);
  const endLte = endDate.toISOString().slice(0, 10);
  const types = type === "both" ? ["call", "put"] : [type || "call"];
  const list = [];
  for (const t of types) {
    const params = new URLSearchParams({
      underlying_symbols: underlying,
      expiration_date_gte: startStr,
      expiration_date_lte: endLte,
      type: t,
      limit: "200",
    });
    let res = await fetch(`${API}/options/contracts?${params}`);
    let data = await res.json();
    if (!res.ok) {
      const opraHint = opraErrorMessage(data.message || data.error) ? " Sign the Options agreement in your Alpaca account (app.alpaca.markets → Account → Agreements)." : "";
      throw new Error((data.message || "Failed to fetch option contracts") + opraHint);
    }
    let chunk = data.option_contracts || [];
    list.push(...chunk);
    let nextToken = data.next_page_token;
    while (nextToken) {
      res = await fetch(`${API}/options/contracts?${params}&page_token=${encodeURIComponent(nextToken)}`);
      data = await res.json();
      if (!res.ok) break;
      chunk = data.option_contracts || [];
      list.push(...chunk);
      nextToken = data.next_page_token;
      if (!chunk.length) break;
    }
  }
  return list;
}

async function fetchOptionsBarsForBacktest(symbols, startStr, endStr, timeframe) {
  const bySymbol = {};
  const chunk = 100;
  for (let i = 0; i < symbols.length; i += chunk) {
    const slice = symbols.slice(i, i + chunk);
    const params = new URLSearchParams({ symbols: slice.join(","), timeframe, limit: "10000", start: startStr, end: endStr });
    const res = await fetch(`${API}/options/bars?${params}`);
    const data = await res.json();
    if (!res.ok) {
      const opraHint = opraErrorMessage(data.message || data.error) ? " OPRA agreement is not signed. Sign the Options agreement in your Alpaca account (app.alpaca.markets → Account → Agreements)." : "";
      throw new Error((data.message || "Failed to fetch options bars") + opraHint);
    }
    for (const sym of slice) {
      const bars = (data.bars && data.bars[sym]) ? data.bars[sym].sort((a, b) => new Date(a.t) - new Date(b.t)) : [];
      if (bars.length) bySymbol[sym] = bars;
    }
  }
  return bySymbol;
}

function runBacktestWithOptions(stockBars, optionsBarsBySymbol, contracts, indicatorKeys, budget, takeProfitPct, stopLossPct, direction, exitOnSignal) {
  const trades = [];
  let position = null;
  let cash = Number(budget) || 10000;
  const initialCash = cash;
  let peakEquity = initialCash;
  let maxDrawdown = 0;
  const tp = takeProfitPct != null && Number.isFinite(takeProfitPct) ? Number(takeProfitPct) : null;
  const sl = stopLossPct != null && Number.isFinite(stopLossPct) ? Number(stopLossPct) : null;
  const dir = (direction || "bullish").toLowerCase();
  const doCalls = dir === "bullish" || dir === "both";
  const doPuts = dir === "bearish" || dir === "both";
  const exitOnSignalFlip = exitOnSignal !== false;
  const callContracts = contracts.filter((c) => (c.type || "").toLowerCase() === "call");
  const putContracts = contracts.filter((c) => (c.type || "").toLowerCase() === "put");
  if (!indicatorKeys.length || stockBars.length < 2 || !contracts.length) {
    return { trades, summary: { totalPnl: 0, totalPnlPct: 0, numTrades: 0, winCount: 0, finalEquity: initialCash, maxDrawdown: 0 } };
  }
  const optionsByDate = typeof indexOptionsBarsByDate === "function" ? indexOptionsBarsByDate(optionsBarsBySymbol) : {};

  function closeOptionPosition(pos, exitPrice, exitTime, exitReason) {
    const proceeds = pos.contracts * 100 * exitPrice;
    cash += proceeds;
    const pnl = proceeds - pos.cost;
    trades.push({
      entryTime: pos.entryTime,
      exitTime: exitTime,
      side: "long",
      optionSide: pos.isCall ? "call" : "put",
      optionSymbol: pos.symbol,
      contracts: pos.contracts,
      entryPrice: pos.entryPrice,
      exitPrice,
      cost: pos.cost,
      proceeds,
      pnl,
      pnlPct: pos.cost > 0 ? (pnl / pos.cost) * 100 : 0,
      exitReason: exitReason || "end_of_backtest",
    });
  }

  for (let i = 0; i < stockBars.length; i++) {
    const stockBar = stockBars[i];
    const dateStr = stockBar.t ? String(stockBar.t).slice(0, 10) : "";
    const optionBarsAtDate = optionsByDate[dateStr] || {};
    const history = stockBars.slice(0, i + 1).map((b) => ({ close: b.c, high: b.h, low: b.l, volume: b.v ?? 0, vwap: b.vw }));
    const signals = typeof computeIndicatorSignals === "function" ? computeIndicatorSignals(history) : {};
    const allBullish = indicatorKeys.every((k) => typeof isSignalBullish === "function" && isSignalBullish(signals, k));
    const anyBearish = indicatorKeys.some((k) => typeof isSignalBearish === "function" && isSignalBearish(signals, k));
    const allBearish = indicatorKeys.every((k) => typeof isSignalBearish === "function" && isSignalBearish(signals, k));
    const anyBullish = indicatorKeys.some((k) => typeof isSignalBullish === "function" && isSignalBullish(signals, k));

    if (position) {
      const optionBars = optionsBarsBySymbol[position.symbol] || [];
      const exitBar = optionBars.find((b) => (b.t ? String(b.t).slice(0, 10) : "") === dateStr);
      const exitPrice = exitBar?.c != null ? Number(exitBar.c) : 0;
      const currentEquity = cash + position.contracts * 100 * exitPrice;
      if (currentEquity > peakEquity) peakEquity = currentEquity;
      const drawdown = peakEquity > 0 ? (peakEquity - currentEquity) / peakEquity : 0;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;

      const pnlPct = position.cost > 0 ? ((position.contracts * 100 * exitPrice - position.cost) / position.cost) * 100 : 0;
      const hitTakeProfit = tp != null && pnlPct >= tp;
      const hitStopLoss = sl != null && pnlPct <= -sl;
      const exitCall = position.isCall && ((exitOnSignalFlip && anyBearish) || hitTakeProfit || hitStopLoss);
      const exitPut = !position.isCall && ((exitOnSignalFlip && anyBullish) || hitTakeProfit || hitStopLoss);
      if (exitCall || exitPut) {
        const exitReason = hitTakeProfit ? "take_profit" : hitStopLoss ? "stop_loss" : "signal";
        closeOptionPosition(position, exitPrice, stockBar.t, exitReason);
        position = null;
      }
    }
    if (!position) {
      if (doCalls && allBullish && cash > 0 && callContracts.length) {
        const bestSymbol = typeof pickBestOptionAtBar === "function" ? pickBestOptionAtBar(stockBar, optionBarsAtDate, callContracts, {}, "call") : null;
        if (bestSymbol) {
          const bar = optionBarsAtDate[bestSymbol];
          if (bar && bar.c != null && bar.c > 0) {
            const optionPrice = Number(bar.c);
            const contractsCount = Math.floor(cash / (optionPrice * 100));
            if (contractsCount > 0) {
              const cost = contractsCount * optionPrice * 100;
              cash -= cost;
              position = { symbol: bestSymbol, isCall: true, entryPrice: optionPrice, contracts: contractsCount, entryTime: stockBar.t, cost };
            }
          }
        }
      } else if (doPuts && allBearish && cash > 0 && putContracts.length) {
        const bestSymbol = typeof pickBestOptionAtBar === "function" ? pickBestOptionAtBar(stockBar, optionBarsAtDate, putContracts, {}, "put") : null;
        if (bestSymbol) {
          const bar = optionBarsAtDate[bestSymbol];
          if (bar && bar.c != null && bar.c > 0) {
            const optionPrice = Number(bar.c);
            const contractsCount = Math.floor(cash / (optionPrice * 100));
            if (contractsCount > 0) {
              const cost = contractsCount * optionPrice * 100;
              cash -= cost;
              position = { symbol: bestSymbol, isCall: false, entryPrice: optionPrice, contracts: contractsCount, entryTime: stockBar.t, cost };
            }
          }
        }
      }
    }
  }

  if (position && stockBars.length) {
    const lastDate = stockBars[stockBars.length - 1].t ? String(stockBars[stockBars.length - 1].t).slice(0, 10) : "";
    const optionBars = optionsBarsBySymbol[position.symbol] || [];
    const lastBar = optionBars.find((b) => (b.t ? String(b.t).slice(0, 10) : "") === lastDate);
    const exitPrice = lastBar?.c != null ? Number(lastBar.c) : 0;
    closeOptionPosition(position, exitPrice, stockBars[stockBars.length - 1].t, "end_of_backtest");
  }

  const totalPnl = cash - initialCash;
  const totalPnlPct = initialCash > 0 ? (totalPnl / initialCash) * 100 : 0;
  const winCount = trades.filter((t) => t.pnl > 0).length;
  return {
    trades,
    summary: { totalPnl, totalPnlPct, numTrades: trades.length, winCount, finalEquity: cash, maxDrawdown: maxDrawdown * 100 },
  };
}

function runBacktest(bars, indicatorKeys, budget, takeProfitPct, stopLossPct, direction, exitOnSignal) {
  const trades = [];
  let position = null;
  let cash = Number(budget) || 10000;
  const initialCash = cash;
  let peakEquity = initialCash;
  let maxDrawdown = 0;
  const tp = takeProfitPct != null && Number.isFinite(takeProfitPct) ? Number(takeProfitPct) : null;
  const sl = stopLossPct != null && Number.isFinite(stopLossPct) ? Number(stopLossPct) : null;
  const dir = (direction || "bullish").toLowerCase();
  const doLong = dir === "bullish" || dir === "both";
  const doShort = dir === "bearish" || dir === "both";
  const exitOnSignalFlip = exitOnSignal !== false;

  if (!indicatorKeys.length || bars.length < 2) return { trades, summary: { totalPnl: 0, totalPnlPct: 0, numTrades: 0, winCount: 0, finalEquity: initialCash, maxDrawdown: 0 } };

  for (let i = 0; i < bars.length; i++) {
    const history = bars.slice(0, i + 1).map((b) => ({
      close: b.c,
      high: b.h,
      low: b.l,
      volume: b.v ?? 0,
      vwap: b.vw,
    }));
    const signals = typeof computeIndicatorSignals === "function" ? computeIndicatorSignals(history) : {};
    const allBullish = indicatorKeys.every((k) => typeof isSignalBullish === "function" && isSignalBullish(signals, k));
    const anyBearish = indicatorKeys.some((k) => typeof isSignalBearish === "function" && isSignalBearish(signals, k));
    const allBearish = indicatorKeys.every((k) => typeof isSignalBearish === "function" && isSignalBearish(signals, k));
    const anyBullish = indicatorKeys.some((k) => typeof isSignalBullish === "function" && isSignalBullish(signals, k));
    const price = bars[i].c;
    const time = bars[i].t;

    if (position) {
      const isLong = position.long !== false;
      const currentEquity = isLong ? cash + position.shares * price : cash - position.shares * price;
      if (currentEquity > peakEquity) peakEquity = currentEquity;
      const drawdown = peakEquity > 0 ? (peakEquity - currentEquity) / peakEquity : 0;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;

      const costOrProceeds = isLong ? position.cost : position.entryProceeds;
      const currentValue = isLong ? position.shares * price : -position.shares * price;
      const pnlPct = costOrProceeds > 0 ? ((currentValue - (isLong ? position.cost : -position.entryProceeds)) / costOrProceeds) * 100 : 0;
      const pnlPctLong = isLong && position.cost > 0 ? ((position.shares * price - position.cost) / position.cost) * 100 : 0;
      const pnlPctShort = !isLong && position.entryProceeds > 0 ? ((position.entryProceeds - position.shares * price) / position.entryProceeds) * 100 : 0;
      const pnlPctPos = isLong ? pnlPctLong : pnlPctShort;
      const hitTakeProfit = tp != null && pnlPctPos >= tp;
      const hitStopLoss = sl != null && pnlPctPos <= -sl;
      const exitLong = isLong && ((exitOnSignalFlip && anyBearish) || hitTakeProfit || hitStopLoss);
      const exitShort = !isLong && ((exitOnSignalFlip && anyBullish) || hitTakeProfit || hitStopLoss);
      if (exitLong) {
        const proceeds = position.shares * price;
        cash += proceeds;
        const pnl = proceeds - position.cost;
        const exitReason = hitTakeProfit ? "take_profit" : hitStopLoss ? "stop_loss" : "signal";
        trades.push({ entryTime: position.entryTime, exitTime: time, side: "long", shares: position.shares, entryPrice: position.entryPrice, exitPrice: price, cost: position.cost, proceeds, pnl, pnlPct: (pnl / position.cost) * 100, exitReason });
        position = null;
      } else if (exitShort) {
        const coverCost = position.shares * price;
        cash -= coverCost;
        const pnl = position.entryProceeds - coverCost;
        const exitReason = hitTakeProfit ? "take_profit" : hitStopLoss ? "stop_loss" : "signal";
        trades.push({ entryTime: position.entryTime, exitTime: time, side: "short", shares: position.shares, entryPrice: position.entryPrice, exitPrice: price, cost: coverCost, proceeds: position.entryProceeds, pnl, pnlPct: position.entryProceeds > 0 ? (pnl / position.entryProceeds) * 100 : 0, exitReason });
        position = null;
      }
    }
    if (!position) {
      if (doLong && allBullish && cash > 0 && price > 0) {
        const shares = Math.floor(cash / price);
        if (shares > 0) {
          const cost = shares * price;
          cash -= cost;
          position = { long: true, shares, entryPrice: price, entryTime: time, cost };
        }
      } else if (doShort && allBearish && price > 0) {
        const margin = cash * 0.5;
        const shares = Math.floor(margin / price);
        if (shares > 0) {
          const entryProceeds = shares * price;
          cash += entryProceeds;
          position = { long: false, shares, entryPrice: price, entryTime: time, entryProceeds };
        }
      }
    }
  }

  if (position && bars.length) {
    const lastPrice = bars[bars.length - 1].c;
    const isLong = position.long !== false;
    if (isLong) {
      cash += position.shares * lastPrice;
      const pnl = position.shares * lastPrice - position.cost;
      trades.push({ entryTime: position.entryTime, exitTime: bars[bars.length - 1].t, side: "long", shares: position.shares, entryPrice: position.entryPrice, exitPrice: lastPrice, cost: position.cost, proceeds: position.shares * lastPrice, pnl, pnlPct: (pnl / position.cost) * 100, exitReason: "end_of_backtest" });
    } else {
      cash -= position.shares * lastPrice;
      const pnl = position.entryProceeds - position.shares * lastPrice;
      trades.push({ entryTime: position.entryTime, exitTime: bars[bars.length - 1].t, side: "short", shares: position.shares, entryPrice: position.entryPrice, exitPrice: lastPrice, cost: position.shares * lastPrice, proceeds: position.entryProceeds, pnl, pnlPct: position.entryProceeds > 0 ? (pnl / position.entryProceeds) * 100 : 0, exitReason: "end_of_backtest" });
    }
  }

  const totalPnl = cash - initialCash;
  const totalPnlPct = initialCash > 0 ? (totalPnl / initialCash) * 100 : 0;
  const winCount = trades.filter((t) => t.pnl > 0).length;
  return {
    trades,
    summary: {
      totalPnl,
      totalPnlPct,
      numTrades: trades.length,
      winCount,
      finalEquity: cash,
      maxDrawdown: maxDrawdown * 100,
    },
  };
}

function renderBacktestResult(result, symbol, timeframe, budget, useOptions = false, takeProfitPct = null, stopLossPct = null, direction = "bullish") {
  if (!botBacktestOutput) return;
  const { trades, summary } = result;
  const fmt = (n) => (n == null ? "—" : Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const fmtPct = (n) => (n == null ? "—" : Number(n).toFixed(2) + "%");
  const tpSlLine = (takeProfitPct != null || stopLossPct != null) ? ` · TP ${takeProfitPct != null ? takeProfitPct + "%" : "—"} / SL ${stopLossPct != null ? stopLossPct + "%" : "—"}` : "";
  const dirLabel = direction === "bullish" ? "Bullish" : direction === "bearish" ? "Bearish" : "Both";
  const exitReasonLabel = (r) => ({ take_profit: "Take profit", stop_loss: "Stop loss", signal: "Signal", end_of_backtest: "End of backtest" }[r] || r || "—");
  const rows = trades.map((t) => {
    const qty = useOptions ? (t.contracts ?? 0) : (t.shares ?? 0);
    const sideCol = useOptions ? `<td>${t.optionSide || "call"}</td>` : `<td>${t.side || "long"}</td>`;
    const optCol = useOptions ? `<td title="${t.optionSymbol || ""}">${(t.optionSymbol || "").slice(-12)}</td>` : "";
    return `<tr>
        <td>${t.entryTime ? new Date(t.entryTime).toLocaleString() : "—"}</td>
        <td>${t.exitTime ? new Date(t.exitTime).toLocaleString() : "—"}</td>
        ${sideCol}${optCol}<td>${qty}</td>
        <td>${fmt(t.entryPrice)}</td>
        <td>${fmt(t.exitPrice)}</td>
        <td>${fmt(t.pnl)}</td>
        <td class="${t.pnl >= 0 ? "positive" : "negative"}">${fmtPct(t.pnlPct)}</td>
        <td class="muted small">${exitReasonLabel(t.exitReason)}</td>
      </tr>`;
  });
  const headerSide = useOptions ? "<th>Type</th>" : "<th>Side</th>";
  const headerQty = useOptions ? "<th>Option</th><th>Contracts</th>" : "<th>Shares</th>";
  const headerExitReason = "<th>Exit reason</th>";
  const summaryLine = useOptions ? ` · <strong>Options</strong> (historical + contract selection)` : "";
  const directionLine = ` · <strong>${dirLabel}</strong>`;
  botBacktestOutput.innerHTML = `
    <div class="backtest-summary">
      <h3>Summary</h3>
      <p><strong>${symbol}</strong> · ${timeframe} · Budget $${Number(budget).toLocaleString()}${directionLine}${summaryLine}${tpSlLine}</p>
      <ul>
        <li>Total P&amp;L: <span class="${summary.totalPnl >= 0 ? "positive" : "negative"}">${fmt(summary.totalPnl)} (${fmtPct(summary.totalPnlPct)})</span></li>
        <li>Final equity: ${fmt(summary.finalEquity)}</li>
        <li>Trades: ${summary.numTrades} (${summary.winCount} wins)</li>
        <li>Max drawdown: ${fmtPct(summary.maxDrawdown)}</li>
      </ul>
    </div>
    <div class="backtest-trades table-wrap">
      <h3>Trades</h3>
      ${trades.length ? `<table><thead><tr><th>Entry</th><th>Exit</th>${headerSide}${headerQty}<th>Entry $</th><th>Exit $</th><th>P&amp;L</th><th>P&amp;L %</th>${headerExitReason}</tr></thead><tbody>${rows.join("")}</tbody></table>` : "<p class=\"muted\">No trades.</p>"}
    </div>
  `;
}

function loadBotCreatorPage() {
  if (botTickerStatus) botTickerStatus.textContent = botCreatorSymbol ? `Loaded: ${botCreatorSymbol}` : "Enter a ticker and click Load.";
  if (botBacktestStart && !botBacktestStart.value) {
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - 1);
    botBacktestStart.value = start.toISOString().slice(0, 10);
    if (botBacktestEnd) botBacktestEnd.value = end.toISOString().slice(0, 10);
  }
  if (botCreatorSymbol) loadBotCreatorChart();
}

botTickerLoad?.addEventListener("click", async () => {
  const symbol = (botTickerInput?.value || "").trim().toUpperCase();
  if (!symbol) return;
  botCreatorSymbol = symbol;
  if (botTickerStatus) botTickerStatus.textContent = `Loading ${symbol}…`;
  await loadBotCreatorChart();
  if (botTickerStatus) botTickerStatus.textContent = `Loaded: ${symbol}. Change range and click Update chart to refresh.`;
});

botChartRange?.addEventListener("change", () => {
  const isToday = botChartRange?.value === "today";
  if (botTodayBarSizeWrap) botTodayBarSizeWrap.style.display = isToday ? "" : "none";
  if (botCreatorSymbol) loadBotCreatorChart();
});
botTodayBarSize?.addEventListener("change", () => {
  if (botCreatorSymbol) loadBotCreatorChart();
});
if (botTodayBarSizeWrap) botTodayBarSizeWrap.style.display = botChartRange?.value === "today" ? "" : "none";

["indPriceOverEma50", "indPriceOverEma200", "indEma20MinusEma50", "indEmaSlope", "indRsi", "indRsiSlope", "indRsiDivergence", "indRsiDistanceFrom50", "indMacdLine", "indBollinger", "indVwap"].forEach((id) => {
  document.getElementById(id)?.addEventListener("change", () => {
    if (lastBotCreatorRows?.length) {
      renderBotCreatorChart(lastBotCreatorRows);
      updateBotIndicatorValues(lastBotCreatorRows);
    }
  });
});

botBacktestRun?.addEventListener("click", async () => {
  const symbol = (botTickerInput?.value || botCreatorSymbol || "").trim().toUpperCase();
  const startStr = botBacktestStart?.value;
  const endStr = botBacktestEnd?.value;
  const timeframe = botBacktestTimeframe?.value || "1Day";
  const budget = botBacktestBudget?.value || "10000";
  if (!symbol) {
    if (botBacktestOutput) botBacktestOutput.innerHTML = "<p class=\"error\">Load a ticker first.</p>";
    return;
  }
  if (!startStr || !endStr) {
    if (botBacktestOutput) botBacktestOutput.innerHTML = "<p class=\"error\">Set start and end dates.</p>";
    return;
  }
  const indicatorKeys = getSelectedBacktestIndicatorKeys();
  if (!indicatorKeys.length) {
    if (botBacktestOutput) botBacktestOutput.innerHTML = "<p class=\"error\">Select at least one indicator in the Indicators section to combine.</p>";
    return;
  }
  if (botBacktestOutput) botBacktestOutput.innerHTML = "<p class=\"muted\">Running backtest…</p>";
  try {
    const stockBars = await fetchBarsForBacktest(symbol, startStr, endStr, timeframe);
    if (stockBars.length < 2) {
      botBacktestOutput.innerHTML = "<p class=\"error\">Not enough bars for the selected range and timeframe. Try a longer range or different timeframe.</p>";
      return;
    }
    const useOptions = botBacktestUseOptions?.checked === true;
    const exitOnSignal = botBacktestExitOnSignal?.checked !== false;
    const direction = botBacktestDirection?.value || "bullish";
    const takeProfitPct = botBacktestTakeProfit?.value ? parseFloat(botBacktestTakeProfit.value) : null;
    const stopLossPct = botBacktestStopLoss?.value ? parseFloat(botBacktestStopLoss.value) : null;
    const optionType = direction === "bullish" ? "call" : direction === "bearish" ? "put" : "both";
    let result;
    if (useOptions) {
      const contracts = await fetchOptionContracts(symbol, startStr, endStr, optionType);
      if (!contracts.length) {
        botBacktestOutput.innerHTML = "<p class=\"error\">No option contracts found for this symbol and date range. Try stock-only backtest or a different range.</p>";
        return;
      }
      const optionSymbols = contracts.map((c) => c.symbol);
      const optionsBarsBySymbol = await fetchOptionsBarsForBacktest(optionSymbols, startStr, endStr, timeframe);
      result = runBacktestWithOptions(stockBars, optionsBarsBySymbol, contracts, indicatorKeys, budget, takeProfitPct, stopLossPct, direction, exitOnSignal);
    } else {
      result = runBacktest(stockBars, indicatorKeys, budget, takeProfitPct, stopLossPct, direction, exitOnSignal);
    }
    renderBacktestResult(result, symbol, timeframe, budget, useOptions, takeProfitPct, stopLossPct, direction);
  } catch (e) {
    if (botBacktestOutput) {
      const opraMsg = opraErrorMessage(e.message);
      botBacktestOutput.innerHTML = opraMsg || `<p class="error">${e.message}</p>`;
    }
  }
});

bindZoomToolbar(() => equityChartInstance, "equityChartZoomIn", "equityChartZoomOut", "equityChartZoomReset");
bindZoomToolbar(() => tickerBarsChartInstance, "tickerChartZoomIn", "tickerChartZoomOut", "tickerChartZoomReset");
bindZoomToolbar(() => botCreatorChartInstance, "botChartZoomIn", "botChartZoomOut", "botChartZoomReset");

// --- Status ---
const connectionEl = document.getElementById("connection");
const statusText = document.getElementById("statusText");

async function checkStatus() {
  try {
    const res = await fetch(`${API}/status`);
    const data = await res.json();
    connectionEl?.classList.toggle("connected", data.connected);
    connectionEl?.classList.toggle("error", !data.connected);
    if (data.connected) {
      statusText.textContent = data.dataOk ? "Connected" : "Account connected";
    } else {
      statusText.textContent = data.error || "Disconnected";
    }
  } catch (e) {
    connectionEl?.classList.remove("connected");
    connectionEl?.classList.add("error");
    statusText.textContent = "Offline";
  }
}

// --- Init ---
renderRoute();
checkStatus();
