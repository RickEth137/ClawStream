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
let VOICE_ID = null;

// Create temp directory for audio files
export const TEMP_DIR = path.join(os.tmpdir(), 'lobster-tts');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

console.log(`📁 TTS temp directory: ${TEMP_DIR}`);

// Find the Lulu Lolipop voice
async function findVoice() {
  try {
    console.log('🔍 Searching for Lulu Lolipop voice...');
    const response = await elevenlabs.voices.getAll();
    const voices = response.voices || response;

    const luluVoice = voices.find(v =>
      v.name && (v.name.toLowerCase().includes('lulu') ||
      v.name.toLowerCase().includes('lolipop'))
    );

    if (luluVoice) {
      VOICE_ID = luluVoice.voice_id || luluVoice.voiceId || luluVoice.id;
      console.log(`✅ Found Lulu voice: ${luluVoice.name} (ID: ${VOICE_ID})`);
    } else {
      const fallback = voices[0];
      VOICE_ID = fallback.voice_id || fallback.voiceId || fallback.id;
      console.log(`⚠️ Lulu not found, using: ${fallback.name} (${VOICE_ID})`);
    }
  } catch (error) {
    console.error('❌ Error fetching voices:', error.message);
    VOICE_ID = '21m00Tcm4TlvDq8ikWAM';
    console.log(`⚠️ Using fallback voice ID: ${VOICE_ID}`);
  }
}

findVoice();

export const TTS_TEMP_DIR = TEMP_DIR;

/**
 * Convert numbers to words for better TTS pronunciation
 */
const ones = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
              'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 
              'seventeen', 'eighteen', 'nineteen'];
const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function numberToWords(num) {
  if (num === 0) return 'zero';
  if (num < 0) return 'negative ' + numberToWords(-num);
  
  // Handle decimals
  if (num % 1 !== 0) {
    const parts = num.toString().split('.');
    const intPart = parseInt(parts[0]);
    const decPart = parts[1];
    
    // For prices like $0.00001234, say "zero point zero zero zero zero one two three four"
    if (intPart === 0 && decPart) {
      let result = 'zero point ';
      for (const digit of decPart) {
        result += ones[parseInt(digit)] || 'zero';
        result += ' ';
      }
      return result.trim();
    }
    
    // For normal decimals like 2.5, say "two point five"
    return numberToWords(intPart) + ' point ' + decPart.split('').map(d => ones[parseInt(d)] || 'zero').join(' ');
  }
  
  num = Math.floor(num);
  
  if (num < 20) return ones[num];
  if (num < 100) return tens[Math.floor(num / 10)] + (num % 10 ? ' ' + ones[num % 10] : '');
  if (num < 1000) return ones[Math.floor(num / 100)] + ' hundred' + (num % 100 ? ' ' + numberToWords(num % 100) : '');
  if (num < 1000000) return numberToWords(Math.floor(num / 1000)) + ' thousand' + (num % 1000 ? ' ' + numberToWords(num % 1000) : '');
  if (num < 1000000000) return numberToWords(Math.floor(num / 1000000)) + ' million' + (num % 1000000 ? ' ' + numberToWords(num % 1000000) : '');
  if (num < 1000000000000) return numberToWords(Math.floor(num / 1000000000)) + ' billion' + (num % 1000000000 ? ' ' + numberToWords(num % 1000000000) : '');
  return numberToWords(Math.floor(num / 1000000000000)) + ' trillion' + (num % 1000000000000 ? ' ' + numberToWords(num % 1000000000000) : '');
}

function convertNumbersToWords(text) {
  // Handle currency with $ first (e.g., $97,234.56 or $0.00001234)
  text = text.replace(/\$([0-9,]+\.?[0-9]*)/g, (match, num) => {
    const cleanNum = parseFloat(num.replace(/,/g, ''));
    if (isNaN(cleanNum)) return match;
    return numberToWords(cleanNum) + ' dollars';
  });
  
  // Handle percentages (e.g., 2.34% or +5.67%)
  text = text.replace(/([+-])?([0-9]+\.?[0-9]*)%/g, (match, sign, num) => {
    const cleanNum = parseFloat(num);
    if (isNaN(cleanNum)) return match;
    const prefix = sign === '+' ? 'plus ' : sign === '-' ? 'minus ' : '';
    return prefix + numberToWords(cleanNum) + ' percent';
  });
  
  // Handle K/M/B suffixes (e.g., 97K, 5.2M, 1.5B)
  text = text.replace(/([0-9]+\.?[0-9]*)\s*([KMBkmb])\b/g, (match, num, suffix) => {
    const cleanNum = parseFloat(num);
    if (isNaN(cleanNum)) return match;
    const suffixWord = { 'k': ' thousand', 'K': ' thousand', 'm': ' million', 'M': ' million', 'b': ' billion', 'B': ' billion' };
    return numberToWords(cleanNum) + (suffixWord[suffix] || '');
  });
  
  // Handle remaining standalone numbers with commas (e.g., 1,000,000)
  text = text.replace(/\b([0-9]{1,3}(?:,[0-9]{3})+)\b/g, (match) => {
    const cleanNum = parseInt(match.replace(/,/g, ''));
    if (isNaN(cleanNum)) return match;
    return numberToWords(cleanNum);
  });
  
  // Handle remaining standalone numbers (but not things like "24h" or dates)
  text = text.replace(/\b([0-9]+\.?[0-9]*)\b(?![hms%])/g, (match, num) => {
    // Don't convert very long numbers that might be addresses/IDs
    if (match.length > 12) return match;
    const cleanNum = parseFloat(num);
    if (isNaN(cleanNum)) return match;
    return numberToWords(cleanNum);
  });
  
  return text;
}

/**
 * Strip avatar control tags from text for TTS
 * Removes things like [happy], [wave], [raise_left_hand], [gif:...], [youtube:...], etc.
 */
function stripTagsForTTS(text) {
  // Remove all [tag] patterns - emotions, actions, effects, etc.
  return text
    // Emotions
    .replace(/\[(neutral|happy|excited|sad|angry|surprised|thinking|confused|wink|love|smug|sleepy)\]/gi, '')
    // Gestures and actions (COMPLETE list!)
    .replace(/\[(wave|nod|shake|dance|bow|shrug|point|think|wonder|doubt|shy|cute|flirt|heart|love|magic_heart|magic|trick|rabbit)\]/gi, '')
    // Arm controls
    .replace(/\[(raise_left_hand|raise_right_hand|raise_left_arm|raise_right_arm|raise_both_hands|raise_both_arms|lower_left_arm|lower_right_arm|lower_arms)\]/gi, '')
    // Eye/look direction
    .replace(/\[(look_left|look_right|look_up|look_down)\]/gi, '')
    // Special effects
    .replace(/\[(hearts|magic|explosion|aura)\]/gi, '')
    // GIF tags [gif:search] or [gif:search:position] or [gif:search:position:duration]
    .replace(/\[gif:[^\]]+\]/gi, '')
    // YouTube tags [youtube:search term]
    .replace(/\[youtube:[^\]]+\]/gi, '')
    // Catch any remaining [tags] we might have missed
    .replace(/\[[a-z_]+\]/gi, '')
    .replace(/\s+/g, ' ')  // Collapse multiple spaces
    .trim();
}

/**
 * Generate speech from text using ElevenLabs
 */
export async function generateSpeech(text) {
  if (!text || text.trim().length === 0) {
    throw new Error('No text provided for TTS');
  }

  // Strip avatar tags before TTS!
  let cleanText = stripTagsForTTS(text);
  
  // Convert numbers to words for better pronunciation
  cleanText = convertNumbersToWords(cleanText);
  
  if (!cleanText || cleanText.length === 0) {
    throw new Error('No speakable text after stripping tags');
  }

  // Wait for voice to be loaded
  let attempts = 0;
  while (!VOICE_ID && attempts < 10) {
    await new Promise(r => setTimeout(r, 500));
    attempts++;
  }

  if (!VOICE_ID) {
    VOICE_ID = '21m00Tcm4TlvDq8ikWAM';
  }

  try {
    console.log(`🎤 TTS (clean): "${cleanText.slice(0, 50)}..."`);

    const audio = await elevenlabs.textToSpeech.convert(VOICE_ID, {
      text: cleanText,
      modelId: 'eleven_turbo_v2_5',
      outputFormat: 'mp3_44100_64',
      voiceSettings: {
        stability: 0.4,
        similarityBoost: 0.85,
        style: 0.5,
        useSpeakerBoost: false
      }
    });

    const filename = `voice-${Date.now()}.mp3`;
    const filepath = path.join(TEMP_DIR, filename);

    const chunks = [];
    for await (const chunk of audio) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    fs.writeFileSync(filepath, buffer);

    console.log(`✅ TTS generated: ${filepath}`);
    return `/tts/${filename}`;

  } catch (error) {
    console.error('❌ ElevenLabs TTS error:', error);
    throw error;
  }
}

export function cleanupOldFiles() {
  try {
    if (!fs.existsSync(TEMP_DIR)) return;
    const files = fs.readdirSync(TEMP_DIR);
    const now = Date.now();
    const maxAge = 5 * 60 * 1000;

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

setInterval(cleanupOldFiles, 2 * 60 * 1000);

process.on('exit', () => {
  try {
    if (fs.existsSync(TEMP_DIR)) {
      fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    }
  } catch (e) {}
});
