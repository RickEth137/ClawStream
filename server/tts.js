import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize ElevenLabs client with the actual API key
const elevenlabs = new ElevenLabsClient({
  apiKey: 'sk_a2a6014fd846346e449e3efad9fec52085f7037e7c48ca9f'
});

// Voice ID for "Lulu Lolipop - High-Pitched and Bubbly"
// We'll fetch the actual voice ID on startup
let VOICE_ID = null;

// Create temp directory for audio files
export const TEMP_DIR = path.join(os.tmpdir(), 'clawstream-tts');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

console.log(`📁 TTS temp directory: ${TEMP_DIR}`);

// Find the Lulu Lolipop voice
async function findVoice() {
  try {
    console.log('🔍 Searching for Lulu Lolipop voice...');
    const response = await elevenlabs.voices.getAll();
    
    // Handle different response structures
    const voices = response.voices || response;
    
    // Search for Lulu voice
    const luluVoice = voices.find(v => 
      v.name && (v.name.toLowerCase().includes('lulu') || 
      v.name.toLowerCase().includes('lolipop'))
    );
    
    if (luluVoice) {
      // Try different property names for voice ID
      VOICE_ID = luluVoice.voice_id || luluVoice.voiceId || luluVoice.id;
      console.log(`✅ Found Lulu voice: ${luluVoice.name} (ID: ${VOICE_ID})`);
    } else {
      // List available voices for debugging
      console.log('Available voices:');
      voices.slice(0, 15).forEach(v => {
        const id = v.voice_id || v.voiceId || v.id;
        console.log(`  - ${v.name}: ${id}`);
      });
      
      // Use first available voice
      const fallback = voices[0];
      VOICE_ID = fallback.voice_id || fallback.voiceId || fallback.id;
      console.log(`⚠️ Lulu not found, using: ${fallback.name} (${VOICE_ID})`);
    }
  } catch (error) {
    console.error('❌ Error fetching voices:', error.message);
    // Fallback to a known voice ID (Rachel)
    VOICE_ID = '21m00Tcm4TlvDq8ikWAM';
    console.log(`⚠️ Using fallback voice ID: ${VOICE_ID}`);
  }
}

// Initialize voice on module load
findVoice();

// Export the temp directory for serving files
export const TTS_TEMP_DIR = TEMP_DIR;

/**
 * Generate speech from text using ElevenLabs
 * @param {string} text - The text to convert to speech
 * @returns {Promise<string>} - URL path to the generated audio file (relative to server)
 */
export async function generateSpeech(text) {
  if (!text || text.trim().length === 0) {
    throw new Error('No text provided for TTS');
  }

  // Wait for voice to be loaded
  let attempts = 0;
  while (!VOICE_ID && attempts < 10) {
    await new Promise(r => setTimeout(r, 500));
    attempts++;
  }
  
  if (!VOICE_ID) {
    VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // Rachel fallback
  }

  try {
    console.log(`🎤 Generating TTS for: "${text.slice(0, 50)}..."`);
    console.log(`🎤 Using voice ID: ${VOICE_ID}`);
    
    // Generate audio using ElevenLabs convert method with optimized settings
    const audio = await elevenlabs.textToSpeech.convert(VOICE_ID, {
      text: text,
      modelId: 'eleven_turbo_v2_5',  // Fastest model available
      outputFormat: 'mp3_44100_64',   // Lower quality = faster generation
      voiceSettings: {
        stability: 0.4,
        similarityBoost: 0.85,
        style: 0.5,              // Reduced style for speed
        useSpeakerBoost: false   // Disable for speed
      }
    });

    // Create unique filename
    const filename = `voice-${Date.now()}.mp3`;
    const filepath = path.join(TEMP_DIR, filename);

    // Write audio to file - audio is an async iterator
    const chunks = [];
    for await (const chunk of audio) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    fs.writeFileSync(filepath, buffer);

    console.log(`✅ TTS generated: ${filepath}`);
    
    // Return just the filename - server will serve from /tts/
    return `/tts/${filename}`;

  } catch (error) {
    console.error('❌ ElevenLabs TTS error:', error);
    throw error;
  }
}

/**
 * Clean up old audio files (older than 5 minutes)
 */
export function cleanupOldFiles() {
  try {
    if (!fs.existsSync(TEMP_DIR)) return;

    const files = fs.readdirSync(TEMP_DIR);
    const now = Date.now();
    const maxAge = 5 * 60 * 1000; // 5 minutes

    files.forEach(file => {
      const filepath = path.join(TEMP_DIR, file);
      const stats = fs.statSync(filepath);
      
      if (now - stats.mtimeMs > maxAge) {
        fs.unlinkSync(filepath);
        console.log(`🗑️ Cleaned up old TTS file: ${file}`);
      }
    });
  } catch (error) {
    console.error('Error cleaning up TTS files:', error);
  }
}

// Clean up old files every 2 minutes
setInterval(cleanupOldFiles, 2 * 60 * 1000);

// Clean up on process exit
process.on('exit', () => {
  try {
    if (fs.existsSync(TEMP_DIR)) {
      fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    }
  } catch (e) {
    // Ignore cleanup errors
  }
});
