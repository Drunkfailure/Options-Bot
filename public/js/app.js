const API = "/api";

const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const connectionEl = document.getElementById("connection");

const accountSummary = document.getElementById("accountSummary");
const equityChart = document.getElementById("equityChart");
const chartPeriod = document.getElementById("chartPeriod");
const recentTrades = document.getElementById("recentTrades");

const liveSymbol = document.getElementById("liveSymbol");
const btnQuote = document.getElementById("btnQuote");
const btnTrade = document.getElementById("btnTrade");
const liveOutput = document.getElementById("liveOutput");

const barSymbols = document.getElementById("barSymbols");
const timeframe = document.getElementById("timeframe");
const startInput = document.getElementById("start");
const endInput = document.getElementById("end");
const btnBars = document.getElementById("btnBars");
const barsChartWrap = document.getElementById("barsChartWrap");
const barsOutput = document.getElementById("barsOutput");

const optUnderlying = document.getElementById("optUnderlying");
const optType = document.getElementById("optType");
const btnOptionChain = document.getElementById("btnOptionChain");
const optionChainOutput = document.getElementById("optionChainOutput");
const optBarSymbols = document.getElementById("optBarSymbols");
const optBarTimeframe = document.getElementById("optBarTimeframe");
const optBarStart = document.getElementById("optBarStart");
const optBarEnd = document.getElementById("optBarEnd");
const btnOptionBars = document.getElementById("btnOptionBars");
const optionBarsOutput = document.getElementById("optionBarsOutput");

let barsChartInstance = null;

// Set default date range (e.g. last 30 days)
function setDefaultDates() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);
  endInput.value = end.toISOString().slice(0, 10);
  startInput.value = start.toISOString().slice(0, 10);
  if (optBarStart && optBarEnd) {
    optBarEnd.value = end.toISOString().slice(0, 10);
    optBarStart.value = start.toISOString().slice(0, 10);
  }
}
setDefaultDates();

// --- Dashboard: account, portfolio history, recent trades ---
let selectedPeriod = "1M";

function fmtMoney(n) {
  if (n == null || n === undefined) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function fmtPct(n) {
  if (n == null || n === undefined) return "—";
  const s = (n * 100).toFixed(2);
  return (n >= 0 ? "+" : "") + s + "%";
}

async function loadAccount() {
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
      equityChart.innerHTML = `<p class="error">${data.message || "Failed to load history"}</p>`;
      return;
    }
    renderEquityChart(data);
  } catch (e) {
    equityChart.innerHTML = `<p class="error">${e.message}</p>`;
  }
}

async function loadOrders() {
  try {
    const res = await fetch(`${API}/orders?status=all&limit=25`);
    const data = await res.json();
    if (!res.ok) {
      recentTrades.innerHTML = `<p class="error">${data.message || "Failed to load orders"}</p>`;
      return;
    }
    const orders = Array.isArray(data) ? data : [];
    if (orders.length === 0) {
      recentTrades.innerHTML = "<p class=\"muted\">No recent orders.</p>";
      return;
    }
    recentTrades.innerHTML = `
      <table>
        <thead><tr>
          <th>Symbol</th><th>Side</th><th>Qty</th><th>Filled</th><th>Type</th><th>Status</th><th>Time</th>
        </tr></thead>
        <tbody>
          ${orders.slice(0, 15).map(o => `
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
  } catch (e) {
    recentTrades.innerHTML = `<p class="error">${e.message}</p>`;
  }
}

async function loadDashboard() {
  await Promise.all([loadAccount(), loadPortfolioHistory(), loadOrders()]);
}

chartPeriod?.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-period]");
  if (!btn) return;
  chartPeriod.querySelectorAll("button").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  selectedPeriod = btn.dataset.period;
  loadPortfolioHistory();
});

async function checkStatus() {
  try {
    const res = await fetch(`${API}/status`);
    const data = await res.json();
    connectionEl.classList.toggle("connected", data.connected);
    connectionEl.classList.toggle("error", !data.connected);
    if (data.connected) {
      statusText.textContent = data.dataOk ? "Connected (account + market data)" : "Account connected · Market data: try data.alpaca.markets in .env";
    } else {
      statusText.textContent = data.error || "Disconnected";
    }
    return data.connected;
  } catch (e) {
    connectionEl.classList.remove("connected");
    connectionEl.classList.add("error");
    statusText.textContent = "Cannot reach server";
    return false;
  }
}

function showLive(data, isError = false) {
  liveOutput.classList.remove("empty");
  liveOutput.classList.toggle("error", isError);
  liveOutput.innerHTML = `<pre>${JSON.stringify(data, null, 2)}</pre>`;
}

async function getQuote() {
  const symbols = liveSymbol.value.trim() || "SPY";
  liveOutput.classList.add("empty");
  liveOutput.textContent = "Loading…";
  try {
    const res = await fetch(`${API}/stocks/quotes/latest?symbols=${encodeURIComponent(symbols)}`);
    const data = await res.json();
    showLive(data, !res.ok);
  } catch (e) {
    showLive({ error: e.message }, true);
  }
}

async function getTrade() {
  const symbol = liveSymbol.value.trim() || "SPY";
  liveOutput.classList.add("empty");
  liveOutput.textContent = "Loading…";
  try {
    const res = await fetch(`${API}/stocks/trades/latest?symbol=${encodeURIComponent(symbol)}`);
    const data = await res.json();
    showLive(data, !res.ok);
  } catch (e) {
    showLive({ error: e.message }, true);
  }
}

const DATA_URL_TIP = `<p class="data-tip">Using paper trading? Set <code>ALPACA_DATA_BASE_URL=https://data.alpaca.markets</code> in <code>.env</code> and restart the server. Sandbox data URL often returns no data for stock bars.</p>`;

async function getBars() {
  const symbols = barSymbols.value.trim() || "SPY";
  let start = startInput.value;
  let end = endInput.value;
  if (!start || !end) {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);
    end = endDate.toISOString().slice(0, 10);
    start = startDate.toISOString().slice(0, 10);
  }
  barsOutput.classList.add("empty");
  barsOutput.textContent = "Loading…";
  if (barsChartWrap) barsChartWrap.innerHTML = "<p class=\"no-chart\">Loading…</p>";
  try {
    const params = new URLSearchParams({ symbols, timeframe: timeframe.value, limit: "100" });
    params.set("start", start);
    params.set("end", end);
    const res = await fetch(`${API}/stocks/bars?${params}`);
    const data = await res.json();
    if (!res.ok) {
      barsOutput.classList.add("error");
      const msg = data.message || data.error || `HTTP ${res.status}`;
      barsOutput.innerHTML = `<p class="error"><strong>${msg}</strong></p><pre>${JSON.stringify(data, null, 2)}</pre>${DATA_URL_TIP}`;
      if (barsChartWrap) barsChartWrap.innerHTML = "<p class=\"no-chart\">Could not load bars. See message below.</p>";
      return;
    }
    renderBarsTable(data);
  } catch (e) {
    barsOutput.classList.add("error");
    barsOutput.innerHTML = `<p class="error"><strong>${e.message}</strong></p>${DATA_URL_TIP}`;
    if (barsChartWrap) barsChartWrap.innerHTML = "<p class=\"no-chart\">Request failed. See message below.</p>";
  }
}

function renderBarsChart(rows) {
  if (barsChartInstance) {
    barsChartInstance.destroy();
    barsChartInstance = null;
  }
  barsChartWrap.innerHTML = "<canvas id=\"barsChart\" aria-label=\"Price chart\"></canvas>";
  const canvas = document.getElementById("barsChart");
  if (!canvas || rows.length === 0) return;
  const labels = rows.map((r) => {
    const d = new Date(r.time);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: r.time.includes("T") ? "2-digit" : undefined, minute: r.time.includes("T") ? "2-digit" : undefined });
  });
  const closes = rows.map((r) => r.close);
  const volumes = rows.map((r) => r.volumeNum != null ? r.volumeNum : Number(String(r.volume).replace(/,/g, "")) || 0);
  const theme = {
    text: "#e6e9ef",
    muted: "#8b92a4",
    grid: "#2a3140",
    accent: "#00c896",
    accentDim: "#00a87a",
  };
  const ctx = canvas.getContext("2d");
  barsChartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Close",
          data: closes,
          borderColor: theme.accent,
          backgroundColor: theme.accent + "20",
          fill: true,
          tension: 0.1,
          yAxisID: "y",
        },
        {
          label: "Volume",
          data: volumes,
          backgroundColor: theme.muted + "40",
          borderColor: theme.muted,
          borderWidth: 1,
          fill: true,
          yAxisID: "y1",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 2,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { labels: { color: theme.text } },
      },
      scales: {
        x: {
          grid: { color: theme.grid },
          ticks: { color: theme.muted, maxTicksLimit: 10 },
        },
        y: {
          type: "linear",
          display: true,
          position: "left",
          grid: { color: theme.grid },
          ticks: { color: theme.muted },
        },
        y1: {
          type: "linear",
          display: true,
          position: "right",
          grid: { drawOnChartArea: false },
          ticks: { color: theme.muted },
        },
      },
    },
  });
}

function renderBarsTable(data) {
  const bars = data.bars || {};
  const symbols = Object.keys(bars);
  if (symbols.length === 0) {
    if (barsChartWrap) {
      barsChartWrap.innerHTML = "<p class=\"no-chart\">No bar data for this request.</p>";
    }
    barsOutput.classList.remove("empty");
    barsOutput.innerHTML = `<p>No bars returned for the selected symbol and date range.</p><p class="muted">Try: <strong>1 Day</strong> timeframe, symbol <strong>SPY</strong>, and a past date range (e.g. last 30 days). If you use paper trading, ensure <code>ALPACA_DATA_BASE_URL=https://data.alpaca.markets</code> in .env.</p>`;
    return;
  }
  const barList = bars[symbols[0]] || [];
  if (barList.length === 0) {
    if (barsChartWrap) barsChartWrap.innerHTML = "<p class=\"no-chart\">No bar data for this request.</p>";
    barsOutput.classList.remove("empty");
    barsOutput.innerHTML = `<p>No bars in range.</p><p class="muted">Try a past date range and 1 Day timeframe. Paper accounts: use <code>ALPACA_DATA_BASE_URL=https://data.alpaca.markets</code> in .env.</p>`;
    return;
  }
  const rows = [];
  for (const sym of symbols) {
    const barList = bars[sym] || [];
    for (const b of barList) {
      rows.push({
        symbol: sym,
        time: b.t || "",
        open: b.o,
        high: b.h,
        low: b.l,
        close: b.c,
        volume: (b.v ?? 0).toLocaleString(),
        vwap: b.vw != null ? Number(b.vw).toFixed(2) : "",
      });
    }
  }
  rows.sort((a, b) => new Date(a.time) - new Date(b.time));
  renderBarsChart(rows.map((r) => ({ ...r, volumeNum: Number(String(r.volume).replace(/,/g, "")) || 0 })));
  const nextToken = data.next_page_token;
  let table = `
    <table>
      <thead><tr>
        <th>Symbol</th><th>Time</th><th>Open</th><th>High</th><th>Low</th><th>Close</th><th>Volume</th><th>VWAP</th>
      </tr></thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td>${r.symbol}</td>
            <td>${r.time}</td>
            <td>${r.open}</td>
            <td>${r.high}</td>
            <td>${r.low}</td>
            <td>${r.close}</td>
            <td>${r.volume}</td>
            <td>${r.vwap}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
  if (nextToken) {
    table += `<p class="muted" style="margin-top:0.75rem">More data available (use page_token for next page).</p>`;
  }
  barsOutput.classList.remove("empty");
  barsOutput.innerHTML = table;
}

// --- Options: chain (snapshots) + historical bars ---
async function getOptionChain() {
  const underlying = (optUnderlying?.value || "SPY").trim();
  if (!underlying) return;
  if (optionChainOutput) {
    optionChainOutput.classList.add("empty");
    optionChainOutput.textContent = "Loading…";
  }
  try {
    const params = new URLSearchParams();
    if (optType?.value) params.set("type", optType.value);
    const res = await fetch(`${API}/options/snapshots/${encodeURIComponent(underlying)}?${params}`);
    const data = await res.json();
    if (!res.ok) {
      if (optionChainOutput) {
        optionChainOutput.classList.add("error");
        optionChainOutput.innerHTML = `<p class="error">${data.message || data.error || res.status}</p><pre>${JSON.stringify(data, null, 2)}</pre>`;
      }
      return;
    }
    const snapshots = data.snapshots || {};
    const contracts = Object.keys(snapshots);
    if (contracts.length === 0) {
      if (optionChainOutput) {
        optionChainOutput.classList.remove("empty");
        optionChainOutput.innerHTML = "<p>No option snapshots returned. Check symbol and data subscription.</p>";
      }
      return;
    }
    const rows = contracts.slice(0, 50).map((sym) => {
      const s = snapshots[sym] || {};
      const q = s.latestQuote || {};
      const t = s.latestTrade || {};
      const g = s.greeks || {};
      return {
        symbol: sym,
        bid: q.bp ?? "—",
        ask: q.ap ?? "—",
        last: t.p ?? "—",
        delta: g.delta != null ? Number(g.delta).toFixed(4) : "—",
        iv: s.impliedVolatility != null ? (s.impliedVolatility * 100).toFixed(2) + "%" : "—",
      };
    });
    const table = `
      <table>
        <thead><tr><th>Contract</th><th>Bid</th><th>Ask</th><th>Last</th><th>Delta</th><th>IV</th></tr></thead>
        <tbody>
          ${rows.map((r) => `<tr><td>${r.symbol}</td><td>${r.bid}</td><td>${r.ask}</td><td>${r.last}</td><td>${r.delta}</td><td>${r.iv}</td></tr>`).join("")}
        </tbody>
      </table>
    `;
    if (optionChainOutput) {
      optionChainOutput.classList.remove("empty");
      optionChainOutput.innerHTML = table + (contracts.length > 50 ? "<p class=\"muted\">Showing first 50. Use filters for more.</p>" : "");
    }
  } catch (e) {
    if (optionChainOutput) {
      optionChainOutput.classList.add("error");
      optionChainOutput.innerHTML = `<p class="error">${e.message}</p>`;
    }
  }
}

async function getOptionBars() {
  const symbols = (optBarSymbols?.value || "").trim();
  if (!symbols) {
    if (optionBarsOutput) optionBarsOutput.innerHTML = "<p class=\"error\">Enter at least one option symbol (OCC format, e.g. AAPL240419C00150000).</p>";
    return;
  }
  let start = optBarStart?.value;
  let end = optBarEnd?.value;
  if (!start || !end) {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);
    end = endDate.toISOString().slice(0, 10);
    start = startDate.toISOString().slice(0, 10);
  }
  if (optionBarsOutput) {
    optionBarsOutput.classList.add("empty");
    optionBarsOutput.textContent = "Loading…";
  }
  try {
    const params = new URLSearchParams({
      symbols,
      timeframe: optBarTimeframe?.value || "1Day",
      limit: "100",
      start,
      end,
    });
    const res = await fetch(`${API}/options/bars?${params}`);
    const data = await res.json();
    if (!res.ok) {
      if (optionBarsOutput) {
        optionBarsOutput.classList.add("error");
        optionBarsOutput.innerHTML = `<p class="error">${data.message || data.error || res.status}</p><pre>${JSON.stringify(data, null, 2)}</pre>`;
      }
      return;
    }
    const bars = data.bars || {};
    const syms = Object.keys(bars);
    if (syms.length === 0) {
      if (optionBarsOutput) {
        optionBarsOutput.classList.remove("empty");
        optionBarsOutput.innerHTML = "<p>No option bars for this range. Try different symbols or dates.</p>";
      }
      return;
    }
    const rows = [];
    for (const sym of syms) {
      for (const b of bars[sym] || []) {
        rows.push({
          symbol: sym,
          time: b.t || "",
          open: b.o,
          high: b.h,
          low: b.l,
          close: b.c,
          volume: (b.v ?? 0).toLocaleString(),
          vwap: b.vw != null ? Number(b.vw).toFixed(4) : "",
        });
      }
    }
    rows.sort((a, b) => new Date(a.time) - new Date(b.time));
    const table = `
      <table>
        <thead><tr><th>Contract</th><th>Time</th><th>Open</th><th>High</th><th>Low</th><th>Close</th><th>Volume</th><th>VWAP</th></tr></thead>
        <tbody>
          ${rows.map((r) => `<tr><td>${r.symbol}</td><td>${r.time}</td><td>${r.open}</td><td>${r.high}</td><td>${r.low}</td><td>${r.close}</td><td>${r.volume}</td><td>${r.vwap}</td></tr>`).join("")}
        </tbody>
      </table>
    `;
    if (optionBarsOutput) {
      optionBarsOutput.classList.remove("empty");
      optionBarsOutput.innerHTML = table;
    }
  } catch (e) {
    if (optionBarsOutput) {
      optionBarsOutput.classList.add("error");
      optionBarsOutput.innerHTML = `<p class="error">${e.message}</p>`;
    }
  }
}

btnQuote.addEventListener("click", getQuote);
btnTrade.addEventListener("click", getTrade);
btnBars.addEventListener("click", getBars);
if (btnOptionChain) btnOptionChain.addEventListener("click", getOptionChain);
if (btnOptionBars) btnOptionBars.addEventListener("click", getOptionBars);

// Load dashboard on page load (Trading API may work even if Data API status fails)
loadDashboard();
checkStatus();
