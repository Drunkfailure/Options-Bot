const API = "/api";

// --- Router (hash-based) ---
const viewHome = document.getElementById("view-home");
const viewTicker = document.getElementById("view-ticker");
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");

function getRoute() {
  const hash = (window.location.hash || "#/").slice(1);
  const parts = hash.split("/").filter(Boolean);
  if (parts[0] === "ticker" && parts[1]) return { view: "ticker", symbol: parts[1].toUpperCase() };
  return { view: "home", symbol: null };
}

function renderRoute() {
  const route = getRoute();
  viewHome.classList.toggle("hidden", route.view !== "home");
  viewTicker.classList.toggle("hidden", route.view !== "ticker");
  if (route.view === "ticker") {
    if (searchInput) searchInput.value = route.symbol;
    loadTickerPage(route.symbol);
  } else {
    loadHomePage();
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
let barsChartInstance = null;

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
  const timestamps = history?.timestamp || [];
  const equity = history?.equity || [];
  if (timestamps.length === 0 || equity.length === 0) {
    equityChart.innerHTML = "<p class=\"muted\">No portfolio history for this period.</p>";
    return;
  }
  const minE = Math.min(...equity);
  const maxE = Math.max(...equity);
  const range = maxE - minE || 1;
  const padding = { top: 8, right: 8, bottom: 8, left: 8 };
  const w = equityChart.clientWidth || 400;
  const h = 180;
  const x = (i) => padding.left + (i / (equity.length - 1 || 1)) * (w - padding.left - padding.right);
  const y = (v) => padding.top + (1 - (v - minE) / range) * (h - padding.top - padding.bottom);
  const pathD = equity.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(v)}`).join(" ");
  const isPositive = equity[equity.length - 1] >= equity[0];
  equityChart.innerHTML = `
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <path d="${pathD}" fill="none" stroke="${isPositive ? "var(--accent)" : "var(--danger)"}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
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
const tickerBarsRefresh = document.getElementById("tickerBarsRefresh");
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

function renderOptionTable(rows, maxRows = 80) {
  if (!rows.length) return "<p class=\"muted\">None</p>";
  const slice = rows.slice(0, maxRows);
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

async function loadTickerOptionChain(symbol) {
  if ((!tickerCallsOutput && !tickerPutsOutput) || !symbol) return;
  if (tickerCallsOutput) tickerCallsOutput.innerHTML = "<p class=\"muted\">Loading…</p>";
  if (tickerPutsOutput) tickerPutsOutput.innerHTML = "<p class=\"muted\">Loading…</p>";
  try {
    const res = await fetch(`${API}/options/snapshots/${encodeURIComponent(symbol)}?limit=500`);
    const data = await res.json();
    if (!res.ok) {
      const err = `<p class="error">${data.message || res.status}</p>`;
      if (tickerCallsOutput) tickerCallsOutput.innerHTML = err;
      if (tickerPutsOutput) tickerPutsOutput.innerHTML = err;
      return;
    }
    const snapshots = data.snapshots || {};
    const contracts = Object.keys(snapshots);
    const calls = [];
    const puts = [];
    for (const sym of contracts) {
      const s = snapshots[sym] || {};
      const q = s.latestQuote || {};
      const t = s.latestTrade || {};
      const g = s.greeks || {};
      const strikeRaw = sym.length >= 8 ? parseInt(sym.slice(-8), 10) : 0;
      const strike = strikeRaw / 1000;
      const row = {
        symbol: sym,
        strike: strike.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        bid: q.bp ?? "—",
        ask: q.ap ?? "—",
        last: t.p ?? "—",
        delta: g.delta != null ? Number(g.delta).toFixed(3) : "—",
        iv: s.impliedVolatility != null ? (s.impliedVolatility * 100).toFixed(1) + "%" : "—",
      };
      if (isCall(sym)) calls.push(row);
      else puts.push(row);
    }
    calls.sort((a, b) => parseFloat(a.strike) - parseFloat(b.strike));
    puts.sort((a, b) => parseFloat(a.strike) - parseFloat(b.strike));
    if (tickerCallsOutput) tickerCallsOutput.innerHTML = renderOptionTable(calls);
    if (tickerPutsOutput) tickerPutsOutput.innerHTML = renderOptionTable(puts);
  } catch (e) {
    const err = `<p class="error">${e.message}</p>`;
    if (tickerCallsOutput) tickerCallsOutput.innerHTML = err;
    if (tickerPutsOutput) tickerPutsOutput.innerHTML = err;
  }
}

function renderTickerBarsChart(rows) {
  if (tickerBarsChartInstance) {
    tickerBarsChartInstance.destroy();
    tickerBarsChartInstance = null;
  }
  if (!tickerBarsChartWrap || !rows.length) return;
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
      plugins: { legend: { labels: { color: theme.text } } },
      scales: {
        x: { grid: { color: theme.grid }, ticks: { color: theme.muted, maxTicksLimit: 10 } },
        y: { grid: { color: theme.grid }, ticks: { color: theme.muted } },
      },
    },
  });
}

async function loadTickerBars(symbol) {
  if (!tickerBarsOutput || !tickerBarsChartWrap || !symbol) return;
  tickerBarsOutput.innerHTML = "";
  tickerBarsChartWrap.innerHTML = "<p class=\"no-chart\">Loading…</p>";
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);
  const startStr = start.toISOString().slice(0, 10);
  const endStr = end.toISOString().slice(0, 10);
  try {
    const params = new URLSearchParams({
      symbols: symbol,
      timeframe: tickerTimeframe?.value || "1Day",
      limit: "100",
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
          ${rows.map((r) => `<tr><td>${r.time}</td><td>${r.open}</td><td>${r.high}</td><td>${r.low}</td><td>${r.close}</td><td>${r.volume}</td></tr>`).join("")}
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
tickerBarsRefresh?.addEventListener("click", () => {
  const route = getRoute();
  if (route.view === "ticker" && route.symbol) loadTickerBars(route.symbol);
});

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
