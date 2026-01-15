const https = require("https");

function fetchPriceREST(symbol) {
  return new Promise((resolve, reject) => {
    const url = `https://api.binance.com/api/v3/ticker/price?symbol=${symbol.toUpperCase()}`;
    console.log(`Testing URL: ${url}`);
    
    https.get(url, { timeout: 5000 }, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        try {
          const body = JSON.parse(data);
          if (body && body.price) {
            resolve(parseFloat(body.price));
          } else {
            console.log("Response Body:", body);
            resolve(null);
          }
        } catch (e) { 
          reject(new Error("Parse error: " + e.message)); 
        }
      });
    }).on("error", (err) => {
      reject(err);
    }).on("timeout", () => {
      reject(new Error("Timeout"));
    });
  });
}

const symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "PEPEUSDT", "DOGEUSDT", "USDTUSDT", "INVALIDUSDT"];

async function runTest() {
  for (const s of symbols) {
    try {
      const price = await fetchPriceREST(s);
      console.log(`Symbol: ${s}, Price: ${price}`);
    } catch (err) {
      console.error(`Symbol: ${s}, Error: ${err.message}`);
    }
    console.log("---");
  }
}

runTest();
