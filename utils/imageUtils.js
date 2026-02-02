/**
 * Normalizes image input to always be a string URL.
 * Handles both direct string URLs and CoinGecko image objects (small, large, thumb).
 * 
 * @param {string|Object} image - The image URL or CoinGecko image object
 * @returns {string} - The extracted string URL
 */
const normalizeCoinImage = (image) => {
    if (typeof image === "string") return image;
    if (image && typeof image === "object") {
        return image.small || image.large || image.thumb || "";
    }
    return "";
};

module.exports = { normalizeCoinImage };
