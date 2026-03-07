# Options Bot

A stock trading web app built with JavaScript that connects to the **Alpaca API** for market data and historical bars. It’s set up for real-time data later and for backtesting strategies you add natively.

## Features

- **Connection status** — Shows whether the app is connected to Alpaca (market data API).
- **Market data (live)** — Latest quote and latest trade for one or more symbols.
- **Historical bars** — OHLCV bars for any symbols, timeframe, and date range (for backtesting and analysis).
- **Backtest** — Placeholder section for strategies you’ll add later.

## Setup

1. **Clone or open the project** and install dependencies:

   ```bash
   npm install
   ```

2. **Alpaca API keys**

   - Sign up at [Alpaca](https://alpaca.markets) and get API keys from the [dashboard](https://app.alpaca.markets).
   - Copy `.env.example` to `.env` and fill in your keys:

   ```bash
   cp .env.example .env
   ```

   Edit `.env`:

   ```
   ALPACA_API_KEY_ID=your_key_id
   ALPACA_SECRET_KEY=your_secret_key
   ALPACA_DATA_BASE_URL=https://data.alpaca.markets
   ALPACA_TRADING_BASE_URL=https://paper-api.alpaca.markets
   ```

   **One set of keys** is used for both account/trading and market data. For **paper** trading use `paper-api.alpaca.markets` for trading. For market data, many paper accounts work with `https://data.alpaca.markets`; if you get 401, try that URL for `ALPACA_DATA_BASE_URL`.

3. **Run the app**

   ```bash
   npm start
   ```

   Or with auto-restart on file changes:

   ```bash
   npm run dev
   ```

4. Open **http://localhost:3000** in your browser.

## API used

- **Alpaca Market Data API** — Latest quotes and latest trades (REST).
- **Alpaca History API** — Historical stock (and crypto) bars via the same data API base URL.

Keys are only used on the server; the frontend talks to your Express backend, which proxies requests to Alpaca.

## Project structure

```
Options-Bot/
├── server/
│   ├── index.js    # Express app, routes, static files
│   └── alpaca.js   # Alpaca Data API proxy helpers
├── public/
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
├── .env.example
├── package.json
└── README.md
```

## Next steps

- **Real-time data** — Add Alpaca WebSocket streams for live quotes/trades.
- **Backtesting** — Implement strategy runners that use the historical bars from `/api/stocks/bars` (and optional crypto bars from `/api/crypto/bars`).
