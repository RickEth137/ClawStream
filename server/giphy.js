// giphy.js - Giphy API integration for GIF popups on stream
// Docs: https://developers.giphy.com/docs/api

import dotenv from 'dotenv';
dotenv.config();

const GIPHY_API_KEY = process.env.GIPHY_API_KEY || 'GlVGYHkr3WSBnllca54iNt0yFbjz7L65'; // Public beta key (rate limited)
const BASE_URL = 'https://api.giphy.com/v1/gifs';

/**
 * Search for GIFs by keyword
 * @param {string} query - Search term
 * @param {number} limit - Max results (default 10)
 * @param {string} rating - Content rating: g, pg, pg-13, r (default pg-13)
 * @returns {Promise<Array>} Array of GIF objects
 */
export async function searchGifs(query, limit = 10, rating = 'pg-13') {
  try {
    const params = new URLSearchParams({
      api_key: GIPHY_API_KEY,
      q: query,
      limit: limit.toString(),
      rating,
      lang: 'en'
    });
    
    const response = await fetch(`${BASE_URL}/search?${params}`);
    if (!response.ok) {
      console.error('Giphy search failed:', response.status);
      return [];
    }
    
    const data = await response.json();
    return data.data || [];
  } catch (error) {
    console.error('Giphy search error:', error.message);
    return [];
  }
}

/**
 * Get a random GIF by tag/keyword
 * @param {string} tag - Tag to search for
 * @param {string} rating - Content rating (default pg-13)
 * @returns {Promise<Object|null>} GIF object or null
 */
export async function getRandomGif(tag, rating = 'pg-13') {
  try {
    const params = new URLSearchParams({
      api_key: GIPHY_API_KEY,
      tag,
      rating
    });
    
    const response = await fetch(`${BASE_URL}/random?${params}`);
    if (!response.ok) {
      console.error('Giphy random failed:', response.status);
      return null;
    }
    
    const data = await response.json();
    return data.data || null;
  } catch (error) {
    console.error('Giphy random error:', error.message);
    return null;
  }
}

/**
 * Get trending GIFs
 * @param {number} limit - Max results (default 10)
 * @param {string} rating - Content rating (default pg-13)
 * @returns {Promise<Array>} Array of GIF objects
 */
export async function getTrendingGifs(limit = 10, rating = 'pg-13') {
  try {
    const params = new URLSearchParams({
      api_key: GIPHY_API_KEY,
      limit: limit.toString(),
      rating
    });
    
    const response = await fetch(`${BASE_URL}/trending?${params}`);
    if (!response.ok) {
      console.error('Giphy trending failed:', response.status);
      return [];
    }
    
    const data = await response.json();
    return data.data || [];
  } catch (error) {
    console.error('Giphy trending error:', error.message);
    return [];
  }
}

/**
 * Get a GIF by its ID
 * @param {string} gifId - Giphy GIF ID
 * @returns {Promise<Object|null>} GIF object or null
 */
export async function getGifById(gifId) {
  try {
    const params = new URLSearchParams({
      api_key: GIPHY_API_KEY
    });
    
    const response = await fetch(`${BASE_URL}/${gifId}?${params}`);
    if (!response.ok) {
      console.error('Giphy get by ID failed:', response.status);
      return null;
    }
    
    const data = await response.json();
    return data.data || null;
  } catch (error) {
    console.error('Giphy get error:', error.message);
    return null;
  }
}

/**
 * Parse a GIF object into a simplified format for the frontend
 * @param {Object} gif - Raw Giphy GIF object
 * @returns {Object} Simplified GIF data
 */
export function parseGif(gif) {
  if (!gif || !gif.images) return null;
  
  return {
    id: gif.id,
    title: gif.title,
    url: gif.images.fixed_height?.url || gif.images.original?.url,
    width: parseInt(gif.images.fixed_height?.width || gif.images.original?.width) || 200,
    height: parseInt(gif.images.fixed_height?.height || gif.images.original?.height) || 200,
    // Smaller version for thumbnails
    preview: gif.images.fixed_height_small?.url || gif.images.preview_gif?.url,
    // WebP version (smaller file size)
    webp: gif.images.fixed_height?.webp || gif.images.original?.webp
  };
}

/**
 * Search and get a random GIF from results (best for variety)
 * @param {string} query - Search term
 * @param {string} rating - Content rating (default pg-13)
 * @returns {Promise<Object|null>} Parsed GIF object or null
 */
export async function getGifForStream(query, rating = 'pg-13') {
  // First try search to get variety
  const results = await searchGifs(query, 25, rating);
  
  if (results.length > 0) {
    // Pick a random one from results for variety
    const randomIndex = Math.floor(Math.random() * results.length);
    return parseGif(results[randomIndex]);
  }
  
  // Fallback to random endpoint
  const randomGif = await getRandomGif(query, rating);
  if (randomGif) {
    return parseGif(randomGif);
  }
  
  return null;
}

/**
 * Default GIF position - top-right to avoid covering the avatar
 */
export const DEFAULT_GIF_POSITION = 'top-right';

/**
 * Available positions for GIF placement (top-right is default)
 */
export const GIF_POSITIONS = [
  'top-right'
];

/**
 * Get default position (always top-right)
 */
export function getRandomPosition() {
  return DEFAULT_GIF_POSITION;
}

/**
 * Parse GIF tag from text
 * Format: [gif:search_term] or [gif:search_term:position] or [gif:search_term:position:duration]
 * @param {string} text - Text containing gif tags
 * @returns {Array} Array of {search, position, duration} objects
 */
export function parseGifTags(text) {
  const gifTags = [];
  // Match [gif:something] or [gif:something:position] or [gif:something:position:duration]
  const regex = /\[gif:([^\]:\s]+)(?::([^\]:\s]+))?(?::(\d+))?\]/gi;
  
  let match;
  while ((match = regex.exec(text)) !== null) {
    const search = match[1];
    let position = match[2] || 'random';
    const duration = match[3] ? parseInt(match[3]) : 4000; // Default 4 seconds
    
    // Always use top-right position to avoid covering the avatar
    position = DEFAULT_GIF_POSITION;
    
    gifTags.push({
      search,
      position: position.toLowerCase(),
      duration
    });
  }
  
  return gifTags;
}

/**
 * Remove GIF tags from text (for TTS)
 * @param {string} text - Text with gif tags
 * @returns {string} Text without gif tags
 */
export function stripGifTags(text) {
  return text.replace(/\[gif:[^\]]+\]/gi, '').trim();
}

export default {
  searchGifs,
  getRandomGif,
  getTrendingGifs,
  getGifById,
  parseGif,
  getGifForStream,
  parseGifTags,
  stripGifTags,
  GIF_POSITIONS,
  getRandomPosition
};
