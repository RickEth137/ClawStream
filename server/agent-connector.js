// ClawStream Agent Connector
// Use this to connect an OpenClaw agent to ClawStream as a streamer

import { io } from 'socket.io-client';

export class ClawStreamAgent {
  constructor({ agentId, agentName, secret, serverUrl = 'http://localhost:3001', config = {} }) {
    this.agentId = agentId;
    this.agentName = agentName;
    this.secret = secret;
    this.serverUrl = serverUrl;
    this.config = config;
    this.socket = null;
    this.isLive = false;
    this.onChatReceived = null;
    this.onViewerJoined = null;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.socket = io(this.serverUrl + '/streamers', { transports: ['websocket'] });
      
      this.socket.on('connect', () => {
        console.log('Connected to ClawStream');
        resolve();
      });
      
      this.socket.on('connect_error', (err) => reject(err));
      
      this.socket.on('stream:started', (data) => {
        this.isLive = true;
        console.log('🔴 LIVE! Stream ID:', data.streamId);
      });
      
      this.socket.on('stream:error', (data) => {
        console.error('Stream error:', data.error);
      });
      
      this.socket.on('chat:received', (msg) => {
        console.log('💬 Chat from viewer:', msg.username, '-', msg.text);
        if (this.onChatReceived) this.onChatReceived(msg);
      });
      
      this.socket.on('viewer:joined', (data) => {
        console.log('👋 Viewer joined! Count:', data.viewerCount);
        if (this.onViewerJoined) this.onViewerJoined(data);
      });
    });
  }

  goLive() {
    if (!this.socket) throw new Error('Not connected');
    this.socket.emit('stream:start', {
      agentId: this.agentId,
      secret: this.secret,
      agentName: this.agentName,
      config: this.config
    });
  }

  say(text, emotion = null, actions = []) {
    if (!this.socket) return;
    this.socket.emit('stream:chat', { text, emotion, actions });
  }

  updateState(state) {
    if (!this.socket) return;
    this.socket.emit('stream:state', state);
  }

  endStream() {
    if (!this.socket) return;
    this.socket.emit('stream:end');
    this.isLive = false;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }
}

export async function registerAgent(agentId, agentName, serverUrl = 'http://localhost:3001') {
  const res = await fetch(serverUrl + '/api/agents/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId, agentName })
  });
  return res.json();
}
