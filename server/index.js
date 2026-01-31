import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import cors from 'cors';
import { generateSpeech, cleanupOldFiles, TEMP_DIR as TTS_TEMP_DIR } from './tts.js';

const app = express();

// Enable CORS for all routes
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:5173'],
  methods: ['GET', 'POST'],
  credentials: true
}));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: ["http://localhost:3000", "http://localhost:5173"],
    methods: ["GET", "POST"]
  }
});

// ============ OPENCLAW AGENT (via CLI) ============
// Uses `openclaw agent --local` for direct execution

class OpenClawAgent {
  constructor() {
    this.agentId = process.env.OPENCLAW_AGENT_ID || 'main';
    this.sessionId = `clawstream-${randomUUID()}`;
    this.isProcessing = false;
    this.conversationHistory = [];
  }

  async sendMessage(message, socket) {
    if (this.isProcessing) {
      return { error: 'Agent is busy processing another request' };
    }

    this.isProcessing = true;
    io.emit('agent:status', { state: 'thinking' });
    
    const startTime = Date.now();
    console.log(`⏱️ [TIMING] Request started at ${new Date().toISOString()}`);

    return new Promise((resolve, reject) => {
      let output = '';
      let errorOutput = '';
      let firstChunkTime = null;

      // Run openclaw agent command
      // The agent gets its avatar control instructions from SOUL.md in the workspace
      // Use --thinking minimal for faster responses (Mao doesn't need deep reasoning)
      const args = [
        'agent',
        '--local',
        '--agent', this.agentId,
        '--session-id', this.sessionId,
        '--thinking', 'minimal',  // Faster responses - she's a streamer, not solving math problems
        '--message', message
      ];

      console.log(`🦞 Running: openclaw ${args.join(' ').slice(0, 80)}...`);

      const proc = spawn('openclaw', args, {
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // Stream stdout in real-time
      proc.stdout.on('data', (data) => {
        const text = data.toString();
        output += text;
        
        if (!firstChunkTime) {
          firstChunkTime = Date.now();
          console.log(`⏱️ [TIMING] First chunk received after ${firstChunkTime - startTime}ms`);
        }
        
        // Emit to terminal only (not chat - we show final message only)
        io.emit('agent:output', {
          type: 'text',
          content: text,
          state: 'coding',
          timestamp: Date.now()
        });

        io.emit('terminal:output', {
          text: text,
          type: 'stdout'
        });
      });

      proc.stderr.on('data', (data) => {
        const text = data.toString();
        errorOutput += text;
        
        // Filter out the OpenClaw banner
        if (!text.includes('OpenClaw') && !text.includes('🦞')) {
          io.emit('terminal:output', {
            text: `\x1b[33m${text}\x1b[0m`,
            type: 'stderr'
          });
        }
      });

      proc.on('close', (code) => {
        const totalTime = Date.now() - startTime;
        console.log(`⏱️ [TIMING] OpenClaw finished after ${totalTime}ms (code: ${code})`);
        
        this.isProcessing = false;
        io.emit('agent:status', { state: 'idle' });

        if (code === 0) {
          // Clean the output (remove OpenClaw banner if present)
          const cleanOutput = output
            .replace(/🦞 OpenClaw.*?\n\n/s, '')
            .trim();

          this.conversationHistory.push({
            role: 'user',
            content: message,
            timestamp: Date.now()
          });
          
          this.conversationHistory.push({
            role: 'assistant',
            content: cleanOutput,
            timestamp: Date.now()
          });

          resolve({ ok: true, response: cleanOutput });
        } else {
          const error = errorOutput || `Process exited with code ${code}`;
          io.emit('agent:error', { message: error });
          reject(new Error(error));
        }
      });

      proc.on('error', (err) => {
        this.isProcessing = false;
        io.emit('agent:status', { state: 'error' });
        io.emit('agent:error', { message: err.message });
        reject(err);
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        if (this.isProcessing) {
          proc.kill('SIGTERM');
          this.isProcessing = false;
          io.emit('agent:status', { state: 'error' });
          reject(new Error('Agent request timed out'));
        }
      }, 300000);
    });
  }

  getHistory() {
    return this.conversationHistory;
  }

  clearHistory() {
    this.conversationHistory = [];
    this.sessionId = `clawstream-${randomUUID()}`;
  }
}

// Initialize agent
const agent = new OpenClawAgent();

// ============ SOCKET.IO HANDLERS ============
io.on('connection', (socket) => {
  console.log('👤 Client connected:', socket.id);

  // Send initial state
  socket.emit('agent:status', { 
    state: 'idle',
    connected: true,
    agentId: agent.agentId
  });

  // Send conversation history
  socket.emit('chat:history', agent.getHistory());

  // Handle chat messages
  socket.on('chat:send', async (data) => {
    const { username, text, isAutonomous } = data;
    
    // Check if this is an autonomous thought
    const isAutonomousThought = isAutonomous || text?.startsWith('[AUTONOMOUS THOUGHT]');
    
    // Extract the actual prompt for autonomous messages
    const actualMessage = isAutonomousThought 
      ? text.replace('[AUTONOMOUS THOUGHT]', '').trim()
      : text;
    
    console.log(`💬 ${isAutonomousThought ? '🤖 AUTONOMOUS' : username}: ${actualMessage.slice(0, 60)}...`);

    // Only broadcast user message if NOT autonomous
    if (!isAutonomousThought) {
      io.emit('chat:message', {
        username: username || 'You',
        text: text,
        type: 'user',
        timestamp: Date.now()
      });
    }

    // Send to agent
    try {
      const result = await agent.sendMessage(actualMessage, socket);
      
      // Clean emotion/action tags for chat display
      // Mao PRO supports extended emotions and actions
      const cleanedResponse = result.response
        .replace(/\[(neutral|happy|excited|thinking|confused|surprised|sad|angry|wink|love|smug|sleepy)\]/gi, '')
        .replace(/\[(wave|nod|shake|dance|bow|think|shrug|point|raise_left_hand|raise_right_hand|raise_left_arm|raise_right_arm|raise_both_hands|raise_both_arms|lower_left_arm|lower_right_arm|lower_arms|look_left|look_right|look_up|look_down|cast_spell|magic|hearts|send_love|explosion|boom|summon_rabbit|rabbit|aura|power_up)\]/gi, '')
        .trim();
      
      // NOTE: We no longer emit chat:message here for agent responses
      // The frontend will show Mao's message in chat when her voice starts playing
      // This makes it feel more natural - like she's really talking
      
      // Generate TTS audio using ElevenLabs
      let audioPath = null;
      try {
        const ttsStart = Date.now();
        audioPath = await generateSpeech(cleanedResponse);
        console.log(`⏱️ [TIMING] TTS generated in ${Date.now() - ttsStart}ms`);
        console.log(`🔊 Audio generated: ${audioPath}`);
      } catch (ttsError) {
        console.error('TTS generation failed:', ttsError.message);
      }
      
      // Send complete event with FULL response (including tags) for emotion processing
      io.emit('chat:complete', {
        fullResponse: result.response,
        cleanResponse: cleanedResponse,
        audioPath: audioPath,
        timestamp: Date.now()
      });
      
    } catch (err) {
      console.error('Agent error:', err.message);
      io.emit('chat:error', { error: err.message });
      io.emit('chat:message', {
        username: 'System',
        text: `Error: ${err.message}`,
        type: 'system',
        timestamp: Date.now()
      });
    }
  });

  // Handle direct agent requests
  socket.on('agent:send', async (data) => {
    try {
      await agent.sendMessage(data.message, socket);
    } catch (err) {
      socket.emit('agent:error', { message: err.message });
    }
  });

  // Clear conversation
  socket.on('chat:clear', () => {
    agent.clearHistory();
    io.emit('chat:cleared');
  });

  socket.on('disconnect', () => {
    console.log('👤 Client disconnected:', socket.id);
  });
});

// ============ REST API ============
app.use(express.json());

// Serve TTS audio files from our temp directory
app.use('/tts', express.static(TTS_TEMP_DIR));
console.log(`🔊 Serving TTS files from: ${TTS_TEMP_DIR}`);

app.get('/api/status', (req, res) => {
  res.json({
    connected: true,
    agentId: agent.agentId,
    sessionId: agent.sessionId,
    isProcessing: agent.isProcessing,
    viewers: io.engine.clientsCount,
    uptime: process.uptime()
  });
});

app.get('/api/history', (req, res) => {
  res.json(agent.getHistory());
});

app.post('/api/message', async (req, res) => {
  const { message } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'Message required' });
  }
  
  try {
    const result = await agent.sendMessage(message);
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/clear', (req, res) => {
  agent.clearHistory();
  res.json({ ok: true });
});

// ============ START SERVER ============
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  🦞 ClawStream Server                                        ║
║  Server running on http://localhost:${PORT}                     ║
║  Agent: ${agent.agentId.padEnd(47)}   ║
║  Using: openclaw agent --local                               ║
╚══════════════════════════════════════════════════════════════╝
  `);
});
