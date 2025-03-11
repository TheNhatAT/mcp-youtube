# YouTube MCP Server

Uses `yt-dlp` to download subtitles from YouTube and connects it to claude.ai via [Model Context Protocol](https://modelcontextprotocol.io/introduction). Try it by asking Claude, "Summarize the YouTube video <<URL>>". Requires `yt-dlp` to be installed locally e.g. via Homebrew.

## Features

- Download YouTube video subtitles (both manual and auto-generated)
- Process and clean subtitle text
- Split content into configurable chunks
- Support for English subtitles
- Timeout protection for long-running downloads

## Code Structure

The codebase is organized into modular components:

- `SubtitleProcessor`: Handles subtitle text processing and chunking
- `validateAndDownloadSubtitles`: Manages URL validation and subtitle downloading
- `processSubtitleContent`: Processes raw subtitle content into structured format
- `formatResponse`: Formats the processed content for output
- `processYoutubeSubtitles`: Main orchestrator function

## Installation

1. Install `yt-dlp` (Homebrew and WinGet both work great here)
2. Install via [mcp-installer](https://github.com/anaisbetts/mcp-installer):
   ```bash
   npx @modelcontextprotocol/installer install @TheNhatAT/mcp-youtube
   ```

## Configuration

The tool accepts the following parameters:
- `url`: YouTube video URL (required)
- `chunkSize`: Number of words per chunk (default: 4000, min: 1000, max: 10000)
- `chunkIndex`: Index of the chunk to fetch (0-based, default: 0)
- `chunks`: Number of consecutive chunks to fetch (default: 1, max: 5)

## Author

TheNhatAT

## License

MIT
