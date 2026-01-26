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

## Usage

### Getting Started

1. **Invite the bot** to your Discord server with the necessary permissions (Send Messages, Embed Links, Use Slash Commands)

2. **Set the output channel** where content summaries will be posted:
   ```
   /config channel #your-channel-name
   ```

3. **Add content sources** to monitor:
   ```
   /source add type:Substack name:"My Newsletter" url:https://example.substack.com
   /source add type:YouTube name:"Tech Channel" url:https://youtube.com/@channel
   /source add type:RSS name:"Blog Feed" url:https://example.com/feed.xml
   ```

4. The bot will automatically poll sources every 5 minutes (configurable), fetch new content, generate AI summaries, and post them to your configured channel.

### Discord Commands

#### Source Management

| Command | Description |
|---------|-------------|
| `/source add type:<type> name:<name> url:<url>` | Add a new content source (Substack, YouTube, or RSS) |
| `/source list` | List all configured sources with their status |
| `/source remove name:<name>` | Remove a source by name |
| `/source toggle name:<name>` | Enable or disable a source |

#### Configuration

| Command | Description |
|---------|-------------|
| `/config channel #channel` | Set the channel where summaries will be posted |
| `/config show` | Show current bot configuration (channel, sources, poll interval) |

### How It Works

1. **Polling**: The bot periodically checks all active sources for new content
2. **Fetching**: New articles/videos are fetched and stored in the database
3. **Summarization**: Claude AI generates concise summaries of each piece of content
4. **Posting**: Rich Discord embeds are posted with the summary, source info, and link

### Embed Styling

Each source type has distinct styling:
- **Substack**: Orange accent color with newsletter icon
- **YouTube**: Red accent color with video icon
- **RSS**: Blue accent color with feed icon

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
