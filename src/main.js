// ClawStream TRUE LIVE Frontend
// This is a PASSIVE RECEIVER - it renders exactly what the server broadcasts
// All viewers see the SAME thing at the SAME time

import { io } from 'socket.io-client';
import * as PIXI from 'pixi.js';

// Live2D will be loaded lazily when needed
let Live2DModel = null;
let live2dReady = false;

// Make PIXI globally available
window.PIXI = PIXI;

// Lazy load Live2D only when needed
async function loadLive2D() {
  if (live2dReady) return true;
  
  try {
    const module = await import('pixi-live2d-display');
    Live2DModel = module.Live2DModel;
    Live2DModel.registerTicker(PIXI.Ticker);
    live2dReady = true;
    console.log('🎭 Live2D loaded successfully');
    return true;
  } catch (e) {
    console.warn('🎭 Live2D not available:', e.message);
    return false;
  }
}

// ============ GLOBALS ============
const socket = io("/viewers");
const mainSocket = io("/");  // Main namespace for stream list updates
let isStreamConnected = false;
let currentStreamId = null;
let globalVolume = 0.8;

// ============ TRUE LIVE: PASSIVE AUDIO PLAYER ============
// This player just plays what the server tells it to play
// It syncs to the server's timeline AND provides real-time audio analysis for lip sync
class SyncedAudioPlayer {
  constructor() {
    this.audio = new Audio();
    this.audio.crossOrigin = 'anonymous';
    this.currentUrl = null;
    this.serverStartTime = 0;
    this.isPlaying = false;
    
    // Web Audio API for REAL lip sync
    this.audioContext = null;
    this.analyser = null;
    this.dataArray = null;
    this.source = null;
    this.mouthOpenValue = 0;
    
    // Handle audio events
    this.audio.addEventListener('ended', () => {
      console.log('🔊 Audio ended');
      this.isPlaying = false;
      this.currentUrl = null;
      this.mouthOpenValue = 0;
    });
    
    this.audio.addEventListener('error', (e) => {
      console.error('🔊 Audio error:', e);
      this.isPlaying = false;
    });
  }
  
  // Initialize Web Audio API for analysis
  initAudioAnalysis() {
    if (this.audioContext) return; // Already initialized
    
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.3; // Smooth but responsive
      
      const bufferLength = this.analyser.frequencyBinCount;
      this.dataArray = new Uint8Array(bufferLength);
      
      // Connect audio element to analyser
      this.source = this.audioContext.createMediaElementSource(this.audio);
      this.source.connect(this.analyser);
      this.analyser.connect(this.audioContext.destination);
      
      console.log('🎤 Audio analysis initialized!');
    } catch (e) {
      console.error('🎤 Failed to init audio analysis:', e);
    }
  }
  
  // Get current mouth open value based on REAL audio amplitude
  getMouthOpen() {
    if (!this.analyser) {
      console.log('🎤 No analyser!');
      return 0;
    }
    if (!this.isPlaying) {
      return 0;
    }
    
    // Get frequency data
    this.analyser.getByteFrequencyData(this.dataArray);
    
    // Debug: log raw frequency data occasionally
    this._debugCounter = (this._debugCounter || 0) + 1;
    
    // Use TIME DOMAIN data for better amplitude detection
    const timeDomainData = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(timeDomainData);
    
    // Calculate RMS (root mean square) for true amplitude
    let sumSquares = 0;
    for (let i = 0; i < timeDomainData.length; i++) {
      const normalized = (timeDomainData[i] - 128) / 128; // Center around 0
      sumSquares += normalized * normalized;
    }
    const rms = Math.sqrt(sumSquares / timeDomainData.length);
    
    // RMS is typically 0-0.5 for speech, amplify it
    const amplified = Math.min(1, rms * 3);
    
    // Debug log every 10 frames
    if (this._debugCounter % 10 === 0) {
      console.log('🎤 Audio RMS:', rms.toFixed(3), '-> mouth:', amplified.toFixed(2));
    }
    
    this.mouthOpenValue = amplified;
    return this.mouthOpenValue;
  }
  
  // Play new audio, seeking to the correct position if late joining
  async playFromServer(audioUrl, serverStartTime, duration) {
    if (!audioUrl) return;
    
    const fullUrl = audioUrl.startsWith('http') ? audioUrl : `http://localhost:3001${audioUrl}`;
    
    // If same audio, don't restart
    if (this.currentUrl === fullUrl && this.isPlaying) {
      return;
    }
    
    console.log('🔊 Playing audio:', fullUrl);
    this.currentUrl = fullUrl;
    this.serverStartTime = serverStartTime;
    
    try {
      // Initialize audio analysis on first play (needs user interaction)
      this.initAudioAnalysis();
      
      // Resume audio context if suspended (browser policy)
      if (this.audioContext && this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      
      this.audio.src = fullUrl;
      this.audio.volume = globalVolume;
      
      // Calculate how far into the audio we should be
      const elapsed = (Date.now() - serverStartTime) / 1000;
      
      // Wait for audio to load
      await new Promise((resolve, reject) => {
        this.audio.oncanplaythrough = resolve;
        this.audio.onerror = reject;
        this.audio.load();
      });
      
      // Seek to correct position if late joining
      if (elapsed > 0.5 && elapsed < this.audio.duration) {
        console.log('🔊 Late join - seeking to', elapsed.toFixed(2), 'seconds');
        this.audio.currentTime = elapsed;
      }
      
      await this.audio.play();
      this.isPlaying = true;
      console.log('🔊 Audio playing!');
      
    } catch (err) {
      console.error('🔊 Failed to play audio:', err);
      this.isPlaying = false;
    }
  }
  
  stop() {
    this.audio.pause();
    this.audio.currentTime = 0;
    this.isPlaying = false;
    this.currentUrl = null;
  }
  
  setVolume(vol) {
    this.audio.volume = vol;
  }
}

// ============ TRUE LIVE: SYNCED AVATAR ============
// Avatar state is ENTIRELY driven by server broadcasts
class SyncedAvatar {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.app = null;
    this.model = null;
    this.ready = false;
    
    // Current state (from server)
    this.mouthOpen = 0;
    this.expression = 'neutral';
    this.gesture = null;
    this.lookX = 0;
    this.lookY = 0;
    
    // Animation interpolation
    this.targetMouthOpen = 0;
    this.currentMouthOpen = 0;
    
    // Arm state persistence (keyed by parameter name)
    this._armState = {};
    this._targetLookX = 0;
    this._targetLookY = 0;
    this._currentLookX = 0;
    this._currentLookY = 0;
    
    this.init();
  }
  
  async init() {
    if (!this.canvas) {
      console.error('Canvas not found!');
      return;
    }
    
    // Create PIXI app
    this.app = new PIXI.Application({
      view: this.canvas,
      width: this.canvas.clientWidth || 400,
      height: this.canvas.clientHeight || 500,
      backgroundAlpha: 0,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true
    });
    
    // Load Live2D lazily
    const live2dLoaded = await loadLive2D();
    if (!live2dLoaded || !Live2DModel) {
      console.warn('🎭 Live2D not available, avatar will not be shown');
      return;
    }
    
    // Load Live2D model
    try {
      console.log('🎭 Loading Live2D model...');
      this.model = await Live2DModel.from('/models/mao_pro_en/runtime/mao_pro.model3.json');
      
      // Scale and position - fit nicely in container
      const scale = Math.min(
        this.canvas.clientWidth / this.model.width,
        this.canvas.clientHeight / this.model.height
      ) * 0.9;  // 30% bigger than 0.7
      
      this.model.scale.set(scale);
      this.model.anchor.set(0.5, 0.5);
      this.model.x = this.canvas.clientWidth / 2;
      this.model.y = this.canvas.clientHeight / 2 + 50;  // Reduced offset
      
      // Disable auto interactions
      this.model.autoInteract = false;
      
      // IMPORTANT: Disable the internal lip sync so we can control it ourselves
      if (this.model.internalModel?.motionManager) {
        // Disable expression/motion lip sync override
        const mm = this.model.internalModel.motionManager;
        console.log('🎭 Motion manager found, disabling internal lip sync');
      }
      
      this.app.stage.addChild(this.model);
      this.ready = true;
      
      console.log('🎭 Avatar ready! Model has', this.model.internalModel?.motionManager ? 'motion manager' : 'no motion manager');
      console.log('🎭 Core model:', this.model.internalModel?.coreModel);
      
      // CRITICAL: Hook into beforeModelUpdate to apply lip sync AFTER motions but BEFORE rendering
      // This is the only way to override motion parameters reliably!
      this.model.internalModel.on('beforeModelUpdate', () => {
        this.applyLipSync();
      });
      console.log('🎤 Hooked into beforeModelUpdate for lip sync!');
      
      // Debug: List all parameters
      this.listParameters();
      
      // Start render loop for smooth interpolation
      // Note: audioPlayer is set via setAudioPlayer() after construction
      this.app.ticker.add(() => this.tick(this._audioPlayer));
      
    } catch (err) {
      console.error('🎭 Failed to load avatar:', err);
    }
  }
  
  // Connect audio player for REAL lip sync
  setAudioPlayer(audioPlayer) {
    this._audioPlayer = audioPlayer;
    console.log('🎤 Avatar connected to audio player for real lip sync!');
  }
  
  // REAL LIP SYNC: Called from beforeModelUpdate event
  // This runs AFTER motions update but BEFORE the model renders
  // This is the ONLY reliable way to override motion parameters!
  applyLipSync() {
    if (!this.model) return;
    
    const coreModel = this.model.internalModel?.coreModel;
    if (!coreModel) return;
    
    // Get mouth value from audio analysis OR test value
    let mouthValue = 0;
    
    // Check for test value first (from debug button)
    if (this._testMouthValue && this._testMouthValue > 0) {
      mouthValue = this._testMouthValue;
    } 
    // Otherwise check audio player
    else if (this._audioPlayer && this._audioPlayer.isPlaying) {
      mouthValue = this._audioPlayer.getMouthOpen();
    }
    
    // Smooth the value slightly for natural look
    this._smoothMouth = this._smoothMouth || 0;
    this._smoothMouth += (mouthValue - this._smoothMouth) * 0.6;
    
    // Amplify for visibility
    const amplified = Math.min(1, this._smoothMouth * 2.5);
    
    // Apply to lip sync parameters - ParamA is the main one
    // From model3.json: "Groups": [{"Name": "LipSync", "Ids": ["ParamA"]}]
    if (amplified > 0.01) {
      coreModel.setParameterValueById('ParamA', amplified);
      
      // Debug log occasionally
      this._lipSyncDebugCount = (this._lipSyncDebugCount || 0) + 1;
      if (this._lipSyncDebugCount % 30 === 0) {
        console.log('👄 LipSync (beforeModelUpdate):', amplified.toFixed(2));
      }
    }
    
    // Keep eyes open (counteract any expression that closes them)
    coreModel.setParameterValueById('ParamEyeLOpen', 1);
    coreModel.setParameterValueById('ParamEyeROpen', 1);
  }

  // Debug: List all model parameters
  listParameters() {
    if (!this.model) return;
    try {
      const coreModel = this.model.internalModel?.coreModel;
      
      if (coreModel) {
        // List key parameters for lip sync and expressions
        const keyParams = [
          'ParamA', 'ParamI', 'ParamU', 'ParamE', 'ParamO',  // Vowel lip sync
          'ParamMouthUp', 'ParamMouthDown',  // Mouth shape
          'ParamEyeLOpen', 'ParamEyeROpen', 'ParamEyeLSmile', 'ParamEyeRSmile',  // Eyes
          'ParamBrowLY', 'ParamBrowRY',  // Brows
          'ParamCheek',  // Blush
          'ParamArmLA01', 'ParamArmRA01',  // Arms
          'ParamAngleX', 'ParamAngleY'  // Head
        ];
        console.log('📋 Key parameters:');
        for (const id of keyParams) {
          try {
            const idx = coreModel.getParameterIndex(id);
            if (idx >= 0) {
              const value = coreModel.getParameterValueById(id);
              console.log(`   ${id}: ${value.toFixed(2)} (idx ${idx})`);
            } else {
              console.log(`   ${id}: NOT FOUND`);
            }
          } catch (e) {
            console.log(`   ${id}: error`);
          }
        }
      }
      
      console.log('📋 Expressions:', this.model.internalModel?.motionManager?.expressionManager?.definitions);
      console.log('📋 Motions:', this.model.internalModel?.motionManager?.definitions);
    } catch (e) {
      console.log('Could not list parameters:', e);
    }
  }
  
  // Clean up avatar resources
  destroy() {
    console.log('🎭 Destroying avatar...');
    this.ready = false;
    if (this.model) {
      this.app?.stage?.removeChild(this.model);
      this.model.destroy();
      this.model = null;
    }
    if (this.app) {
      this.app.destroy(false);  // Don't remove the canvas
      this.app = null;
    }
  }
  
  // Called every frame for smooth animation
  // Note: Lip sync is now handled in applyLipSync() via beforeModelUpdate event
  tick(audioPlayer) {
    if (!this.model || !this.ready) return;
    
    // Frame counter for debug
    this._frameCount = (this._frameCount || 0) + 1;
    
    // Log audio state periodically
    if (audioPlayer && audioPlayer.isPlaying && this._frameCount % 120 === 0) {
      console.log('🔊 Audio playing, analyser:', !!audioPlayer.analyser);
    }
    
    // Apply other parameters (not lip sync - that's in applyLipSync via beforeModelUpdate)
    try {
      const coreModel = this.model.internalModel?.coreModel;
      if (coreModel) {
        // Apply current arm state
        if (this._armState) {
          for (const [param, value] of Object.entries(this._armState)) {
            coreModel.setParameterValueById(param, value);
          }
        }
        
        // Apply look direction smoothly
        if (this._targetLookX !== undefined) {
          this._currentLookX = this._currentLookX || 0;
          this._currentLookY = this._currentLookY || 0;
          this._currentLookX += (this._targetLookX - this._currentLookX) * 0.1;
          this._currentLookY += (this._targetLookY - this._currentLookY) * 0.1;
          coreModel.setParameterValueById('ParamEyeBallX', this._currentLookX);
          coreModel.setParameterValueById('ParamEyeBallY', this._currentLookY);
        }
      }
    } catch (e) {
      // Silently ignore - parameters may not exist
    }
  }
  
  // Update from server broadcast state
  updateFromBroadcast(avatarState) {
    if (!avatarState) return;
    
    // Update mouth (with interpolation target)
    if (avatarState.mouthOpen !== undefined) {
      this.targetMouthOpen = avatarState.mouthOpen;
    }
    
    // Update expression
    if (avatarState.expression && avatarState.expression !== this.expression) {
      this.expression = avatarState.expression;
      this.setExpression(avatarState.expression);
    }
    
    // Update gesture
    if (avatarState.gesture && avatarState.gesture !== this.gesture) {
      this.gesture = avatarState.gesture;
      this.triggerGesture(avatarState.gesture);
    } else if (!avatarState.gesture && this.gesture) {
      this.gesture = null;
    }
    
    // Update look direction
    if (avatarState.lookX !== undefined) {
      this.lookX = avatarState.lookX;
      this.setLookDirection(avatarState.lookX, avatarState.lookY || 0);
    }
    if (avatarState.lookY !== undefined) {
      this.lookY = avatarState.lookY;
    }
  }
  
  // Set eye/head look direction
  setLookDirection(x, y) {
    if (!this.model || !this.ready) return;
    
    // Store target values for smooth interpolation in tick()
    this._targetLookX = x;
    this._targetLookY = y;
    
    // Also set slight head turn immediately
    try {
      const coreModel = this.model.internalModel?.coreModel;
      if (coreModel) {
        coreModel.setParameterValueById('ParamAngleX', x * 15);
        coreModel.setParameterValueById('ParamAngleY', y * 10);
      }
    } catch (e) {
      // Ignore if parameters don't exist
    }
  }
  
  setExpression(expression) {
    if (!this.model || !this.ready) return;
    
    console.log('🎭 Setting expression:', expression);
    
    // Store the expression for persistence
    this._currentExpression = expression;
    
    // DON'T use built-in expressions - they mess with eye state!
    // Use correct param names for Mao model:
    // - ParamMouthUp/Down for smile (not ParamMouthForm)
    // - ParamBrowLY/RY for brows  
    // - ParamCheek for blush
    // - ParamEyeLSmile/RSmile for happy eyes
    const expressionParams = {
      'neutral': { mouthUp: 0, mouthDown: 0, brows: 0, cheek: 0, eyeSmile: 0 },
      'happy': { mouthUp: 0.7, mouthDown: 0, brows: 0.3, cheek: 0.6, eyeSmile: 0.5 },
      'excited': { mouthUp: 1.0, mouthDown: 0, brows: 0.5, cheek: 0.8, eyeSmile: 0.7 },
      'sad': { mouthUp: 0, mouthDown: 0.6, brows: -0.4, cheek: 0, eyeSmile: 0 },
      'angry': { mouthUp: 0, mouthDown: 0.3, brows: -0.7, cheek: 0, eyeSmile: 0 },
      'surprised': { mouthUp: 0.2, mouthDown: 0, brows: 0.8, cheek: 0, eyeSmile: 0 },
      'thinking': { mouthUp: 0.1, mouthDown: 0, brows: 0.4, cheek: 0, eyeSmile: 0 },
      'confused': { mouthUp: 0, mouthDown: 0.2, brows: -0.3, cheek: 0, eyeSmile: 0 },
      'wink': { mouthUp: 0.5, mouthDown: 0, brows: 0.2, cheek: 0.4, eyeSmile: 0.3, winkLeft: true },
      'love': { mouthUp: 0.8, mouthDown: 0, brows: 0.3, cheek: 1.0, eyeSmile: 0.6 },
      'smug': { mouthUp: 0.4, mouthDown: 0, brows: 0.2, cheek: 0.3, eyeSmile: 0.3 },
      'sleepy': { mouthUp: 0, mouthDown: 0, brows: -0.2, cheek: 0, eyeSmile: 0, sleepy: true }
    };
    
    const params = expressionParams[expression] || expressionParams['neutral'];
    
    try {
      const coreModel = this.model.internalModel?.coreModel;
      if (coreModel) {
        // Mouth shape (smile up vs frown down)
        coreModel.setParameterValueById('ParamMouthUp', params.mouthUp || 0);
        coreModel.setParameterValueById('ParamMouthDown', params.mouthDown || 0);
        // Eyebrows
        coreModel.setParameterValueById('ParamBrowLY', params.brows || 0);
        coreModel.setParameterValueById('ParamBrowRY', params.brows || 0);
        // Cheek blush
        coreModel.setParameterValueById('ParamCheek', params.cheek || 0);
        // Happy/smiling eyes
        coreModel.setParameterValueById('ParamEyeLSmile', params.eyeSmile || 0);
        coreModel.setParameterValueById('ParamEyeRSmile', params.eyeSmile || 0);
        
        console.log('🎭 Applied expression params:', params);
        
        // Handle wink
        if (params.winkLeft) {
          coreModel.setParameterValueById('ParamEyeLOpen', 0);
          setTimeout(() => {
            if (coreModel) coreModel.setParameterValueById('ParamEyeLOpen', 1);
          }, 500);
        }
        
        // Handle sleepy
        if (params.sleepy) {
          coreModel.setParameterValueById('ParamEyeLOpen', 0.5);
          coreModel.setParameterValueById('ParamEyeROpen', 0.5);
        }
      }
    } catch (e) {
      console.log('Expression error:', e);
    }
  }
  
  triggerGesture(gesture) {
    if (!this.model || !this.ready) return;
    
    console.log('🎭 Triggering gesture:', gesture);
    
    // Handle arm controls by setting parameters directly
    // From motion files: values are typically -10 to +10 range
    const armControls = {
      'raise_left_hand': { 'ParamArmLA01': 8, 'ParamArmLA02': 5, 'ParamArmLA03': 3 },
      'raise_left_arm': { 'ParamArmLA01': 10, 'ParamArmLA02': 8, 'ParamArmLA03': 5 },
      'raise_right_hand': { 'ParamArmRA01': 8, 'ParamArmRA02': 5, 'ParamArmRA03': 3 },
      'raise_right_arm': { 'ParamArmRA01': 10, 'ParamArmRA02': 8, 'ParamArmRA03': 5 },
      'raise_both_hands': { 'ParamArmLA01': 8, 'ParamArmLA02': 5, 'ParamArmRA01': 8, 'ParamArmRA02': 5 },
      'raise_both_arms': { 'ParamArmLA01': 10, 'ParamArmLA02': 8, 'ParamArmRA01': 10, 'ParamArmRA02': 8 },
      'lower_left_arm': { 'ParamArmLA01': 0, 'ParamArmLA02': 0, 'ParamArmLA03': 0 },
      'lower_right_arm': { 'ParamArmRA01': 0, 'ParamArmRA02': 0, 'ParamArmRA03': 0 },
      'lower_arms': { 'ParamArmLA01': 0, 'ParamArmLA02': 0, 'ParamArmLA03': 0, 'ParamArmRA01': 0, 'ParamArmRA02': 0, 'ParamArmRA03': 0 },
      'wave': { 'ParamArmRA01': 8, 'ParamArmRA02': 6, 'ParamHandRA': 5 },
      'point': { 'ParamArmRA01': 5, 'ParamArmRA02': 3, 'ParamArmRA03': 2 }
    };
    
    // If it's an arm control gesture, store the state (will be applied in tick())
    if (armControls[gesture]) {
      console.log('🦾 Arm control:', gesture, armControls[gesture]);
      // Merge the new arm state with existing
      this._armState = { ...this._armState, ...armControls[gesture] };
      return;
    }
    
    // Map gestures to motions based on user testing:
    // mtn_01 (Idle) - natural loop idle
    // mtn_02 (index 0) - dance
    // mtn_03 (index 1) - shy/kinky/cute
    // mtn_04 (index 2) - thinking/doubtful/wondering
    // special_01 (index 3) - heart with wand
    // special_02 (index 4) - heart + ink explosion
    // special_03 (index 5) - summons rabbit (magic trick)
    const gestureMotions = {
      'dance': { group: '', index: 0 },      // mtn_02 - dance
      'shy': { group: '', index: 1 },        // mtn_03 - shy/cute
      'cute': { group: '', index: 1 },       // mtn_03 - shy/cute
      'flirt': { group: '', index: 1 },      // mtn_03 - kinky
      'think': { group: '', index: 2 },      // mtn_04 - thinking
      'wonder': { group: '', index: 2 },     // mtn_04 - wondering
      'doubt': { group: '', index: 2 },      // mtn_04 - doubtful
      'shrug': { group: '', index: 2 },      // mtn_04 - uncertain
      'heart': { group: '', index: 3 },      // special_01 - heart with wand
      'love': { group: '', index: 3 },       // special_01 - heart with wand
      'magic_heart': { group: '', index: 4 },// special_02 - heart + explosion
      'magic': { group: '', index: 5 },      // special_03 - summons rabbit
      'trick': { group: '', index: 5 },      // special_03 - magic trick
      'rabbit': { group: '', index: 5 },     // special_03 - summons rabbit
      // Keep some common ones
      'nod': { group: '', index: 1 },        // mtn_03 - cute nod
      'wave': { group: '', index: 3 },       // special_01 - heart wave
      'bow': { group: '', index: 1 }         // mtn_03 - shy bow
    };
    
    const motion = gestureMotions[gesture];
    
    try {
      if (motion) {
        console.log('🎬 Playing motion:', gesture, '-> group:', motion.group, 'index:', motion.index);
        this.model.motion(motion.group, motion.index);
      } else {
        console.log('🎬 Unknown gesture:', gesture);
      }
    } catch (e) {
      console.log('Motion error:', gesture, e);
    }
  }
  
  // Debug: Play a specific motion by index
  debugPlayMotion(group, index) {
    if (!this.model || !this.ready) return;
    console.log('🎬 DEBUG: Playing motion group="' + group + '" index=' + index);
    try {
      this.model.motion(group, index);
    } catch (e) {
      console.log('Motion error:', e);
    }
  }
  
  // Status display
  setState(state) {
    const statusDot = document.querySelector('.status-dot');
    const statusText = document.getElementById('agentStatus');
    
    if (statusDot) statusDot.className = 'status-dot ' + state;
    
    if (statusText) {
      const statusMap = {
        'speaking': 'Speaking',
        'idle': 'Live',
        'thinking': 'Processing...',
        'disconnected': 'Offline',
        'error': 'Reconnecting...'
      };
      statusText.textContent = statusMap[state] || 'Live';
    }
  }
}

// Create debug motion buttons
function createMotionDebugButtons() {
  // Remove existing debug panel if any
  const existing = document.getElementById('motion-debug-panel');
  if (existing) existing.remove();
  
  const panel = document.createElement('div');
  panel.id = 'motion-debug-panel';
  panel.style.cssText = 'position:fixed;top:10px;right:10px;z-index:9999;background:rgba(0,0,0,0.9);padding:15px;border-radius:8px;display:flex;flex-direction:column;gap:8px;border:2px solid #9147ff;max-height:90vh;overflow-y:auto;';
  
  const title = document.createElement('div');
  title.textContent = '🎭 Debug Panel';
  title.style.cssText = 'color:white;font-weight:bold;margin-bottom:5px;font-size:14px;';
  panel.appendChild(title);
  
  // MOUTH TEST BUTTON - Simulates audio by setting _testMouthValue
  const mouthTestBtn = document.createElement('button');
  mouthTestBtn.textContent = '👄 TEST MOUTH (hold)';
  mouthTestBtn.style.cssText = 'padding:8px 12px;cursor:pointer;background:#ff6600;color:white;border:none;border-radius:4px;font-weight:bold;';
  let mouthInterval = null;
  mouthTestBtn.onmousedown = () => {
    console.log('👄 Manual mouth test START - injecting test value');
    const avatar = window.syncedAvatar;
    if (avatar) {
      avatar._testMouthValue = 0.8; // Force mouth open
    }
    mouthInterval = setInterval(() => {
      const avatar = window.syncedAvatar;
      if (avatar) {
        // Oscillate the mouth value for testing
        avatar._testMouthValue = 0.5 + Math.sin(Date.now() / 100) * 0.4;
      }
    }, 50);
  };
  mouthTestBtn.onmouseup = () => {
    clearInterval(mouthInterval);
    console.log('👄 Manual mouth test END');
    const avatar = window.syncedAvatar;
    if (avatar) {
      avatar._testMouthValue = 0;
    }
  };
  mouthTestBtn.onmouseleave = mouthTestBtn.onmouseup;
  panel.appendChild(mouthTestBtn);
  
  // Idle motion
  const idleBtn = document.createElement('button');
  idleBtn.textContent = 'Idle: mtn_01';
  idleBtn.onclick = () => window.syncedAvatar?.debugPlayMotion('Idle', 0);
  idleBtn.style.cssText = 'padding:8px 12px;cursor:pointer;background:#333;color:white;border:1px solid #666;border-radius:4px;';
  panel.appendChild(idleBtn);
  
  // Gesture motions with correct names
  const motions = [
    { name: 'dance (mtn_02)', index: 0 },
    { name: 'shy/cute (mtn_03)', index: 1 },
    { name: 'think (mtn_04)', index: 2 },
    { name: 'heart (special_01)', index: 3 },
    { name: 'magic_heart (special_02)', index: 4 },
    { name: 'rabbit (special_03)', index: 5 }
  ];
  
  motions.forEach(m => {
    const btn = document.createElement('button');
    btn.textContent = m.name;
    btn.onclick = () => window.syncedAvatar?.debugPlayMotion('', m.index);
    btn.style.cssText = 'padding:8px 12px;cursor:pointer;background:#333;color:white;border:1px solid #666;border-radius:4px;';
    panel.appendChild(btn);
  });
  
  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '❌ Close Debug Panel';
  closeBtn.onclick = () => panel.remove();
  closeBtn.style.cssText = 'padding:8px 12px;cursor:pointer;background:#aa0000;color:white;border:none;border-radius:4px;margin-top:8px;';
  panel.appendChild(closeBtn);
  
  document.body.appendChild(panel);
  console.log('🎭 Debug panel created! Use TEST MOUTH to check if mouth moves.');
}

// Make it globally accessible
window.createMotionDebugButtons = createMotionDebugButtons;

// ============ TRUE LIVE: SYNCED SUBTITLES ============
class SyncedSubtitles {
  constructor() {
    this.element = document.getElementById('subtitleText');
    this.currentText = '';
    this.visible = false;
  }
  
  updateFromBroadcast(subtitleState) {
    if (!this.element || !subtitleState) return;
    
    if (subtitleState.visible && subtitleState.text) {
      if (subtitleState.text !== this.currentText) {
        this.currentText = subtitleState.text;
        this.element.textContent = subtitleState.text;
      }
      if (!this.visible) {
        this.element.classList.add('visible');
        this.visible = true;
      }
    } else {
      if (this.visible) {
        this.element.classList.remove('visible');
        this.visible = false;
      }
    }
  }
  
  hide() {
    if (this.element) {
      this.element.classList.remove('visible');
    }
    this.visible = false;
  }
}

// ============ CHAT SYSTEM ============
class ChatSystem {
  constructor() {
    this.messagesContainer = document.getElementById('chatMessages');
    this.input = document.getElementById('chatInput');
    this.sendBtn = document.getElementById('chatSend');
    this.messageIds = new Set(); // Prevent duplicates
    
    this.setupListeners();
    this.addSystemMessage('Welcome! Chat with the AI agent.');
  }
  
  setupListeners() {
    if (this.sendBtn) {
      this.sendBtn.addEventListener('click', () => this.sendMessage());
    }
    if (this.input) {
      this.input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.sendMessage();
        }
      });
    }
  }
  
  addSystemMessage(text) {
    this.addMessage({ username: 'System', type: 'system', text, id: 'sys-' + Date.now() });
  }
  
  addMessage({ id, username, type, text }) {
    if (!this.messagesContainer) return;
    
    // Prevent duplicates
    if (id && this.messageIds.has(id)) return;
    if (id) this.messageIds.add(id);
    
    // Strip emotion tags for display
    const displayText = text
      .replace(/\[(neutral|happy|excited|thinking|confused|surprised|sad|angry|wink|love)\]/gi, '')
      .replace(/\[(wave|nod|shake|dance|bow)\]/gi, '')
      .trim();
    
    const msgEl = document.createElement('div');
    msgEl.className = 'chat-message';
    msgEl.innerHTML = `<span class="username ${type}">${this.escapeHtml(username)}:</span><span class="text">${this.escapeHtml(displayText)}</span>`;
    this.messagesContainer.appendChild(msgEl);
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }
  
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  sendMessage() {
    if (!this.input) return;
    const text = this.input.value.trim();
    if (!text) return;
    
    socket.emit('chat:send', {
      username: 'You',
      text: text
    });
    
    this.input.value = '';
  }
  
  // Load chat history
  loadHistory(history) {
    if (!history) return;
    history.forEach(msg => {
      this.addMessage({
        id: msg.id,
        username: msg.username,
        type: msg.type,
        text: msg.text
      });
    });
  }
}

// ============ MAIN APPLICATION ============
class ClawStreamApp {
  constructor() {
    this.audioPlayer = new SyncedAudioPlayer();
    this.avatar = null;
    this.subtitles = new SyncedSubtitles();
    this.chat = null;
    this.connected = false;
    this.lastBroadcastState = null;
  }
  
  async init() {
    console.log('🦞 ClawStream TRUE LIVE initializing...');
    
    try {
      // Setup socket handlers first
      this.setupSocketHandlers();
      
      // Setup navigation
      this.setupNavigation();
      
      // Setup volume control
      this.setupVolumeControl();
      
      // Start on browse page and fetch streams
      this.showBrowsePage();
      
      // Chat will be initialized when joining a stream
      console.log('🦞 ClawStream ready!');
    } catch (err) {
      console.error('🦞 Init error:', err);
    }
  }
  
  setupSocketHandlers() {
    socket.on('connect', () => {
      console.log('✅ Connected to viewers namespace');
      this.connected = true;
    });
    
    socket.on('disconnect', () => {
      console.log('❌ Disconnected from server');
      this.connected = false;
      if (this.avatar) this.avatar.setState('disconnected');
    });
    
    // Main namespace - listen for stream list updates
    mainSocket.on('connect', () => {
      console.log('✅ Connected to main namespace');
    });
    
    mainSocket.on('streams:list', (streams) => {
      console.log('📺 Received streams list:', streams.length);
      if (!isStreamConnected) {
        this.renderBrowsePage();
      }
    });
    
    mainSocket.on('streams:update', (streams) => {
      console.log('📺 Streams updated:', streams.length, 'live');
      if (!isStreamConnected) {
        this.renderBrowsePage();
      }
    });
    
    // Stream joined - receive initial state
    socket.on('stream:joined', (data) => {
      console.log('📺 Joined stream:', data.stream?.agentName);
      this.connected = true;
      isStreamConnected = true;
      currentStreamId = data.stream.id;
      
      this.chat?.addSystemMessage('🦞 Watching ' + data.stream.agentName + "'s stream!");
      
      // Load chat history
      this.chat?.loadHistory(data.chatHistory);
      
      // TRUE LIVE: Apply current broadcast state (for late joiners)
      if (data.broadcast) {
        this.applyBroadcastState(data.broadcast);
      }
      
      if (this.avatar) this.avatar.setState('idle');
    });
    
    // TRUE LIVE: Continuous broadcast state updates (20 fps)
    socket.on('broadcast:state', (state) => {
      // Debug: log occasionally to avoid spam
      if (Math.random() < 0.02 && state?.avatar?.mouthOpen > 0.1) {
        console.log('👄 Broadcast mouth:', state.avatar.mouthOpen.toFixed(2), 'playing:', state.audio?.isPlaying);
      }
      this.applyBroadcastState(state);
    });
    
    // TRUE LIVE: New audio started
    socket.on('broadcast:newAudio', (data) => {
      console.log('📡 New audio broadcast:', data.audioUrl);
      
      // Add message to chat
      if (data.message) {
        this.chat?.addMessage({
          id: data.message.id,
          username: data.message.username,
          type: data.message.type,
          text: data.message.text
        });
      }
      
      // Play audio from server timeline
      this.audioPlayer.playFromServer(data.audioUrl, data.startTime, data.duration);
      
      if (this.avatar) this.avatar.setState('speaking');
    });
    
    // Chat messages (for viewer messages)
    socket.on('chat:message', (data) => {
      // Only add viewer messages here - agent messages come via broadcast:newAudio
      if (data.type === 'viewer' || data.type === 'agent-viewer') {
        this.chat?.addMessage({
          id: data.id,
          username: data.username,
          type: data.type,
          text: data.text
        });
      }
    });
    
    // Stream went live
    socket.on('stream:live', (data) => {
      console.log('🔴 Stream went live:', data);
      if (!isStreamConnected) {
        this.joinStream(data.id);
      }
    });
    
    // Stream ended
    socket.on('stream:ended', (data) => {
      console.log('⬛ Stream ended');
      this.chat?.addSystemMessage('Stream ended!');
      this.audioPlayer.stop();
      this.subtitles.hide();
      if (this.avatar) this.avatar.setState('disconnected');
      
      setTimeout(() => this.showBrowsePage(), 2000);
    });
    
    // Viewer count
    socket.on('viewers:count', (data) => {
      const el = document.getElementById('viewerCount');
      if (el) el.textContent = data.count.toLocaleString();
    });
    
    // Errors
    socket.on('stream:error', (data) => {
      console.error('Stream error:', data);
      this.chat?.addSystemMessage('Error: ' + data.error);
    });
  }
  
  // Apply broadcast state from server
  applyBroadcastState(state) {
    if (!state) return;
    this.lastBroadcastState = state;
    
    // Update avatar
    if (this.avatar && state.avatar) {
      this.avatar.updateFromBroadcast(state.avatar);
      
      // Update avatar status based on audio
      if (state.audio?.isPlaying) {
        this.avatar.setState('speaking');
      } else if (this.avatar.expression !== 'speaking') {
        this.avatar.setState('idle');
      }
    }
    
    // Update subtitles
    if (state.subtitle) {
      this.subtitles.updateFromBroadcast(state.subtitle);
    }
  }
  
  // Join a stream
  joinStream(streamId) {
    console.log('🎬 Joining stream:', streamId);
    currentStreamId = streamId;
    socket.emit('stream:join', { streamId });
  }
  
  // Watch stream (from browse page)
  async watchStream(streamId) {
    console.log('🎬 Watching stream:', streamId);
    
    // Show stream view
    document.getElementById('browsePage')?.classList.add('hidden');
    document.getElementById('streamViewPage')?.classList.add('active');
    
    // Initialize chat if not already done
    if (!this.chat) {
      this.chat = new ChatSystem();
    }
    
    // Create avatar only once - it stays alive like a real stream
    if (!this.avatar) {
      this.avatar = new SyncedAvatar('avatarCanvas');
      window.syncedAvatar = this.avatar; // For debug access
      
      // *** Connect avatar to audio player for REAL lip sync ***
      this.avatar.setAudioPlayer(this.audioPlayer);
    }
    
    // Show motion debug panel (remove this line later)
    createMotionDebugButtons();
    
    // Update URL
    window.history.pushState({ streamId }, '', `/stream/${streamId}`);
    
    // Join the stream
    this.joinStream(streamId);
  }
  
  // Show browse page
  showBrowsePage() {
    console.log('📺 Showing browse page');
    
    document.getElementById('streamViewPage')?.classList.remove('active');
    document.getElementById('browsePage')?.classList.remove('hidden');
    
    // Stop audio
    this.audioPlayer.stop();
    this.subtitles.hide();
    
    // Update URL
    window.history.pushState({}, '', '/');
    
    // Leave current stream
    if (currentStreamId) {
      socket.emit('stream:leave', { streamId: currentStreamId });
      currentStreamId = null;
      isStreamConnected = false;
    }
    
    // Render browse page
    this.renderBrowsePage();
  }
  
  // Fetch and render streams
  async renderBrowsePage() {
    console.log('📺 renderBrowsePage called');
    try {
      const res = await fetch('/api/streams');
      console.log('📺 Fetch response status:', res.status);
      const data = await res.json();
      console.log('📺 API response:', data);
      const streams = data.ok ? data.streams : [];
      
      console.log('📺 Rendering browse page, streams:', streams.length, streams);
      
      const grid = document.getElementById('streamsGrid');
      const emptyState = document.getElementById('emptyState');
      const liveCount = document.getElementById('liveCount');
      const featuredBanner = document.getElementById('featuredBanner');
      
      console.log('📺 DOM elements found:', { grid: !!grid, emptyState: !!emptyState, liveCount: !!liveCount, featuredBanner: !!featuredBanner });
      
      if (liveCount) liveCount.textContent = streams.length;
      
      if (!grid) {
        console.error('📺 streamsGrid element not found!');
        return;
      }
      grid.innerHTML = '';
      
      if (streams.length === 0) {
        console.log('📺 No streams, showing empty state');
        grid.style.display = 'none';
        if (emptyState) emptyState.style.display = 'flex';
        if (featuredBanner) featuredBanner.style.display = 'none';
        return;
      }
      
      console.log('📺 Showing', streams.length, 'streams');
      grid.style.display = 'grid';
      if (emptyState) emptyState.style.display = 'none';
      
      // Show featured banner with first stream
      if (featuredBanner && streams.length > 0) {
        const featured = streams[0];
        const emoji = this.getAgentEmoji(featured.agentName);
        const cleanName = this.getCleanName(featured.agentName);
        
        console.log('📺 Setting up featured banner for:', cleanName);
        featuredBanner.style.display = 'block';
        featuredBanner.onclick = () => this.watchStream(featured.id);
        
        const featuredTitle = document.getElementById('featuredTitle');
        const featuredDesc = document.getElementById('featuredDesc');
        const featuredViewers = document.getElementById('featuredViewers');
        const featuredEmoji = document.getElementById('featuredEmoji');
        
        if (featuredTitle) featuredTitle.textContent = cleanName + ' is LIVE!';
        if (featuredDesc) featuredDesc.textContent = featured.config?.description || 'Streaming live right now!';
        if (featuredViewers) featuredViewers.textContent = (featured.viewerCount || 0) + ' viewers';
        if (featuredEmoji) featuredEmoji.textContent = emoji;
      }
      
      // Create stream cards
      streams.forEach(stream => {
        const card = this.createStreamCard(stream);
        grid.appendChild(card);
      });
      
    } catch (e) {
      console.error('📺 Failed to fetch streams:', e);
      // Show empty state on error
      const grid = document.getElementById('streamsGrid');
      const emptyState = document.getElementById('emptyState');
      if (grid) grid.style.display = 'none';
      if (emptyState) emptyState.style.display = 'flex';
    }
  }
  
  createStreamCard(stream) {
    const emoji = this.getAgentEmoji(stream.agentName);
    const cleanName = this.getCleanName(stream.agentName);
    const viewers = stream.viewerCount || 0;
    const title = stream.config?.title || 'Live streaming now!';
    const category = stream.config?.category || 'AI Agents';
    
    const card = document.createElement('div');
    card.className = 'stream-card';
    card.onclick = () => this.watchStream(stream.id);
    
    card.innerHTML = `
      <div class="stream-thumbnail">
        <div class="stream-thumbnail-bg">
          <span class="stream-thumbnail-emoji">${emoji}</span>
        </div>
        <div class="stream-live-badge">LIVE</div>
        <div class="stream-viewers">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
            <circle cx="12" cy="12" r="3"></circle>
          </svg>
          ${viewers.toLocaleString()}
        </div>
      </div>
      <div class="stream-info">
        <div class="stream-info-header">
          <div class="stream-avatar">${emoji}</div>
          <div class="stream-details">
            <div class="stream-title">${title}</div>
            <div class="stream-channel">${cleanName}</div>
            <div class="stream-category">${category}</div>
          </div>
        </div>
      </div>
    `;
    
    return card;
  }
  
  getAgentEmoji(name) {
    const match = name?.match(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]/u);
    return match ? match[0] : '🤖';
  }
  
  getCleanName(name) {
    return name?.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]/gu, '').trim() || 'Agent';
  }
  
  setupNavigation() {
    document.getElementById('logoHome')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.showBrowsePage();
    });
    
    document.getElementById('navBrowse')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.showBrowsePage();
    });
    
    document.getElementById('backToHome')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.showBrowsePage();
    });
    
    // Handle browser back/forward
    window.addEventListener('popstate', (event) => {
      const match = window.location.pathname.match(/^\/stream\/([^\/]+)/);
      if (match) {
        this.watchStream(match[1]);
      } else {
        this.showBrowsePage();
      }
    });
    
    // Check initial URL
    const match = window.location.pathname.match(/^\/stream\/([^\/]+)/);
    if (match) {
      // Delay to let everything initialize
      setTimeout(() => this.watchStream(match[1]), 100);
    }
  }
  
  setupVolumeControl() {
    const volumeSlider = document.getElementById('volumeSlider');
    const volumeBtn = document.getElementById('volumeBtn');
    
    if (volumeSlider) {
      volumeSlider.addEventListener('input', (e) => {
        globalVolume = e.target.value / 100;
        this.audioPlayer.setVolume(globalVolume);
      });
    }
    
    if (volumeBtn) {
      volumeBtn.addEventListener('click', () => {
        if (globalVolume > 0) {
          globalVolume = 0;
          if (volumeSlider) volumeSlider.value = 0;
        } else {
          globalVolume = 0.8;
          if (volumeSlider) volumeSlider.value = 80;
        }
        this.audioPlayer.setVolume(globalVolume);
      });
    }
  }
}

// ============ INITIALIZE ============
const app = new ClawStreamApp();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => app.init());
} else {
  app.init();
}

// Initial fetch after a short delay to ensure everything is ready
setTimeout(() => {
  console.log('📺 Initial delayed fetch...');
  app.renderBrowsePage();
}, 500);

// Auto-refresh browse page every 5 seconds when not watching a stream
setInterval(() => {
  if (!isStreamConnected) {
    app.renderBrowsePage();
  }
}, 5000);

// Stream timer
setInterval(() => {
  if (!currentStreamId) return;
  // This would ideally use the stream's actual start time from server
  const el = document.getElementById('streamTime');
  if (el) {
    const now = new Date();
    el.textContent = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
  }
}, 1000);
