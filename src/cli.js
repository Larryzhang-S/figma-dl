#!/usr/bin/env node

/**
 * Figma Image Downloader CLI
 * 
 * Usage:
 *   figma-dl -f <fileKey> -n <nodeIds> -o <outputDir> [options]
 * 
 * Examples:
 *   figma-dl -f otEuB83cLByEVzqDwg3T4r -n "3228-9855,3228-10044" -o ./images
 *   figma-dl -f otEuB83cLByEVzqDwg3T4r -n "3228-9855" -o ./images --format svg
 */

import { Command } from 'commander';
import { FigmaDownloader } from './figma-api.js';

const program = new Command();

program
  .name('figma-dl')
  .description('Figma image downloader - bypass MCP bugs')
  .version('1.0.0')
  .requiredOption('-f, --file-key <key>', 'Figma file key (from URL)')
  .requiredOption('-n, --node-ids <ids>', 'Node IDs, comma separated (e.g., "3228-9855,3228-10044")')
  .requiredOption('-o, --output <dir>', 'Output directory')
  .option('--format <format>', 'Image format: png or svg', 'png')
  .option('--scale <scale>', 'PNG scale: 1-4', '2')
  .option('--api-key <key>', 'Figma API key (or set FIGMA_API_KEY env var)')
  .action(async (options) => {
    console.log('');
    console.log('========== Figma Image Downloader ==========');
    console.log(`[INFO] FileKey: ${options.fileKey}`);
    console.log(`[INFO] NodeIds: ${options.nodeIds}`);
    console.log(`[INFO] Format: ${options.format} (Scale: ${options.scale}x)`);
    console.log(`[INFO] Output: ${options.output}`);
    console.log('');

    const apiKey = options.apiKey || process.env.FIGMA_API_KEY;
    
    if (!apiKey) {
      console.error('[ERROR] No API key provided. Use --api-key or set FIGMA_API_KEY env var');
      process.exit(1);
    }

    const downloader = new FigmaDownloader(apiKey);
    const nodeIds = options.nodeIds.split(',').map(id => id.trim());

    try {
      const results = await downloader.downloadImages(
        options.fileKey,
        nodeIds,
        options.output,
        {
          format: options.format,
          scale: parseInt(options.scale, 10),
        }
      );

      console.log('');
      console.log('========== Download Complete ==========');
      
      const success = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;
      
      console.log(`[OK] Success: ${success}`);
      if (failed > 0) {
        console.log(`[FAIL] Failed: ${failed}`);
      }
      console.log('');
      
      process.exit(failed > 0 ? 1 : 0);
    } catch (error) {
      console.error(`[ERROR] ${error.message}`);
      process.exit(1);
    }
  });

program.parse();
