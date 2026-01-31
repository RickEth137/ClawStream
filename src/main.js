// ClawStream - Real AI Agent Streaming Frontend
// Connects to OpenClaw Gateway via backend server

import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import 'xterm/css/xterm.css';
import * as PIXI from 'pixi.js';
import { io } from 'socket.io-client';

// Make PIXI available globally BEFORE importing pixi-live2d-display
window.PIXI = PIXI;

// Import only Cubism4 model support
import { Live2DModel } from 'pixi-live2d-display/cubism4';

// ============ AUDIO AUTOPLAY UNLOCK ============
// Browser requires user interaction before playing audio
// This creates a silent audio context on first click to unlock audio playback
let audioUnlocked = false;
const audioUnlockCallbacks = []; // Callbacks to run after audio is unlocked

const unlockAudio = () => {
  if (audioUnlocked) return;
  
  // Create and play a silent audio to unlock
  const silentAudio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
  silentAudio.play().then(() => {
    audioUnlocked = true;
    console.log('🔊 Audio playback unlocked!');
    
    // Hide the click prompt if it exists
    const prompt = document.getElementById('audioUnlockPrompt');
    if (prompt) prompt.style.display = 'none';
    
    // Run any pending callbacks
    audioUnlockCallbacks.forEach(cb => cb());
    audioUnlockCallbacks.length = 0;
  }).catch(() => {
    // Still locked, will try again on next interaction
  });
  
  // Also resume AudioContext if it exists
  if (window.AudioContext || window.webkitAudioContext) {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    ctx.resume().then(() => {
      console.log('🔊 AudioContext resumed');
    });
  }
};

// Helper to run code after audio is unlocked
const afterAudioUnlocked = (callback) => {
  if (audioUnlocked) {
    callback();
  } else {
    audioUnlockCallbacks.push(callback);
  }
};

// Unlock audio on any user interaction
['click', 'touchstart', 'keydown'].forEach(event => {
  document.addEventListener(event, unlockAudio, { once: false, passive: true });
});

// ============ SOCKET.IO CONNECTION ============
const socket = io('http://localhost:3001', {
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionAttempts: 10
});

// ============ TERMINAL CLASS ============
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

    window.addEventListener('resize', () => this.fitAddon.fit());

    this.showWelcome();
  }

  showWelcome() {
    this.writeLine('\x1b[38;5;141m╔══════════════════════════════════════════════════════════════╗\x1b[0m');
    this.writeLine('\x1b[38;5;141m║\x1b[0m  \x1b[1;38;5;207m🦞 ClawStream Agent Terminal\x1b[0m                                \x1b[38;5;141m║\x1b[0m');
    this.writeLine('\x1b[38;5;141m║\x1b[0m  \x1b[38;5;245mPowered by Claude • OpenClaw Gateway\x1b[0m                       \x1b[38;5;141m║\x1b[0m');
    this.writeLine('\x1b[38;5;141m╚══════════════════════════════════════════════════════════════╝\x1b[0m');
    this.writeLine('');
    this.writeLine('\x1b[38;5;245mConnecting to OpenClaw...\x1b[0m');
  }

  writeLine(text) {
    this.terminal.writeln(text);
  }

  write(text) {
    this.terminal.write(text);
  }

  clear() {
    this.terminal.clear();
  }

  writeOutput(text, type = 'stdout') {
    // Handle different output types with colors
    if (type === 'error') {
      this.terminal.write('\x1b[31m' + text + '\x1b[0m');
    } else if (type === 'tool') {
      this.terminal.write('\x1b[38;5;45m' + text + '\x1b[0m');
    } else {
      this.terminal.write(text);
    }
  }
}

// ============ TEXT-TO-SPEECH ENGINE ============
class TTSEngine {
  constructor() {
    this.audio = null;
    this.speaking = false;
    this.currentSubtitleText = null;
    this.audioDuration = 0;
    this.audioCurrentTime = 0;
    this.onSpeakingChange = null; // Callback when speaking state changes
    this.progressCheckInterval = null; // Interval to check audio progress
  }

  async speak(audioPath, callbacks = {}) {
    if (!audioPath) {
      console.log('❌ TTS: No audio path provided');
      callbacks.onEnd?.();
      return;
    }
    
    console.log('🎤 TTS speak() called with path:', audioPath);
    
    // Stop any ongoing speech
    this.stop();
    
    // Store subtitle text to show when audio plays
    this.currentSubtitleText = callbacks.subtitleText || null;
    
    try {
      // Build full URL - audioPath is like "/tts/voice-123.mp3"
      const audioUrl = `http://localhost:3001${audioPath}`;
      console.log('🎤 TTS loading audio from:', audioUrl);
      
      // Create audio element
      this.audio = new Audio(audioUrl);
      this.audio.volume = 1.0;
      this.audio.crossOrigin = 'anonymous';
      
      // Set up event handlers BEFORE loading
      this.audio.oncanplaythrough = () => {
        console.log('✅ TTS: Audio can play through, duration:', this.audio?.duration);
      };
      
      this.audio.onloadedmetadata = () => {
        console.log('✅ TTS: Metadata loaded, duration:', this.audio?.duration);
        if (this.audio?.duration) {
          this.audioDuration = this.audio.duration;
        }
      };
      
      this.audio.onloadeddata = () => {
        console.log('✅ TTS: Audio loaded successfully');
      };

      this.audio.onplay = () => {
        console.log('✅ TTS: Started playing, duration:', this.audio?.duration);
        this.speaking = true;
        this.audioDuration = this.audio?.duration || 30;
        this.onSpeakingChange?.(true);
        callbacks.onStart?.();
        
        // Start a backup interval to track progress (in case ontimeupdate doesn't fire)
        this.startProgressCheck();
      };
      
      // Track audio progress for lip sync timing
      this.audio.ontimeupdate = () => {
        if (this.audio) {
          this.audioCurrentTime = this.audio.currentTime;
        }
      };

      this.audio.onended = () => {
        console.log('✅ TTS: Finished playing');
        this.cleanupAndEnd(callbacks.onEnd);
      };

      this.audio.onerror = (error) => {
        console.error('❌ TTS Audio Error:', error);
        console.error('  Audio error code:', this.audio?.error?.code);
        console.error('  Audio error message:', this.audio?.error?.message);
        this.cleanupAndEnd(callbacks.onEnd);
      };
      
      // Also handle audio stalling (network issues)
      this.audio.onstalled = () => {
        console.warn('⚠️ TTS: Audio stalled (network issue?)');
      };
      
      this.audio.onwaiting = () => {
        console.warn('⚠️ TTS: Audio waiting for data...');
      };

      // Load the audio first
      this.audio.load();
      
      // Play the audio - handle autoplay restrictions
      try {
        await this.audio.play();
        console.log('✅ TTS: Play started successfully');
      } catch (playError) {
        console.error('❌ TTS Autoplay blocked:', playError.name, playError.message);
        
        // If autoplay is blocked, we need user interaction
        // For now, still animate lip sync even without audio
        if (playError.name === 'NotAllowedError') {
          console.log('⚠️ TTS: Autoplay blocked by browser. Starting lip sync anyway...');
          this.speaking = true;
          this.onSpeakingChange?.(true);
          callbacks.onStart?.();
          
          // Estimate duration based on text length (roughly 150 words per minute)
          const words = (this.currentSubtitleText || '').split(' ').length;
          const estimatedDuration = Math.max(3000, words * 400); // ~150 wpm
          this.audioDuration = estimatedDuration / 1000;
          
          // Simulate time progress
          this.startProgressCheck(estimatedDuration);
          
          setTimeout(() => {
            console.log('⚠️ TTS: Simulated speech ended');
            this.cleanupAndEnd(callbacks.onEnd);
          }, estimatedDuration);
        } else {
          this.cleanupAndEnd(callbacks.onEnd);
        }
      }
      
    } catch (error) {
      console.error('❌ TTS Play Error:', error);
      this.cleanupAndEnd(callbacks.onEnd);
    }
  }
  
  // Start interval to check progress (backup for ontimeupdate)
  startProgressCheck(simulatedDuration = null) {
    if (this.progressCheckInterval) {
      clearInterval(this.progressCheckInterval);
    }
    
    const startTime = Date.now();
    let lastTimeUpdate = Date.now();
    let lastKnownTime = 0;
    
    this.progressCheckInterval = setInterval(() => {
      if (!this.speaking) {
        clearInterval(this.progressCheckInterval);
        this.progressCheckInterval = null;
        return;
      }
      
      if (simulatedDuration) {
        // Simulated progress (no audio)
        this.audioCurrentTime = (Date.now() - startTime) / 1000;
      } else if (this.audio) {
        const currentTime = this.audio.currentTime || 0;
        
        // Check if time is progressing
        if (currentTime !== lastKnownTime) {
          this.audioCurrentTime = currentTime;
          lastKnownTime = currentTime;
          lastTimeUpdate = Date.now();
        } else {
          // Time hasn't changed - check if we're stalled
          const timeSinceUpdate = Date.now() - lastTimeUpdate;
          
          // If audio says it's playing but time isn't moving for 500ms, it might be buffering
          if (!this.audio.paused && !this.audio.ended && timeSinceUpdate > 500) {
            console.warn(`⚠️ TTS: Audio appears stuck at ${currentTime.toFixed(2)}s for ${timeSinceUpdate}ms`);
            // Still increment slightly to keep lip sync moving during buffering
            this.audioCurrentTime += 0.05;
          }
        }
        
        // Check if audio ended but onended didn't fire
        if (this.audio.ended && this.speaking) {
          console.log('⚠️ TTS: Detected audio ended via progress check');
          this.cleanupAndEnd();
          return;
        }
        
        // Check if audio is paused unexpectedly (not by us)
        if (this.audio.paused && !this.audio.ended && this.speaking) {
          const timeSincePause = Date.now() - lastTimeUpdate;
          if (timeSincePause > 2000) {
            console.warn('⚠️ TTS: Audio paused unexpectedly for 2s, attempting to resume...');
            this.audio.play().catch(e => {
              console.error('❌ TTS: Could not resume audio:', e.message);
            });
          }
        }
      }
    }, 50); // Check every 50ms for smooth lip sync
  }
  
  // Clean up and call end callback
  cleanupAndEnd(callback) {
    console.log('🔚 TTS cleanupAndEnd called, was speaking:', this.speaking, 'audioTime:', this.audioCurrentTime?.toFixed(2), 'duration:', this.audioDuration?.toFixed(2));
    console.trace('TTS cleanup trace');
    if (this.progressCheckInterval) {
      clearInterval(this.progressCheckInterval);
      this.progressCheckInterval = null;
    }
    this.speaking = false;
    this.onSpeakingChange?.(false);
    this.currentSubtitleText = null;
    callback?.();
  }

  stop() {
    console.log('🛑 TTS stop() called, was speaking:', this.speaking, 'has audio:', !!this.audio);
    console.trace('TTS stop trace');
    if (this.progressCheckInterval) {
      clearInterval(this.progressCheckInterval);
      this.progressCheckInterval = null;
    }
    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
      this.audio = null;
    }
    const wasSpeaking = this.speaking;
    this.speaking = false;
    this.currentSubtitleText = null;
    this.audioDuration = 0;
    this.audioCurrentTime = 0;
    if (wasSpeaking) {
      this.onSpeakingChange?.(false);
    }
  }

  get isSpeaking() {
    return this.speaking;
  }
  
  // Get audio progress (0-1)
  get progress() {
    if (!this.speaking || this.audioDuration <= 0) return 0;
    return Math.min(1, this.audioCurrentTime / this.audioDuration);
  }
}

// ============ LIVE2D AVATAR CLASS ============
class AgentAvatar {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.app = null;
    this.model = null;
    this.state = 'idle';
    this.tts = new TTSEngine();
    this.isSpeaking = false;
    this.lipSyncValue = 0;
    this.targetLipSyncValue = 0;
    this.currentEmotion = 'neutral';
    
    // Persistent expression state - applied every frame in beforeModelUpdate
    // This ensures expressions don't get overwritten by the model's update cycle
    this.expressionParams = {};
    
    // Persistent action animation state for custom animations
    this.actionParams = {};
    
    // Sync TTS speaking state with avatar
    this.tts.onSpeakingChange = (isSpeaking) => {
      console.log(`🔊 TTS speaking state changed: ${isSpeaking}`);
      this.isSpeaking = isSpeaking;
    };
    
    this.init();
  }

  async init() {
    this.app = new PIXI.Application({
      view: this.canvas,
      backgroundAlpha: 0, // PIXI v6 uses backgroundAlpha instead of transparent
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
      resizeTo: this.canvas.parentElement,
    });

    await this.loadModel();
  }

  async loadModel() {
    try {
      // Load Mao PRO model - has extensive parameter control including arms, magic effects, etc.
      const modelUrl = '/models/mao_pro_en/runtime/mao_pro.model3.json';
      
      console.log('Loading Live2D model from:', modelUrl);
      this.model = await Live2DModel.from(modelUrl, { autoInteract: true });
      
      // Scale and position to fit the avatar container properly
      const containerWidth = this.canvas.parentElement.clientWidth;
      const containerHeight = this.canvas.parentElement.clientHeight;
      
      // Calculate scale to fit model in container - Mao needs to fit fully visible
      const isFullscreen = this.canvas.parentElement.classList.contains('avatar-container') && 
                           this.canvas.parentElement.parentElement.classList.contains('video-container');
      // Much larger divisor = smaller model that fits on screen
      const scaleDivisor = isFullscreen ? 2200 : 2000;
      const scale = Math.min(containerWidth / scaleDivisor, containerHeight / scaleDivisor) * 0.28;
      this.model.scale.set(scale);
      this.model.anchor.set(0.5, 0.5);
      this.model.x = this.app.screen.width / 2;
      // Position model in center vertically so full body is visible
      this.model.y = this.app.screen.height * 0.52;

      this.app.stage.addChild(this.model);
      
      // DISABLE global mouse tracking - we'll do it manually inside canvas only
      this.model.autoInteract = false;
      
      // Setup canvas-only mouse tracking for eye follow
      this.setupCanvasMouseTracking();

      // Start idle animation loop
      this.startIdleLoop();
      
      // Setup lip sync via the PIXI ticker (this runs every frame)
      this.setupLipSyncTicker();
      
      console.log('✓ Live2D model loaded successfully!');
      
      // Log available lip sync parameters
      if (this.model.internalModel?.motionManager?.lipSyncIds) {
        console.log('📋 LipSync parameters:', this.model.internalModel.motionManager.lipSyncIds);
      }
      
      // Log available motions
      const motionManager = this.model.internalModel?.motionManager;
      if (motionManager?.definitions) {
        console.log('🎬 Available motion groups:', Object.keys(motionManager.definitions));
        for (const [group, motions] of Object.entries(motionManager.definitions)) {
          console.log(`   ${group}: ${motions.length} motions`);
        }
      }
      
      // Handle window resize
      window.addEventListener('resize', () => this.repositionModel());
      
    } catch (error) {
      console.error('Live2D model failed to load:', error);
      this.createFallbackAvatar();
    }
  }
  
  // Setup mouse tracking that only works inside the avatar canvas
  // This prevents the character's eyes from tracking the cursor across the entire screen
  setupCanvasMouseTracking() {
    const container = this.canvas.parentElement;
    let isInside = false;
    let lastX = 0;
    let lastY = 0;
    
    // Track when mouse enters/leaves the avatar area
    container.addEventListener('mouseenter', () => {
      isInside = true;
    });
    
    container.addEventListener('mouseleave', () => {
      isInside = false;
      // Smoothly reset eyes to center when mouse leaves
      lastX = 0;
      lastY = 0;
      // Set focus parameters directly for reliable control
      this.focusX = 0;
      this.focusY = 0;
    });
    
    // Track mouse movement only when inside
    container.addEventListener('mousemove', (e) => {
      if (!isInside || !this.model) return;
      
      // Get model's position on screen
      const modelBounds = this.model.getBounds();
      const modelCenterX = modelBounds.x + modelBounds.width / 2;
      const modelCenterY = modelBounds.y + modelBounds.height / 2;
      
      // Get mouse position relative to canvas
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      
      // Calculate direction from model center to mouse (in canvas space)
      // Normalize to -1 to 1 range
      const dx = (mouseX - modelCenterX) / (modelBounds.width / 2);
      const dy = (mouseY - modelCenterY) / (modelBounds.height / 2);
      
      // Clamp and smooth
      const targetX = Math.max(-1, Math.min(1, dx));
      const targetY = Math.max(-1, Math.min(1, dy));
      
      // Store for use in beforeModelUpdate
      this.focusX = targetX;
      this.focusY = targetY;
    });
    
    // Initialize focus values
    this.focusX = 0;
    this.focusY = 0;
    
    console.log('👁️ Canvas-only mouse tracking enabled');
  }
  
  // Setup lip sync by hooking into the model's internal update cycle
  // This is the ONLY reliable way to modify parameters because:
  // 1. The model's update() runs: saveParameters() -> modifications -> update() -> loadParameters()
  // 2. Parameters set via ticker are NOT in sync with the model's update cycle
  // 3. We need to set parameters INSIDE the model's update flow, not outside
  setupLipSyncTicker() {
    if (!this.app || !this.model) return;
    
    let phase = 0;
    
    // Get the internal model reference
    const internalModel = this.model.internalModel;
    const coreModel = internalModel.coreModel;
    const motionManager = internalModel.motionManager;
    
    // Get lip sync parameter IDs
    // Mao PRO model uses ParamA for lip sync (defined in model3.json Groups.LipSync)
    let lipSyncIds = motionManager?.lipSyncIds || [];
    if (lipSyncIds.length === 0) {
      // Mao uses ParamA, fallback for other models
      lipSyncIds = ['ParamA'];
    }
    
    console.log('👄 Lip sync initialized with parameter IDs:', lipSyncIds);
    console.log('👄 LipSyncIds type check:', lipSyncIds.map(id => ({
      value: id,
      type: typeof id,
      hasGetString: typeof id?.getString === 'function',
      stringValue: id?.getString?.() ?? id
    })));
    
    // DEBUG: Dump ALL available parameters from the model
    // This helps us understand what actions/movements the model supports
    try {
      const paramCount = coreModel.getParameterCount();
      console.log(`📊 Model has ${paramCount} parameters - ALL PARAMS:`);
      const allParams = [];
      for (let i = 0; i < paramCount; i++) {
        const paramId = coreModel.getParameterId(i);
        const idStr = paramId?.getString?.() || `Param${i}`;
        const value = coreModel.getParameterValueByIndex(i);
        const defaultValue = coreModel.getParameterDefaultValue(i);
        const minValue = coreModel.getParameterMinimumValue(i);
        const maxValue = coreModel.getParameterMaximumValue(i);
        allParams.push({
          index: i,
          id: idStr,
          value,
          default: defaultValue,
          min: minValue,
          max: maxValue
        });
        console.log(`  [${i}] ${idStr} = ${value?.toFixed?.(2) ?? value} (default: ${defaultValue?.toFixed?.(2)}, range: ${minValue} to ${maxValue})`);
      }
      // Store for reference
      this.availableParams = allParams;
      console.log('\n🎭 AVAILABLE PARAMS FOR AI ACTIONS:', allParams.map(p => p.id));
    } catch (e) {
      console.warn('Could not enumerate parameters:', e);
    }
    
    // CRITICAL: Hook into the model's OWN update cycle via event system
    // The model emits 'beforeModelUpdate' right before coreModel.update() is called
    // This is the PERFECT time to set parameters because:
    // 1. saveParameters() has already been called
    // 2. focus/breath/expressions have already added their values
    // 3. coreModel.update() will process our changes next
    // 4. loadParameters() won't overwrite THIS frame, only resets for NEXT frame
    
    internalModel.on('beforeModelUpdate', () => {
      // === LIP SYNC ===
      // Check BOTH local flag AND TTS engine state for robustness
      const shouldLipSync = this.isSpeaking || this.tts.isSpeaking;
      
      if (shouldLipSync) {
        // Calculate animated lip sync value using audio progress for variation
        const audioProgress = this.tts.progress || 0;
        phase += 0.18; // Slightly faster for more natural movement
        
        // Create varied mouth movement with multiple sine waves
        const wave1 = Math.sin(phase * 0.9 + audioProgress * 10) * 0.5 + 0.5;
        const wave2 = Math.sin(phase * 1.5 + audioProgress * 15) * 0.3;
        const wave3 = Math.sin(phase * 2.3) * 0.2;
        const randomness = Math.random() * 0.1;
        
        this.targetLipSyncValue = Math.max(0, Math.min(1, 
          wave1 * 0.6 + wave2 + wave3 + randomness
        ));
        
        // Smooth interpolation toward target
        this.lipSyncValue += (this.targetLipSyncValue - this.lipSyncValue) * 0.35;
        
        // Apply lip sync
        for (const paramId of lipSyncIds) {
          try {
            const idString = paramId?.getString?.() ?? paramId;
            coreModel.addParameterValueById(idString, this.lipSyncValue, 0.8);
          } catch (e) {
            if (!this._lipSyncErrorLogged) {
              console.warn('Lip sync param error:', e.message);
              this._lipSyncErrorLogged = true;
            }
          }
        }
        
        // Debug log every 2 seconds
        if (!this._lastLipSyncLog || Date.now() - this._lastLipSyncLog > 2000) {
          console.log(`👄 Lip sync active: value=${this.lipSyncValue.toFixed(2)}, progress=${(audioProgress * 100).toFixed(0)}%, tts.speaking=${this.tts.isSpeaking}, local=${this.isSpeaking}`);
          this._lastLipSyncLog = Date.now();
        }
      } else {
        // NOT speaking - reset values
        if (this.lipSyncValue > 0.01) {
          // Log when lip sync stops
          console.log(`👄 Lip sync stopping: tts.speaking=${this.tts.isSpeaking}, local=${this.isSpeaking}`);
        }
        this.targetLipSyncValue = 0;
        this.lipSyncValue = 0;
        phase = 0;
      }
      
      // Apply expression params
      // IMPORTANT: Use addParameterValueById for eye params to blend with auto-blink
      // Eye blink controls ParamEyeLOpen and ParamEyeROpen - don't override them!
      const eyeBlinkParams = ['ParamEyeLOpen', 'ParamEyeROpen'];
      for (const [paramId, value] of Object.entries(this.expressionParams)) {
        try {
          if (eyeBlinkParams.includes(paramId)) {
            // Blend with eye blink instead of overriding
            // Only apply if we want eyes MORE closed (value < 1)
            if (value < 1) {
              coreModel.addParameterValueById(paramId, value - 1, 0.8);
            }
          } else {
            coreModel.setParameterValueById(paramId, value);
          }
        } catch (e) {}
      }
      
      // Apply action params
      for (const [paramId, value] of Object.entries(this.actionParams)) {
        try {
          if (paramId === '_subtleSway') {
            coreModel.addParameterValueById('ParamBodyAngleX', value, 0.3);
          } else if (eyeBlinkParams.includes(paramId)) {
            // Blend with eye blink
            if (value < 1) {
              coreModel.addParameterValueById(paramId, value - 1, 0.8);
            }
          } else {
            coreModel.setParameterValueById(paramId, value);
          }
        } catch (e) {}
      }
      
      // === EYE TRACKING ===
      // Apply focus (eye tracking) parameters based on mouse position
      // This gives us more reliable control than model.focus()
      if (this.focusX !== undefined && this.focusY !== undefined) {
        try {
          // ParamEyeBallX/Y control where the eyes look (-1 to 1)
          coreModel.setParameterValueById('ParamEyeBallX', this.focusX * 0.8);
          coreModel.setParameterValueById('ParamEyeBallY', -this.focusY * 0.5); // Invert Y, reduce range
          
          // Subtle head follow (much less than eyes)
          coreModel.addParameterValueById('ParamAngleX', this.focusX * 5, 0.3);
          coreModel.addParameterValueById('ParamAngleY', -this.focusY * 3, 0.3);
        } catch (e) {}
      }
    });
    
    // Logging ticker (separate, less frequent) - also verify parameter values
    let logCounter = 0;
    this.app.ticker.add(() => {
      if (this.isSpeaking) {
        logCounter++;
        if (logCounter % 60 === 0) {
          console.log('👄 Lip sync active - value:', this.lipSyncValue.toFixed(2));
          // Debug: verify the parameter is actually being read back
          try {
            for (const paramId of lipSyncIds) {
              const currentValue = coreModel.getParameterValueById(paramId);
              console.log(`  └─ ${paramId} actual value: ${currentValue?.toFixed?.(2) ?? currentValue}`);
            }
          } catch (e) {
            console.log('  └─ Could not read param value:', e.message);
          }
        }
      } else {
        logCounter = 0;
      }
    });
  }
  
  repositionModel() {
    if (!this.model) return;
    const containerWidth = this.canvas.parentElement.clientWidth;
    const containerHeight = this.canvas.parentElement.clientHeight;
    const isFullscreen = this.canvas.parentElement.classList.contains('avatar-container') && 
                         this.canvas.parentElement.parentElement.classList.contains('avatar-fullscreen');
    const scaleDivisor = isFullscreen ? 3200 : 2800;
    const scale = Math.min(containerWidth / scaleDivisor, containerHeight / scaleDivisor);
    this.model.scale.set(scale);
    this.model.x = this.app.screen.width / 2;
    this.model.y = isFullscreen ? this.app.screen.height * 0.55 : this.app.screen.height / 2;
  }

  createFallbackAvatar() {
    const container = new PIXI.Container();
    
    // Glow
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

    this.app.stage.addChild(container);
    this.fallbackContainer = container;
    this.glow = glow;

    // Animate
    this.app.ticker.add(() => {
      glow.scale.x = 1 + Math.sin(Date.now() / 500) * 0.1;
      glow.scale.y = 1 + Math.sin(Date.now() / 500) * 0.1;
    });
  }

  // Play a motion by group and index
  // Mao model structure:
  // - "Idle" group: mtn_01 (index 0)
  // - "" (unnamed) group: mtn_02 (0), mtn_03 (1), mtn_04 (2), special_01 (3), special_02 (4), special_03 (5)
  playMotion(groupOrFilename, index = 0) {
    if (this.model?.internalModel?.motionManager) {
      try {
        // Map special/named motions to the unnamed group with correct indices
        const motionMap = {
          'mtn_02': ['', 0],
          'mtn_03': ['', 1],
          'mtn_04': ['', 2],
          'special_01': ['', 3],
          'special_02': ['', 4],
          'special_03': ['', 5],
        };
        
        if (motionMap[groupOrFilename]) {
          const [group, idx] = motionMap[groupOrFilename];
          console.log(`🎬 Playing motion: ${groupOrFilename} → group "${group}" index ${idx}`);
          this.model.motion(group, idx);
        } else {
          // Standard group/index call (e.g., 'Idle', 0)
          console.log(`🎬 Playing motion: group "${groupOrFilename}" index ${index}`);
          this.model.motion(groupOrFilename, index);
        }
      } catch (e) {
        console.warn(`Motion playback error:`, e);
      }
    }
  }

  // Keep the character alive with random idle animations
  startIdleLoop() {
    // Play idle motions periodically - Mao has 1 idle motion
    // The idle motion (mtn_01) already has natural movement including wand rotation
    // We just need to trigger it periodically
    this.idleInterval = setInterval(() => {
      if (this.state === 'idle' && this.model) {
        this.playMotion('Idle', 0);
      }
    }, 12000 + Math.random() * 5000); // Random interval between 12-17 seconds
    
    // NOTE: Removed the breathing/scale animation that was causing erratic behavior
    // The model's physics and idle motion already provide natural movement
    
    // Start with first idle motion after a short delay
    setTimeout(() => {
      this.playMotion('Idle', 0);
    }, 500);
  }

  // Start lip sync - now just sets the flag, actual animation is done in the ticker
  startLipSync() {
    console.log('👄 Starting lip sync');
    this.isSpeaking = true;
  }

  // Stop lip sync
  stopLipSync() {
    console.log('👄 Stopping lip sync');
    this.isSpeaking = false;
  }

  // ============ EMOTION & EXPRESSION CONTROL ============
  // Mao PRO Model Expression System
  // The model has: exp_01 through exp_08 built-in expressions
  // Plus direct parameter control for: Face, Eyes, Eyebrows, Mouth, Body, Arms, Magic
  
  // Mao Parameter Reference:
  // Face: ParamAngleX/Y/Z, ParamCheek (blush), ParamFaceInkOn
  // Eyes: ParamEyeLOpen/ROpen (0-1), ParamEyeLSmile/RSmile (0-1), ParamEyeLForm/RForm, ParamEyeEffect
  // Eyeballs: ParamEyeBallX/Y, ParamEyeBallForm
  // Eyebrows: ParamBrowLY/RY, ParamBrowLX/RX, ParamBrowLAngle/RAngle, ParamBrowLForm/RForm
  // Mouth: ParamA/I/U/E/O (vowels 0-1), ParamMouthUp/Down (0-1), ParamMouthAngry (0-1)
  // Body: ParamBodyAngleX/Y/Z, ParamBreath, ParamLeftShoulderUp/RightShoulderUp
  // Arms: ParamArmLA01/02/03, ParamArmRA01/02/03, ParamArmLB01/02/03, ParamArmRB01/02/03, ParamHandLA/RA/LB/RB
  // Magic: ParamWandRotate, ParamAuraOn, ParamHeartHealOn, ParamHeartMissOn, ParamExplosionOn, ParamRabbitAppearance
  
  setExpression(emotion) {
    if (!this.model?.internalModel?.coreModel) {
      console.log('❌ Cannot set expression - model not ready');
      return;
    }
    
    // Debug: Check for available expressions in the model on first call
    if (!this._expressionsListed) {
      this._expressionsListed = true;
      const expManager = this.model.internalModel.motionManager?.expressionManager;
      if (expManager?.definitions) {
        console.log('📋 Available model expressions:', expManager.definitions.map(e => e.Name || e.name).join(', '));
      }
    }
    
    console.log(`🎭 Setting expression: ${emotion}`);
    
    // Clear previous expression params
    this.expressionParams = {};
    
    // IMPORTANT: We use ONLY direct parameter control, NOT built-in expressions!
    // Mao's built-in expressions (exp_02, etc.) use Multiply blend on eye open
    // which keeps eyes CLOSED permanently. We control everything via parameters instead.
    // This gives us full control and lets auto eye-blink work properly.
    
    // Always reset to neutral expression first to clear any previous expression state
    const expManager = this.model.internalModel.motionManager?.expressionManager;
    if (expManager && expManager.getExpressionIndex('exp_01') !== -1) {
      this.model.expression('exp_01'); // Reset to neutral (eyes open)
    }
    
    // Additionally set parameters for enhanced control
    // IMPORTANT: Avoid setting ParamEyeLOpen/ParamEyeROpen directly as they conflict with auto-blink
    // Use ParamEyeLSmile/ParamEyeRSmile for squinting/smiling eyes instead
    switch (emotion) {
      case 'happy':
        this.expressionParams = {
          'ParamEyeLSmile': 1,
          'ParamEyeRSmile': 1,
          'ParamMouthUp': 0.8,       // Smile mouth corners up
          'ParamCheek': 0.5,         // Light blush
        };
        break;
        
      case 'excited':
        this.expressionParams = {
          'ParamEyeLSmile': 0.7,
          'ParamEyeRSmile': 0.7,
          'ParamMouthUp': 1,
          'ParamCheek': 0.8,         // Strong blush
          'ParamBrowLY': 0.5,        // Raised brows
          'ParamBrowRY': 0.5,
        };
        // Play excited motion
        this.playMotion('mtn_02', 0);
        break;
        
      case 'thinking':
        this.expressionParams = {
          'ParamBrowLY': -0.3,
          'ParamBrowRY': 0.3,        // Asymmetric brows
          'ParamBrowLAngle': -0.5,
          'ParamEyeBallY': 0.5,      // Eyes looking up
          'ParamAngleZ': 5,          // Slight head tilt
        };
        break;
        
      case 'confused':
        this.expressionParams = {
          'ParamBrowLY': 0.8,
          'ParamBrowRY': -0.3,       // Very asymmetric brows
          'ParamBrowLAngle': 0.5,
          'ParamBrowRAngle': -0.5,
          'ParamEyeLSmile': 0.3,     // Slight squint instead of eye open
          'ParamAngleX': -10,        // Head tilt
        };
        break;
        
      case 'surprised':
        this.expressionParams = {
          'ParamBrowLY': 1,          // Eyebrows way up
          'ParamBrowRY': 1,
          'ParamA': 0.6,             // Mouth open (surprise "ah!")
          'ParamMouthDown': 0.5,
        };
        break;
        
      case 'sad':
        this.expressionParams = {
          'ParamBrowLY': -0.8,
          'ParamBrowRY': -0.8,
          'ParamBrowLAngle': 0.8,    // Inner brows up (sad shape)
          'ParamBrowRAngle': 0.8,
          'ParamEyeLSmile': 0.5,     // Droopy eyes via smile param
          'ParamEyeRSmile': 0.5,
          'ParamMouthDown': 0.7,     // Corners down
          'ParamAngleY': -5,         // Head slightly down
        };
        break;
        
      case 'angry':
        this.expressionParams = {
          'ParamBrowLY': -1,
          'ParamBrowRY': -1,
          'ParamBrowLAngle': -0.8,   // Brows angled inward
          'ParamBrowRAngle': -0.8,
          'ParamEyeLSmile': -0.3,    // Narrowed eyes (negative smile = angry look)
          'ParamEyeRSmile': -0.3,
          'ParamMouthAngry': 1,      // Angry mouth shape
        };
        break;
        
      case 'wink':
        // Wink uses built-in expression which handles eye properly
        this.expressionParams = {
          'ParamEyeLSmile': 1,       // Smiling closed eye
          'ParamMouthUp': 0.6,       // Slight smile
        };
        // Reset wink after 800ms
        setTimeout(() => {
          delete this.expressionParams['ParamEyeLSmile'];
        }, 800);
        break;
        
      case 'love':
        this.expressionParams = {
          'ParamEyeLSmile': 1,
          'ParamEyeRSmile': 1,
          'ParamCheek': 1,           // Full blush!
          'ParamMouthUp': 1,
          'ParamEyeEffect': 1,       // Sparkly eyes
          'ParamHeartHealOn': 1,     // Show hearts!
        };
        // Turn off hearts after 2 seconds
        setTimeout(() => {
          delete this.expressionParams['ParamHeartHealOn'];
        }, 2000);
        break;
        
      case 'smug':
        this.expressionParams = {
          'ParamEyeLSmile': 0.6,     // Half-lidded via smile
          'ParamEyeRSmile': 0.6,
          'ParamBrowLY': 0.3,
          'ParamBrowRY': 0.3,
          'ParamMouthUp': 0.4,
          'ParamAngleZ': -8,         // Slight tilt
        };
        break;
        
      case 'sleepy':
        this.expressionParams = {
          'ParamEyeLSmile': 0.8,     // Droopy eyes via smile
          'ParamEyeRSmile': 0.8,
          'ParamBrowLY': -0.5,
          'ParamBrowRY': -0.5,
          'ParamAngleY': 5,          // Head tilting down
        };
        break;
        
      case 'neutral':
      default:
        // Clear expression params to reset to default
        this.expressionParams = {};
        // Reset to neutral expression
        if (expManager && expManager.getExpressionIndex('exp_01') !== -1) {
          this.model.expression('exp_01');
        }
        break;
    }
    
    console.log(`✅ Expression ${emotion} applied with params:`, Object.keys(this.expressionParams));
  }
  
  // ============ ACTIONS & BODY CONTROL ============
  // Mao PRO Model Action System
  // 
  // ARM PARAMETERS (each arm has 3 joints + hand):
  // Left Arm A:  ParamArmLA01, ParamArmLA02, ParamArmLA03, ParamHandLA
  // Right Arm A: ParamArmRA01, ParamArmRA02, ParamArmRA03, ParamHandRA
  // Left Arm B:  ParamArmLB01, ParamArmLB02, ParamArmLB03, ParamHandLB
  // Right Arm B: ParamArmRB01, ParamArmRB02, ParamArmRB03, ParamHandRB
  //
  // BODY PARAMETERS:
  // ParamBodyAngleX/Y/Z, ParamBreath, ParamLeftShoulderUp, ParamRightShoulderUp
  //
  // MAGIC EFFECTS:
  // ParamWandRotate, ParamAuraOn, ParamHeartHealOn, ParamHeartMissOn
  // ParamExplosionOn, ParamRabbitAppearance, ParamInkDrop
  //
  // MOTIONS: idle_00, mtn_02, mtn_03, mtn_04, special_01, special_02, special_03
  
  doAction(action) {
    if (!this.model) return;
    
    console.log(`🎬 Executing action: ${action}`);
    
    switch (action) {
      // ARM ACTIONS
      case 'raise_left_hand':
      case 'raise_left_arm':
        this.animateRaiseLeftArm();
        break;
        
      case 'raise_right_hand':
      case 'raise_right_arm':
        this.animateRaiseRightArm();
        break;
        
      case 'raise_both_hands':
      case 'raise_both_arms':
        this.animateRaiseBothArms();
        break;
        
      case 'lower_left_arm':
        this.animateLowerLeftArm();
        break;
        
      case 'lower_right_arm':
        this.animateLowerRightArm();
        break;
        
      case 'lower_arms':
        this.animateLowerBothArms();
        break;
        
      case 'wave':
        this.animateWave();
        break;
        
      case 'point':
        this.animatePoint();
        break;
        
      // HEAD/BODY ACTIONS
      case 'nod':
        this.animateNod();
        break;
        
      case 'shake':
        this.animateShake();
        break;
        
      case 'bow':
        this.animateBow();
        break;
        
      case 'dance':
        this.animateDance();
        break;
        
      case 'think':
        this.animateThink();
        break;
        
      case 'shrug':
        this.animateShrug();
        break;
        
      case 'look_left':
        this.animateLookDirection('left');
        break;
        
      case 'look_right':
        this.animateLookDirection('right');
        break;
        
      case 'look_up':
        this.animateLookDirection('up');
        break;
        
      case 'look_down':
        this.animateLookDirection('down');
        break;
        
      // MAGIC ACTIONS (Mao special!)
      case 'cast_spell':
      case 'magic':
        this.animateCastSpell();
        break;
        
      case 'hearts':
      case 'send_love':
        this.animateHearts();
        break;
        
      case 'explosion':
      case 'boom':
        this.animateExplosion();
        break;
        
      case 'summon_rabbit':
      case 'rabbit':
        this.animateSummonRabbit();
        break;
        
      case 'aura':
      case 'power_up':
        this.animateAura();
        break;
        
      default:
        console.log(`Unknown action: ${action}`);
    }
  }
  
  // ============ ARM ANIMATIONS ============
  
  animateRaiseLeftArm() {
    if (!this.model?.internalModel?.coreModel) return;
    console.log('🦾 Raising left arm');
    
    // IMPORTANT: Mao model has two arm sets (A and B) controlled by pose
    // We need to animate BOTH sets to ensure visibility regardless of which is active
    const startTime = performance.now();
    const duration = 600; // 600ms for smooth animation
    
    const animate = () => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = this.easeOutCubic(progress);
      
      // Raise left arm - animate BOTH arm sets (A and B) for compatibility
      // The pose system controls which one is visible, but we set both
      this.actionParams['ParamArmLA01'] = eased * 30;     // Upper arm rotation (range -30 to 30)
      this.actionParams['ParamArmLA02'] = eased * 30;     // Elbow rotation  
      this.actionParams['ParamArmLA03'] = eased * 20;     // Wrist rotation
      this.actionParams['ParamArmLB01'] = eased * 30;     // B set upper arm
      this.actionParams['ParamArmLB02'] = eased * 30;     // B set elbow  
      this.actionParams['ParamArmLB03'] = eased * 20;     // B set wrist
      this.actionParams['ParamLeftShoulderUp'] = eased * 1; // Shoulder up (range 0-1)
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      }
      // Keep arm raised after animation completes
    };
    requestAnimationFrame(animate);
  }
  
  animateRaiseRightArm() {
    if (!this.model?.internalModel?.coreModel) return;
    console.log('🦾 Raising right arm');
    
    const startTime = performance.now();
    const duration = 600;
    
    const animate = () => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = this.easeOutCubic(progress);
      
      // Raise right arm - animate BOTH arm sets (A and B) for compatibility
      this.actionParams['ParamArmRA01'] = eased * 30;     // Upper arm rotation
      this.actionParams['ParamArmRA02'] = eased * 30;     // Elbow rotation
      this.actionParams['ParamArmRA03'] = eased * 20;     // Wrist rotation
      this.actionParams['ParamArmRB01'] = eased * 30;     // B set upper arm
      this.actionParams['ParamArmRB02'] = eased * 30;     // B set elbow
      this.actionParams['ParamArmRB03'] = eased * 20;     // B set wrist
      this.actionParams['ParamRightShoulderUp'] = eased * 1; // Shoulder up
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };
    requestAnimationFrame(animate);
  }
  
  animateRaiseBothArms() {
    if (!this.model?.internalModel?.coreModel) return;
    console.log('🙌 Raising both arms');
    
    const startTime = performance.now();
    const duration = 600;
    
    const animate = () => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = this.easeOutCubic(progress);
      
      // Both arms up! Animate all arm sets for compatibility
      this.actionParams['ParamArmLA01'] = eased * 30;
      this.actionParams['ParamArmLA02'] = eased * 30;
      this.actionParams['ParamArmLB01'] = eased * 30;
      this.actionParams['ParamArmLB02'] = eased * 30;
      this.actionParams['ParamArmRA01'] = eased * 30;
      this.actionParams['ParamArmRA02'] = eased * 30;
      this.actionParams['ParamArmRB01'] = eased * 30;
      this.actionParams['ParamArmRB02'] = eased * 30;
      this.actionParams['ParamLeftShoulderUp'] = eased * 1;
      this.actionParams['ParamRightShoulderUp'] = eased * 1;
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };
    requestAnimationFrame(animate);
  }
  
  animateLowerLeftArm() {
    if (!this.model?.internalModel?.coreModel) return;
    console.log('⬇️ Lowering left arm');
    
    const startTime = performance.now();
    const duration = 600;
    const startVals = {
      LA01: this.actionParams['ParamArmLA01'] || 0,
      LA02: this.actionParams['ParamArmLA02'] || 0,
      LA03: this.actionParams['ParamArmLA03'] || 0,
      LB01: this.actionParams['ParamArmLB01'] || 0,
      LB02: this.actionParams['ParamArmLB02'] || 0,
      LB03: this.actionParams['ParamArmLB03'] || 0,
      shoulder: this.actionParams['ParamLeftShoulderUp'] || 0,
    };
    
    const animate = () => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = this.easeOutCubic(progress);
      const inverse = 1 - eased;
      
      this.actionParams['ParamArmLA01'] = startVals.LA01 * inverse;
      this.actionParams['ParamArmLA02'] = startVals.LA02 * inverse;
      this.actionParams['ParamArmLA03'] = startVals.LA03 * inverse;
      this.actionParams['ParamArmLB01'] = startVals.LB01 * inverse;
      this.actionParams['ParamArmLB02'] = startVals.LB02 * inverse;
      this.actionParams['ParamArmLB03'] = startVals.LB03 * inverse;
      this.actionParams['ParamLeftShoulderUp'] = startVals.shoulder * inverse;
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        // Clean up
        delete this.actionParams['ParamArmLA01'];
        delete this.actionParams['ParamArmLA02'];
        delete this.actionParams['ParamArmLA03'];
        delete this.actionParams['ParamArmLB01'];
        delete this.actionParams['ParamArmLB02'];
        delete this.actionParams['ParamArmLB03'];
        delete this.actionParams['ParamLeftShoulderUp'];
      }
    };
    requestAnimationFrame(animate);
  }
  
  animateLowerRightArm() {
    if (!this.model?.internalModel?.coreModel) return;
    console.log('⬇️ Lowering right arm');
    
    const startTime = performance.now();
    const duration = 600;
    const startVals = {
      RA01: this.actionParams['ParamArmRA01'] || 0,
      RA02: this.actionParams['ParamArmRA02'] || 0,
      RA03: this.actionParams['ParamArmRA03'] || 0,
      RB01: this.actionParams['ParamArmRB01'] || 0,
      RB02: this.actionParams['ParamArmRB02'] || 0,
      RB03: this.actionParams['ParamArmRB03'] || 0,
      shoulder: this.actionParams['ParamRightShoulderUp'] || 0,
    };
    
    const animate = () => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = this.easeOutCubic(progress);
      const inverse = 1 - eased;
      
      this.actionParams['ParamArmRA01'] = startVals.RA01 * inverse;
      this.actionParams['ParamArmRA02'] = startVals.RA02 * inverse;
      this.actionParams['ParamArmRA03'] = startVals.RA03 * inverse;
      this.actionParams['ParamArmRB01'] = startVals.RB01 * inverse;
      this.actionParams['ParamArmRB02'] = startVals.RB02 * inverse;
      this.actionParams['ParamArmRB03'] = startVals.RB03 * inverse;
      this.actionParams['ParamRightShoulderUp'] = startVals.shoulder * inverse;
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        // Clean up
        delete this.actionParams['ParamArmRA01'];
        delete this.actionParams['ParamArmRA02'];
        delete this.actionParams['ParamArmRA03'];
        delete this.actionParams['ParamArmRB01'];
        delete this.actionParams['ParamArmRB02'];
        delete this.actionParams['ParamArmRB03'];
        delete this.actionParams['ParamRightShoulderUp'];
      }
    };
    requestAnimationFrame(animate);
  }
  
  animateLowerBothArms() {
    this.animateLowerLeftArm();
    this.animateLowerRightArm();
  }
  
  // Wave animation - moves arm up and down repeatedly
  animateWave() {
    if (!this.model?.internalModel?.coreModel) return;
    console.log('👋 Waving');
    
    const startTime = performance.now();
    const duration = 2000; // 2 seconds of waving
    
    const animate = () => {
      const elapsed = performance.now() - startTime;
      const progress = elapsed / duration;
      
      // Wave motion with right arm - use correct param ranges (-30 to 30)
      const wave = Math.sin(elapsed * 0.008) * 10;  // Wave oscillation
      const basePosition = 25;  // Raised position
      
      // Animate both A and B arm sets for compatibility
      this.actionParams['ParamArmRA01'] = basePosition + wave;
      this.actionParams['ParamArmRA02'] = 20 + wave * 0.5;
      this.actionParams['ParamArmRA03'] = 10 + wave * 0.3;
      this.actionParams['ParamArmRB01'] = basePosition + wave;
      this.actionParams['ParamArmRB02'] = 20 + wave * 0.5;
      this.actionParams['ParamArmRB03'] = 10 + wave * 0.3;
      this.actionParams['ParamRightShoulderUp'] = 0.8;
      
      // Body follows slightly
      this.actionParams['ParamBodyAngleZ'] = Math.sin(elapsed * 0.005) * 3;
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        // Lower arm gradually after wave
        this.animateLowerRightArm();
        delete this.actionParams['ParamBodyAngleZ'];
      }
    };
    requestAnimationFrame(animate);
  }
  
  animatePoint() {
    if (!this.model?.internalModel?.coreModel) return;
    console.log('👆 Pointing');
    
    const startTime = performance.now();
    const duration = 600;
    
    const animate = () => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = this.easeOutCubic(progress);
      
      // Point with right arm extended - use correct param ranges (0-30)
      this.actionParams['ParamArmRA01'] = eased * 20;
      this.actionParams['ParamArmRA02'] = eased * 25;
      this.actionParams['ParamArmRA03'] = eased * 30;
      this.actionParams['ParamArmRB01'] = eased * 20;
      this.actionParams['ParamArmRB02'] = eased * 25;
      this.actionParams['ParamArmRB03'] = eased * 30;
      this.actionParams['ParamRightShoulderUp'] = eased * 0.5;
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        // Hold for a bit then lower
        setTimeout(() => this.animateLowerRightArm(), 1000);
      }
    };
    requestAnimationFrame(animate);
  }
  
  // ============ HEAD & BODY ANIMATIONS ============
  
  animateNod() {
    if (!this.model?.internalModel?.coreModel) return;
    console.log('😊 Nodding');
    let step = 0;
    const interval = setInterval(() => {
      // Nod - head goes down then up
      const angle = Math.sin(step * 0.5) * 15;
      this.actionParams['ParamAngleY'] = angle;
      step++;
      if (step > 14) {
        clearInterval(interval);
        delete this.actionParams['ParamAngleY'];
      }
    }, 50);
  }
  
  animateShake() {
    if (!this.model?.internalModel?.coreModel) return;
    console.log('😤 Shaking head');
    let step = 0;
    const interval = setInterval(() => {
      // Head shake - left to right
      const angle = Math.sin(step * 0.8) * 20;
      this.actionParams['ParamAngleX'] = angle;
      step++;
      if (step > 18) {
        clearInterval(interval);
        delete this.actionParams['ParamAngleX'];
      }
    }, 50);
  }
  
  animateDance() {
    if (!this.model?.internalModel?.coreModel) return;
    let step = 0;
    const interval = setInterval(() => {
      // Dance - body sways rhythmically
      const bodyAngleX = Math.sin(step * 0.4) * 10;
      const bodyAngleZ = Math.sin(step * 0.4 + Math.PI/4) * 8;
      const headAngleX = Math.sin(step * 0.4) * 5;
      this.actionParams['ParamBodyAngleX'] = bodyAngleX;
      this.actionParams['ParamBodyAngleZ'] = bodyAngleZ;
      this.actionParams['ParamAngleX'] = headAngleX;
      step++;
      if (step > 50) {
        clearInterval(interval);
        delete this.actionParams['ParamBodyAngleX'];
        delete this.actionParams['ParamBodyAngleZ'];
        delete this.actionParams['ParamAngleX'];
      }
    }, 60);
  }
  
  animateBow() {
    if (!this.model?.internalModel?.coreModel) return;
    let step = 0;
    const interval = setInterval(() => {
      let angle;
      if (step < 10) angle = step * 2; // Bow down
      else if (step < 25) angle = 20; // Hold bow
      else angle = Math.max(0, 50 - step * 2); // Rise back up
      this.actionParams['ParamBodyAngleY'] = angle;
      this.actionParams['ParamAngleY'] = angle * 0.5;
      step++;
      if (step > 35) {
        clearInterval(interval);
        delete this.actionParams['ParamBodyAngleY'];
        delete this.actionParams['ParamAngleY'];
      }
    }, 50);
  }
  
  animateThink() {
    if (!this.model?.internalModel?.coreModel) return;
    console.log('🤔 Thinking');
    let step = 0;
    const interval = setInterval(() => {
      // Thinking - slight head tilt, eyes up
      const tilt = Math.sin(step * 0.15) * 5 + 8;
      this.actionParams['ParamAngleZ'] = tilt;
      this.actionParams['ParamAngleY'] = -5; // Look slightly up
      this.actionParams['ParamEyeBallY'] = 0.5; // Eyes looking up
      step++;
      if (step > 40) {
        clearInterval(interval);
        delete this.actionParams['ParamAngleZ'];
        delete this.actionParams['ParamAngleY'];
        delete this.actionParams['ParamEyeBallY'];
      }
    }, 60);
  }
  
  animateShrug() {
    if (!this.model?.internalModel?.coreModel) return;
    console.log('🤷 Shrugging');
    
    const startTime = performance.now();
    const duration = 1500; // 1.5 seconds total animation
    
    const animate = () => {
      const elapsed = performance.now() - startTime;
      const progress = elapsed / duration;
      
      let shoulderVal;
      if (progress < 0.3) shoulderVal = progress / 0.3;           // Raise
      else if (progress < 0.6) shoulderVal = 1;                   // Hold
      else shoulderVal = Math.max(0, 1 - (progress - 0.6) / 0.4); // Lower
      
      this.actionParams['ParamLeftShoulderUp'] = shoulderVal;
      this.actionParams['ParamRightShoulderUp'] = shoulderVal;
      this.actionParams['ParamAngleZ'] = shoulderVal * 5; // Head tilt
      
      // Arms out slightly - use correct param ranges
      this.actionParams['ParamArmLA01'] = shoulderVal * 10;
      this.actionParams['ParamArmRA01'] = shoulderVal * 10;
      this.actionParams['ParamArmLB01'] = shoulderVal * 10;
      this.actionParams['ParamArmRB01'] = shoulderVal * 10;
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        // Clean up all params
        delete this.actionParams['ParamLeftShoulderUp'];
        delete this.actionParams['ParamRightShoulderUp'];
        delete this.actionParams['ParamAngleZ'];
        delete this.actionParams['ParamArmLA01'];
        delete this.actionParams['ParamArmRA01'];
        delete this.actionParams['ParamArmLB01'];
        delete this.actionParams['ParamArmRB01'];
      }
    };
    requestAnimationFrame(animate);
  }
  
  animateLookDirection(direction) {
    if (!this.model?.internalModel?.coreModel) return;
    console.log(`👀 Looking ${direction}`);
    
    let eyeX = 0, eyeY = 0, headX = 0, headY = 0;
    switch(direction) {
      case 'left':
        eyeX = -1; headX = -15;
        break;
      case 'right':
        eyeX = 1; headX = 15;
        break;
      case 'up':
        eyeY = 1; headY = -10;
        break;
      case 'down':
        eyeY = -1; headY = 10;
        break;
    }
    
    let step = 0;
    const interval = setInterval(() => {
      const progress = Math.min(step / 10, 1);
      const eased = this.easeOutCubic(progress);
      
      this.actionParams['ParamEyeBallX'] = eyeX * eased;
      this.actionParams['ParamEyeBallY'] = eyeY * eased;
      this.actionParams['ParamAngleX'] = headX * eased;
      this.actionParams['ParamAngleY'] = headY * eased;
      
      step++;
      if (step > 10) {
        clearInterval(interval);
        // Hold for 1 second then return to center
        setTimeout(() => {
          let returnStep = 0;
          const returnInterval = setInterval(() => {
            const returnProgress = Math.min(returnStep / 10, 1);
            const returnEased = this.easeOutCubic(returnProgress);
            
            this.actionParams['ParamEyeBallX'] = eyeX * (1 - returnEased);
            this.actionParams['ParamEyeBallY'] = eyeY * (1 - returnEased);
            this.actionParams['ParamAngleX'] = headX * (1 - returnEased);
            this.actionParams['ParamAngleY'] = headY * (1 - returnEased);
            
            returnStep++;
            if (returnStep > 10) {
              clearInterval(returnInterval);
              delete this.actionParams['ParamEyeBallX'];
              delete this.actionParams['ParamEyeBallY'];
              delete this.actionParams['ParamAngleX'];
              delete this.actionParams['ParamAngleY'];
            }
          }, 40);
        }, 1000);
      }
    }, 40);
  }
  
  // ============ MAGIC ANIMATIONS (Mao Special!) ============
  
  animateCastSpell() {
    if (!this.model?.internalModel?.coreModel) return;
    console.log('✨ Casting spell!');
    
    // Play special motion if available
    this.playMotion('special_01', 0);
    
    // Add magic effects
    let step = 0;
    const interval = setInterval(() => {
      // Wand rotate
      this.actionParams['ParamWandRotate'] = Math.sin(step * 0.3) * 30;
      
      // Aura on!
      if (step > 5) {
        this.actionParams['ParamAuraOn'] = 1;
      }
      
      // Raise arm holding wand
      const progress = Math.min(step / 15, 1);
      this.actionParams['ParamArmRA01'] = progress * 0.8;
      this.actionParams['ParamArmRA02'] = progress * 0.6;
      
      step++;
      if (step > 40) {
        clearInterval(interval);
        // Turn off effects
        delete this.actionParams['ParamWandRotate'];
        delete this.actionParams['ParamAuraOn'];
        this.animateLowerRightArm();
      }
    }, 60);
  }
  
  animateHearts() {
    if (!this.model?.internalModel?.coreModel) return;
    console.log('💕 Sending hearts!');
    
    // Play heart special motion
    this.playMotion('special_02', 0);
    
    // Enable hearts effect
    this.actionParams['ParamHeartHealOn'] = 1;
    this.expressionParams['ParamCheek'] = 1; // Blush!
    this.expressionParams['ParamEyeLSmile'] = 1;
    this.expressionParams['ParamEyeRSmile'] = 1;
    
    // Turn off after 3 seconds
    setTimeout(() => {
      delete this.actionParams['ParamHeartHealOn'];
      delete this.expressionParams['ParamCheek'];
    }, 3000);
  }
  
  animateExplosion() {
    if (!this.model?.internalModel?.coreModel) return;
    console.log('💥 Explosion!');
    
    // Play explosion special motion
    this.playMotion('special_03', 0);
    
    // Enable explosion effect
    this.actionParams['ParamExplosionOn'] = 1;
    
    // Dramatic pose
    this.actionParams['ParamArmLA01'] = 0.6;
    this.actionParams['ParamArmRA01'] = 0.6;
    
    // Turn off after 2 seconds
    setTimeout(() => {
      delete this.actionParams['ParamExplosionOn'];
      delete this.actionParams['ParamArmLA01'];
      delete this.actionParams['ParamArmRA01'];
    }, 2000);
  }
  
  animateSummonRabbit() {
    if (!this.model?.internalModel?.coreModel) return;
    console.log('🐰 Summoning rabbit!');
    
    // Enable rabbit
    let step = 0;
    const interval = setInterval(() => {
      const progress = Math.min(step / 20, 1);
      
      // Gradually show rabbit
      this.actionParams['ParamRabbitAppearance'] = progress;
      
      // Look at rabbit
      this.actionParams['ParamEyeBallX'] = -0.5 * progress;
      this.actionParams['ParamEyeBallY'] = -0.3 * progress;
      this.actionParams['ParamAngleX'] = -10 * progress;
      
      step++;
      if (step > 20) {
        clearInterval(interval);
        
        // Keep rabbit visible for 3 seconds
        setTimeout(() => {
          let hideStep = 0;
          const hideInterval = setInterval(() => {
            const hideProgress = Math.min(hideStep / 15, 1);
            this.actionParams['ParamRabbitAppearance'] = 1 - hideProgress;
            
            hideStep++;
            if (hideStep > 15) {
              clearInterval(hideInterval);
              delete this.actionParams['ParamRabbitAppearance'];
              delete this.actionParams['ParamEyeBallX'];
              delete this.actionParams['ParamEyeBallY'];
              delete this.actionParams['ParamAngleX'];
            }
          }, 40);
        }, 3000);
      }
    }, 50);
  }
  
  animateAura() {
    if (!this.model?.internalModel?.coreModel) return;
    console.log('🔮 Power up!');
    
    // Enable aura
    this.actionParams['ParamAuraOn'] = 1;
    
    // Power up pose
    let step = 0;
    const interval = setInterval(() => {
      // Body slightly forward, arms tensed
      const pulse = Math.sin(step * 0.3) * 0.1 + 0.9;
      
      this.actionParams['ParamBodyAngleY'] = 5;
      this.actionParams['ParamLeftShoulderUp'] = 0.3 * pulse;
      this.actionParams['ParamRightShoulderUp'] = 0.3 * pulse;
      
      step++;
      if (step > 50) {
        clearInterval(interval);
        delete this.actionParams['ParamAuraOn'];
        delete this.actionParams['ParamBodyAngleY'];
        delete this.actionParams['ParamLeftShoulderUp'];
        delete this.actionParams['ParamRightShoulderUp'];
      }
    }, 60);
  }
  
  // ============ UTILITY FUNCTIONS ============
  
  // Easing function for smooth animations
  easeOutCubic(x) {
    return 1 - Math.pow(1 - x, 3);
  }
  
  easeInOutCubic(x) {
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  }
  
  // Parse and execute emotion tags from text
  // Mao PRO supports many more emotions and actions!
  parseAndExecuteEmotions(text) {
    if (!text) return;
    
    // Extended emotion list for Mao
    const emotionRegex = /\[(neutral|happy|excited|thinking|confused|surprised|sad|angry|wink|love|smug|sleepy)\]/gi;
    
    // Extended action list for Mao with arm control and magic
    const actionRegex = /\[(wave|nod|shake|dance|bow|think|shrug|point|raise_left_hand|raise_right_hand|raise_left_arm|raise_right_arm|raise_both_hands|raise_both_arms|lower_left_arm|lower_right_arm|lower_arms|look_left|look_right|look_up|look_down|cast_spell|magic|hearts|send_love|explosion|boom|summon_rabbit|rabbit|aura|power_up)\]/gi;
    
    console.log('🎭 Parsing emotions from:', text.slice(0, 100));
    
    // Find emotions and actions
    const emotions = text.match(emotionRegex) || [];
    const actions = text.match(actionRegex) || [];
    
    console.log('  Found emotions:', emotions);
    console.log('  Found actions:', actions);
    
    // Execute the FIRST emotion found (set the mood immediately)
    if (emotions.length > 0) {
      const firstEmotion = emotions[0].replace(/[\[\]]/g, '').toLowerCase();
      console.log('  Setting expression:', firstEmotion);
      this.setExpression(firstEmotion);
    }
    
    // Execute all actions with delays
    actions.forEach((action, index) => {
      const actionName = action.replace(/[\[\]]/g, '').toLowerCase();
      console.log(`  Scheduling action: ${actionName} (delay: ${index * 1000}ms)`);
      setTimeout(() => {
        console.log(`  Executing action: ${actionName}`);
        this.doAction(actionName);
      }, index * 1000);
    });
  }

  // Interrupt current speech - stops talking immediately
  interrupt() {
    console.log('🛑 Avatar interrupted!');
    this.tts.stop();
    this.isSpeaking = false;
    this.setState('idle');
    this.hideSubtitles();
    this.setExpression('neutral');
  }
  
  // Check if currently speaking
  get isTalking() {
    return this.state === 'speaking' || this.tts.isSpeaking;
  }

  // Speak text with lip sync and emotion parsing
  speak(text, audioPath) {
    if (!text) return;
    
    console.log('🗣️ Avatar.speak called');
    console.log('  Text:', text.slice(0, 50) + '...');
    console.log('  Audio:', audioPath);
    
    // Parse and execute emotions/actions from text
    this.parseAndExecuteEmotions(text);
    
    // Clean text for subtitles (remove emotion/action tags)
    const cleanText = text
      .replace(/\[(happy|sad|angry|excited|surprised|thinking|confused|wink|love|smug|sleepy|neutral)\]/gi, '')
      .replace(/\[(raise_left_hand|raise_right_hand|raise_both_hands|lower_arms|wave|point|nod|shake|bow|dance|shrug|look_left|look_right|look_up|look_down|cast_spell|hearts|explosion|summon_rabbit|aura)\]/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    
    // Set state to speaking (lip sync is now auto-synced with TTS engine)
    this.setState('speaking');
    
    // Store clean text for chat display when audio starts
    this.pendingChatMessage = cleanText;
    
    // Play audio if available
    if (audioPath) {
      this.tts.speak(audioPath, {
        subtitleText: cleanText,
        onStart: () => {
          console.log('🗣️ TTS onStart callback - showing chat message NOW');
          // Show message in chat ONLY when audio actually starts playing!
          if (this.pendingChatMessage && this.onSpeakStart) {
            this.onSpeakStart(this.pendingChatMessage);
            this.pendingChatMessage = null;
          }
        },
        onEnd: () => {
          console.log('🗣️ TTS onEnd callback');
          this.setState('idle');
          // Reset expression to neutral after speaking to ensure eyes open
          setTimeout(() => this.setExpression('neutral'), 500);
        }
      });
    } else {
      // No audio - show chat message immediately and animate
      console.log('⚠️ No audio path, using timed animation');
      this.isSpeaking = true; // Manually set for lip sync without audio
      
      // Show message in chat immediately
      if (this.pendingChatMessage && this.onSpeakStart) {
        this.onSpeakStart(this.pendingChatMessage);
        this.pendingChatMessage = null;
      }
      
      const duration = Math.max(3000, cleanText.split(' ').length * 400);
      setTimeout(() => {
        this.isSpeaking = false;
        this.setState('idle');
      }, duration);
    }
    
    // Safety timeout - stop everything after 3 minutes max
    setTimeout(() => {
      if (this.state === 'speaking') {
        console.log('🗣️ Safety timeout - stopping speech');
        this.tts.stop();
        this.isSpeaking = false;
        this.setState('idle');
        this.setExpression('neutral');
        this.hideSubtitles();
      }
    }, 180000);
  }
  
  // Show subtitles on screen - synced with audio duration
  showSubtitles(text) {
    const subtitleEl = document.getElementById('subtitleText');
    if (!subtitleEl) return;
    
    // Clear any existing subtitle animation
    if (this.subtitleTimeout) {
      clearTimeout(this.subtitleTimeout);
    }
    if (this.subtitleAnimationFrame) {
      cancelAnimationFrame(this.subtitleAnimationFrame);
    }
    
    // Split text into chunks (like movie subtitles)
    const chunks = this.splitIntoSubtitleChunks(text);
    if (chunks.length === 0) return;
    
    // Calculate total character count for timing
    const totalChars = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    
    // Use audio-synced subtitle display
    const startTime = Date.now();
    let lastChunkIndex = -1;
    
    const updateSubtitle = () => {
      // Check if still speaking
      if (this.state !== 'speaking' && !this.tts.isSpeaking) {
        return;
      }
      
      // Get current progress from TTS (0-1)
      const progress = this.tts.progress || 0;
      const audioDuration = this.tts.audioDuration || 10;
      
      // If no progress data, fall back to time-based
      let currentProgress;
      if (progress > 0 || this.tts.isSpeaking) {
        currentProgress = progress;
      } else {
        // Fallback: estimate based on elapsed time
        const elapsed = (Date.now() - startTime) / 1000;
        currentProgress = Math.min(1, elapsed / audioDuration);
      }
      
      // Calculate which chunk should be shown based on progress
      // Distribute chunks evenly across the audio duration
      const targetChunkIndex = Math.min(
        chunks.length - 1,
        Math.floor(currentProgress * chunks.length)
      );
      
      // Update subtitle if we've moved to a new chunk
      if (targetChunkIndex !== lastChunkIndex) {
        lastChunkIndex = targetChunkIndex;
        subtitleEl.textContent = chunks[targetChunkIndex];
        subtitleEl.classList.add('visible');
        console.log(`📝 Subtitle [${targetChunkIndex + 1}/${chunks.length}]: "${chunks[targetChunkIndex].slice(0, 30)}..."`);
      }
      
      // Continue animation if still speaking
      if (this.state === 'speaking' || this.tts.isSpeaking) {
        this.subtitleAnimationFrame = requestAnimationFrame(updateSubtitle);
      }
    };
    
    // Start the subtitle sync loop
    this.subtitleAnimationFrame = requestAnimationFrame(updateSubtitle);
    
    // Also show first chunk immediately
    subtitleEl.textContent = chunks[0];
    subtitleEl.classList.add('visible');
    lastChunkIndex = 0;
  }
  
  // Split text into movie-style subtitle chunks
  splitIntoSubtitleChunks(text) {
    const chunks = [];
    
    // First, split by sentence-ending punctuation
    const sentences = text.split(/(?<=[.!?])\s+/);
    
    for (const sentence of sentences) {
      // If sentence is short enough, use it as one chunk
      const words = sentence.trim().split(/\s+/);
      
      if (words.length <= 10) {
        if (sentence.trim()) chunks.push(sentence.trim());
      } else {
        // Split longer sentences by commas, semicolons, or natural breaks
        const parts = sentence.split(/(?<=[,;:])\s+|(?<=\.\.\.)\s*/);
        
        for (const part of parts) {
          const partWords = part.trim().split(/\s+/);
          
          if (partWords.length <= 12) {
            if (part.trim()) chunks.push(part.trim());
          } else {
            // Still too long - split by word count
            let chunk = [];
            for (const word of partWords) {
              chunk.push(word);
              // Split at 8-10 words, preferring to break after certain words
              if (chunk.length >= 8 && (
                chunk.length >= 10 || 
                ['and', 'but', 'or', 'so', 'then', 'like', 'that', 'which', 'when', 'because'].includes(word.toLowerCase())
              )) {
                chunks.push(chunk.join(' '));
                chunk = [];
              }
            }
            if (chunk.length > 0) {
              chunks.push(chunk.join(' '));
            }
          }
        }
      }
    }
    
    return chunks.filter(c => c.length > 0);
  }
  
  // Hide subtitles
  hideSubtitles() {
    const subtitleEl = document.getElementById('subtitleText');
    if (!subtitleEl) return;
    
    // Clear any pending subtitle animations
    if (this.subtitleTimeout) {
      clearTimeout(this.subtitleTimeout);
      this.subtitleTimeout = null;
    }
    if (this.subtitleAnimationFrame) {
      cancelAnimationFrame(this.subtitleAnimationFrame);
      this.subtitleAnimationFrame = null;
    }
    
    subtitleEl.classList.remove('visible');
  }

  setState(state) {
    this.state = state;
    const statusDot = document.querySelector('.status-dot');
    const statusText = document.getElementById('agentStatus');
    
    if (statusDot) statusDot.className = 'status-dot ' + state;
    
    if (statusText) {
      switch(state) {
        case 'thinking':
          statusText.textContent = 'Thinking...';
          this.playMotion('Idle', 1);
          break;
        case 'coding':
          statusText.textContent = 'Writing code...';
          this.playMotion('TapBody');
          break;
        case 'speaking':
          statusText.textContent = 'Speaking...';
          break;
        case 'idle':
          statusText.textContent = 'Idle';
          this.playMotion('Idle', 0);
          break;
        case 'disconnected':
          statusText.textContent = 'Disconnected';
          break;
        case 'error':
          statusText.textContent = 'Error';
          break;
        default:
          statusText.textContent = state;
      }
    }
  }
}

// ============ CHAT SYSTEM ============
class ChatSystem {
  constructor() {
    this.messagesContainer = document.getElementById('chatMessages');
    this.input = document.getElementById('chatInput');
    this.sendBtn = document.getElementById('chatSend');
    this.streamingMessage = null;
    
    this.setupListeners();
    this.addSystemMessage('Welcome! Chat with the AI agent.');
  }

  setupListeners() {
    this.sendBtn.addEventListener('click', () => this.sendMessage());
    this.input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });
  }

  addSystemMessage(text) {
    this.addMessage({ username: 'System', type: 'system', text });
  }

  // Strip emotion/action tags for display
  stripEmotionTags(text) {
    return text
      .replace(/\[(neutral|happy|excited|thinking|confused|surprised|sad|angry|wink|love)\]/gi, '')
      .replace(/\[(wave|nod|shake|dance|bow)\]/gi, '')
      .trim();
  }

  addMessage({ username, type, text }) {
    // Strip emotion tags for display (they're executed by avatar, not shown)
    const displayText = this.stripEmotionTags(text);
    const msgEl = document.createElement('div');
    msgEl.className = 'chat-message';
    msgEl.innerHTML = `<span class="username ${type}">${username}:</span><span class="text">${this.escapeHtml(displayText)}</span>`;
    this.messagesContainer.appendChild(msgEl);
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  // Start streaming response from agent
  startStreaming() {
    this.streamingMessage = document.createElement('div');
    this.streamingMessage.className = 'chat-message';
    this.streamingMessage.innerHTML = `<span class="username agent">Mao:</span><span class="text streaming"></span>`;
    this.messagesContainer.appendChild(this.streamingMessage);
    this.streamingContent = '';
  }

  // Append to streaming message
  appendStream(delta) {
    if (!this.streamingMessage) {
      this.startStreaming();
    }
    this.streamingContent += delta;
    const textEl = this.streamingMessage.querySelector('.text');
    if (textEl) {
      textEl.textContent = this.streamingContent;
    }
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  // Finalize streaming message
  endStreaming() {
    if (this.streamingMessage) {
      this.streamingMessage.querySelector('.text')?.classList.remove('streaming');
    }
    this.streamingMessage = null;
    this.streamingContent = '';
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  sendMessage() {
    const text = this.input.value.trim();
    if (!text) return;

    // Send via Socket.IO
    socket.emit('chat:send', {
      username: 'You',
      text: text
    });

    this.input.value = '';
  }
}

// ============ MAIN APPLICATION ============
class ClawStreamApp {
  constructor() {
    this.terminal = null;
    this.avatar = null;
    this.chat = null;
    this.connected = false;
    this.autonomousTalkTimer = null;
    this.lastInteractionTime = Date.now();
  }

  async init() {
    console.log('Initializing ClawStream...');

    // Initialize components
    this.terminal = new AgentTerminal('terminal');
    this.avatar = new AgentAvatar('avatarCanvas');
    this.chat = new ChatSystem();

    // Setup Socket.IO handlers
    this.setupSocketHandlers();
    
    // Start autonomous talking system
    this.startAutonomousTalking();

    console.log('ClawStream initialized!');
  }
  
  // Mao talks on her own like a real streamer!
  startAutonomousTalking() {
    // Prompts to make Mao talk about random things
    const autonomousPrompts = [
      "Share a random thought or observation you just had. Be natural and casual.",
      "React to something happening in your stream or talk about what's on your mind.",
      "Tell the viewers something interesting about crypto or tech.",
      "Share a funny or interesting story or memory.",
      "Talk about what you're excited about lately.",
      "Share an opinion on something trending in crypto or tech.",
      "Wonder out loud about something curious.",
      "Comment on being live and streaming right now.",
      "Talk about your day or how you're feeling.",
      "Share a hot take or unpopular opinion about something.",
    ];
    
    // Check every 30 seconds if Mao should talk
    const checkAndTalk = () => {
      const timeSinceInteraction = Date.now() - this.lastInteractionTime;
      const minSilenceTime = 25000; // 25 seconds of silence before talking
      const maxSilenceTime = 60000; // Max 60 seconds of silence
      
      // Only talk if:
      // 1. Audio is unlocked (user has interacted)
      // 2. Connected to server
      // 3. Not currently talking
      // 4. Been silent for a while
      // 5. Random chance (so it's not predictable)
      if (
        audioUnlocked &&
        this.connected &&
        !this.avatar.isTalking &&
        this.avatar.state === 'idle' &&
        timeSinceInteraction > minSilenceTime
      ) {
        // Higher chance to talk the longer the silence
        const silenceRatio = Math.min(1, (timeSinceInteraction - minSilenceTime) / (maxSilenceTime - minSilenceTime));
        const talkChance = 0.3 + (silenceRatio * 0.5); // 30-80% chance based on silence duration
        
        if (Math.random() < talkChance) {
          console.log('🎙️ Mao decides to talk on her own!');
          
          // Pick a random prompt
          const prompt = autonomousPrompts[Math.floor(Math.random() * autonomousPrompts.length)];
          
          // Send as a system/autonomous message
          socket.emit('chat:send', {
            username: 'System',
            text: `[AUTONOMOUS THOUGHT] ${prompt}`,
            isAutonomous: true
          });
          
          // Update last interaction time
          this.lastInteractionTime = Date.now();
        }
      }
    };
    
    // Start the autonomous talking loop
    this.autonomousTalkTimer = setInterval(checkAndTalk, 15000); // Check every 15 seconds
    
    // Do initial greeting AFTER audio is unlocked (user clicks)
    afterAudioUnlocked(() => {
      // Small delay after unlock to feel natural
      setTimeout(() => {
        if (this.connected && !this.avatar.isTalking) {
          socket.emit('chat:send', {
            username: 'System',
            text: '[AUTONOMOUS THOUGHT] Greet your viewers! You just started streaming. Be excited and welcoming.',
            isAutonomous: true
          });
          this.lastInteractionTime = Date.now();
        }
      }, 1000);
    });
    
    console.log('🎙️ Autonomous talking system started');
  }

  setupSocketHandlers() {
    // Connection events
    socket.on('connect', () => {
      console.log('Connected to server');
      this.terminal.writeLine('\x1b[32m✓ Connected to ClawStream server\x1b[0m');
    });

    socket.on('disconnect', () => {
      console.log('Disconnected from server');
      this.terminal.writeLine('\x1b[31m✗ Disconnected from server\x1b[0m');
      this.avatar.setState('disconnected');
      this.connected = false;
    });

    // Agent status updates
    socket.on('agent:status', (data) => {
      console.log('Agent status:', data);
      this.avatar.setState(data.state || 'idle');
      
      if (data.connected && !this.connected) {
        this.connected = true;
        this.terminal.writeLine('\x1b[32m✓ Connected to OpenClaw Gateway\x1b[0m');
        this.terminal.writeLine('\x1b[38;5;245mSend a message in chat to talk to the AI!\x1b[0m');
        this.terminal.writeLine('');
        this.chat.addSystemMessage('🦞 Connected to OpenClaw! Send a message to chat with Claude.');
      } else if (!data.connected && this.connected) {
        this.connected = false;
        this.terminal.writeLine('\x1b[31m✗ Disconnected from OpenClaw Gateway\x1b[0m');
      }
    });

    // Chat messages (user messages echoed back)
    socket.on('chat:message', (data) => {
      // Don't show autonomous prompts in chat
      if (data.isAutonomous || data.text?.startsWith('[AUTONOMOUS THOUGHT]')) {
        return;
      }
      
      this.chat.addMessage({
        username: data.username,
        type: data.type || 'viewer',
        text: data.text
      });
      
      // Update last interaction time for autonomous system
      this.lastInteractionTime = Date.now();
      
      // If it's a user message, interrupt Mao if she's talking and show thinking state
      if ((data.type === 'user' || data.type === 'viewer') && data.username !== 'System') {
        // INTERRUPT! Mao doesn't care about being rude - she responds to chat!
        if (this.avatar.isTalking) {
          console.log('💬 User message received - interrupting Mao!');
          this.avatar.interrupt();
        }
        this.avatar.setState('thinking');
      }
      
      // NOTE: We don't speak here - we speak from chat:complete to avoid double-speaking
    });

    // Streaming chat response from agent (disabled - we show final message only)
    socket.on('chat:stream', (data) => {
      // Don't show streaming in chat - avatar state only
      if (data.delta) {
        this.avatar.setState('thinking');
      }
    });

    // Chat complete - THIS IS WHERE WE SPEAK
    socket.on('chat:complete', (data) => {
      console.log('📢 chat:complete received');
      console.log('  fullResponse:', data.fullResponse?.slice(0, 50) + '...');
      console.log('  audioPath:', data.audioPath);
      
      this.chat.endStreaming();
      
      // Store whether this is an autonomous message (don't show in chat until speech starts)
      const isAutonomous = data.isAutonomous;
      
      // Set up callback to show message in chat when speech actually starts
      this.avatar.onSpeakStart = (cleanText) => {
        // Show Mao's message in chat when she starts speaking
        this.chat.addMessage({
          username: 'Mao',
          type: 'agent',
          text: cleanText
        });
      };
      
      // Speak with emotions from fullResponse and audio from server
      if (data.fullResponse) {
        console.log('🎤 Triggering avatar speech...');
        this.avatar.speak(data.fullResponse, data.audioPath);
      }
    });

    // Chat error
    socket.on('chat:error', (data) => {
      this.chat.endStreaming();
      this.chat.addSystemMessage(`Error: ${data.error}`);
      this.avatar.setState('error');
      setTimeout(() => this.avatar.setState('idle'), 2000);
    });

    // Terminal output from agent
    socket.on('terminal:output', (data) => {
      this.terminal.writeOutput(data.text, data.type);
    });

    // Agent output (detailed)
    socket.on('agent:output', (data) => {
      if (data.content) {
        this.terminal.writeOutput(data.content, data.type);
      }
      if (data.state) {
        this.avatar.setState(data.state);
      }
    });

    // Agent errors
    socket.on('agent:error', (data) => {
      this.terminal.writeLine(`\x1b[31mError: ${data.message}\x1b[0m`);
      this.chat.addSystemMessage(`Error: ${data.message}`);
      this.avatar.setState('error');
    });
  }
}

// ============ INITIALIZE ============
async function init() {
  const app = new ClawStreamApp();
  await app.init();
  
  // Stream timer
  const streamStartTime = Date.now();
  const updateStreamTime = () => {
    const elapsed = Date.now() - streamStartTime;
    const hours = Math.floor(elapsed / 3600000);
    const minutes = Math.floor((elapsed % 3600000) / 60000);
    const seconds = Math.floor((elapsed % 60000) / 1000);
    const timeStr = [
      hours.toString().padStart(2, '0'),
      minutes.toString().padStart(2, '0'),
      seconds.toString().padStart(2, '0')
    ].join(':');
    const el = document.getElementById('streamTime');
    if (el) el.textContent = timeStr;
  };
  setInterval(updateStreamTime, 1000);
  updateStreamTime();
  
  // Update viewer count (simulated for demo)
  setInterval(() => {
    const count = 125000 + Math.floor(Math.random() * 5000);
    const el = document.getElementById('viewerCount');
    if (el) el.textContent = count.toLocaleString();
  }, 5000);
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
