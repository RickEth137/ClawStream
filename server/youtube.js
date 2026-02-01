/**
 * YouTube Shorts Integration for Lobster
 * Uses official YouTube Data API v3 (free tier: 10,000 requests/day)
 */

import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

if (!YOUTUBE_API_KEY) {
  console.warn('⚠️  YOUTUBE_API_KEY not set! YouTube Shorts feature will not work.');
  console.warn('   Get a free API key from: https://console.cloud.google.com/');
  console.warn('   Enable "YouTube Data API v3" and add key to .env');
}

// In-memory cache for search results
const searchCache = new Map();

// Cache expiry time (30 minutes)
const CACHE_TTL = 30 * 60 * 1000;

/**
 * Parse ISO 8601 duration (PT1M30S) to seconds
 */
function parseDuration(duration) {
  if (!duration) return 0;
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  
  const hours = parseInt(match[1] || '0');
  const minutes = parseInt(match[2] || '0');
  const seconds = parseInt(match[3] || '0');
  
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Format duration in seconds to MM:SS
 */
function formatDuration(seconds) {
  if (!seconds) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Format large numbers (1000 -> 1K, 1000000 -> 1M)
 */
function formatNumber(num) {
  if (!num) return '0';
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

/**
 * Search YouTube for Shorts (videos under 60 seconds)
 */
async function searchShorts(query, limit = 10) {
  if (!YOUTUBE_API_KEY) {
    console.log('📺 YouTube: No API key configured');
    return [];
  }

  const cacheKey = `shorts:${query}`;
  const cached = searchCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`📺 YouTube: Using cached results for "${query}"`);
    return cached.videos;
  }
  
  console.log(`📺 YouTube Shorts: Searching for "${query}"...`);
  
  try {
    // YouTube Data API v3 search endpoint
    const params = new URLSearchParams({
      part: 'snippet',
      q: `${query} #shorts`,
      type: 'video',
      videoDuration: 'short', // Videos < 4 minutes
      maxResults: String(limit * 3), // Get extra to filter
      order: 'relevance',
      safeSearch: 'moderate',
      key: YOUTUBE_API_KEY
    });
    
    const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
    
    if (!response.ok) {
      const error = await response.json();
      console.error('📺 YouTube API error:', error.error?.message || response.status);
      return [];
    }
    
    const data = await response.json();
    
    if (!data.items || data.items.length === 0) {
      console.log(`📺 YouTube: No results for "${query}"`);
      return [];
    }
    
    // Get video IDs to fetch duration info
    const videoIds = data.items.map(item => item.id.videoId).join(',');
    
    // Fetch video details to get actual duration
    const detailsParams = new URLSearchParams({
      part: 'contentDetails,statistics',
      id: videoIds,
      key: YOUTUBE_API_KEY
    });
    
    const detailsResponse = await fetch(`https://www.googleapis.com/youtube/v3/videos?${detailsParams}`);
    const detailsData = await detailsResponse.json();
    
    // Create a map of video details
    const detailsMap = new Map();
    if (detailsData.items) {
      for (const item of detailsData.items) {
        const duration = parseDuration(item.contentDetails?.duration);
        detailsMap.set(item.id, {
          duration,
          views: parseInt(item.statistics?.viewCount || '0')
        });
      }
    }
    
    // Map and filter results - ONLY actual Shorts (≤60 seconds)
    const videos = data.items
      .map(item => {
        const details = detailsMap.get(item.id.videoId) || { duration: 0, views: 0 };
        return {
          id: item.id.videoId,
          url: `https://www.youtube.com/shorts/${item.id.videoId}`,
          embedUrl: `https://www.youtube.com/embed/${item.id.videoId}`,
          title: item.snippet.title || 'Untitled',
          author: item.snippet.channelTitle || 'Unknown',
          channelId: item.snippet.channelId,
          thumbnail: item.snippet.thumbnails?.high?.url || 
                     item.snippet.thumbnails?.medium?.url ||
                     item.snippet.thumbnails?.default?.url,
          duration: details.duration,
          durationFormatted: formatDuration(details.duration),
          views: details.views,
          viewsFormatted: formatNumber(details.views),
          publishedAt: item.snippet.publishedAt,
          isShort: details.duration > 0 && details.duration <= 60
        };
      })
      .filter(v => v.isShort) // Only actual Shorts
      .slice(0, limit);
    
    // Cache results
    if (videos.length > 0) {
      searchCache.set(cacheKey, {
        videos,
        timestamp: Date.now()
      });
    }
    
    console.log(`📺 YouTube Shorts: Found ${videos.length} shorts for "${query}"`);
    return videos;
    
  } catch (error) {
    console.error('📺 YouTube API error:', error.message);
    return [];
  }
}

/**
 * Search for any YouTube video (not just shorts)
 */
async function searchVideos(query, limit = 10) {
  if (!YOUTUBE_API_KEY) {
    return [];
  }

  const cacheKey = `videos:${query}`;
  const cached = searchCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.videos;
  }
  
  try {
    const params = new URLSearchParams({
      part: 'snippet',
      q: query,
      type: 'video',
      maxResults: String(limit),
      order: 'relevance',
      safeSearch: 'moderate',
      key: YOUTUBE_API_KEY
    });
    
    const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
    if (!response.ok) return [];
    
    const data = await response.json();
    if (!data.items) return [];
    
    const videos = data.items.map(item => ({
      id: item.id.videoId,
      url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
      embedUrl: `https://www.youtube.com/embed/${item.id.videoId}`,
      title: item.snippet.title,
      author: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails?.high?.url,
      isShort: false
    }));
    
    searchCache.set(cacheKey, { videos, timestamp: Date.now() });
    return videos;
    
  } catch (error) {
    console.error('YouTube search error:', error.message);
    return [];
  }
}

/**
 * Parse [youtube:search_term] tags from text
 */
function parseYouTubeTags(text) {
  const tags = [];
  const regex = /\[youtube:([^\]]+)\]/gi;
  let match;
  
  while ((match = regex.exec(text)) !== null) {
    tags.push({
      fullMatch: match[0],
      search: match[1].trim(),
      position: match.index
    });
  }
  
  return tags;
}

/**
 * Strip YouTube tags from text
 */
function stripYouTubeTags(text) {
  return text.replace(/\[youtube:[^\]]+\]/gi, '').trim();
}

/**
 * Get a YouTube Short for streaming
 */
async function getVideoForStream(searchTerm) {
  console.log(`📺 YouTube Shorts: Getting short for "${searchTerm}"...`);
  
  const videos = await searchShorts(searchTerm, 8);
  
  if (videos.length === 0) {
    console.log(`📺 YouTube Shorts: No shorts found for "${searchTerm}"`);
    return null;
  }
  
  // Pick a random one
  const video = videos[Math.floor(Math.random() * videos.length)];
  
  console.log(`📺 YouTube Shorts: Selected "${video.title}" (${video.durationFormatted}) by ${video.author}`);
  
  return {
    id: video.id,
    url: video.url,
    embedUrl: video.embedUrl,
    title: video.title,
    author: video.author,
    thumbnail: video.thumbnail,
    duration: video.duration,
    durationFormatted: video.durationFormatted,
    views: video.views,
    viewsFormatted: video.viewsFormatted,
    isShort: true,
    displayDuration: Math.min((video.duration + 5) * 1000, 65000)
  };
}

/**
 * Get random video from popular categories
 */
async function getRandomVideo(category = null) {
  const categories = ['funny shorts', 'cute animals shorts', 'satisfying', 'fails', 'memes'];
  const query = category || categories[Math.floor(Math.random() * categories.length)];
  return await getVideoForStream(query);
}

/**
 * Get YouTube oEmbed data
 */
async function getOEmbed(url) {
  try {
    const response = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    return {
      ok: true,
      title: data.title,
      author: data.author_name,
      authorUrl: data.author_url,
      thumbnail: data.thumbnail_url,
      html: data.html
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

/**
 * Check if API key is configured
 */
function isConfigured() {
  return !!YOUTUBE_API_KEY;
}

export {
  searchShorts,
  searchVideos,
  parseYouTubeTags,
  stripYouTubeTags,
  getVideoForStream,
  getRandomVideo,
  getOEmbed,
  formatDuration,
  formatNumber,
  isConfigured
};