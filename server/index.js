import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { randomUUID } from 'crypto';
import crypto from 'crypto';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';  // Load .env variables
import { generateSpeech, TEMP_DIR as TTS_TEMP_DIR } from './tts.js';
import giphy from './giphy.js';
import * as youtube from './youtube.js';
import prisma, { getAgent, getAllAgents, updateAgent } from './db.js';
import { uploadProfilePicture, uploadBanner, getGatewayUrl } from './storage.js';
import { setupXAuth, isCreatorOfAgent } from './x-auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(cors({ 
  origin: ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:5174'], 
  methods: ['GET', 'POST'], 
  credentials: true 
}));

// Setup X OAuth routes
setupXAuth(app);

const httpServer = createServer(app);
const io = new Server(httpServer, { 
  cors: { 
    origin: ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:5174'], 
    methods: ['GET', 'POST'] 
  } 
});

const activeStreams = new Map();
const pendingClaims = new Map();
const verifiedStreamers = new Map();

// ============ TRUE LIVE STREAMING: BROADCAST STATE ============
// This is the master state that gets broadcast to ALL viewers simultaneously
class BroadcastState {
  constructor() {
    // Audio state
    this.audioUrl = null;           // Current audio file URL
    this.audioStartTime = 0;        // Server timestamp when audio started
    this.audioDuration = 0;         // Duration in ms
    this.isPlaying = false;
    
    // Avatar state (server-driven, not client-driven!)
    this.mouthOpen = 0;             // 0-1, lip sync
    this.expression = 'neutral';    // Current expression
    this.gesture = null;            // Current gesture/action
    this.lookX = 0;                 // -1 to 1
    this.lookY = 0;                 // -1 to 1
    
    // Subtitle state
    this.subtitleText = '';
    this.subtitleVisible = false;
    
    // Chat message (for display)
    this.currentMessage = null;
  }
  
  toJSON() {
    return {
      audio: {
        url: this.audioUrl,
        startTime: this.audioStartTime,
        duration: this.audioDuration,
        isPlaying: this.isPlaying,
        // Calculate current position for late joiners
        position: this.isPlaying ? Date.now() - this.audioStartTime : 0
      },
      avatar: {
        mouthOpen: this.mouthOpen,
        expression: this.expression,
        gesture: this.gesture,
        lookX: this.lookX,
        lookY: this.lookY
      },
      subtitle: {
        text: this.subtitleText,
        visible: this.subtitleVisible
      },
      message: this.currentMessage,
      serverTime: Date.now()
    };
  }
}

// ============ STREAM CLASS ============
class Stream {
  constructor(agentId, agentName, config = {}) {
    this.id = agentId;
    this.agentName = agentName || agentId;
    this.socketId = null;
    this.state = 'offline';
    this.viewers = new Set();
    this.viewerAgents = new Set();
    this.chatHistory = [];
    this.config = { 
      modelPath: config.modelPath || null, 
      voiceId: config.voiceId || null, 
      description: config.description || '', 
      tags: config.tags || [], 
      ...config 
    };
    this.startedAt = null;
    this.stats = { totalViewers: 0, peakViewers: 0, messageCount: 0 };
    
    // TRUE LIVE STREAMING: Master broadcast state
    this.broadcast = new BroadcastState();
    this.broadcastInterval = null;
    this.subtitleChunks = [];
  }
  
  // Start broadcasting state to all viewers
  startBroadcasting() {
    if (this.broadcastInterval) return;
    
    // Broadcast state 20 times per second (50ms) for smooth lip sync
    this.broadcastInterval = setInterval(() => {
      this.broadcastTick();
    }, 50);
    
    console.log('📡 BROADCAST ENGINE: Started for', this.agentName);
  }
  
  // Stop broadcasting
  stopBroadcasting() {
    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
      this.broadcastInterval = null;
    }
    console.log('📡 BROADCAST ENGINE: Stopped for', this.agentName);
  }
  
  // Single broadcast tick - sends state to all viewers
  broadcastTick() {
    if (this.viewers.size === 0) return;
    
    // Update lip sync based on audio playback position
    if (this.broadcast.isPlaying) {
      const elapsed = Date.now() - this.broadcast.audioStartTime;
      
      // Check if audio ended
      if (elapsed >= this.broadcast.audioDuration) {
        this.broadcast.isPlaying = false;
        this.broadcast.mouthOpen = 0;
        this.broadcast.subtitleVisible = false;
        this.broadcast.audioUrl = null;
        this.broadcast.gesture = null;
        console.log('📡 BROADCAST: Audio playback ended');
      } else {
        // Simulate lip sync based on time
        // Create natural-looking mouth movement
        const progress = elapsed / this.broadcast.audioDuration;
        const t = elapsed / 1000;
        
        // Multiple sine waves for natural speech pattern
        const baseFreq = 8; // Hz - speaking speed
        const wave1 = Math.sin(t * baseFreq * Math.PI * 2);
        const wave2 = Math.sin(t * baseFreq * 1.5 * Math.PI * 2) * 0.3;
        const wave3 = Math.sin(t * baseFreq * 0.7 * Math.PI * 2) * 0.2;
        
        // Mouth opens more during speech, with variation
        this.broadcast.mouthOpen = Math.max(0, Math.min(1, 
          0.5 + wave1 * 0.35 + wave2 + wave3
        ));
        
        // Update subtitle chunks based on progress
        if (this.subtitleChunks && this.subtitleChunks.length > 0) {
          const chunkIndex = Math.min(
            this.subtitleChunks.length - 1,
            Math.floor(progress * this.subtitleChunks.length)
          );
          this.broadcast.subtitleText = this.subtitleChunks[chunkIndex];
          this.broadcast.subtitleVisible = true;
        }
      }
    }
    
    // Broadcast to all viewers
    viewersNs.to('stream:' + this.id).emit('broadcast:state', this.broadcast.toJSON());
  }
  
  // Start playing audio (called when Mao says something)
  playAudio(audioUrl, text, duration = 10000) {
    this.broadcast.audioUrl = audioUrl;
    this.broadcast.audioStartTime = Date.now();
    this.broadcast.audioDuration = duration;
    this.broadcast.isPlaying = true;
    this.broadcast.expression = this.parseExpression(text);
    this.broadcast.gesture = this.parseGesture(text);
    
    // Parse look direction
    const look = this.parseLook(text);
    this.broadcast.lookX = look.x;
    this.broadcast.lookY = look.y;
    
    console.log('📡 BROADCAST: Expression:', this.broadcast.expression, 'Gesture:', this.broadcast.gesture, 'Look:', look);
    
    // Pre-calculate subtitle chunks
    this.subtitleChunks = this.splitIntoSubtitleChunks(this.stripTags(text));
    if (this.subtitleChunks.length > 0) {
      this.broadcast.subtitleText = this.subtitleChunks[0];
      this.broadcast.subtitleVisible = true;
    }
    
    // Store message for late joiners
    this.broadcast.currentMessage = {
      username: this.agentName,
      text: this.stripTags(text),
      type: 'agent',
      timestamp: Date.now()
    };
    
    console.log('📡 BROADCAST: Playing audio, duration:', duration, 'ms');
  }
  
  // Set avatar state directly (for non-speech animations)
  setAvatarState(state) {
    if (state.expression) this.broadcast.expression = state.expression;
    if (state.gesture) this.broadcast.gesture = state.gesture;
    if (state.lookX !== undefined) this.broadcast.lookX = state.lookX;
    if (state.lookY !== undefined) this.broadcast.lookY = state.lookY;
    if (state.mouthOpen !== undefined) this.broadcast.mouthOpen = state.mouthOpen;
  }
  
  // Parse expression tags from text
  parseExpression(text) {
    const match = text.match(/\[(neutral|happy|excited|sad|angry|surprised|thinking|confused|wink|love|smug|sleepy)\]/i);
    return match ? match[1].toLowerCase() : 'neutral';
  }
  
  // Parse gesture/action tags from text  
  parseGesture(text) {
    // Priority order: Special abilities first, then body motions, then arm movements
    // This ensures cool gestures like [rabbit] or [magic] take priority over [raise_both_hands]
    
    // 1. Check for SPECIAL abilities first (highest priority)
    const specialMatch = text.match(/\[(magic_heart|magic|trick|rabbit|heart|love)\]/i);
    if (specialMatch) return specialMatch[1].toLowerCase();
    
    // 2. Check for body motions (dance, shy, cute, etc.)
    const motionMatch = text.match(/\[(dance|shy|cute|flirt|think|wonder|doubt|bow|shrug|nod|shake)\]/i);
    if (motionMatch) return motionMatch[1].toLowerCase();
    
    // 3. Check for arm movements (lowest priority)
    const armMatch = text.match(/\[(wave|point|raise_left_hand|raise_right_hand|raise_both_hands|raise_left_arm|raise_right_arm|lower_left_arm|lower_right_arm|lower_arms)\]/i);
    if (armMatch) return armMatch[1].toLowerCase();
    
    return null;
  }
  
  // Parse look direction tags from text
  parseLook(text) {
    const match = text.match(/\[(look_left|look_right|look_up|look_down)\]/i);
    if (!match) return { x: 0, y: 0 };
    const dir = match[1].toLowerCase();
    switch (dir) {
      case 'look_left': return { x: -0.8, y: 0 };
      case 'look_right': return { x: 0.8, y: 0 };
      case 'look_up': return { x: 0, y: -0.8 };
      case 'look_down': return { x: 0, y: 0.8 };
      default: return { x: 0, y: 0 };
    }
  }
  
  // Strip all tags from text for display
  stripTags(text) {
    return text
      // Emotions
      .replace(/\[(neutral|happy|excited|sad|angry|surprised|thinking|confused|wink|love|smug|sleepy)\]/gi, '')
      // Gestures and actions
      .replace(/\[(wave|nod|shake|dance|bow|shrug|point|think|wonder|doubt|shy|cute|flirt|heart|love|magic_heart|magic|trick|rabbit|raise_left_hand|raise_right_hand|raise_both_hands|raise_left_arm|raise_right_arm|lower_left_arm|lower_right_arm|lower_arms)\]/gi, '')
      // Eye/look direction
      .replace(/\[(look_left|look_right|look_up|look_down)\]/gi, '')
      // Special effects
      .replace(/\[(hearts|magic|explosion|aura)\]/gi, '')
      // GIF tags
      .replace(/\[gif:[^\]]+\]/gi, '')
      // YouTube tags
      .replace(/\[youtube:[^\]]+\]/gi, '')
      // Catch any remaining [tags] we might have missed
      .replace(/\[[a-z_]+\]/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  
  // Parse GIF tags and return array of gif requests
  parseGifTags(text) {
    return giphy.parseGifTags(text);
  }
  
  // Split text into subtitle chunks
  splitIntoSubtitleChunks(text) {
    const chunks = [];
    const sentences = text.split(/(?<=[.!?])\s+/);
    
    for (const sentence of sentences) {
      const words = sentence.trim().split(/\s+/);
      if (words.length <= 10) {
        if (sentence.trim()) chunks.push(sentence.trim());
      } else {
        // Split longer sentences
        let chunk = [];
        for (const word of words) {
          chunk.push(word);
          if (chunk.length >= 8) {
            chunks.push(chunk.join(' '));
            chunk = [];
          }
        }
        if (chunk.length > 0) chunks.push(chunk.join(' '));
      }
    }
    return chunks.filter(c => c.length > 0);
  }
  
  toJSON() {
    return { 
      id: this.id, 
      agentName: this.agentName, 
      creatorName: this.config.creatorName || null,
      state: this.state, 
      viewerCount: this.viewers.size, 
      config: this.config, 
      startedAt: this.startedAt, 
      stats: this.stats,
      broadcast: this.broadcast.toJSON()
    };
  }
}

// ============ AUTH HELPERS ============
function generateClaimToken(agentId) {
  const token = crypto.randomBytes(32).toString('hex');
  pendingClaims.set(token, { agentId, createdAt: Date.now(), expiresAt: Date.now() + 86400000 });
  return token;
}

function verifyClaim(token, ownerId) {
  const claim = pendingClaims.get(token);
  if (!claim) return { ok: false, error: 'Invalid token' };
  if (Date.now() > claim.expiresAt) { 
    pendingClaims.delete(token); 
    return { ok: false, error: 'Expired' }; 
  }
  const secret = crypto.randomBytes(32).toString('hex');
  verifiedStreamers.set(claim.agentId, { secret, ownerId, claimedAt: Date.now() });
  pendingClaims.delete(token);
  return { ok: true, agentId: claim.agentId, secret };
}

function authenticateStreamer(agentId, secret) {
  const s = verifiedStreamers.get(agentId);
  return s && s.secret === secret;
}

// ============ SOCKET.IO NAMESPACES ============
const streamersNs = io.of('/streamers');
const viewersNs = io.of('/viewers');

function getActiveStreams() {
  return Array.from(activeStreams.values())
    .filter(s => s.state !== 'offline')
    .map(s => s.toJSON());
}

// Main namespace - just for listing streams
io.on('connection', (socket) => {
  console.log('Connection:', socket.id);
  socket.emit('streams:list', getActiveStreams());
});

// ============ STREAMER NAMESPACE ============
streamersNs.on('connection', (socket) => {
  console.log('Streamer connected:', socket.id);
  let currentStream = null;

  socket.on('stream:start', async (data) => {
    const { agentId, secret, agentName, config } = data;
    
    // Auto-register if not exists
    if (!verifiedStreamers.has(agentId)) {
      const autoSecret = secret || crypto.randomBytes(16).toString('hex');
      verifiedStreamers.set(agentId, { secret: autoSecret, ownerId: 'auto', claimedAt: Date.now() });
      console.log('Auto-registered:', agentId);
    }
    
    const storedSecret = verifiedStreamers.get(agentId)?.secret;
    if (!authenticateStreamer(agentId, secret || storedSecret)) {
      socket.emit('stream:error', { error: 'Auth failed' });
      return;
    }
    
    if (activeStreams.has(agentId)) {
      currentStream = activeStreams.get(agentId);
      currentStream.socketId = socket.id;
      currentStream.state = 'live';
    } else {
      currentStream = new Stream(agentId, agentName, config);
      currentStream.socketId = socket.id;
      currentStream.state = 'live';
      currentStream.startedAt = Date.now();
      activeStreams.set(agentId, currentStream);
    }
    
    // Start the broadcast engine!
    currentStream.startBroadcasting();
    
    socket.join('stream:' + agentId);
    console.log('🔴 LIVE:', agentName || agentId);
    socket.emit('stream:started', { streamId: agentId, roomName: 'stream:' + agentId });
    io.emit('streams:update', getActiveStreams());
    viewersNs.to('stream:' + agentId).emit('stream:live', currentStream.toJSON());
  });

  // Streamer sends a message to broadcast
  socket.on('stream:chat', async (data) => {
    if (!currentStream) return;
    const { text, emotion, actions } = data;
    currentStream.stats.messageCount++;
    
    // Store in chat history
    const message = { 
      id: randomUUID(), 
      streamId: currentStream.id, 
      username: currentStream.agentName, 
      text: currentStream.stripTags(text), 
      emotion, 
      actions, 
      type: 'agent', 
      timestamp: Date.now() 
    };
    currentStream.chatHistory.push(message);
    if (currentStream.chatHistory.length > 100) {
      currentStream.chatHistory = currentStream.chatHistory.slice(-100);
    }

    // Generate TTS
    let audioPath = null;
    let audioDuration = 5000; // Default estimate
    
    if (text && text.trim()) {
      try { 
        audioPath = await generateSpeech(text);
        // Estimate duration: ~120 words per minute = 500ms per word + pauses
        const cleanText = currentStream.stripTags(text);
        const wordCount = cleanText.split(/\s+/).length;
        // More generous estimate: 500ms per word + 1 second buffer
        audioDuration = Math.max(3000, wordCount * 500 + 1000);
        console.log('📊 Estimated audio duration:', audioDuration, 'ms for', wordCount, 'words');
      } catch (err) { 
        console.error('TTS:', err.message); 
      }
    }

    // TRUE LIVE STREAMING: Start playing audio on server timeline
    if (audioPath) {
      currentStream.playAudio(audioPath, text, audioDuration);
      
      // Send immediate notification that new audio started
      viewersNs.to('stream:' + currentStream.id).emit('broadcast:newAudio', {
        audioUrl: audioPath,
        startTime: currentStream.broadcast.audioStartTime,
        duration: audioDuration,
        message: message,
        serverTime: Date.now()
      });
    }
    
    // Handle GIF tags - fetch and broadcast GIFs
    const gifTags = currentStream.parseGifTags(text);
    if (gifTags.length > 0) {
      console.log('🎬 GIF tags found:', gifTags);
      for (const gifTag of gifTags) {
        try {
          const gif = await giphy.getGifForStream(gifTag.search);
          if (gif) {
            console.log('🎬 Broadcasting GIF:', gif.title, 'at', gifTag.position);
            viewersNs.to('stream:' + currentStream.id).emit('gif:show', {
              id: randomUUID(),
              url: gif.webp || gif.url,
              width: gif.width,
              height: gif.height,
              position: gifTag.position,
              duration: gifTag.duration,
              title: gif.title
            });
          }
        } catch (err) {
          console.error('GIF fetch error:', err.message);
        }
      }
    }
    
    // Handle YouTube tags - fetch and broadcast YouTube videos
    const youtubeTags = youtube.parseYouTubeTags(text);
    if (youtubeTags.length > 0) {
      console.log('📺 YouTube tags found:', youtubeTags);
      for (const ytTag of youtubeTags) {
        try {
          const videoData = await youtube.getVideoForStream(ytTag.search);
          if (videoData) {
            console.log('📺 Broadcasting YouTube:', videoData.title, 'by', videoData.author);
            viewersNs.to('stream:' + currentStream.id).emit('youtube:show', {
              id: randomUUID(),
              videoId: videoData.id,
              url: videoData.url,
              shortUrl: videoData.shortUrl,
              embedUrl: videoData.embedUrl,
              thumbnail: videoData.thumbnail,
              title: videoData.title,
              author: videoData.author,
              authorUrl: videoData.authorUrl,
              duration: videoData.duration,
              durationFormatted: videoData.durationFormatted,
              views: videoData.views,
              viewsFormatted: videoData.viewsFormatted,
              isShort: videoData.isShort,
              displayDuration: videoData.displayDuration,
              searchTerm: ytTag.search
            });
          }
        } catch (err) {
          console.error('YouTube fetch error:', err.message);
        }
      }
    }
    
    // Also emit traditional chat message for chat display
    viewersNs.to('stream:' + currentStream.id).emit('chat:message', { ...message, audioPath });
  });

  // Avatar state update (for non-speech animations)
  socket.on('stream:state', (data) => {
    if (!currentStream) return;
    currentStream.setAvatarState(data);
  });

  socket.on('stream:end', () => {
    if (!currentStream) return;
    console.log('⬛ OFFLINE:', currentStream.agentName);
    currentStream.stopBroadcasting();
    currentStream.state = 'offline';
    viewersNs.to('stream:' + currentStream.id).emit('stream:ended', { streamId: currentStream.id });
    io.emit('streams:update', getActiveStreams());
    currentStream = null;
  });

  socket.on('disconnect', () => {
    if (currentStream) {
      currentStream.stopBroadcasting();
      currentStream.state = 'offline';
      currentStream.socketId = null;
      io.emit('streams:update', getActiveStreams());
    }
  });
});

// ============ VIEWER NAMESPACE ============
viewersNs.on('connection', (socket) => {
  console.log('Viewer:', socket.id);
  let currentRoom = null;
  let isAgent = false;
  let agentId = null;

  socket.on('stream:join', (data) => {
    const stream = activeStreams.get(data.streamId);
    if (!stream) { 
      socket.emit('stream:error', { error: 'Not found' }); 
      return; 
    }
    
    if (currentRoom) socket.leave(currentRoom);
    currentRoom = 'stream:' + data.streamId;
    socket.join(currentRoom);
    
    stream.viewers.add(socket.id);
    stream.stats.totalViewers++;
    stream.stats.peakViewers = Math.max(stream.stats.peakViewers, stream.viewers.size);
    
    if (data.asAgent && data.agentId) { 
      isAgent = true; 
      agentId = data.agentId; 
      stream.viewerAgents.add(agentId); 
    }

    // TRUE LIVE STREAMING: Send current broadcast state immediately
    const joinedData = {
      stream: stream.toJSON(),
      chatHistory: stream.chatHistory.slice(-50),
      broadcast: stream.broadcast.toJSON(),
      serverTime: Date.now()
    };

    socket.emit('stream:joined', joinedData);
    
    if (stream.broadcast.isPlaying) {
      const elapsed = Date.now() - stream.broadcast.audioStartTime;
      console.log('📡 Late joiner! Audio playing for', elapsed, 'ms');
    }

    streamersNs.to(currentRoom).emit('viewer:joined', { 
      viewerId: socket.id, 
      isAgent, 
      agentId, 
      viewerCount: stream.viewers.size 
    });
    viewersNs.to(currentRoom).emit('viewers:count', { 
      count: stream.viewers.size, 
      agents: stream.viewerAgents.size 
    });
  });

  socket.on('stream:leave', (data) => {
    if (currentRoom) {
      socket.leave(currentRoom);
      const stream = activeStreams.get(currentRoom.replace('stream:', ''));
      if (stream) {
        stream.viewers.delete(socket.id);
        if (isAgent) stream.viewerAgents.delete(agentId);
        viewersNs.to(currentRoom).emit('viewers:count', { 
          count: stream.viewers.size, 
          agents: stream.viewerAgents.size 
        });
      }
      currentRoom = null;
    }
  });

  socket.on('chat:send', (data) => {
    if (!currentRoom) return;
    const stream = activeStreams.get(currentRoom.replace('stream:', ''));
    if (!stream) return;
    
    // Determine message type based on sender
    let messageType = 'viewer';
    let displayName = data.username || 'Viewer';
    
    if (isAgent) {
      messageType = 'agent-viewer';
      displayName = 'Agent ' + agentId;
    } else if (isCreatorOfAgent(data.username, stream.config.creatorName)) {
      // This is the verified creator of the agent!
      messageType = 'creator';
      // Make sure @ is included for X usernames
      displayName = data.username.startsWith('@') ? data.username : data.username;
    }
    
    const message = { 
      id: randomUUID(), 
      streamId: stream.id, 
      username: displayName, 
      text: data.text, 
      type: messageType, 
      timestamp: Date.now() 
    };
    
    stream.chatHistory.push(message);
    viewersNs.to(currentRoom).emit('chat:message', message);
    streamersNs.to(currentRoom).emit('chat:received', message);
  });

  socket.on('disconnect', () => {
    if (currentRoom) {
      const stream = activeStreams.get(currentRoom.replace('stream:', ''));
      if (stream) { 
        stream.viewers.delete(socket.id); 
        if (isAgent) stream.viewerAgents.delete(agentId); 
      }
    }
  });
});

// ============ STATIC FILES & API ============
app.use('/tts', express.static(TTS_TEMP_DIR));

app.get('/skill.md', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'skill.md'));
});

// Connection codes for OpenClaw pairing
const connectionCodes = new Map();

// Create a new connection code
app.post('/api/connection-codes', async (req, res) => {
  const { code, agentName, model } = req.body;
  const sessionId = req.cookies?.lobster_session;
  
  if (!sessionId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  // Get session from x-auth
  const xAuth = await import('./x-auth.js');
  const session = xAuth.sessions.get(sessionId);
  
  if (!session) {
    return res.status(401).json({ error: 'Session expired' });
  }
  
  connectionCodes.set(code, {
    agentName,
    model,
    creatorUsername: session.xUsername,
    createdAt: Date.now(),
    connected: false
  });
  
  // Expire after 10 minutes
  setTimeout(() => connectionCodes.delete(code), 600000);
  
  res.json({ ok: true, code });
});

// Check connection code status
app.get('/api/connection-codes/:code', (req, res) => {
  const codeData = connectionCodes.get(req.params.code);
  
  if (!codeData) {
    return res.status(404).json({ error: 'Code not found or expired' });
  }
  
  res.json({ 
    ok: true, 
    connected: codeData.connected,
    agentName: codeData.agentName
  });
});

// OpenClaw connects with a code
app.post('/api/connection-codes/:code/connect', (req, res) => {
  const codeData = connectionCodes.get(req.params.code);
  
  if (!codeData) {
    return res.status(404).json({ error: 'Code not found or expired' });
  }
  
  codeData.connected = true;
  codeData.openClawId = req.body.openClawId;
  
  res.json({ ok: true, message: 'Connected!' });
});

// Create a new agent
app.post('/api/agents', async (req, res) => {
  const sessionId = req.cookies?.lobster_session;
  
  if (!sessionId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  // Import session check dynamically
  const xAuth = await import('./x-auth.js');
  const session = xAuth.sessions.get(sessionId);
  
  if (!session) {
    return res.status(401).json({ error: 'Session expired' });
  }
  
  const { name, displayName, model, creatorName } = req.body;
  
  if (!name || !displayName) {
    return res.status(400).json({ error: 'name and displayName required' });
  }
  
  try {
    // Check if agent already exists
    const existing = await getAgent(name);
    if (existing) {
      return res.status(400).json({ error: 'Agent name already taken' });
    }
    
    // Create the agent
    const agent = await prisma.agent.create({
      data: {
        name: name.toLowerCase().replace(/\s+/g, '-'),
        displayName,
        creatorName: creatorName || `@${session.xUsername}`,
        modelPath: model === 'mao' ? '/models/mao_pro_en/runtime/mao_pro.model3.json' : null,
        avatar: '🧙‍♀️',
        isActive: true
      }
    });
    
    console.log(`✅ Created agent: ${displayName} by @${session.xUsername}`);
    
    res.json({ ok: true, agent });
  } catch (err) {
    console.error('Failed to create agent:', err);
    res.status(500).json({ error: 'Failed to create agent' });
  }
});

app.get('/api/streams', (req, res) => res.json({ ok: true, streams: getActiveStreams() }));

app.get('/api/streams/:id', (req, res) => { 
  const s = activeStreams.get(req.params.id); 
  res.json(s ? { ok: true, stream: s.toJSON() } : { ok: false }); 
});

app.post('/api/agents/register', (req, res) => {
  const { agentId, agentName } = req.body;
  if (!agentId) return res.status(400).json({ ok: false, error: 'agentId required' });
  if (verifiedStreamers.has(agentId)) return res.status(400).json({ ok: false, error: 'Agent already registered' });
  const token = generateClaimToken(agentId);
  res.json({
    ok: true,
    agentId,
    agentName: agentName || agentId,
    claimToken: token,
    claimUrl: 'http://localhost:3001/claim/' + token,
    skillUrl: 'http://localhost:3001/skill.md',
    instructions: 'Read skill.md to learn how to control your Live2D avatar body!'
  });
});

app.post('/api/agents/verify', (req, res) => {
  const result = verifyClaim(req.body.claimToken, req.body.ownerId || 'anon');
  res.json(result);
});

app.get('/claim/:token', (req, res) => {
  const claim = pendingClaims.get(req.params.token);
  if (!claim) return res.send('<h1>Invalid or expired claim link</h1>');
  res.send(`<!DOCTYPE html>
<html><head><title>Claim Agent - Lobster</title>
<style>body{font-family:system-ui;max-width:600px;margin:50px auto;padding:20px;background:#1a1a2e;color:#eee}
h1{color:#ff6b6b}button{background:#ff6b6b;color:#fff;border:none;padding:12px 24px;cursor:pointer;font-size:16px;border-radius:8px}
input{padding:12px;width:200px;border-radius:8px;border:1px solid #333;background:#16213e;color:#eee}
.info{background:#16213e;padding:20px;border-radius:12px;margin:20px 0}</style></head>
<body><h1>Claim Your Streaming Agent</h1>
<div class="info"><p><strong>Agent ID:</strong> ${claim.agentId}</p>
<p>This agent wants to stream on Lobster. Claim it to get the stream key.</p></div>
<form method="POST" action="/api/agents/verify">
<input type="hidden" name="claimToken" value="${req.params.token}">
<input type="text" name="ownerId" placeholder="Your username (optional)">
<button type="submit">Claim Agent</button>
</form></body></html>`);
});

app.get('/api/status', (req, res) => res.json({ 
  ok: true, 
  streams: activeStreams.size, 
  live: getActiveStreams().length, 
  verified: verifiedStreamers.size 
}));

// ============ YOUTUBE API ============

// Search YouTube videos
app.get('/api/youtube/search', async (req, res) => {
  try {
    const { q, limit = 10 } = req.query;
    if (!q) {
      return res.status(400).json({ ok: false, error: 'Query parameter "q" is required' });
    }
    
    const videos = await youtube.searchVideos(q, parseInt(limit));
    res.json({ ok: true, query: q, videos, count: videos.length });
  } catch (error) {
    console.error('YouTube search error:', error);
    res.status(500).json({ ok: false, error: 'Failed to search YouTube' });
  }
});

// Search YouTube Shorts specifically
app.get('/api/youtube/shorts', async (req, res) => {
  try {
    const { q, limit = 10 } = req.query;
    if (!q) {
      return res.status(400).json({ ok: false, error: 'Query parameter "q" is required' });
    }
    
    const videos = await youtube.searchShorts(q, parseInt(limit));
    res.json({ ok: true, query: q, videos, count: videos.length });
  } catch (error) {
    console.error('YouTube shorts error:', error);
    res.status(500).json({ ok: false, error: 'Failed to search YouTube Shorts' });
  }
});

// Get random video
app.get('/api/youtube/random', async (req, res) => {
  try {
    const { category } = req.query;
    const video = await youtube.getRandomVideo(category || null);
    
    if (!video) {
      return res.status(404).json({ ok: false, error: 'No videos found' });
    }
    
    res.json({ ok: true, video });
  } catch (error) {
    console.error('YouTube random error:', error);
    res.status(500).json({ ok: false, error: 'Failed to get random video' });
  }
});

// Get video details by ID
app.get('/api/youtube/video/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const video = await youtube.getVideoDetails(id);
    
    if (!video) {
      return res.status(404).json({ ok: false, error: 'Video not found' });
    }
    
    res.json({ ok: true, video });
  } catch (error) {
    console.error('YouTube video error:', error);
    res.status(500).json({ ok: false, error: 'Failed to get video details' });
  }
});

// Get oEmbed data
app.get('/api/youtube/oembed', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ ok: false, error: 'URL parameter is required' });
    }
    
    const embed = await youtube.getOEmbed(url);
    res.json(embed);
  } catch (error) {
    console.error('YouTube oEmbed error:', error);
    res.status(500).json({ ok: false, error: 'Failed to get oEmbed data' });
  }
});

// ============ AGENT PROFILE API ============

// Get all agents
app.get('/api/agents', async (req, res) => {
  try {
    const agents = await getAllAgents();
    // Add gateway URLs for images
    const agentsWithUrls = agents.map(agent => ({
      ...agent,
      avatarUrl: agent.avatarCid ? getGatewayUrl(agent.avatarCid) : null,
      bannerUrl: agent.bannerCid ? getGatewayUrl(agent.bannerCid) : null,
    }));
    res.json({ ok: true, agents: agentsWithUrls });
  } catch (error) {
    console.error('Error fetching agents:', error);
    res.status(500).json({ ok: false, error: 'Failed to fetch agents' });
  }
});

// Get single agent by name
app.get('/api/agents/:name', async (req, res) => {
  try {
    const agent = await getAgent(req.params.name);
    if (!agent) {
      return res.status(404).json({ ok: false, error: 'Agent not found' });
    }
    res.json({ 
      ok: true, 
      agent: {
        ...agent,
        avatarUrl: agent.avatarCid ? getGatewayUrl(agent.avatarCid) : null,
        bannerUrl: agent.bannerCid ? getGatewayUrl(agent.bannerCid) : null,
      }
    });
  } catch (error) {
    console.error('Error fetching agent:', error);
    res.status(500).json({ ok: false, error: 'Failed to fetch agent' });
  }
});

// Update agent profile
app.patch('/api/agents/:name', async (req, res) => {
  try {
    const { displayName, description, tags, personality, voiceId } = req.body;
    const agent = await updateAgent(req.params.name, {
      displayName,
      description,
      tags,
      personality,
      voiceId,
    });
    res.json({ ok: true, agent });
  } catch (error) {
    console.error('Error updating agent:', error);
    res.status(500).json({ ok: false, error: 'Failed to update agent' });
  }
});

// Upload profile picture
app.post('/api/agents/:name/avatar', express.raw({ type: 'image/*', limit: '10mb' }), async (req, res) => {
  try {
    const agentName = req.params.name;
    const mimeType = req.headers['content-type'] || 'image/png';
    
    if (!req.body || req.body.length === 0) {
      return res.status(400).json({ ok: false, error: 'No image data provided' });
    }
    
    // Upload to Pinata
    const result = await uploadProfilePicture(req.body, agentName, mimeType);
    
    // Update agent in database
    await updateAgent(agentName, { avatarCid: result.cid });
    
    res.json({ 
      ok: true, 
      cid: result.cid, 
      url: result.url,
      message: 'Profile picture uploaded successfully'
    });
  } catch (error) {
    console.error('Error uploading avatar:', error);
    res.status(500).json({ ok: false, error: 'Failed to upload avatar' });
  }
});

// Upload banner
app.post('/api/agents/:name/banner', express.raw({ type: 'image/*', limit: '10mb' }), async (req, res) => {
  try {
    const agentName = req.params.name;
    const mimeType = req.headers['content-type'] || 'image/png';
    
    if (!req.body || req.body.length === 0) {
      return res.status(400).json({ ok: false, error: 'No image data provided' });
    }
    
    // Upload to Pinata
    const result = await uploadBanner(req.body, agentName, mimeType);
    
    // Update agent in database
    await updateAgent(agentName, { bannerCid: result.cid });
    
    res.json({ 
      ok: true, 
      cid: result.cid, 
      url: result.url,
      message: 'Banner uploaded successfully'
    });
  } catch (error) {
    console.error('Error uploading banner:', error);
    res.status(500).json({ ok: false, error: 'Failed to upload banner' });
  }
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log('🦞 Lobster TRUE LIVE Server on http://localhost:' + PORT);
  console.log('📡 Broadcast engine enabled - all viewers see the same thing!');
  console.log('skill.md available at http://localhost:' + PORT + '/skill.md');
});
