# IntelStream

A Discord bot that monitors content sources and posts AI-generated summaries to Discord channels.

## Features

- **Substack newsletters** - Monitor any Substack publication via RSS
- **YouTube channels** - Track new videos with transcript-based summarization
- **RSS/Atom feeds** - Support for any standard RSS or Atom feed
- **Arxiv papers** - Monitor research paper categories (cs.AI, cs.LG, cs.CL, etc.)
- **Blogs** - Smart extraction from any blog using cascading discovery strategies (RSS, Sitemap, LLM extraction)
- **Web pages** - Monitor any web page URL with automatic content detection
- **GitHub repositories** - Track commits, pull requests, and issues with Discord embeds
- **Manual summarization** - Summarize any URL on-demand with `/summarize`
- **Message forwarding** - Forward messages from channels to threads for better organization
- **AI summaries** - Claude-powered summaries with thesis and key arguments format
- **Multi-channel routing** - Route different sources to different channels

## Requirements

- Python 3.12+
- Discord Bot Token
- Anthropic API Key (for Claude)
- YouTube API Key (optional, for YouTube monitoring)

## Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/user1303836/intelstream.git
   cd intelstream
   ```

2. Install dependencies using uv:
   ```bash
   uv sync
   ```

3. Create a `.env` file with your configuration:
   ```bash
   DISCORD_BOT_TOKEN=your_discord_bot_token
   DISCORD_GUILD_ID=your_guild_id
   DISCORD_OWNER_ID=your_user_id
   ANTHROPIC_API_KEY=your_anthropic_api_key

   # Optional: YouTube monitoring
   # YOUTUBE_API_KEY=your_youtube_api_key
   ```

4. Run the bot:
   ```bash
   uv run intelstream
   ```

## Configuration

### Required Environment Variables

| Variable | Description |
|----------|-------------|
| `DISCORD_BOT_TOKEN` | Your Discord bot token |
| `DISCORD_GUILD_ID` | The Discord server ID |
| `DISCORD_OWNER_ID` | Your Discord user ID (for error notifications) |
| `ANTHROPIC_API_KEY` | Your Anthropic API key for Claude |

### Optional Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `YOUTUBE_API_KEY` | - | YouTube Data API key (required for YouTube monitoring) |
| `GITHUB_TOKEN` | - | GitHub Personal Access Token (required for GitHub monitoring) |
| `GITHUB_POLL_INTERVAL_MINUTES` | `5` | Polling interval for GitHub repositories (1-60) |
| `DATABASE_URL` | `sqlite+aiosqlite:///./data/intelstream.db` | Database connection string |
| `DEFAULT_POLL_INTERVAL_MINUTES` | `5` | Default polling interval for new sources (1-60) |
| `CONTENT_POLL_INTERVAL_MINUTES` | `5` | Interval for checking and posting new content (1-60) |
| `LOG_LEVEL` | `INFO` | Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL) |

### Summarization Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `SUMMARY_MAX_TOKENS` | `2048` | Maximum tokens for AI-generated summaries (256-8192) |
| `SUMMARY_MAX_INPUT_LENGTH` | `100000` | Maximum input content length before truncation (1000-500000) |
| `SUMMARY_MODEL` | `claude-3-5-haiku-20241022` | Claude model for background summarization |
| `SUMMARY_MODEL_INTERACTIVE` | `claude-sonnet-4-20250514` | Claude model for interactive `/summarize` command |
| `DISCORD_MAX_MESSAGE_LENGTH` | `2000` | Maximum Discord message length (500-2000) |

### Advanced Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `HTTP_TIMEOUT_SECONDS` | `30.0` | Timeout for HTTP requests (5-120) |
| `MAX_HTML_LENGTH` | `50000` | Maximum HTML length for LLM processing (10000-200000) |
| `SUMMARIZATION_DELAY_SECONDS` | `0.5` | Delay between summarization requests (0.1-5.0) |
| `MAX_CONSECUTIVE_FAILURES` | `3` | Failures before re-analyzing a source (1-20) |
| `YOUTUBE_MAX_RESULTS` | `5` | Maximum YouTube videos to fetch per poll (1-50) |
| `FETCH_DELAY_SECONDS` | `1.0` | Delay between fetching sources (0-30) |
| `MAX_CONCURRENT_FORWARDS` | `5` | Maximum concurrent message forwards (1-20) |

## Usage

### Getting Started

1. **Invite the bot** to your Discord server with permissions: Send Messages, Use Slash Commands

2. **Set the output channel** where content summaries will be posted:
   ```
   /config channel #your-channel-name
   ```

3. **Add content sources** to monitor:
   ```
   /source add type:Substack name:"My Newsletter" url:https://example.substack.com
   /source add type:YouTube name:"Tech Channel" url:https://youtube.com/@channel
   /source add type:RSS name:"Blog Feed" url:https://example.com/feed.xml
   /source add type:Arxiv name:"ML Papers" url:cs.LG
   /source add type:Blog name:"Company Blog" url:https://example.com/blog
   /source add type:Page name:"News Site" url:https://example.com/news
   ```

4. The bot will automatically poll sources, fetch new content, generate AI summaries, and post them to your configured channel.

### Discord Commands

#### Source Management

| Command | Description |
|---------|-------------|
| `/source add type:<type> name:<name> url:<url> [channel:#channel]` | Add a new content source |
| `/source list [channel:#channel]` | List sources (optionally filter by channel) |
| `/source remove name:<name>` | Remove a source by name |
| `/source toggle name:<name>` | Enable or disable a source |

The optional `channel` parameter on `/source add` specifies which channel this source should post to. If omitted, the source uses the guild's default channel (set via `/config channel`).

**Supported source types:**
- `Substack` - Substack newsletter URL
- `YouTube` - YouTube channel URL (requires YouTube API key)
- `RSS` - Any RSS/Atom feed URL
- `Arxiv` - Arxiv category code (e.g., `cs.AI`, `cs.LG`, `cs.CL`, `cs.CV`, `stat.ML`)
- `Blog` - Any blog URL (uses cascading discovery: RSS, Sitemap, LLM extraction)
- `Page` - Any web page URL (uses AI to detect content structure)

#### Configuration

| Command | Description |
|---------|-------------|
| `/config channel #channel` | Set the channel where summaries will be posted |
| `/config show` | Show current bot configuration |

#### Manual Summarization

| Command | Description |
|---------|-------------|
| `/summarize url:<url>` | Get an AI summary of any URL (YouTube, Substack, or web page) |

#### Message Forwarding

Forward messages from one channel to another. Useful for routing followed announcement channels into organized threads.

| Command | Description |
|---------|-------------|
| `/forward add source:#channel destination:#thread` | Create a forwarding rule |
| `/forward list [channel:#channel]` | List forwarding rules (optionally filter by channel) |
| `/forward remove source:#channel destination:#thread` | Remove a forwarding rule |
| `/forward pause source:#channel destination:#thread` | Temporarily pause forwarding |
| `/forward resume source:#channel destination:#thread` | Resume paused forwarding |

**Use case**: Discord's native "Follow" feature only forwards announcement channel messages to channels, not threads. Use message forwarding to route those messages into a thread for better organization:

```
External Server (OpenAI Announcements)
    | (Discord native "Follow")
    v
Your Server: #announcement-intake
    | (Bot forwards)
    v
Your Server: #announcements -> "AI News" thread
```

**Features**:
- Preserves embeds and attachments from original messages
- Automatically unarchives archived destination threads
- Skips attachments that exceed the server's file size limit
- Supports multiple forwarding rules from the same source to different destinations

#### GitHub Monitoring

Monitor GitHub repositories for new commits, pull requests, and issues. Updates are posted as Discord embeds.

| Command | Description |
|---------|-------------|
| `/github add <repo_url> [channel]` | Monitor a GitHub repository |
| `/github list [channel]` | List monitored repositories |
| `/github remove <repo>` | Stop monitoring a repository |

**Adding a repository**:
```
/github add repo_url:https://github.com/owner/repo
/github add repo_url:owner/repo channel:#github-feed
```

Both full GitHub URLs and `owner/repo` format are supported. The optional `channel` parameter specifies where updates should be posted (defaults to the current channel).

**Features**:
- Tracks commits, pull requests, and issues
- Color-coded embeds (gray for commits, purple for PRs, blue for issues)
- Shows PR/issue status (open, closed, merged)
- Displays author avatars and links to GitHub
- Automatically disables repos after 5 consecutive failures
- Case-insensitive repository names

**Requirements**: Set `GITHUB_TOKEN` environment variable with a GitHub Personal Access Token. The token needs `repo` scope for private repositories or `public_repo` for public repositories only.

#### Bot Status

| Command | Description |
|---------|-------------|
| `/status` | Show uptime, source counts, and latency |
| `/ping` | Check bot responsiveness |

### How It Works

1. **Polling**: The bot periodically checks all active sources for new content
2. **Fetching**: New articles/videos are fetched and stored in the database
3. **Summarization**: Claude AI generates structured summaries with thesis and key arguments
4. **Posting**: Plain text messages are posted with the summary, author, title link, and source

### Source-Specific Behavior

**YouTube**: Fetches video transcripts (manual or auto-generated) for summarization. Falls back to video description if no transcript is available.

**Arxiv**: Monitors RSS feeds for specific categories. Summaries focus on the problem solved, key innovation, and practical implications.

**Blog**: Uses cascading discovery strategies to find content:
1. **RSS Discovery** - Tries common RSS paths (`/feed`, `/rss.xml`, `/feed.xml`, etc.)
2. **Sitemap Discovery** - Parses `sitemap.xml` to extract article URLs
3. **LLM Extraction** - Uses Claude to analyze HTML and extract post information

Results are cached to avoid repeated extraction on subsequent polls.

**Page**: When you add a Page source, the bot uses Claude to analyze the page structure and automatically determine CSS selectors for extracting posts.

### Multi-Channel Setup

By default, all sources post to a single channel configured via `/config channel`. For more advanced setups, you can route different sources to different channels.

**Per-source channels**: Specify a channel when adding a source:
```
/source add type:Substack name:"Tech News" url:https://tech.substack.com channel:#tech-feed
/source add type:YouTube name:"Gaming" url:https://youtube.com/@gaming channel:#gaming-feed
/source add type:RSS name:"General" url:https://example.com/feed.xml
```

In this example:
- "Tech News" posts to #tech-feed
- "Gaming" posts to #gaming-feed
- "General" uses the default channel (set via `/config channel`)

**Channel priority**:
1. Source-specific channel (set via `/source add ... channel:#channel`)
2. Guild default channel (set via `/config channel`)

## Development

### Running Tests

```bash
uv run pytest
```

The project has 250+ tests covering adapters, services, Discord cogs, and database operations.

### Linting and Formatting

```bash
uv run ruff check .
uv run ruff format .
```

### Type Checking

```bash
uv run mypy src/
```

### Continuous Integration

GitHub Actions runs on all pull requests:
- Ruff linting and formatting checks
- MyPy type checking
- Pytest with coverage (uploaded to Codecov)
- Security scanning (pip-audit for dependency vulnerabilities, bandit for code security)

### Project Structure

```
src/intelstream/
├── adapters/              # Source adapters
│   ├── substack.py        # Substack RSS adapter
│   ├── youtube.py         # YouTube API adapter
│   ├── rss.py             # Generic RSS/Atom adapter
│   ├── arxiv.py           # Arxiv RSS adapter
│   ├── smart_blog.py      # Blog adapter with cascading strategies
│   ├── page.py            # Web page adapter
│   └── strategies/        # Discovery strategies for Blog adapter
│       ├── rss_discovery.py
│       ├── sitemap_discovery.py
│       └── llm_extraction.py
├── database/
│   ├── models.py          # SQLAlchemy models
│   └── repository.py      # Database operations
├── discord/cogs/
│   ├── source_management.py     # /source commands
│   ├── config_management.py     # /config commands
│   ├── content_posting.py       # Background polling task
│   ├── summarize.py             # /summarize command
│   ├── message_forwarding.py    # /forward commands
│   ├── github.py                # /github commands
│   └── github_polling.py        # GitHub polling task
├── services/
│   ├── pipeline.py           # Content pipeline orchestration
│   ├── summarizer.py         # Claude summarization
│   ├── content_poster.py     # Discord message formatting
│   ├── content_extractor.py  # Content extraction utilities
│   ├── message_forwarder.py  # Message forwarding logic
│   ├── page_analyzer.py      # LLM-based page structure analysis
│   ├── web_fetcher.py        # HTTP fetching
│   ├── github_service.py     # GitHub API client
│   └── github_poster.py      # GitHub embed formatting
├── bot.py                 # Discord bot main class
├── config.py              # Pydantic settings
└── main.py                # Entry point
```

## License

MIT
