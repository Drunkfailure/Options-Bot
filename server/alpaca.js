/**
 * Alpaca Data API proxy helpers.
 * Base URL: https://data.alpaca.markets (prod) or https://data.sandbox.alpaca.markets (sandbox)
 */

export async function alpacaProxy(url, keyId, secretKey) {
  if (!keyId || !secretKey) {
    return {
      ok: false,
      status: 503,
      body: { message: "Alpaca API keys not configured. Set ALPACA_API_KEY_ID and ALPACA_SECRET_KEY in .env" },
    };
  }
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "APCA-API-KEY-ID": keyId,
        "APCA-API-SECRET-KEY": secretKey,
        Accept: "application/json",
      },
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return {
      ok: false,
      status: 502,
      body: { message: "Failed to reach Alpaca API", error: String(err.message) },
    };
  }
}

/** Trading API uses same auth, different base URL (paper-api.alpaca.markets / api.alpaca.markets) */
export async function alpacaTradingProxy(url, keyId, secretKey) {
  if (!keyId || !secretKey) {
    return {
      ok: false,
      status: 503,
      body: { message: "Alpaca API keys not configured." },
    };
  }
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "APCA-API-KEY-ID": keyId,
        "APCA-API-SECRET-KEY": secretKey,
        Accept: "application/json",
      },
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return {
      ok: false,
      status: 502,
      body: { message: "Failed to reach Alpaca Trading API", error: String(err.message) },
    };
  }
}

function friendlyStatusMessage(status) {
  const map = {
    401: "Invalid or missing API keys",
    403: "Access denied — check API keys and base URL (paper vs live)",
    404: "Endpoint not found",
    429: "Rate limit exceeded",
    481: "Market data access issue — check plan or use paper data URL",
  };
  return map[status] || "Connection failed";
}
