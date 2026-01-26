# IntelStream

A Discord bot that monitors content sources (Substack, YouTube, blogs) and posts AI-generated summaries to a Discord channel.

## Features

- Monitor Substack newsletters via RSS
- Monitor YouTube channels for new videos
- Monitor any RSS/Atom feed
- AI-powered summarization using Claude
- Rich Discord embeds with formatted summaries
- Manual URL summarization via slash commands

## Requirements

- Python 3.12+
- Discord Bot Token
- Anthropic API Key (for Claude)
- YouTube API Key (optional, for YouTube monitoring)

## Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/intelstream.git
   cd intelstream
   ```

2. Install dependencies using uv:
   ```bash
   uv sync
   ```

3. Copy the example environment file and configure:
   ```bash
   cp .env.example .env
   # Edit .env with your tokens and configuration
   ```

4. Run the bot:
   ```bash
   uv run intelstream
   ```

## Configuration

See `.env.example` for all available configuration options.

### Required Environment Variables

- `DISCORD_BOT_TOKEN` - Your Discord bot token
- `DISCORD_GUILD_ID` - The Discord server ID
- `DISCORD_CHANNEL_ID` - The channel ID for posting summaries
- `DISCORD_OWNER_ID` - Your Discord user ID (for error notifications)
- `ANTHROPIC_API_KEY` - Your Anthropic API key for Claude

### Optional Environment Variables

- `YOUTUBE_API_KEY` - YouTube Data API key (required for YouTube monitoring)
- `DATABASE_URL` - Database connection string (default: SQLite)
- `DEFAULT_POLL_INTERVAL_MINUTES` - Polling interval (default: 5)
- `LOG_LEVEL` - Logging level (default: INFO)

## Discord Commands

- `/status` - Show bot status and configured sources
- `/ping` - Check bot responsiveness

## Development

### Running Tests

```bash
uv run pytest
```

### Linting and Formatting

```bash
uv run ruff check .
uv run ruff format .
```

### Type Checking

```bash
uv run mypy src/
```

## License

MIT
