import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { WebSocket } from 'ws';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

// ============ OPENCLAW INTEGRATION ============
class OpenClawBridge {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.gatewayUrl = process.env.OPENCLAW_GATEWAY || 'ws://127.0.0.1:18789';
    this.token = process.env.OPENCLAW_TOKEN || '';
  }

  connect() {
    console.log(`Connecting to OpenClaw Gateway at ${this.gatewayUrl}...`);
    
    try {
      this.ws = new WebSocket(this.gatewayUrl);
      
      this.ws.on('open', () => {
        console.log('✓ Connected to OpenClaw Gateway');
        this.connected = true;
        
        // Authenticate if token provided
        if (this.token) {
          this.send({ type: 'auth', token: this.token });
        }
        
        // Subscribe to events
        this.send({ type: 'subscribe', events: ['agent.output', 'agent.status', 'session.message'] });
      });

      this.ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleMessage(msg);
        } catch (e) {
          console.error('Failed to parse message:', e);
        }
      });

      this.ws.on('close', () => {
        console.log('Disconnected from OpenClaw Gateway');
        this.connected = false;
        // Reconnect after 5 seconds
        setTimeout(() => this.connect(), 5000);
      });

      this.ws.on('error', (err) => {
        console.error('OpenClaw WebSocket error:', err.message);
      });
    } catch (err) {
      console.error('Failed to connect to OpenClaw:', err.message);
      setTimeout(() => this.connect(), 5000);
    }
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  handleMessage(msg) {
    // Forward relevant events to connected clients
    switch (msg.type) {
      case 'agent.output':
        io.emit('terminal:output', msg.data);
        break;
      case 'agent.status':
        io.emit('agent:status', msg.data);
        break;
      case 'session.message':
        io.emit('chat:message', msg.data);
        break;
      default:
        console.log('Unknown message type:', msg.type);
    }
  }

  sendToAgent(message) {
    this.send({
      type: 'session.send',
      data: { message }
    });
  }
}

// Initialize OpenClaw bridge
const openClaw = new OpenClawBridge();

// Try to connect (will fail gracefully if OpenClaw not running)
openClaw.connect();

// ============ SOCKET.IO HANDLERS ============
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Send initial state
  socket.emit('agent:status', { 
    state: 'idle',
    connected: openClaw.connected 
  });

  // Handle chat messages
  socket.on('chat:send', (data) => {
    // Broadcast to all clients
    io.emit('chat:message', {
      username: data.username || 'Anonymous',
      text: data.text,
      type: 'viewer',
      timestamp: Date.now()
    });

    // Forward to OpenClaw if command
    if (data.text.startsWith('/')) {
      openClaw.sendToAgent(data.text);
    }
  });

  // Handle terminal input
  socket.on('terminal:input', (data) => {
    openClaw.sendToAgent(data.command);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// ============ REST API ============
app.use(express.json());

app.get('/api/status', (req, res) => {
  res.json({
    openclaw: openClaw.connected,
    viewers: io.engine.clientsCount,
    uptime: process.uptime()
  });
});

app.post('/api/agent/message', (req, res) => {
  const { message } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'Message required' });
  }
  openClaw.sendToAgent(message);
  res.json({ ok: true });
});

// ============ START SERVER ============
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  🦞 AgentStream Server                                       ║
║  Server running on http://localhost:${PORT}                     ║
║  OpenClaw Gateway: ${openClaw.gatewayUrl.padEnd(35)}   ║
╚══════════════════════════════════════════════════════════════╝
  `);
});
