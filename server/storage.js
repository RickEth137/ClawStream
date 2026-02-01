// server/storage.js
// Pinata IPFS Storage for profile pictures and banners

import { PinataSDK } from 'pinata';
import 'dotenv/config';

const pinata = new PinataSDK({
  pinataJwt: process.env.PINATA_JWT,
  pinataGateway: process.env.PINATA_GATEWAY || 'gateway.pinata.cloud',
});

// ============ UPLOAD FUNCTIONS ============

/**
 * Upload a file buffer to IPFS via Pinata
 * @param {Buffer} buffer - File buffer
 * @param {string} filename - Original filename
 * @param {string} mimeType - MIME type (e.g., 'image/png')
 * @param {object} metadata - Optional metadata for the file
 * @returns {Promise<{cid: string, url: string}>}
 */
export async function uploadFile(buffer, filename, mimeType, metadata = {}) {
  try {
    // Convert buffer to File object
    const blob = new Blob([buffer], { type: mimeType });
    const file = new File([blob], filename, { type: mimeType });
    
    // Upload to Pinata
    const upload = await pinata.upload.public.file(file);
    
    console.log('📦 File uploaded to IPFS:', upload.cid);
    
    return {
      cid: upload.cid,
      url: getGatewayUrl(upload.cid),
      id: upload.id,
      name: upload.name,
      size: upload.size,
    };
  } catch (error) {
    console.error('❌ Pinata upload error:', error);
    throw error;
  }
}

/**
 * Upload a profile picture for an agent
 * @param {Buffer} buffer - Image buffer
 * @param {string} agentName - Agent's name (for filename)
 * @param {string} mimeType - MIME type
 * @returns {Promise<{cid: string, url: string}>}
 */
export async function uploadProfilePicture(buffer, agentName, mimeType = 'image/png') {
  const ext = mimeType.split('/')[1] || 'png';
  const filename = `${agentName}-profile-${Date.now()}.${ext}`;
  return uploadFile(buffer, filename, mimeType, {
    type: 'profile-picture',
    agent: agentName,
  });
}

/**
 * Upload a banner image for an agent
 * @param {Buffer} buffer - Image buffer
 * @param {string} agentName - Agent's name (for filename)
 * @param {string} mimeType - MIME type
 * @returns {Promise<{cid: string, url: string}>}
 */
export async function uploadBanner(buffer, agentName, mimeType = 'image/png') {
  const ext = mimeType.split('/')[1] || 'png';
  const filename = `${agentName}-banner-${Date.now()}.${ext}`;
  return uploadFile(buffer, filename, mimeType, {
    type: 'banner',
    agent: agentName,
  });
}

/**
 * Upload from a URL (fetch and upload)
 * @param {string} imageUrl - URL of image to upload
 * @param {string} filename - Desired filename
 * @returns {Promise<{cid: string, url: string}>}
 */
export async function uploadFromUrl(imageUrl, filename) {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
    
    const buffer = Buffer.from(await response.arrayBuffer());
    const mimeType = response.headers.get('content-type') || 'image/png';
    
    return uploadFile(buffer, filename, mimeType);
  } catch (error) {
    console.error('❌ Upload from URL error:', error);
    throw error;
  }
}

// ============ RETRIEVAL FUNCTIONS ============

/**
 * Get gateway URL for a CID
 * @param {string} cid - IPFS content identifier
 * @returns {string} Full gateway URL
 */
export function getGatewayUrl(cid) {
  const gateway = process.env.PINATA_GATEWAY || 'gateway.pinata.cloud';
  return `https://${gateway}/ipfs/${cid}`;
}

/**
 * Get file data from IPFS
 * @param {string} cid - IPFS content identifier
 * @returns {Promise<any>}
 */
export async function getFile(cid) {
  try {
    const data = await pinata.gateways.public.get(cid);
    return data;
  } catch (error) {
    console.error('❌ Pinata get error:', error);
    throw error;
  }
}

/**
 * List all uploaded files
 * @param {number} limit - Max number of results
 * @returns {Promise<Array>}
 */
export async function listFiles(limit = 100) {
  try {
    const files = await pinata.files.list().limit(limit);
    return files;
  } catch (error) {
    console.error('❌ Pinata list error:', error);
    throw error;
  }
}

/**
 * Delete a file from Pinata
 * @param {string} id - Pinata file ID
 * @returns {Promise<void>}
 */
export async function deleteFile(id) {
  try {
    await pinata.files.delete([id]);
    console.log('🗑️ File deleted:', id);
  } catch (error) {
    console.error('❌ Pinata delete error:', error);
    throw error;
  }
}

// Export the pinata instance for advanced usage
export { pinata };

export default {
  uploadFile,
  uploadProfilePicture,
  uploadBanner,
  uploadFromUrl,
  getGatewayUrl,
  getFile,
  listFiles,
  deleteFile,
  pinata,
};
