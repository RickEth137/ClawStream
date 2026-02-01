/**
 * TikTok Integration for ClawStream
 * Allows agents to search, browse, and watch TikTok videos
 * Uses hashtag discovery + oEmbed for embedding
 */

import fetch from 'node-fetch';

// In-memory cache for discovered TikToks by hashtag
const hashtagCache = new Map();

// Cache expiry time (1 hour)
const CACHE_TTL = 60 * 60 * 1000;

// Popular hashtags mapped to search terms
const hashtagMap = {
  puppies: ['puppies', 'puppy', 'cutepuppy', 'puppylove', 'puppiesoftiktok', 'dogsoftiktok'],
  cats: ['cats', 'catsoftiktok', 'kitten', 'catlife', 'cutecats'],
  funny: ['funny', 'funnyvideos', 'comedy', 'lol', 'memes', 'humor'],
  cooking: ['cooking', 'recipe', 'food', 'foodtiktok', 'chef', 'homecooking'],
  crypto: ['crypto', 'bitcoin', 'ethereum', 'trading', 'cryptotok', 'web3'],
  music: ['music', 'song', 'viral', 'newmusic', 'singer', 'musician'],
  dance: ['dance', 'dancing', 'choreography', 'dancechallenge'],
  animals: ['animals', 'cute', 'pets', 'wildlife', 'animalsoftiktok'],
  satisfying: ['satisfying', 'oddlysatisfying', 'asmr', 'relaxing'],
  memes: ['memes', 'meme', 'viral', 'trending'],
  gaming: ['gaming', 'gamer', 'videogames', 'twitch', 'streamer'],
  art: ['art', 'artist', 'drawing', 'painting', 'digitalart'],
  fashion: ['fashion', 'style', 'outfit', 'ootd', 'fashiontiktok'],
  fitness: ['fitness', 'workout', 'gym', 'fitnesstiktok', 'exercise']
};

/**
 * Discover TikToks by hashtag using web scraping approach
 * This fetches the hashtag page and extracts video URLs
 * @param {string} hashtag - The hashtag to search (without #)
 * @param {number} limit - Max videos to return
 */
async function discoverByHashtag(hashtag, limit = 10) {
  const cleanHashtag = hashtag.replace(/^#/, '').toLowerCase();
  
  // Check cache first
  const cached = hashtagCache.get(cleanHashtag);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`📱 TikTok: Using cached results for #${cleanHashtag}`);
    return cached.videos.slice(0, limit);
  }
  
  console.log(`📱 TikTok: Discovering videos for #${cleanHashtag}...`);
  
  try {
    // Method 1: Try to fetch from TikTok's unofficial API endpoint
    // This endpoint sometimes returns video data for hashtags
    const apiUrl = `https://www.tiktok.com/api/challenge/item_list/?challengeID=0&count=${limit}&cursor=0&challengeName=${cleanHashtag}`;
    
    const response = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Referer': `https://www.tiktok.com/tag/${cleanHashtag}`
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.itemList && data.itemList.length > 0) {
        const videos = data.itemList.map(item => ({
          id: item.id,
          url: `https://www.tiktok.com/@${item.author?.uniqueId || 'user'}/video/${item.id}`,
          description: item.desc || '',
          author: item.author?.uniqueId || 'unknown',
          authorNickname: item.author?.nickname || '',
          likes: item.stats?.diggCount || 0,
          comments: item.stats?.commentCount || 0,
          shares: item.stats?.shareCount || 0,
          plays: item.stats?.playCount || 0,
          thumbnail: item.video?.cover || item.video?.dynamicCover || '',
          hashtag: cleanHashtag,
          source: 'api'
        }));
        
        // Cache the results
        hashtagCache.set(cleanHashtag, {
          videos,
          timestamp: Date.now()
        });
        
        console.log(`📱 TikTok: Found ${videos.length} videos for #${cleanHashtag}`);
        return videos.slice(0, limit);
      }
    }
  } catch (error) {
    console.log(`📱 TikTok API method failed, trying fallback...`);
  }
  
  // Method 2: Fallback - use known seed videos + oEmbed verification
  return await discoverFromSeedList(cleanHashtag, limit);
}

/**
 * Fallback discovery using seed hashtags
 */
async function discoverFromSeedList(hashtag, limit) {
  // Find related hashtags
  let relatedHashtags = [hashtag];
  for (const [category, tags] of Object.entries(hashtagMap)) {
    if (tags.includes(hashtag) || category === hashtag) {
      relatedHashtags = [...new Set([...relatedHashtags, ...tags])];
      break;
    }
  }
  
  // Return placeholder - in production, this would fetch from a database
  // of previously discovered videos
  console.log(`📱 TikTok: Using seed list for #${hashtag}`);
  return [];
}

/**
 * Search for TikToks using natural language
 * Maps search terms to hashtags and discovers content
 * @param {string} query - Natural language search query
 * @param {number} limit - Max results
 */
async function searchTikToks(query, limit = 5) {
  const queryLower = query.toLowerCase();
  
  // Extract potential hashtags from query
  const words = queryLower.split(/\s+/);
  let hashtags = [];
  
  // Direct hashtag mentions
  const hashtagMatches = query.match(/#(\w+)/g);
  if (hashtagMatches) {
    hashtags.push(...hashtagMatches.map(h => h.slice(1)));
  }
  
  // Map common words to hashtags
  const wordToHashtag = {
    'puppies': 'puppies', 'puppy': 'puppies', 'dogs': 'dogsoftiktok', 'dog': 'dogsoftiktok',
    'cats': 'catsoftiktok', 'cat': 'catsoftiktok', 'kitten': 'kitten', 'kitty': 'catsoftiktok',
    'funny': 'funny', 'hilarious': 'funnyvideos', 'comedy': 'comedy', 'laugh': 'funny',
    'cooking': 'cooking', 'recipe': 'recipe', 'food': 'foodtiktok', 'cook': 'cooking',
    'crypto': 'crypto', 'bitcoin': 'bitcoin', 'ethereum': 'ethereum', 'trading': 'trading',
    'music': 'music', 'song': 'music', 'singing': 'singer', 'dance': 'dance',
    'cute': 'cute', 'adorable': 'cute', 'baby': 'cute',
    'satisfying': 'satisfying', 'relaxing': 'relaxing', 'asmr': 'asmr',
    'meme': 'memes', 'memes': 'memes', 'viral': 'viral',
    'gaming': 'gaming', 'games': 'gaming', 'gamer': 'gamer',
    'art': 'art', 'drawing': 'drawing', 'painting': 'painting',
    'fitness': 'fitness', 'workout': 'workout', 'gym': 'gym',
    'fashion': 'fashion', 'style': 'style', 'outfit': 'ootd'
  };
  
  for (const word of words) {
    if (wordToHashtag[word]) {
      hashtags.push(wordToHashtag[word]);
    }
  }
  
  // Default to trending if no hashtags found
  if (hashtags.length === 0) {
    hashtags = ['viral', 'trending', 'fyp'];
  }
  
  // Discover videos from the first matching hashtag
  const primaryHashtag = hashtags[0];
  const videos = await discoverByHashtag(primaryHashtag, limit);
  
  return {
    query,
    hashtag: primaryHashtag,
    relatedHashtags: hashtags.slice(1),
    videos,
    count: videos.length
  };
}

/**
 * Get TikTok oEmbed data for embedding
 * @param {string} url - TikTok video URL
 */
async function getOEmbed(url) {
  try {
    const response = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`);
    if (!response.ok) {
      throw new Error(`oEmbed failed: ${response.status}`);
    }
    const data = await response.json();
    return {
      ok: true,
      url,
      title: data.title,
      author: data.author_name,
      authorUrl: data.author_url,
      thumbnail: data.thumbnail_url,
      thumbnailWidth: data.thumbnail_width,
      thumbnailHeight: data.thumbnail_height,
      html: data.html,
      videoId: extractVideoId(url)
    };
  } catch (error) {
    console.error('TikTok oEmbed error:', error);
    return { ok: false, error: error.message };
  }
}

/**
 * Extract video ID from TikTok URL
 */
function extractVideoId(url) {
  const match = url.match(/video\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * Get a random TikTok from a category/hashtag
 */
async function getRandomTikTok(category = null) {
  const hashtag = category || getRandomCategory();
  const videos = await discoverByHashtag(hashtag, 10);
  
  if (videos.length === 0) {
    return null;
  }
  
  const randomVideo = videos[Math.floor(Math.random() * videos.length)];
  return {
    ...randomVideo,
    category: hashtag
  };
}

/**
 * Get available categories
 */
function getCategories() {
  return Object.keys(hashtagMap);
}

function getRandomCategory() {
  const categories = getCategories();
  return categories[Math.floor(Math.random() * categories.length)];
}

/**
 * Format TikTok for agent context
 * Returns a description the agent can understand and react to
 */
async function describeTikTokForAgent(videoData) {
  let data = videoData;
  
  // If given a URL string, fetch oEmbed first
  if (typeof videoData === 'string') {
    const embed = await getOEmbed(videoData);
    if (!embed.ok) return null;
    data = embed;
  }
  
  return {
    url: data.url,
    videoId: data.videoId || data.id,
    title: data.title || data.description,
    creator: data.author,
    creatorNickname: data.authorNickname,
    thumbnail: data.thumbnail,
    stats: {
      likes: data.likes,
      comments: data.comments,
      shares: data.shares,
      plays: data.plays
    },
    description: `TikTok by @${data.author}: "${data.title || data.description}"`,
    // This is what the agent "sees" and can talk about
    agentPrompt: `You're watching a TikTok video by @${data.author}. The video is titled: "${data.title || data.description}". ${data.plays ? `It has ${formatNumber(data.plays)} views.` : ''}`
  };
}

function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

/**
 * Create embed URL for iframe
 */
function getEmbedUrl(videoId) {
  return `https://www.tiktok.com/embed/v2/${videoId}`;
}

/**
 * Store a discovered TikTok (for building up the database)
 */
function storeTikTok(videoData, hashtag) {
  const cached = hashtagCache.get(hashtag) || { videos: [], timestamp: Date.now() };
  
  // Check if already exists
  if (!cached.videos.find(v => v.id === videoData.id)) {
    cached.videos.push(videoData);
    hashtagCache.set(hashtag, cached);
  }
}

/**
 * Parse [tiktok:search_term] tags from text
 * Returns array of { search, position } objects
 * @param {string} text - Message text to parse
 */
function parseTikTokTags(text) {
  const tags = [];
  // Match [tiktok:search_term] or [tiktok:search term with spaces]
  const regex = /\[tiktok:([^\]]+)\]/gi;
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
 * Strip TikTok tags from text (for speech/display)
 * @param {string} text - Text containing [tiktok:...] tags
 */
function stripTikTokTags(text) {
  return text.replace(/\[tiktok:[^\]]+\]/gi, '').trim();
}

/**
 * Get a TikTok for streaming based on search term
 * Returns embed data suitable for frontend display
 */
async function getTikTokForStream(searchTerm) {
  console.log(`📱 TikTok: Searching for "${searchTerm}"...`);
  
  const results = await searchTikToks(searchTerm, 5);
  
  if (results.videos.length === 0) {
    console.log(`📱 TikTok: No results for "${searchTerm}"`);
    return null;
  }
  
  // Pick a random one from results
  const video = results.videos[Math.floor(Math.random() * results.videos.length)];
  
  // Get oEmbed data for the video
  const embed = await getOEmbed(video.url);
  
  if (!embed.ok) {
    console.log(`📱 TikTok: oEmbed failed for ${video.url}`);
    // Return basic info without embed
    return {
      id: video.id,
      url: video.url,
      embedUrl: getEmbedUrl(video.id),
      title: video.description,
      author: video.author,
      authorNickname: video.authorNickname,
      thumbnail: video.thumbnail,
      hashtag: results.hashtag,
      stats: {
        likes: video.likes,
        plays: video.plays
      },
      duration: 15000 // Default 15 seconds display time
    };
  }
  
  return {
    id: embed.videoId || video.id,
    url: video.url,
    embedUrl: getEmbedUrl(embed.videoId || video.id),
    title: embed.title || video.description,
    author: embed.author || video.author,
    authorNickname: video.authorNickname,
    thumbnail: embed.thumbnail || video.thumbnail,
    thumbnailWidth: embed.thumbnailWidth,
    thumbnailHeight: embed.thumbnailHeight,
    html: embed.html,
    hashtag: results.hashtag,
    stats: {
      likes: video.likes,
      plays: video.plays,
      comments: video.comments,
      shares: video.shares
    },
    duration: 15000 // Display for 15 seconds
  };
}

export {
  discoverByHashtag,
  searchTikToks,
  getOEmbed,
  getRandomTikTok,
  getCategories,
  describeTikTokForAgent,
  extractVideoId,
  getEmbedUrl,
  storeTikTok,
  parseTikTokTags,
  stripTikTokTags,
  getTikTokForStream,
  hashtagMap
};
