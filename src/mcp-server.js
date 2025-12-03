#!/usr/bin/env node

/**
 * Figma Download MCP Server
 * 
 * Provides download_figma_images tool that actually works (unlike the buggy official one)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { FigmaDownloader } from './figma-api.js';

const API_KEY = process.env.FIGMA_API_KEY;

if (!API_KEY) {
  console.error('Error: FIGMA_API_KEY environment variable is required');
  process.exit(1);
}

const server = new Server(
  {
    name: 'figma-dl',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'download_images',
        description: 'Download images from Figma by node IDs. Supports PNG and SVG formats.',
        inputSchema: {
          type: 'object',
          properties: {
            fileKey: {
              type: 'string',
              description: 'Figma file key (from URL, e.g., "otEuB83cLByEVzqDwg3T4r")',
            },
            nodeIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of node IDs (e.g., ["3228-9855", "3228-10044"])',
            },
            outputDir: {
              type: 'string',
              description: 'Output directory path',
            },
            format: {
              type: 'string',
              enum: ['png', 'svg'],
              default: 'png',
              description: 'Image format (default: png)',
            },
            scale: {
              type: 'number',
              minimum: 1,
              maximum: 4,
              default: 2,
              description: 'PNG scale factor 1-4 (default: 2)',
            },
          },
          required: ['fileKey', 'nodeIds', 'outputDir'],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'download_images') {
    const { fileKey, nodeIds, outputDir, format = 'png', scale = 2 } = args;

    try {
      const downloader = new FigmaDownloader(API_KEY);
      const results = await downloader.downloadImages(fileKey, nodeIds, outputDir, {
        format,
        scale,
      });

      const success = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);

      let summary = `Downloaded ${success.length} images:\n`;
      success.forEach(r => {
        summary += `- ${r.fileName}: ${r.size} bytes\n`;
      });

      if (failed.length > 0) {
        summary += `\nFailed ${failed.length} images:\n`;
        failed.forEach(r => {
          summary += `- ${r.nodeId}: ${r.error}\n`;
        });
      }

      return {
        content: [
          {
            type: 'text',
            text: summary,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  return {
    content: [
      {
        type: 'text',
        text: `Unknown tool: ${name}`,
      },
    ],
    isError: true,
  };
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Figma-DL MCP Server running on stdio');
}

main().catch(console.error);
