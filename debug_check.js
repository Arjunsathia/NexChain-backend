
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const mongoSanitize = require("express-mongo-sanitize");

console.log("Helmet type:", typeof helmet);
console.log("Helmet export:", helmet);
console.log("--------------------------------------------------");
console.log("RateLimit type:", typeof rateLimit);
console.log("RateLimit export:", rateLimit);
console.log("--------------------------------------------------");
console.log("MongoSanitize type:", typeof mongoSanitize);
console.log("MongoSanitize export:", mongoSanitize);
