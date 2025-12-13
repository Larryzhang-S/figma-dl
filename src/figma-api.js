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
const REQUEST_INTERVAL = 1000; // 1 second between requests (more conservative)
const MAX_CONCURRENT = 2; // Max concurrent downloads (reduced to avoid 429)
const BATCH_SIZE = 5; // Max nodes per API request (reduced for safety)
const RATE_LIMIT_WINDOW = 60000; // 60 seconds
const RATE_LIMIT_MAX_REQUESTS = 30; // 30 requests per minute (conservative, Figma allows ~60)

// Sleep helper
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Token bucket rate limiter - prevents 429 by pre-checking quota
class RateLimiter {
  constructor(windowMs = RATE_LIMIT_WINDOW, maxRequests = RATE_LIMIT_MAX_REQUESTS) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.requests = [];
  }

  async acquire() {
    const now = Date.now();
    // Remove requests outside the window
    this.requests = this.requests.filter(timestamp => now - timestamp < this.windowMs);

    if (this.requests.length >= this.maxRequests) {
      // Calculate wait time until oldest request expires
      const oldestRequest = this.requests[0];
      const waitTime = this.windowMs - (now - oldestRequest) + 100;
      console.log(`[RATE] Quota exhausted (${this.requests.length}/${this.maxRequests}). Waiting ${Math.ceil(waitTime/1000)}s...`);
      await sleep(waitTime);
      return this.acquire(); // Recursive check
    }

    this.requests.push(now);
    console.log(`[RATE] Request quota: ${this.requests.length}/${this.maxRequests}`);
  }

  getRemaining() {
    const now = Date.now();
    this.requests = this.requests.filter(timestamp => now - timestamp < this.windowMs);
    return this.maxRequests - this.requests.length;
  }
}

// Request queue with rate limiting and concurrency control
class RequestQueue {
  constructor(concurrency = MAX_CONCURRENT, interval = REQUEST_INTERVAL) {
    this.concurrency = concurrency;
    this.interval = interval;
    this.running = 0;
    this.queue = [];
    this.lastRequestTime = 0;
    this.rateLimiter = new RateLimiter();
  }

  async add(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.process();
    });
  }

  async process() {
    if (this.running >= this.concurrency || this.queue.length === 0) return;

    const { fn, resolve, reject } = this.queue.shift();
    this.running++;

    try {
      // Pre-check rate limit quota
      await this.rateLimiter.acquire();

      // Ensure minimum interval between requests
      const now = Date.now();
      const elapsed = now - this.lastRequestTime;
      if (elapsed < this.interval) {
        await sleep(this.interval - elapsed);
      }
      this.lastRequestTime = Date.now();

      const result = await fn();
      resolve(result);
    } catch (error) {
      reject(error);
    } finally {
      this.running--;
      this.process();
    }
  }
}

export class FigmaDownloader {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.downloadQueue = new RequestQueue(MAX_CONCURRENT, REQUEST_INTERVAL);
    this.apiRateLimiter = new RateLimiter(); // Separate limiter for API calls
    this.rateLimitInfo = { remaining: null, resetTime: null };
    this.retryCount = 0; // Track consecutive retries
  }

  /**
   * Update rate limit info from response headers
   */
  updateRateLimitInfo(response) {
    const remaining = response.headers.get('x-ratelimit-remaining');
    const reset = response.headers.get('x-ratelimit-reset');
    if (remaining !== null) {
      this.rateLimitInfo.remaining = parseInt(remaining);
      console.log(`[RATE] Remaining requests: ${this.rateLimitInfo.remaining}`);
    }
    if (reset) {
      this.rateLimitInfo.resetTime = parseInt(reset) * 1000;
    }
  }

  /**
   * Fetch with exponential backoff retry for 429 errors
   * Implements best practices from Figma-Context-MCP error handling
   */
  async fetchWithRetry(url, options, retries = MAX_RETRIES) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      // Pre-check: if we've had recent 429s, wait proactively
      if (this.retryCount > 0) {
        const proactiveDelay = Math.min(this.retryCount * 2000, 10000);
        console.log(`[RATE] Proactive delay: ${proactiveDelay/1000}s (retry count: ${this.retryCount})`);
        await sleep(proactiveDelay);
      }

      const response = await fetch(url, options);
      
      if (response.status === 429) {
        this.retryCount++; // Increment global retry counter
        
        if (attempt === retries) {
          throw new Error(`Rate limit exceeded after ${retries} retries. Try again in a few minutes.`);
        }
        
        // Get retry-after header or use exponential backoff
        const retryAfter = response.headers.get('retry-after');
        let delay;
        
        if (retryAfter) {
          delay = parseInt(retryAfter) * 1000;
        } else {
          // Exponential backoff: 2s, 4s, 8s, 16s, 32s
          delay = INITIAL_DELAY * Math.pow(2, attempt);
        }
        
        // Add jitter to prevent thundering herd
        delay += Math.random() * 1000;
        
        console.log(`[WAIT] 429 Rate limited. Waiting ${Math.ceil(delay/1000)}s before retry ${attempt + 1}/${retries}...`);
        await sleep(delay);
        continue;
      }
      
      // Success - decrease retry counter gradually
      if (this.retryCount > 0) {
        this.retryCount = Math.max(0, this.retryCount - 1);
      }
      
      // Update rate limit tracking from headers
      this.updateRateLimitInfo(response);
      
      return response;
    }
  }

  /**
   * Get image URLs with batch support to avoid rate limits
   */
  async getImageUrls(fileKey, nodeIds, format = 'png', scale = 2) {
    // Convert nodeIds format: "3228-9855" -> "3228:9855"
    const formattedIds = nodeIds.map(id => id.replace(/-/g, ':'));
    
    // Split into batches to avoid rate limits
    const batches = [];
    for (let i = 0; i < formattedIds.length; i += BATCH_SIZE) {
      batches.push(formattedIds.slice(i, i + BATCH_SIZE));
    }

    console.log(`[INFO] Processing ${formattedIds.length} nodes in ${batches.length} batch(es)`);
    
    let allImages = {};
    
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      
      if (batches.length > 1) {
        console.log(`[INFO] Batch ${i + 1}/${batches.length}: ${batch.length} nodes`);
      }
      
      const params = new URLSearchParams({
        ids: batch.join(','),
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

      allImages = { ...allImages, ...data.images };
      
      // Add longer delay between batches to respect rate limits
      if (i < batches.length - 1) {
        const batchDelay = REQUEST_INTERVAL * 2; // Double delay between batches
        console.log(`[WAIT] Waiting ${batchDelay/1000}s before next batch...`);
        await sleep(batchDelay);
      }
    }

    return allImages;
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

      console.log(`[...] Queuing: ${nodeId} -> ${fileName}`);

      // Use queue for controlled concurrent downloads
      const downloadTask = this.downloadQueue.add(async () => {
        try {
          const response = await this.fetchWithRetry(imageUrl, {});
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const fileStream = fs.createWriteStream(filePath);
          await pipeline(Readable.fromWeb(response.body), fileStream);
          
          const stats = fs.statSync(filePath);
          console.log(`[OK] Done: ${fileName} (${stats.size} bytes)`);
          
          return {
            nodeId,
            success: true,
            fileName,
            filePath,
            size: stats.size,
          };
        } catch (error) {
          console.log(`[FAIL] Download failed: ${nodeId} - ${error.message}`);
          return { nodeId, success: false, error: error.message };
        }
      });
      
      results.push(downloadTask);
    }
    
    // Wait for all downloads to complete
    const finalResults = await Promise.all(results);

    return finalResults;
  }
}

export default FigmaDownloader;
