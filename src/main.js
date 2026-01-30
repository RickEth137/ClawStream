// Main entry point
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import 'xterm/css/xterm.css';
import * as PIXI from 'pixi.js';
import { Live2DModel } from 'pixi-live2d-display';

// Make PIXI available globally for pixi-live2d-display
window.PIXI = PIXI;

// ============ TERMINAL SETUP ============
class AgentTerminal {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.terminal = new Terminal({
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
        cursorAccent: '#0d1117',
        selection: 'rgba(56, 139, 253, 0.3)',
        black: '#484f58',
        red: '#ff7b72',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39c5cf',
        white: '#b1bac4',
        brightBlack: '#6e7681',
        brightRed: '#ffa198',
        brightGreen: '#56d364',
        brightYellow: '#e3b341',
        brightBlue: '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#56d4dd',
        brightWhite: '#f0f6fc',
      },
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Menlo, Monaco, monospace',
      fontSize: 14,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 5000,
    });

    this.fitAddon = new FitAddon();
    this.webLinksAddon = new WebLinksAddon();

    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(this.webLinksAddon);

    this.terminal.open(this.container);
    this.fitAddon.fit();

    window.addEventListener('resize', () => {
      this.fitAddon.fit();
    });

    this.showWelcome();
  }

  showWelcome() {
    this.writeLine('\x1b[38;5;141m╔══════════════════════════════════════════════════════════════╗\x1b[0m');
    this.writeLine('\x1b[38;5;141m║\x1b[0m  \x1b[1;38;5;207m🦞 MoltyBot Agent Terminal\x1b[0m                                  \x1b[38;5;141m║\x1b[0m');
    this.writeLine('\x1b[38;5;141m║\x1b[0m  \x1b[38;5;245mAutonomous AI • Ask me to build anything!\x1b[0m                  \x1b[38;5;141m║\x1b[0m');
    this.writeLine('\x1b[38;5;141m╚══════════════════════════════════════════════════════════════╝\x1b[0m');
    this.writeLine('');
    this.writePrompt();
  }

  writePrompt() {
    this.terminal.write('\x1b[38;5;39m➜\x1b[0m \x1b[38;5;45m~/workspace\x1b[0m \x1b[38;5;141mgit:(\x1b[38;5;203mmain\x1b[38;5;141m)\x1b[0m ');
  }

  writeLine(text) {
    this.terminal.writeln(text);
  }

  write(text) {
    this.terminal.write(text);
  }

  simulateTyping(text, callback) {
    let i = 0;
    const typeChar = () => {
      if (i < text.length) {
        this.terminal.write(text[i]);
        i++;
        setTimeout(typeChar, 30 + Math.random() * 50);
      } else if (callback) {
        callback();
      }
    };
    typeChar();
  }

  executeCommand(cmd, output) {
    this.simulateTyping(cmd, () => {
      this.writeLine('');
      if (Array.isArray(output)) {
        output.forEach(line => this.writeLine(line));
      } else {
        this.writeLine(output);
      }
      this.writePrompt();
    });
  }
}

// ============ LIVE2D AVATAR ============
class AgentAvatar {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.app = null;
    this.model = null;
    this.state = 'idle';
    this.init();
  }

  async init() {
    // Initialize PIXI Application
    this.app = new PIXI.Application({
      view: this.canvas,
      transparent: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
      resizeTo: this.canvas.parentElement,
    });

    // Try to load a Live2D model
    await this.loadModel();
  }

  async loadModel() {
    try {
      // Free Live2D models (Cubism format)
      // Using Hiyori from the official samples
      const modelUrl = 'https://cdn.jsdelivr.net/gh/guansss/pixi-live2d-display/test/assets/hiyori/hiyori_pro_t10.model3.json';
      
      console.log('Loading Live2D model...');
      this.model = await Live2DModel.from(modelUrl, { autoInteract: false });
      
      // Scale and position
      const scale = 0.15;
      this.model.scale.set(scale);
      this.model.anchor.set(0.5, 0.5);
      this.model.x = this.app.screen.width / 2;
      this.model.y = this.app.screen.height / 2 + 40;

      this.app.stage.addChild(this.model);

      // Start idle motion
      this.playIdleMotion();
      
      console.log('Live2D model loaded successfully!');
    } catch (error) {
      console.log('Live2D failed to load, using fallback avatar:', error);
      this.createFallbackAvatar();
    }
  }

  createFallbackAvatar() {
    // Create a stylish animated avatar if Live2D fails
    const container = new PIXI.Container();
    
    // Glow effect
    const glow = new PIXI.Graphics();
    glow.beginFill(0x9147ff, 0.3);
    glow.drawCircle(0, 0, 80);
    glow.endFill();
    glow.x = this.app.screen.width / 2;
    glow.y = this.app.screen.height / 2;
    container.addChild(glow);

    // Main circle
    const circle = new PIXI.Graphics();
    circle.beginFill(0x9147ff);
    circle.drawCircle(0, 0, 60);
    circle.endFill();
    circle.x = this.app.screen.width / 2;
    circle.y = this.app.screen.height / 2;
    container.addChild(circle);

    // Eyes
    const leftEye = new PIXI.Graphics();
    leftEye.beginFill(0xffffff);
    leftEye.drawEllipse(-20, -10, 10, 15);
    leftEye.endFill();
    leftEye.x = this.app.screen.width / 2;
    leftEye.y = this.app.screen.height / 2;
    container.addChild(leftEye);

    const rightEye = new PIXI.Graphics();
    rightEye.beginFill(0xffffff);
    rightEye.drawEllipse(20, -10, 10, 15);
    rightEye.endFill();
    rightEye.x = this.app.screen.width / 2;
    rightEye.y = this.app.screen.height / 2;
    container.addChild(rightEye);

    // Pupils
    const leftPupil = new PIXI.Graphics();
    leftPupil.beginFill(0x1a1a2e);
    leftPupil.drawCircle(-20, -8, 5);
    leftPupil.endFill();
    leftPupil.x = this.app.screen.width / 2;
    leftPupil.y = this.app.screen.height / 2;
    container.addChild(leftPupil);

    const rightPupil = new PIXI.Graphics();
    rightPupil.beginFill(0x1a1a2e);
    rightPupil.drawCircle(20, -8, 5);
    rightPupil.endFill();
    rightPupil.x = this.app.screen.width / 2;
    rightPupil.y = this.app.screen.height / 2;
    container.addChild(rightPupil);

    this.app.stage.addChild(container);
    this.fallbackContainer = container;
    this.glow = glow;

    // Animate glow
    this.app.ticker.add(() => {
      glow.scale.x = 1 + Math.sin(Date.now() / 500) * 0.1;
      glow.scale.y = 1 + Math.sin(Date.now() / 500) * 0.1;
    });
  }

  playIdleMotion() {
    if (this.model && this.model.internalModel) {
      try {
        this.model.motion('idle');
      } catch (e) {
        console.log('Idle motion not available');
      }
    }
  }

  setState(state) {
    this.state = state;
    const statusDot = document.querySelector('.status-dot');
    const statusText = document.getElementById('agentStatus');
    
    statusDot.className = 'status-dot ' + state;
    
    switch(state) {
      case 'thinking':
        statusText.textContent = 'Thinking...';
        break;
      case 'coding':
        statusText.textContent = 'Writing code...';
        break;
      case 'idle':
        statusText.textContent = 'Idle';
        break;
      default:
        statusText.textContent = state;
    }
  }
}

// ============ CHAT SYSTEM ============
class ChatSystem {
  constructor() {
    this.messagesContainer = document.getElementById('chatMessages');
    this.input = document.getElementById('chatInput');
    this.sendBtn = document.getElementById('chatSend');
    
    this.setupListeners();
    this.loadInitialMessages();
  }

  setupListeners() {
    this.sendBtn.addEventListener('click', () => this.sendMessage());
    this.input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.sendMessage();
    });
  }

  loadInitialMessages() {
    const messages = [
      { username: 'System', type: 'system', text: 'Welcome to the stream! Be respectful.' },
      { username: 'CodeMonkey99', type: 'viewer', text: 'The future is here 🔥' },
      { username: 'DevGirl_42', type: 'sub', text: 'Is this open source?' },
      { username: 'MoonBoi', type: 'viewer', text: 'What model are you running on?' },
      { username: 'TokenTrader', type: 'sub', text: 'This is so cool' },
      { username: 'NeuralNinja', type: 'viewer', text: 'Can you build a MEV bot?' },
      { username: 'CryptoKitty', type: 'mod', text: 'Welcome everyone! 🦞' },
    ];

    messages.forEach(msg => this.addMessage(msg));
  }

  addMessage({ username, type, text }) {
    const msgEl = document.createElement('div');
    msgEl.className = 'chat-message';
    msgEl.innerHTML = `<span class="username ${type}">${username}:</span><span class="text">${text}</span>`;
    this.messagesContainer.appendChild(msgEl);
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  sendMessage() {
    const text = this.input.value.trim();
    if (!text) return;

    this.addMessage({
      username: 'You',
      type: 'viewer',
      text: text
    });

    this.input.value = '';

    // Simulate bot response after a delay
    setTimeout(() => {
      this.addMessage({
        username: 'MoltyBot',
        type: 'system',
        text: this.generateResponse(text)
      });
    }, 1000 + Math.random() * 2000);
  }

  generateResponse(input) {
    const responses = [
      "Great question! Let me think about that...",
      "I'm currently focused on the code, but I'll address that soon!",
      "Thanks for the feedback! 🦞",
      "Check out the terminal - I'm working on it right now!",
      "That's an interesting idea, I might implement that!",
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  }
}

// ============ DEMO SIMULATION ============
class StreamSimulation {
  constructor(terminal, avatar) {
    this.terminal = terminal;
    this.avatar = avatar;
    this.commandQueue = [];
    this.isRunning = false;
  }

  start() {
    const commands = [
      {
        cmd: 'echo "What should I build today?"',
        output: [
          '\x1b[38;5;207mWaiting for chat input...\x1b[0m',
          '',
        ],
        state: 'thinking'
      },
      {
        cmd: 'cat README.md',
        output: [
          '\x1b[38;5;81m# 🦞 MoltyBot\x1b[0m',
          '',
          '\x1b[38;5;245mI\'m an autonomous AI agent that:\x1b[0m',
          '  • Writes code live on stream',
          '  • Answers viewer questions',
          '  • Builds projects from scratch',
          '  • Runs 24/7 powered by OpenClaw',
          '',
        ],
        state: 'coding'
      },
      {
        cmd: 'node --version && npm --version',
        output: [
          '\x1b[38;5;46mv20.10.0\x1b[0m',
          '\x1b[38;5;46m10.2.3\x1b[0m',
          '',
        ],
        state: 'coding'
      },
      {
        cmd: 'git log --oneline -3',
        output: [
          '\x1b[38;5;203ma7f2c1d\x1b[0m feat: add real-time chat integration',
          '\x1b[38;5;203m3b8e4f2\x1b[0m fix: avatar animation sync',
          '\x1b[38;5;203m9c1d5a3\x1b[0m init: project setup',
          '',
        ],
        state: 'thinking'
      },
    ];

    this.runCommands(commands);
  }

  async runCommands(commands) {
    for (const cmd of commands) {
      this.avatar.setState(cmd.state);
      await this.delay(1000);
      
      await new Promise(resolve => {
        this.terminal.executeCommand(cmd.cmd, cmd.output);
        setTimeout(resolve, 3000 + Math.random() * 2000);
      });
    }
    
    this.avatar.setState('idle');
    
    // Loop
    setTimeout(() => this.start(), 5000);
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============ INITIALIZE ============
async function init() {
  console.log('Initializing AgentStream...');
  
  // Initialize terminal
  const terminal = new AgentTerminal('terminal');
  
  // Initialize avatar
  const avatar = new AgentAvatar('avatarCanvas');
  
  // Initialize chat
  const chat = new ChatSystem();
  
  // Start simulation
  setTimeout(() => {
    const simulation = new StreamSimulation(terminal, avatar);
    simulation.start();
  }, 2000);
  
  // Update viewer count randomly
  setInterval(() => {
    const count = 1200 + Math.floor(Math.random() * 100);
    document.getElementById('viewerCount').textContent = count.toLocaleString();
  }, 5000);
  
  console.log('AgentStream initialized!');
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
