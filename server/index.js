import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { alpacaProxy, alpacaTradingProxy } from "./alpaca.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const ALPACA_KEY = (process.env.ALPACA_API_KEY_ID || "").trim();
const ALPACA_SECRET = (process.env.ALPACA_SECRET_KEY || "").trim();
const DATA_BASE = (process.env.ALPACA_DATA_BASE_URL || "https://data.sandbox.alpaca.markets").trim().replace(/\/$/, "");
const TRADING_BASE = (process.env.ALPACA_TRADING_BASE_URL || "https://paper-api.alpaca.markets").trim().replace(/\/$/, "");
// IEX is the only feed that works without a subscription (Alpaca docs)
const STOCK_FEED = process.env.ALPACA_STOCK_FEED || "iex";

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

// Connection status: check both Trading API (account) and Data API (market data)
app.get("/api/status", async (req, res) => {
  const accountResult = await alpacaTradingProxy(`${TRADING_BASE}/v2/account`, ALPACA_KEY, ALPACA_SECRET);
  const dataResult = await alpacaProxy(`${DATA_BASE}/v2/stocks/quotes/latest?symbols=SPY&feed=${STOCK_FEED}`, ALPACA_KEY, ALPACA_SECRET);
  const accountOk = accountResult.ok;
  const dataOk = dataResult.ok;
  const connected = accountOk;
  let error = null;
  if (!accountOk) {
    const detail = accountResult.body?.error || accountResult.body?.message;
    error = detail ? `${detail}. Check .env: API keys and ALPACA_TRADING_BASE_URL (paper: https://paper-api.alpaca.markets).` : "Check API keys and ALPACA_TRADING_BASE_URL (paper: paper-api.alpaca.markets).";
  } else if (!dataOk) {
    error = "Account OK. Market data failed — try ALPACA_DATA_BASE_URL=https://data.alpaca.markets in .env.";
  }
  res.json({ connected, dataOk, error });
});

// --- Market Data (real-time) ---
// Latest stock quotes (feed=iex works without subscription)
app.get("/api/stocks/quotes/latest", async (req, res) => {
  const symbols = req.query.symbols || "SPY";
  const feed = req.query.feed || STOCK_FEED;
  const result = await alpacaProxy(
    `${DATA_BASE}/v2/stocks/quotes/latest?symbols=${encodeURIComponent(symbols)}&feed=${feed}`,
    ALPACA_KEY,
    ALPACA_SECRET
  );
  res.status(result.ok ? 200 : result.status).json(result.body);
});

// Latest trade for a symbol
app.get("/api/stocks/trades/latest", async (req, res) => {
  const symbol = req.query.symbol || "SPY";
  const feed = req.query.feed || STOCK_FEED;
  const result = await alpacaProxy(
    `${DATA_BASE}/v2/stocks/trades/latest?symbols=${encodeURIComponent(symbol)}&feed=${feed}`,
    ALPACA_KEY,
    ALPACA_SECRET
  );
  res.status(result.ok ? 200 : result.status).json(result.body);
});

// --- History API ---
// Stock bars (OHLCV). Default feed=iex (no subscription required).
app.get("/api/stocks/bars", async (req, res) => {
  const { symbols = "SPY", timeframe = "1Day", start, end, limit, page_token, feed } = req.query;
  const params = new URLSearchParams({ symbols, timeframe, feed: feed || STOCK_FEED });
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  if (limit) params.set("limit", limit);
  if (page_token) params.set("page_token", page_token);
  const result = await alpacaProxy(
    `${DATA_BASE}/v2/stocks/bars?${params}`,
    ALPACA_KEY,
    ALPACA_SECRET
  );
  res.status(result.ok ? 200 : result.status).json(result.body);
});

// Crypto bars (optional)
app.get("/api/crypto/bars", async (req, res) => {
  const { symbols = "BTC/USD", timeframe = "1Day", start, end, limit, page_token } = req.query;
  const params = new URLSearchParams({ symbols, timeframe });
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  if (limit) params.set("limit", limit);
  if (page_token) params.set("page_token", page_token);
  const result = await alpacaProxy(
    `${DATA_BASE}/v2/crypto/bars?${params}`,
    ALPACA_KEY,
    ALPACA_SECRET
  );
  res.status(result.ok ? 200 : result.status).json(result.body);
});

// --- Options: historical bars (for backtesting) + chain (snapshots) ---
// Historical option bars: same idea as stock bars, for option contract symbols (OCC format)
app.get("/api/options/bars", async (req, res) => {
  const { symbols, timeframe = "1Day", start, end, limit = "100", page_token } = req.query;
  if (!symbols) {
    return res.status(400).json({ message: "symbols required (comma-separated option symbols, e.g. AAPL240419C00150000)" });
  }
  const params = new URLSearchParams({ symbols, timeframe, limit });
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  if (page_token) params.set("page_token", page_token);
  const result = await alpacaProxy(
    `${DATA_BASE}/v1beta1/options/bars?${params}`,
    ALPACA_KEY,
    ALPACA_SECRET
  );
  res.status(result.ok ? 200 : result.status).json(result.body);
});

// Option chain (snapshots): latest quote, trade, greeks per contract for an underlying
app.get("/api/options/snapshots/:underlying", async (req, res) => {
  const { underlying } = req.params;
  const { type, strike_price_gte, strike_price_lte, expiration_date, expiration_date_gte, expiration_date_lte, limit = "100", page_token } = req.query;
  const params = new URLSearchParams();
  if (type) params.set("type", type);
  if (strike_price_gte != null) params.set("strike_price_gte", strike_price_gte);
  if (strike_price_lte != null) params.set("strike_price_lte", strike_price_lte);
  if (expiration_date) params.set("expiration_date", expiration_date);
  if (expiration_date_gte) params.set("expiration_date_gte", expiration_date_gte);
  if (expiration_date_lte) params.set("expiration_date_lte", expiration_date_lte);
  if (limit) params.set("limit", limit);
  if (page_token) params.set("page_token", page_token);
  const qs = params.toString();
  const url = `${DATA_BASE}/v1beta1/options/snapshots/${encodeURIComponent(underlying)}${qs ? `?${qs}` : ""}`;
  const result = await alpacaProxy(url, ALPACA_KEY, ALPACA_SECRET);
  res.status(result.ok ? 200 : result.status).json(result.body);
});

// --- Options contracts (for backtest: list by underlying + expiration) ---
app.get("/api/options/contracts", async (req, res) => {
  const { underlying_symbols, expiration_date, expiration_date_gte, expiration_date_lte, type, status, limit = "200", page_token } = req.query;
  const params = new URLSearchParams();
  if (underlying_symbols) params.set("underlying_symbols", underlying_symbols);
  if (expiration_date) params.set("expiration_date", expiration_date);
  if (expiration_date_gte) params.set("expiration_date_gte", expiration_date_gte);
  if (expiration_date_lte) params.set("expiration_date_lte", expiration_date_lte);
  if (type) params.set("type", type);
  if (status) params.set("status", status);
  if (limit) params.set("limit", limit);
  if (page_token) params.set("page_token", page_token);
  const qs = params.toString();
  const result = await alpacaTradingProxy(
    `${TRADING_BASE}/v2/options/contracts${qs ? `?${qs}` : ""}`,
    ALPACA_KEY,
    ALPACA_SECRET
  );
  res.status(result.ok ? 200 : result.status).json(result.body);
});

// --- Trading API (account, portfolio, orders) ---
app.get("/api/account", async (req, res) => {
  const result = await alpacaTradingProxy(`${TRADING_BASE}/v2/account`, ALPACA_KEY, ALPACA_SECRET);
  res.status(result.ok ? 200 : result.status).json(result.body);
});

app.get("/api/account/portfolio/history", async (req, res) => {
  const { period = "1M", timeframe = "1D" } = req.query;
  const params = new URLSearchParams({ period, timeframe });
  const result = await alpacaTradingProxy(
    `${TRADING_BASE}/v2/account/portfolio/history?${params}`,
    ALPACA_KEY,
    ALPACA_SECRET
  );
  res.status(result.ok ? 200 : result.status).json(result.body);
});

app.get("/api/positions", async (req, res) => {
  const result = await alpacaTradingProxy(`${TRADING_BASE}/v2/positions`, ALPACA_KEY, ALPACA_SECRET);
  res.status(result.ok ? 200 : result.status).json(result.body);
});

app.get("/api/orders", async (req, res) => {
  const { status = "all", limit = "25" } = req.query;
  const params = new URLSearchParams({ status, limit });
  const result = await alpacaTradingProxy(
    `${TRADING_BASE}/v2/orders?${params}`,
    ALPACA_KEY,
    ALPACA_SECRET
  );
  res.status(result.ok ? 200 : result.status).json(result.body);
});

app.listen(PORT, () => {
  console.log(`Options Bot running at http://localhost:${PORT}`);
  if (!ALPACA_KEY || !ALPACA_SECRET) {
    console.warn("Warning: ALPACA_API_KEY_ID or ALPACA_SECRET_KEY not set. Copy .env.example to .env and add your keys.");
  }
});
