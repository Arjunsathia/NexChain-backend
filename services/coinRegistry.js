const axios = require("axios").default;
const { COINS } = require("../config/coins");

// The price symbol is always derived from coin_id on the server, never taken
// from the client, so a trade can't be booked under one coin and priced as another.
const STATIC = new Map(COINS.map((c) => [c.coinId, c]));
const LIST_TTL = 24 * 60 * 60 * 1000;
const COINGECKO_LIST_URL = "https://api.coingecko.com/api/v3/coins/list";

let list = null;
let listFetchedAt = 0;
let inflight = null;

const loadList = async () => {
  const { data } = await axios.get(COINGECKO_LIST_URL, { timeout: 10000 });
  if (!Array.isArray(data)) throw new Error("Unexpected CoinGecko list response");
  list = new Map(
    data.map((c) => [c.id, { symbol: String(c.symbol).toLowerCase(), name: c.name }]),
  );
  listFetchedAt = Date.now();
  return list;
};

const getList = async () => {
  if (list && Date.now() - listFetchedAt < LIST_TTL) return list;
  if (!inflight) {
    inflight = loadList()
      .catch((err) => {
        console.error("[COINS   ] ⚠️ CoinGecko list fetch failed:", err.message);
        return list; // keep serving the stale list, if any
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
};

/**
 * @param {string} coinId CoinGecko id, e.g. "bitcoin"
 * @returns {Promise<{coinId: string, symbol: string, name: string, pair: string} | null>}
 */
const resolveCoin = async (coinId) => {
  if (typeof coinId !== "string" || !/^[a-z0-9-]{1,100}$/.test(coinId)) return null;

  const known = STATIC.get(coinId);
  if (known) return { ...known, pair: `${known.symbol}usdt` };

  const entry = (await getList())?.get(coinId);
  if (!entry || !/^[a-z0-9]{1,15}$/.test(entry.symbol)) return null;
  return { coinId, symbol: entry.symbol, name: entry.name, pair: `${entry.symbol}usdt` };
};

module.exports = { resolveCoin };
