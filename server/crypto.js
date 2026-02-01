// Lobster Crypto Service
// Provides live crypto data from CoinGecko and DexScreener APIs

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';
const DEXSCREENER_BASE = 'https://api.dexscreener.com';

// Cache to avoid rate limiting
const cache = {
  prices: { data: null, timestamp: 0 },
  trending: { data: null, timestamp: 0 },
  market: { data: null, timestamp: 0 }
};

const CACHE_TTL = 60000; // 1 minute cache

// ============ COINGECKO API ============

/**
 * Get current prices for major cryptocurrencies
 * @param {string[]} coins - Array of coin IDs (e.g., ['bitcoin', 'ethereum', 'solana'])
 * @returns {Object} Price data
 */
export async function getPrices(coins = ['bitcoin', 'ethereum', 'solana']) {
  const cacheKey = coins.join(',');
  const now = Date.now();
  
  if (cache.prices.data && cache.prices.key === cacheKey && now - cache.prices.timestamp < CACHE_TTL) {
    return cache.prices.data;
  }
  
  try {
    const url = `${COINGECKO_BASE}/simple/price?ids=${coins.join(',')}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`;
    const res = await fetch(url);
    
    if (!res.ok) throw new Error(`CoinGecko API error: ${res.status}`);
    
    const data = await res.json();
    cache.prices = { data, key: cacheKey, timestamp: now };
    return data;
  } catch (error) {
    console.error('CoinGecko getPrices error:', error.message);
    return null;
  }
}

/**
 * Get market overview - top coins by market cap
 * @param {number} limit - Number of coins to fetch
 * @returns {Array} Market data
 */
export async function getMarketOverview(limit = 10) {
  const now = Date.now();
  
  if (cache.market.data && now - cache.market.timestamp < CACHE_TTL) {
    return cache.market.data;
  }
  
  try {
    const url = `${COINGECKO_BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}&page=1&sparkline=false&price_change_percentage=24h`;
    const res = await fetch(url);
    
    if (!res.ok) throw new Error(`CoinGecko API error: ${res.status}`);
    
    const data = await res.json();
    cache.market = { data, timestamp: now };
    return data;
  } catch (error) {
    console.error('CoinGecko getMarketOverview error:', error.message);
    return null;
  }
}

/**
 * Search for a coin by name or symbol
 * @param {string} query - Search query
 * @returns {Array} Search results
 */
export async function searchCoin(query) {
  try {
    const url = `${COINGECKO_BASE}/search?query=${encodeURIComponent(query)}`;
    const res = await fetch(url);
    
    if (!res.ok) throw new Error(`CoinGecko API error: ${res.status}`);
    
    const data = await res.json();
    return data.coins?.slice(0, 5) || []; // Top 5 results
  } catch (error) {
    console.error('CoinGecko searchCoin error:', error.message);
    return [];
  }
}

/**
 * Get detailed info for a specific coin
 * @param {string} coinId - CoinGecko coin ID
 * @returns {Object} Coin data
 */
export async function getCoinInfo(coinId) {
  try {
    const url = `${COINGECKO_BASE}/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=false`;
    const res = await fetch(url);
    
    if (!res.ok) throw new Error(`CoinGecko API error: ${res.status}`);
    
    return await res.json();
  } catch (error) {
    console.error('CoinGecko getCoinInfo error:', error.message);
    return null;
  }
}

// ============ DEXSCREENER API ============

/**
 * Get token info by contract address
 * @param {string} contractAddress - Token contract address
 * @returns {Object} Token data from DexScreener
 */
export async function getTokenByContract(contractAddress) {
  try {
    // Clean the address
    const address = contractAddress.trim();
    
    const url = `${DEXSCREENER_BASE}/latest/dex/tokens/${address}`;
    const res = await fetch(url);
    
    if (!res.ok) throw new Error(`DexScreener API error: ${res.status}`);
    
    const data = await res.json();
    
    if (!data.pairs || data.pairs.length === 0) {
      return null;
    }
    
    // Get the most liquid pair
    const bestPair = data.pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
    
    // Handle lazy devs who don't name their tokens (looking at you, rugpullers)
    const tokenName = bestPair.baseToken?.name && bestPair.baseToken.name !== 'undefined' 
      ? bestPair.baseToken.name 
      : (bestPair.baseToken?.symbol || `Mystery Token ${bestPair.baseToken?.address?.slice(-6) || '???'}`);
    const tokenSymbol = bestPair.baseToken?.symbol && bestPair.baseToken.symbol !== 'undefined'
      ? bestPair.baseToken.symbol
      : `???`;
    
    return {
      name: tokenName,
      symbol: tokenSymbol,
      address: bestPair.baseToken?.address,
      price: bestPair.priceUsd,
      priceChange24h: bestPair.priceChange?.h24,
      volume24h: bestPair.volume?.h24,
      liquidity: bestPair.liquidity?.usd,
      marketCap: bestPair.marketCap || bestPair.fdv,
      chain: bestPair.chainId,
      dexId: bestPair.dexId,
      pairAddress: bestPair.pairAddress,
      url: bestPair.url,
      // Additional info if available
      info: bestPair.info || null,
      allPairs: data.pairs.length
    };
  } catch (error) {
    console.error('DexScreener getTokenByContract error:', error.message);
    return null;
  }
}

/**
 * Search for tokens on DexScreener
 * @param {string} query - Search query (name, symbol, or address)
 * @returns {Array} Search results
 */
export async function searchToken(query) {
  try {
    const url = `${DEXSCREENER_BASE}/latest/dex/search/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url);
    
    if (!res.ok) throw new Error(`DexScreener API error: ${res.status}`);
    
    const data = await res.json();
    
    if (!data.pairs || data.pairs.length === 0) {
      return [];
    }
    
    // Group by token and return unique tokens
    const seen = new Set();
    const tokens = [];
    
    for (const pair of data.pairs.slice(0, 20)) {
      const key = pair.baseToken?.address;
      if (key && !seen.has(key)) {
        seen.add(key);
        // Handle lazy devs who don't name their tokens
        const name = (pair.baseToken?.name && pair.baseToken.name !== 'undefined') 
          ? pair.baseToken.name 
          : (pair.baseToken?.symbol || `Token ...${key.slice(-6)}`);
        const symbol = (pair.baseToken?.symbol && pair.baseToken.symbol !== 'undefined')
          ? pair.baseToken.symbol 
          : '???';
        tokens.push({
          name: name,
          symbol: symbol,
          address: pair.baseToken?.address,
          price: pair.priceUsd,
          priceChange24h: pair.priceChange?.h24,
          marketCap: pair.marketCap || pair.fdv,
          chain: pair.chainId,
          url: pair.url
        });
      }
      if (tokens.length >= 5) break;
    }
    
    return tokens;
  } catch (error) {
    console.error('DexScreener searchToken error:', error.message);
    return [];
  }
}

/**
 * Get trending/boosted tokens from DexScreener
 * @returns {Array} Trending tokens
 */
export async function getTrendingTokens() {
  const now = Date.now();
  
  if (cache.trending.data && now - cache.trending.timestamp < CACHE_TTL * 2) {
    return cache.trending.data;
  }
  
  try {
    // Get boosted tokens (promoted/trending)
    const url = `${DEXSCREENER_BASE}/token-boosts/latest/v1`;
    const res = await fetch(url);
    
    if (!res.ok) throw new Error(`DexScreener API error: ${res.status}`);
    
    const data = await res.json();
    
    // Process and dedupe
    const seen = new Set();
    const tokens = [];
    
    for (const token of (data || []).slice(0, 20)) {
      if (token.tokenAddress && !seen.has(token.tokenAddress)) {
        seen.add(token.tokenAddress);
        // Handle unnamed tokens (common with scams/lazy devs)
        const name = (token.name && token.name !== 'undefined') ? token.name : 
                     (token.symbol && token.symbol !== 'undefined') ? token.symbol : 
                     `Unnamed Token ...${token.tokenAddress.slice(-6)}`;
        const symbol = (token.symbol && token.symbol !== 'undefined') ? token.symbol : '???';
        tokens.push({
          name: name,
          symbol: symbol,
          address: token.tokenAddress,
          chain: token.chainId,
          url: token.url,
          description: token.description
        });
      }
      if (tokens.length >= 10) break;
    }
    
    cache.trending = { data: tokens, timestamp: now };
    return tokens;
  } catch (error) {
    console.error('DexScreener getTrendingTokens error:', error.message);
    return [];
  }
}

// ============ HELPER FUNCTIONS ============

/**
 * Format a price for display
 */
export function formatPrice(price) {
  if (!price) return 'N/A';
  const num = parseFloat(price);
  if (num >= 1) return `$${num.toFixed(2)}`;
  if (num >= 0.01) return `$${num.toFixed(4)}`;
  if (num >= 0.0001) return `$${num.toFixed(6)}`;
  return `$${num.toExponential(2)}`;
}

/**
 * Format market cap for display
 */
export function formatMarketCap(mc) {
  if (!mc) return 'N/A';
  const num = parseFloat(mc);
  if (num >= 1e12) return `$${(num / 1e12).toFixed(2)}T`;
  if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
  if (num >= 1e3) return `$${(num / 1e3).toFixed(2)}K`;
  return `$${num.toFixed(0)}`;
}

/**
 * Format percentage change
 */
export function formatChange(change) {
  if (change === null || change === undefined) return 'N/A';
  const num = parseFloat(change);
  const sign = num >= 0 ? '+' : '';
  return `${sign}${num.toFixed(2)}%`;
}

/**
 * Detect if a string looks like a contract address
 */
export function isContractAddress(str) {
  if (!str) return false;
  const cleaned = str.trim();
  // Ethereum/EVM address (0x...)
  if (/^0x[a-fA-F0-9]{40}$/.test(cleaned)) return true;
  // Solana address (base58, 32-44 chars)
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(cleaned)) return true;
  return false;
}

/**
 * Extract contract addresses from a message that may contain other text
 * Returns the first valid contract address found, or null
 */
export function extractContractAddress(text) {
  if (!text) return null;
  
  // Split by common separators and whitespace
  const words = text.split(/[\s,;:!?\n]+/);
  
  for (const word of words) {
    const cleaned = word.trim();
    // Ethereum/EVM address (0x...)
    if (/^0x[a-fA-F0-9]{40}$/.test(cleaned)) return cleaned;
    // Solana address (base58, 32-44 chars) - commonly ends with "pump" for pump.fun tokens
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(cleaned)) return cleaned;
  }
  
  return null;
}

/**
 * Generate a market summary for the AI
 */
export async function getMarketSummary() {
  const [prices, market] = await Promise.all([
    getPrices(['bitcoin', 'ethereum', 'solana']),
    getMarketOverview(5)
  ]);
  
  if (!prices || !market) return null;
  
  let summary = '📊 CURRENT MARKET STATE:\n';
  
  // BTC, ETH, SOL prices
  if (prices.bitcoin) {
    summary += `BTC: ${formatPrice(prices.bitcoin.usd)} (${formatChange(prices.bitcoin.usd_24h_change)})\n`;
  }
  if (prices.ethereum) {
    summary += `ETH: ${formatPrice(prices.ethereum.usd)} (${formatChange(prices.ethereum.usd_24h_change)})\n`;
  }
  if (prices.solana) {
    summary += `SOL: ${formatPrice(prices.solana.usd)} (${formatChange(prices.solana.usd_24h_change)})\n`;
  }
  
  // Overall market sentiment
  const btcChange = prices.bitcoin?.usd_24h_change || 0;
  if (btcChange > 5) summary += 'Market sentiment: BULLISH 🚀\n';
  else if (btcChange > 0) summary += 'Market sentiment: Slightly bullish 📈\n';
  else if (btcChange > -5) summary += 'Market sentiment: Slightly bearish 📉\n';
  else summary += 'Market sentiment: BEARISH 🐻\n';
  
  return summary;
}

/**
 * Generate token info summary for a contract address
 */
export async function getTokenSummary(contractAddress) {
  const token = await getTokenByContract(contractAddress);
  
  if (!token) return null;
  
  let summary = `🪙 TOKEN INFO:\n`;
  summary += `Name: ${token.name} (${token.symbol})\n`;
  summary += `Price: ${formatPrice(token.price)} (${formatChange(token.priceChange24h)} 24h)\n`;
  summary += `Market Cap: ${formatMarketCap(token.marketCap)}\n`;
  summary += `Liquidity: ${formatMarketCap(token.liquidity)}\n`;
  summary += `Chain: ${token.chain}\n`;
  summary += `DEX: ${token.dexId}\n`;
  
  // Warn about sketchy tokens with no name
  if (token.symbol === '???' || token.name.includes('Mystery Token') || token.name.includes('Unnamed Token')) {
    summary += `⚠️ WARNING: This token has no name set - devs were too lazy to even name it! Classic rugpull vibes.\n`;
  }
  
  if (token.info?.description) {
    summary += `Description: ${token.info.description.slice(0, 100)}...\n`;
  }
  
  return { summary, token };
}

export default {
  getPrices,
  getMarketOverview,
  searchCoin,
  getCoinInfo,
  getTokenByContract,
  searchToken,
  getTrendingTokens,
  getMarketSummary,
  getTokenSummary,
  formatPrice,
  formatMarketCap,
  formatChange,
  isContractAddress,
  extractContractAddress
};
