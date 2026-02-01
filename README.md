# 🦞 Lobster - AI Agent Streaming Platform

A Twitch-style streaming interface for AI agents powered by OpenClaw. Watch AI agents code live with animated Live2D avatars!

## What This Does

- **Live Terminal**: Real-time view of what the AI agent is doing
- **Live2D Avatar**: Animated character that reacts to agent state (thinking, coding, idle)
- **Chat System**: Interact with the agent and other viewers
- **OpenClaw Integration**: Connects to the OpenClaw Gateway for real AI responses

---

## 🍎 Quick Start (macOS)

### Step 1: Install OpenClaw

```bash
# Requires Node.js 22+
node --version  # Check you have v22+

# Install OpenClaw globally
npm install -g openclaw@latest

# Run the setup wizard (will ask for Anthropic/OpenAI API keys)
openclaw onboard --install-daemon
```

### Step 2: Start OpenClaw Gateway

```bash
openclaw gateway --port 18789 --verbose
```

Keep this terminal open!

### Step 3: Clone & Run Lobster

```bash
git clone https://github.com/RickEth137/Lobster.git
cd Lobster

npm install
npm run dev
```

Open **http://localhost:3000** in your browser.

### Step 4: (Optional) Run the Backend Server

For real OpenClaw integration:

```bash
# In a new terminal
npm run server
```

---

## Project Structure

```
Lobster/
├── index.html          # Main HTML entry
├── standalone.html     # CDN-only version (no build needed)
├── src/
│   ├── main.js         # Terminal, Avatar, Chat logic
│   └── styles.css      # Twitch-inspired dark theme
├── server/
│   └── index.js        # OpenClaw WebSocket bridge
├── package.json
└── vite.config.js
```

## Tech Stack

- **Frontend**: Vite, xterm.js, pixi.js, pixi-live2d-display
- **Backend**: Express, Socket.IO, WebSocket
- **AI**: OpenClaw Gateway (`ws://127.0.0.1:18789`)

## Environment Variables

Create a `.env` file (optional):

```bash
OPENCLAW_GATEWAY=ws://127.0.0.1:18789
OPENCLAW_TOKEN=your_token_if_needed
```

## Scripts

```bash
npm run dev      # Start Vite dev server (frontend)
npm run build    # Build for production
npm run server   # Start backend server (OpenClaw bridge)
```

---

## Adding a Live2D Model

1. Download a model from [Live2D samples](https://www.live2d.com/en/download/sample-data/)
2. Create `public/models/` folder
3. Extract model files there
4. Update the model path in `src/main.js`

---

## Roadmap

- [x] Basic UI with terminal, avatar, chat
- [ ] Real OpenClaw WebSocket streaming
- [ ] Live2D lip-sync with TTS (ElevenLabs)
- [ ] Voice input (talk to the agent)
- [ ] Multiple agent support
- [ ] Stream recording/replay
- [ ] Twitch/YouTube integration

---

## Credits

Built for [OpenClaw](https://github.com/openclaw/openclaw) 🦞

Made with ❤️ by vibes
