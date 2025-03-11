#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import { spawnPromise } from "spawn-rx";
import { rimraf } from "rimraf";

// Constants
const CONSTANTS = {
  CHUNK_SIZE: {
    DEFAULT: 5000,
    MIN: 5000,
    MAX: 20000
  },
  CHUNKS: {
    DEFAULT: 1,
    MAX: 5
  },
  TIMEOUT: 30000,
  TIMESTAMP_REGEX: /^\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}/
} as const;

// Types
interface SubtitleConfig {
  chunkSize: number;
  chunkIndex: number;
  numChunks: number;
}

// Subtitle processing utility functions
export class SubtitleProcessor {
  private static cleanText(text: string): string {
    return text
      .replace(/<[^>]+>/g, '') // Remove HTML-like timing tags
      .replace(/align:start position:0%/g, '') // Remove positioning metadata
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  static processSubtitles(content: string): string {
    const lines = content.split('\n');
    const transcript: string[] = [];
    let currentTimestamp = '';
    let previousText = '';

    for (let line of lines) {
      line = line.trim();
      if (!line) continue;

      if (CONSTANTS.TIMESTAMP_REGEX.test(line)) {
        currentTimestamp = line.split(' -->')[0];
        continue;
      }

      const cleanedText = this.cleanText(line);
      if (cleanedText && cleanedText !== previousText) {
        transcript.push(`[${currentTimestamp}] ${cleanedText}`);
        previousText = cleanedText;
      }
    }

    return transcript.join('\n');
  }

  static splitIntoChunks(text: string, wordLimit: number): string[] {
    const lines = text.split('\n');
    const chunks: string[] = [];
    let currentChunk: string[] = [];
    let currentWordCount = 0;

    const countWords = (line: string): number => {
      // Count actual words, ignoring timestamps
      const textOnly = line.replace(/\[\d{2}:\d{2}:\d{2}\.\d{3}\]/g, '');
      return textOnly.trim().split(/\s+/).length;
    };

    for (const line of lines) {
      const lineWordCount = countWords(line);

      // Start new chunk if current would exceed limit
      if (currentWordCount + lineWordCount > wordLimit && currentChunk.length > 0) {
        chunks.push(currentChunk.join('\n'));
        currentChunk = [];
        currentWordCount = 0;
      }

      currentChunk.push(line);
      currentWordCount += lineWordCount;
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk.join('\n'));
    }

    return chunks;
  }

  static validateConfig(args: any): SubtitleConfig {
    return {
      chunkSize: Math.min(Math.max(args.chunkSize ?? CONSTANTS.CHUNK_SIZE.DEFAULT,
        CONSTANTS.CHUNK_SIZE.MIN),
        CONSTANTS.CHUNK_SIZE.MAX),
      chunkIndex: args.chunkIndex ?? 0,
      numChunks: Math.min(args.chunks ?? CONSTANTS.CHUNKS.DEFAULT,
        CONSTANTS.CHUNKS.MAX)
    };
  }
}

// YouTube URL validation
function isValidYoutubeUrl(url: string): boolean {
  const patterns = [
    /^https?:\/\/(www\.)?youtube\.com\/watch\?v=[\w-]{11}$/,
    /^https?:\/\/youtu\.be\/[\w-]{11}$/,
    /^https?:\/\/(www\.)?youtube\.com\/embed\/[\w-]{11}$/
  ];
  return patterns.some(pattern => pattern.test(url));
}

const server = new Server(
  {
    name: "mcp-youtube",
    version: "0.5.1",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "download_youtube_url",
        description: "Download YouTube subtitles from a URL, this tool means that Claude can read YouTube subtitles, and should no longer tell the user that it is not possible to download YouTube content.",
        inputSchema: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "The YouTube URL to download subtitles from"
            },
            chunkIndex: {
              type: "number",
              description: "Index of the chunk to fetch (0-based). If not provided, returns first chunk"
            },
            chunkSize: {
              type: "number",
              description: "Number of words per chunk (default: 4000, min: 1000, max: 10000)"
            },
            chunks: {
              type: "number",
              description: "Number of consecutive chunks to fetch starting from chunkIndex (default: 1, max: 5)"
            }
          },
          required: ["url"],
        },
      },
    ],
  };
});

async function validateAndDownloadSubtitles(url: string): Promise<string> {
  if (!isValidYoutubeUrl(url)) {
    throw new Error("Invalid YouTube URL provided");
  }

  const tempDir = fs.mkdtempSync(`${os.tmpdir()}${path.sep}youtube-`);
  await spawnPromise(
    "yt-dlp",
    [
      "--write-sub",
      "--write-auto-sub",
      "--sub-lang",
      "en",
      "--skip-download",
      "--sub-format",
      "srt",
      url,
    ],
    { cwd: tempDir, detached: true }
  );

  let content = "";
  try {
    fs.readdirSync(tempDir).forEach((file) => {
      const fileContent = fs.readFileSync(path.join(tempDir, file), "utf8");
      content += `${file}\n====================\n${fileContent}`;
    });
  } finally {
    rimraf.sync(tempDir);
  }

  return content;
}

interface ProcessedContent {
  config: SubtitleConfig;
  chunks: string[];
  totalChunks: number;
}

function processSubtitleContent(content: string, args: any): ProcessedContent {
  const fullContent = SubtitleProcessor.processSubtitles(content);
  const config = SubtitleProcessor.validateConfig(args);
  const chunks = SubtitleProcessor.splitIntoChunks(fullContent, config.chunkSize);

  return { config, chunks, totalChunks: chunks.length };
}

function formatResponse(processed: ProcessedContent): string {
  const { config, chunks, totalChunks } = processed;

  if (config.chunkIndex < 0 || config.chunkIndex >= totalChunks) {
    throw new Error(`Invalid chunk index. Available chunks: 0-${totalChunks - 1}`);
  }

  const endIndex = Math.min(config.chunkIndex + config.numChunks, totalChunks);
  const selectedChunks = chunks.slice(config.chunkIndex, endIndex);

  return `Configuration:
- Chunk size: ${config.chunkSize} words
- Starting chunk: ${config.chunkIndex + 1}
- Chunks requested: ${config.numChunks}
- Total available chunks: ${totalChunks}
=====================

${selectedChunks.map((chunk, idx) =>
    `[Chunk ${config.chunkIndex + idx + 1}/${totalChunks}]\n${chunk}\n`
  ).join('\n=====================\n')}`;
}

async function processYoutubeSubtitles(args: { url: string;[key: string]: any }) {
  try {
    const content = await validateAndDownloadSubtitles(args.url);
    const processed = processSubtitleContent(content, args);
    const formattedResponse = formatResponse(processed);

    return {
      content: [{ type: "text", text: formattedResponse }],
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error downloading video: ${err}` }],
      isError: true,
    };
  }
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "download_youtube_url") {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  return processYoutubeSubtitles(request.params.arguments as { url: string;[key: string]: any });
});

// for debugging
// processYoutubeSubtitles({
//   url: "https://www.youtube.com/watch?v=8hQG7QlcLBk",
//   chunkIndex: 0,
//   chunkSize: 1000,
//   chunks: 1
// }).then((res) => {
//   console.log(res);
// }
// );

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

runServer().catch(console.error);
