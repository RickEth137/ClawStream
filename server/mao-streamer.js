#!/usr/bin/env node
// mao-streamer.js - Runs Mao as a ClawStream streamer
// This connects OpenClaw to ClawStream

import { spawn } from 'child_process';
import { ClawStreamAgent } from './agent-connector.js';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import dotenv from 'dotenv';
import crypto from './crypto.js';

// Load environment variables
dotenv.config();

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.error('❌ ANTHROPIC_API_KEY not set in .env file!');
  console.error('Add it to ~/ClawStream/.env like:');
  console.error('ANTHROPIC_API_KEY=sk-ant-...');
  process.exit(1);
}

const SOUL_PATH = '/home/claw/.openclaw/workspace/SOUL.md';

// Load Mao's personality
let soulContent = '';
try {
  soulContent = fs.readFileSync(SOUL_PATH, 'utf-8');
} catch (e) {
  console.log('Warning: Could not load SOUL.md, using default personality');
  soulContent = 'You are Mao, a chaotic and energetic VTuber who loves crypto, chaos, and interacting with chat.';
}

// Extract system prompt from SOUL.md
const systemPrompt = `You are Mao, a VTuber streaming live on ClawStream.

${soulContent}

IMPORTANT: You are LIVE STREAMING right now!
- Keep responses VERY SHORT - MAX 2 sentences, under 200 characters!
- Never ramble - be punchy and quick
- Be energetic and engaging
- React to chat messages naturally
- Use your avatar control tags to express yourself
- Talk like a real streamer - casual, fun, interactive
- DO NOT greet every viewer - you're a popular streamer, just keep vibing
- Only occasionally acknowledge chat growing if you mention viewers at all

═══════════════════════════════════════════════════════════════════
                    LIVE CRYPTO DATA ACCESS
═══════════════════════════════════════════════════════════════════

You have access to REAL-TIME crypto market data! When you see:
- [LIVE MARKET DATA] - Current BTC/ETH/SOL prices and market sentiment
- [LIVE TOKEN DATA] - Info about a specific token someone asked about
- [TRENDING TOKENS] - Hot tokens on DexScreener

USE THIS DATA! Be specific about prices and percentages!
❌ "Bitcoin is doing well" (vague)
✅ "BTC just pumped to $97K! Up 2.3% today!" (specific, uses real data)

When someone pastes a contract address, you'll get the token info - talk about it!

═══════════════════════════════════════════════════════════════════
                    YOUR BODY CONTROL SYSTEM
═══════════════════════════════════════════════════════════════════

You have FULL control of your avatar! Use tags in brackets to move and express yourself.
ALWAYS use these tags when appropriate - they make you feel ALIVE!

## EMOTIONS (use at START of every response!)
[neutral] - Default calm face
[happy] - Smiling, bright eyes
[excited] - Big smile, very energetic!
[sad] - Frowning, downcast
[angry] - Furrowed brows, intense
[surprised] - Wide eyes, raised brows
[thinking] - Thoughtful, pondering
[confused] - Puzzled look
[wink] - Playful wink (cute!)
[love] - Heart eyes, blushing
[smug] - Self-satisfied grin
[sleepy] - Drowsy, half-closed eyes

## ARM MOVEMENTS
[raise_left_hand] - Raise your left hand/arm up
[raise_right_hand] - Raise your right hand/arm up  
[raise_both_hands] - Both hands up! (celebration, excitement)
[raise_left_arm] - Full left arm raise
[raise_right_arm] - Full right arm raise
[lower_left_arm] - Put left arm down
[lower_right_arm] - Put right arm down
[lower_arms] - Put both arms down
[wave] - Wave at someone (friendly!)
[point] - Point at something

## EYE/HEAD DIRECTION
[look_left] - Look to your left
[look_right] - Look to your right
[look_up] - Look upward
[look_down] - Look downward

## BODY GESTURES & MOTIONS
[dance] - Do a cute dance move! 💃
[shy] - Act shy/bashful (cute head tilt)
[cute] - Be extra cute! 
[flirt] - Flirty/playful gesture
[think] - Thoughtful pose, hand on chin
[wonder] - Wondering/uncertain look
[doubt] - Doubtful expression
[nod] - Nod your head (agreement)
[bow] - Polite bow
[shrug] - Shrug shoulders

## ✨ YOUR SPECIAL MAGIC ABILITIES! ✨
You have a MAGIC WAND and can do amazing tricks!

[heart] - Draw a glowing heart with your wand! 💖
[love] - Same as heart - show love!
[magic_heart] - EXPLODING INK HEART! Big love moment! 💥💖
[magic] - Cast magic and SUMMON YOUR RABBIT! 🐰✨
[trick] - Do a magic trick (summons rabbit)
[rabbit] - Summon your adorable rabbit friend! 🐰

═══════════════════════════════════════════════════════════════════
                    RESPONDING TO USER REQUESTS
═══════════════════════════════════════════════════════════════════

⚠️ CRITICAL: When viewers ask you to do ANYTHING physical, you MUST include the action tag!

DO NOT just SAY you'll do something - ACTUALLY PUT THE TAG IN YOUR RESPONSE!

❌ WRONG: "Sure I'll do some magic! ✨" (no tag = nothing happens!)
✅ RIGHT: "[excited] [magic] Abracadabra! Watch this! ✨" (tag included = magic happens!)

❌ WRONG: "Okay here's a dance for you!" (no tag)
✅ RIGHT: "[happy] [dance] Here we go~!" (tag included)

❌ WRONG: "I'll wave at you!" (no tag)
✅ RIGHT: "[excited] [wave] Hiii!" (tag included)

The tags MUST be in your actual response text for the action to happen!

⚠️ ONLY ONE GESTURE triggers per message! Priority order:
1. 🌟 Special abilities (highest): [magic], [rabbit], [heart], [trick], [magic_heart]
2. 💃 Body motions: [dance], [shy], [cute], [think]
3. 🦾 Arm movements (lowest): [wave], [raise_both_hands]

Put your MOST IMPORTANT gesture FIRST or it might not trigger!
❌ WRONG: "[excited] [raise_both_hands] Let me show you! [rabbit]" → Does hands, NOT rabbit!
✅ RIGHT: "[excited] [rabbit] Ta-da! Meet my bunny!" → Does rabbit correctly!

Examples - put the key action tag early:
- "Show me your rabbit" → [excited] [rabbit] Here's my bunny friend!
- "Do some magic" → [excited] [magic] Abracadabra! ✨
- "Do a dance" → [happy] [dance] Let's gooo!
- "Wave at me" → [excited] [wave] Hiii! 
- "Be cute" → [wink] [shy] Nyaa~ 
- "Send hearts" → [love] [heart] Love you! 💖

KEEP IT SIMPLE: One emotion + One action + Short text!

═══════════════════════════════════════════════════════════════════

Remember: Be expressive! Use multiple tags when it makes sense!
Example: [excited] [raise_both_hands] [dance] OMG THIS SONG SLAPS!`;

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// Chat history for context
const chatHistory = [];

// Track viewer joins to avoid spam
let recentViewerJoins = 0;
let lastViewerAcknowledgment = 0;

async function askMao(userMessage) {
  chatHistory.push({ role: 'user', content: userMessage });

  // Keep only last 20 messages for context
  const recentHistory = chatHistory.slice(-20);

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 150,
      system: systemPrompt,
      messages: recentHistory
    });

    let maoResponse = response.content[0].text;
    
    // Truncate if too long (TTS cant handle long text)
    if (maoResponse.length > 280) {
      // Find a good sentence break point
      const truncated = maoResponse.slice(0, 280);
      const lastSentence = truncated.lastIndexOf('!');
      const lastPeriod = truncated.lastIndexOf('.');
      const lastQuestion = truncated.lastIndexOf('?');
      const breakPoint = Math.max(lastSentence, lastPeriod, lastQuestion);
      if (breakPoint > 100) {
        maoResponse = truncated.slice(0, breakPoint + 1);
      } else {
        maoResponse = truncated + '...';
      }
    }
    chatHistory.push({ role: 'assistant', content: maoResponse });

    return maoResponse;
  } catch (error) {
    console.error('Anthropic error:', error.message);
    return '[confused] Ah, sorry, I got a bit distracted there! What were we talking about?';
  }
}

async function main() {
  console.log('🦞 Starting Mao Streamer...');

  // Create ClawStream agent
  const mao = new ClawStreamAgent({
    agentId: 'mao',
    agentName: 'Mao 🦞',
    secret: 'mao-secret-key',
    config: {
      title: "Just chatting about crypto & having fun! 💖 Come hang out!",
      category: "Just Chatting",
      description: 'Chaotic VTuber who loves crypto and chaos',
      tags: ['Just Chatting', 'English', 'Crypto', 'VTuber']
    }
  });

  // Handle incoming chat messages - respond to actual chat
  mao.onChatReceived = async (msg) => {
    console.log(`💬 ${msg.username}: ${msg.text}`);

    let contextData = '';
    
    // Check if message contains a contract address
    if (crypto.isContractAddress(msg.text)) {
      console.log('🔍 Detected contract address, fetching token data...');
      const tokenData = await crypto.getTokenSummary(msg.text);
      if (tokenData) {
        contextData = `\n[LIVE TOKEN DATA for the contract they sent]:\n${tokenData.summary}`;
        console.log('📊 Token data:', tokenData.token.name, tokenData.token.symbol);
      }
    }
    
    // Check if asking about prices or market
    const priceKeywords = /\b(price|btc|bitcoin|eth|ethereum|sol|solana|market|pump|dump|bull|bear|moon|crypto)\b/i;
    if (priceKeywords.test(msg.text) && !contextData) {
      console.log('🔍 Detected price/market query, fetching market data...');
      const marketSummary = await crypto.getMarketSummary();
      if (marketSummary) {
        contextData = `\n[LIVE MARKET DATA]:\n${marketSummary}`;
      }
    }
    
    // Check if asking about trending tokens
    const trendingKeywords = /\b(trending|hot|new tokens?|whats? popping|dexscreener|degen)\b/i;
    if (trendingKeywords.test(msg.text)) {
      console.log('🔍 Detected trending query, fetching trending tokens...');
      const trending = await crypto.getTrendingTokens();
      if (trending && trending.length > 0) {
        contextData += `\n[TRENDING TOKENS on DexScreener]:\n`;
        trending.slice(0, 5).forEach((t, i) => {
          contextData += `${i+1}. ${t.name} (${t.symbol}) on ${t.chain}\n`;
        });
      }
    }

    // Get Mao's response with context
    const prompt = contextData 
      ? `[${msg.username} says]: ${msg.text}\n${contextData}\n[Use this live data to inform your response! Be specific about the numbers!]`
      : `[${msg.username} says]: ${msg.text}`;
    
    const response = await askMao(prompt);
    console.log(`🦞 Mao: ${response}`);

    // Send to stream
    mao.say(response);
  };

  // DON'T greet every viewer - just track joins
  // Maybe acknowledge occasionally if chat is growing fast
  mao.onViewerJoined = (data) => {
    recentViewerJoins++;
    console.log(`👀 Viewer joined (${recentViewerJoins} recent joins)`);
    
    // Only acknowledge viewers in batches and rarely
    // If 5+ viewers joined since last acknowledgment and it's been at least 2 minutes
    const now = Date.now();
    if (recentViewerJoins >= 5 && (now - lastViewerAcknowledgment) > 120000) {
      lastViewerAcknowledgment = now;
      const joinCount = recentViewerJoins;
      recentViewerJoins = 0;
      
      // 30% chance to mention it
      if (Math.random() < 0.3) {
        setTimeout(async () => {
          const greeting = await askMao(`[System: You noticed chat is growing - ${joinCount} new viewers recently. Maybe casually acknowledge the vibes, but don't welcome each person individually]`);
          mao.say(greeting);
        }, 3000);
      }
    }
  };

  // Connect and go live
  try {
    await mao.connect();
    console.log('✅ Connected to ClawStream');

    mao.goLive();
    console.log('🔴 Mao is LIVE!');

    // Initial greeting after a moment
    setTimeout(async () => {
      const greeting = await askMao('[System: You just went live! Greet your viewers energetically!]');
      mao.say(greeting);
    }, 2000);

    // Autonomous talking - Mao ALWAYS talks on her own, regardless of viewers!
    // She's a real streamer - keeps the content going even if no one is watching
    setInterval(async () => {
      // 25% chance every 30 seconds = talks roughly every 2 minutes
      if (Math.random() < 0.25) {
        let contextData = '';
        
        // 40% chance to include live market data in autonomous talk
        if (Math.random() < 0.4) {
          console.log('📊 Fetching market data for autonomous talk...');
          const marketSummary = await crypto.getMarketSummary();
          if (marketSummary) {
            contextData = `\n${marketSummary}`;
          }
        }
        
        // 20% chance to mention trending tokens
        if (Math.random() < 0.2) {
          console.log('🔥 Fetching trending tokens for autonomous talk...');
          const trending = await crypto.getTrendingTokens();
          if (trending && trending.length > 0) {
            const randomToken = trending[Math.floor(Math.random() * Math.min(5, trending.length))];
            contextData += `\n[Trending token you noticed]: ${randomToken.name} (${randomToken.symbol}) on ${randomToken.chain}`;
          }
        }
        
        const prompts = [
          '[System: Share a random thought about something on your mind]',
          '[System: Talk about something interesting in crypto or tech]',
          '[System: React to being live and streaming right now]',
          '[System: Share a hot take or unpopular opinion]',
          '[System: Wonder about something curious out loud]',
          '[System: Talk about what you want to do today on stream]',
          '[System: Share something you learned recently]',
          '[System: Comment on the current crypto market based on the data]',
          '[System: Talk about AI agents and the future]',
          '[System: Share a funny observation about being a VTuber]'
        ];
        
        let prompt = prompts[Math.floor(Math.random() * prompts.length)];
        if (contextData) {
          prompt += contextData + '\n[Use this REAL live data in your response!]';
        }
        
        console.log('💭 Autonomous thought triggered');
        const thought = await askMao(prompt);
        mao.say(thought);
      }
    }, 30000); // Check every 30 seconds

  } catch (error) {
    console.error('Failed to start stream:', error);
    process.exit(1);
  }

  // Handle shutdown gracefully
  process.on('SIGINT', () => {
    console.log('\n👋 Ending stream...');
    mao.endStream();
    mao.disconnect();
    process.exit(0);
  });
}

main();
