// Core coins tracked from startup. coinId is the CoinGecko id the frontend uses;
// the Binance pair is always `${symbol}usdt`. Any other CoinGecko coin is
// resolved at trade time by services/coinRegistry.js.
const COINS = [
  { coinId: "bitcoin", symbol: "btc", name: "Bitcoin" },
  { coinId: "ethereum", symbol: "eth", name: "Ethereum" },
  { coinId: "binancecoin", symbol: "bnb", name: "BNB" },
  { coinId: "ripple", symbol: "xrp", name: "XRP" },
  { coinId: "cardano", symbol: "ada", name: "Cardano" },
  { coinId: "solana", symbol: "sol", name: "Solana" },
  { coinId: "dogecoin", symbol: "doge", name: "Dogecoin" },
  { coinId: "polkadot", symbol: "dot", name: "Polkadot" },
  { coinId: "polygon-ecosystem-token", symbol: "pol", name: "POL (ex-MATIC)" },
  { coinId: "litecoin", symbol: "ltc", name: "Litecoin" },
  { coinId: "chainlink", symbol: "link", name: "Chainlink" },
  { coinId: "stellar", symbol: "xlm", name: "Stellar" },
  { coinId: "cosmos", symbol: "atom", name: "Cosmos Hub" },
  { coinId: "ethereum-classic", symbol: "etc", name: "Ethereum Classic" },
  { coinId: "bitcoin-cash", symbol: "bch", name: "Bitcoin Cash" },
  { coinId: "filecoin", symbol: "fil", name: "Filecoin" },
  { coinId: "theta-token", symbol: "theta", name: "Theta Network" },
  { coinId: "vechain", symbol: "vet", name: "VeChain" },
  { coinId: "tron", symbol: "trx", name: "TRON" },
  { coinId: "avalanche-2", symbol: "avax", name: "Avalanche" },
  { coinId: "shiba-inu", symbol: "shib", name: "Shiba Inu" },
  { coinId: "the-open-network", symbol: "ton", name: "Toncoin" },
  { coinId: "usd-coin", symbol: "usdc", name: "USDC" },
  { coinId: "tether", symbol: "usdt", name: "Tether" },
  { coinId: "arbitrum", symbol: "arb", name: "Arbitrum" },
  { coinId: "optimism", symbol: "op", name: "Optimism" },
  { coinId: "near", symbol: "near", name: "NEAR Protocol" },
  { coinId: "aptos", symbol: "apt", name: "Aptos" },
  { coinId: "sui", symbol: "sui", name: "Sui" },
  { coinId: "uniswap", symbol: "uni", name: "Uniswap" },
];

const CORE_SYMBOLS = COINS.map((c) => `${c.symbol}usdt`);

module.exports = {
  COINS,
  CORE_SYMBOLS,
};
