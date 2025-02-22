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
            url: { type: "string", description: "URL of the YouTube video" },
          },
          required: ["url"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "download_youtube_url") {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  try {
    const { url } = request.params.arguments as { url: string };

    // Validate YouTube URL
    if (!isValidYoutubeUrl(url)) {
      return {
        content: [{ type: "text", text: "Invalid YouTube URL provided" }],
        isError: true
      };
    }

    const tempDir = fs.mkdtempSync(`${os.tmpdir()}${path.sep}youtube-`);
    // Add timeout wrapper around spawnPromise
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Process timeout after 30 seconds')), 30000);
    });

    await Promise.race([
      spawnPromise(
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
        { cwd: tempDir }
      ),
      timeoutPromise
    ]);

    let content = "";
    try {
      fs.readdirSync(tempDir).forEach((file) => {
        const fileContent = fs.readFileSync(path.join(tempDir, file), "utf8");
        content += `${file}\n====================\n${fileContent}`;
      });
    } finally {
      rimraf.sync(tempDir);
    }

    return {
      content: [
        {
          type: "text",
          text: content,
        },
      ],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: `Error downloading video: ${err}`,
        },
      ],
      isError: true,
    };
  }
});

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

runServer().catch(console.error);
