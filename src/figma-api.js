/**
 * Figma API wrapper for downloading images
 */

import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

const FIGMA_API_BASE = 'https://api.figma.com/v1';
const MAX_RETRIES = 5;
const INITIAL_DELAY = 2000; // 2 seconds

// Sleep helper
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export class FigmaDownloader {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  /**
   * Fetch with exponential backoff retry for 429 errors
   */
  async fetchWithRetry(url, options, retries = MAX_RETRIES) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const response = await fetch(url, options);
      
      if (response.status === 429) {
        if (attempt === retries) {
          throw new Error(`Rate limit exceeded after ${retries} retries`);
        }
        
        // Get retry-after header or use exponential backoff
        const retryAfter = response.headers.get('retry-after');
        const delay = retryAfter 
          ? parseInt(retryAfter) * 1000 
          : INITIAL_DELAY * Math.pow(2, attempt);
        
        console.log(`[WAIT] Rate limited. Waiting ${delay/1000}s before retry ${attempt + 1}/${retries}...`);
        await sleep(delay);
        continue;
      }
      
      return response;
    }
  }

  async getImageUrls(fileKey, nodeIds, format = 'png', scale = 2) {
    // Convert nodeIds format: "3228-9855" -> "3228:9855"
    const formattedIds = nodeIds.map(id => id.replace(/-/g, ':'));
    
    const params = new URLSearchParams({
      ids: formattedIds.join(','),
      format: format,
    });
    
    if (format === 'png') {
      params.append('scale', scale.toString());
    }

    const url = `${FIGMA_API_BASE}/images/${fileKey}?${params}`;
    
    const response = await this.fetchWithRetry(url, {
      headers: {
        'X-Figma-Token': this.apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`Figma API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.err) {
      throw new Error(`Figma API error: ${data.err}`);
    }

    return data.images;
  }

  async downloadImages(fileKey, nodeIds, outputDir, options = {}) {
    const { format = 'png', scale = 2 } = options;
    
    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    console.log(`[INFO] Fetching image URLs from Figma...`);
    const imageUrls = await this.getImageUrls(fileKey, nodeIds, format, scale);
    
    const results = [];
    
    for (const [nodeId, imageUrl] of Object.entries(imageUrls)) {
      if (!imageUrl) {
        console.log(`[FAIL] Node ${nodeId} cannot be exported`);
        results.push({ nodeId, success: false, error: 'Cannot export' });
        continue;
      }

      const safeNodeId = nodeId.replace(/:/g, '_');
      const fileName = `${safeNodeId}.${format}`;
      const filePath = path.join(outputDir, fileName);

      console.log(`[...] Downloading: ${nodeId} -> ${fileName}`);

      try {
        const response = await fetch(imageUrl);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const fileStream = fs.createWriteStream(filePath);
        await pipeline(Readable.fromWeb(response.body), fileStream);
        
        const stats = fs.statSync(filePath);
        console.log(`[OK] Done: ${fileName} (${stats.size} bytes)`);
        
        results.push({
          nodeId,
          success: true,
          fileName,
          filePath,
          size: stats.size,
        });
      } catch (error) {
        console.log(`[FAIL] Download failed: ${nodeId} - ${error.message}`);
        results.push({ nodeId, success: false, error: error.message });
      }
    }

    return results;
  }
}

export default FigmaDownloader;
