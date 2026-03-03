<div align="center">

# IntelStream

**AI-powered content aggregation for Discord**

Monitor newsletters, YouTube channels, RSS feeds, research papers, blogs, Twitter accounts, GitHub repos, and more — with LLM-generated summaries delivered straight to your server.

[![CI](https://github.com/user1303836/intelstream/actions/workflows/ci.yml/badge.svg)](https://github.com/user1303836/intelstream/actions/workflows/ci.yml)
[![Python 3.12+](https://img.shields.io/badge/python-3.12+-blue.svg)](https://www.python.org/downloads/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![discord.py](https://img.shields.io/badge/discord.py-2.4+-7289da.svg)](https://discordpy.readthedocs.io/)

[Quickstart](#-quickstart) · [Commands](#-commands) · [Sources](#-supported-sources) · [Configuration](#%EF%B8%8F-configuration) · [Development](#-development)

</div>

---

## Features

- **7 content source types** — Substack, YouTube, RSS, Arxiv, Blogs, Twitter/X, Web Pages
- **GitHub monitoring** — Track commits, PRs, and issues with color-coded Discord embeds
- **Multi-provider AI summaries** — Anthropic, OpenAI, Gemini, or Kimi — extracts thesis and key arguments, not just topics
- **On-demand summarization** — `/summarize` any URL instantly
- **Channel summaries** — `/summary` to recap recent channel messages
- **Server lore** — `/lore query` to search your server's message history with semantic search
- **Semantic search** — `/search` to find past articles by meaning, not just keywords
- **Message forwarding** — Route announcement channels into organized threads
- **Multi-channel routing** — Different sources post to different channels
- **Per-source polling** — Fine-tune intervals from 1 minute to 24 hours per source type
- **Auto-recovery** — Exponential backoff and auto-disable on consecutive failures

## Quickstart

```bash
# Clone and install
git clone https://github.com/user1303836/intelstream.git
cd intelstream
uv sync

# Configure (minimum required)
cat > .env << 'EOF'
DISCORD_BOT_TOKEN=your_discord_bot_token
DISCORD_GUILD_ID=your_guild_id
DISCORD_OWNER_ID=your_user_id
ANTHROPIC_API_KEY=your_anthropic_api_key
EOF

# Run
uv run intelstream
```

Then in Discord:

```
/config channel #news-feed
/source add type:Substack name:"Stratechery" url:https://stratechery.com
/source add type:YouTube name:"3Blue1Brown" url:https://youtube.com/@3blue1brown
```

The bot polls your sources, generates summaries, and posts them to your channel automatically.

### Using a different LLM provider

```bash
# OpenAI
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...

# Google Gemini
LLM_PROVIDER=gemini
GEMINI_API_KEY=...

# Kimi (Moonshot AI)
LLM_PROVIDER=kimi
KIMI_API_KEY=...
```

Set the API key that matches your chosen `LLM_PROVIDER`. Blog and Page source analysis always requires `ANTHROPIC_API_KEY` regardless of the summarization provider.

## Commands

### Source Management

| Command | Description |
|---------|-------------|
| `/source add type:<type> name:<name> url:<url>` | Add a content source |
| `/source list` | List all sources |
| `/source remove name:<name>` | Remove a source |
| `/source toggle name:<name>` | Pause or resume a source |
| `/source info name:<name>` | Diagnostics: failure count, last polled, metrics |

Optional parameters on `/source add`:
- `channel:#channel` — Post to a specific channel (otherwise uses default)
- `summarize:False` — Post bare URLs instead of AI summaries (Discord auto-embeds)

### GitHub Monitoring

| Command | Description |
|---------|-------------|
| `/github add repo_url:<url>` | Monitor a repo (supports `owner/repo` or full URL) |
| `/github list` | List monitored repos |
| `/github remove repo:<name>` | Stop monitoring |
| `/github toggle repo:<name>` | Pause or resume |

Optional parameters on `/github add`:
- `channel:#channel` — Post to a specific channel
- `track_commits:False` — Disable commit tracking
- `track_prs:False` — Disable PR tracking
- `track_issues:False` — Disable issue tracking

Color-coded embeds: gray for commits, purple for PRs, blue for issues.

### Message Forwarding

Forward messages from channels to threads for better organization. Useful for routing Discord's native "Follow" announcements into threads.

| Command | Description |
|---------|-------------|
| `/forward add source:#channel destination:#thread` | Create a forwarding rule |
| `/forward list` | List forwarding rules |
| `/forward remove source:#channel destination:#thread` | Remove a rule |
| `/forward pause source:#channel destination:#thread` | Pause forwarding |
| `/forward resume source:#channel destination:#thread` | Resume forwarding |

Preserves embeds and attachments. Auto-unarchives destination threads.

### Other Commands

| Command | Description |
|---------|-------------|
| `/summarize url:<url>` | Summarize any URL on-demand |
| `/summary [count] [channel]` | Summarize recent messages in a channel |
| `/search query:<text>` | Search ingested articles by semantic similarity |
| `/lore query question:<text>` | Query server message history with natural language |
| `/lore setup` | Start ingesting server message history (admin) |
| `/lore status` | Show message ingestion progress |
| `/config channel #channel` | Set default output channel |
| `/config show` | Show current configuration |
| `/status` | Uptime, latency, source counts |
| `/ping` | Check bot responsiveness |

## Supported Sources

| Source | Identifier | Notes |
|--------|-----------|-------|
| **Substack** | Publication URL | Auto-discovers RSS feed |
| **YouTube** | Channel URL or `@handle` | Fetches transcripts for summarization; `summarize:False` posts video URL directly |
| **RSS** | Feed URL | Any standard RSS or Atom feed |
| **Arxiv** | Category code (`cs.AI`, `cs.LG`, etc.) | Fetches full HTML papers; summaries focus on problem, innovation, and implications |
| **Blog** | Blog root URL | Cascading discovery: RSS, Sitemap, LLM extraction. Results cached. |
| **Twitter/X** | Profile URL or `@username` | Official X API v2. Filters retweets/replies. Includes quoted tweets. |
| **Page** | Any web page URL | Claude analyzes page structure to auto-detect content selectors |

### YouTube Details

Fetches video transcripts (manual or auto-generated) for summarization. Falls back to description if no transcript is available. With `summarize:False`, transcript fetching is skipped entirely — Discord auto-embeds the video preview.

### Blog Discovery

The blog adapter uses cascading strategies to find posts:

1. **RSS Discovery** — Tries common paths (`/feed`, `/rss.xml`, `/feed.xml`, etc.)
2. **Sitemap Discovery** — Parses `sitemap.xml` for article URLs
3. **LLM Extraction** — Claude analyzes the HTML structure to find posts

Results are cached. If discovery fails, the bot re-analyzes automatically after `MAX_CONSECUTIVE_FAILURES`.

### Twitter/X Cost Considerations

The X API v2 uses a tiered subscription or pay-per-use credits. IntelStream fetches 5 tweets per poll and caches user ID lookups to minimize API usage. With the default 15-minute interval, 10 Twitter sources consume ~28,800 reads/month. Set `TWITTER_POLL_INTERVAL_MINUTES` higher (30 or 60) for lower consumption.

## Configuration

All configuration is via environment variables (`.env` file supported).

### Required

| Variable | Description |
|----------|-------------|
| `DISCORD_BOT_TOKEN` | Discord bot token |
| `DISCORD_GUILD_ID` | Discord server ID |
| `DISCORD_OWNER_ID` | Your user ID (receives error DMs) |

### LLM Provider

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_PROVIDER` | `anthropic` | LLM provider: `anthropic`, `openai`, `gemini`, or `kimi` |
| `ANTHROPIC_API_KEY` | — | Anthropic API key (required when provider is `anthropic`; also required for Blog/Page analysis) |
| `OPENAI_API_KEY` | — | OpenAI API key (required when provider is `openai`) |
| `GEMINI_API_KEY` | — | Google Gemini API key (required when provider is `gemini`) |
| `KIMI_API_KEY` | — | Kimi/Moonshot AI API key (required when provider is `kimi`) |

### Optional API Keys

| Variable | Description |
|----------|-------------|
| `YOUTUBE_API_KEY` | YouTube Data API key (required for YouTube sources) |
| `TWITTER_BEARER_TOKEN` | X API v2 Bearer Token (required for Twitter sources) |
| `GITHUB_TOKEN` | GitHub PAT (required for GitHub monitoring) |

### Polling Intervals

| Variable | Default | Description |
|----------|---------|-------------|
| `DEFAULT_POLL_INTERVAL_MINUTES` | `5` | Default for all source types (1-60) |
| `CONTENT_POLL_INTERVAL_MINUTES` | `5` | How often to check and post new content (1-60) |
| `GITHUB_POLL_INTERVAL_MINUTES` | `5` | How often to poll GitHub repos (1-60) |

Override per source type (each defaults to `DEFAULT_POLL_INTERVAL_MINUTES`, range 1-1440):

`SUBSTACK_POLL_INTERVAL_MINUTES` · `YOUTUBE_POLL_INTERVAL_MINUTES` · `RSS_POLL_INTERVAL_MINUTES` · `ARXIV_POLL_INTERVAL_MINUTES` · `BLOG_POLL_INTERVAL_MINUTES` · `TWITTER_POLL_INTERVAL_MINUTES` · `PAGE_POLL_INTERVAL_MINUTES`

### Summarization

| Variable | Default | Description |
|----------|---------|-------------|
| `SUMMARY_MODEL` | `claude-haiku-4-5-20251001` | Model for background summarization (provider-specific model ID) |
| `SUMMARY_MODEL_INTERACTIVE` | `claude-sonnet-4-20250514` | Model for `/summarize` (provider-specific model ID) |
| `SUMMARY_MAX_TOKENS` | `2048` | Max tokens per summary (256-8192) |
| `SUMMARY_MAX_INPUT_LENGTH` | `100000` | Max input length before truncation (1000-500000) |
| `DISCORD_MAX_MESSAGE_LENGTH` | `2000` | Max Discord message length (500-2000) |

### Advanced

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `sqlite+aiosqlite:///./data/intelstream.db` | Database connection string |
| `HTTP_TIMEOUT_SECONDS` | `30.0` | HTTP request timeout (5-120) |
| `FETCH_DELAY_SECONDS` | `1.0` | Delay between source fetches (0-30) |
| `SUMMARIZATION_DELAY_SECONDS` | `0.5` | Delay between summarization requests (0.1-5.0) |
| `MAX_CONSECUTIVE_FAILURES` | `3` | Failures before auto-disabling a source (1-20) |
| `YOUTUBE_MAX_RESULTS` | `5` | Videos to fetch per YouTube poll (1-50) |
| `MAX_CONCURRENT_FORWARDS` | `5` | Concurrent message forwards (1-20) |
| `LOG_LEVEL` | `INFO` | Logging level |

## How It Works

```
Sources (Substack, YouTube, RSS, ...)
    |
    v
+---------------------------------+
|  Adapters                       |  Fetch new content per source type
|  (one per source type)          |  De-duplicate against existing items
+-----------------+---------------+
                  |
                  v
+---------------------------------+
|  Content Pipeline               |  Store raw content in SQLite
|  (pipeline.py)                  |  Queue for summarization
+-----------------+---------------+
                  |
                  v
+---------------------------------+
|  Summarization Service          |  LLM generates thesis + key arguments
|  (summarizer.py)                |  Retry with backoff on rate limits
+-----------------+---------------+
                  |
                  v
+---------------------------------+
|  Content Poster                 |  Format and post to Discord
|  (content_poster.py)            |  Route to correct channel
+---------------------------------+
```

**Failure handling:** Consecutive failures are tracked per source. After `MAX_CONSECUTIVE_FAILURES` (default: 3), the source is auto-paused. The bot owner receives a DM on unhandled errors.

**Channel routing priority:**
1. Source-specific channel (set via `/source add ... channel:#channel`)
2. Guild default channel (set via `/config channel`)

## Development

### Prerequisites

- Python 3.12+
- [uv](https://github.com/astral-sh/uv) (package manager)

### Running Tests

```bash
uv run pytest                # Run all tests
uv run pytest -x             # Stop on first failure
uv run pytest -k "youtube"   # Run tests matching pattern
```

### Linting & Type Checking

```bash
uv run ruff check .          # Lint
uv run ruff format --check . # Format check
uv run mypy src/             # Type check (strict mode)
```

### CI

GitHub Actions runs on all PRs: ruff, mypy, pytest with coverage (Codecov), pip-audit, bandit.

### Project Structure

```
src/intelstream/
├── adapters/                  # One adapter per source type
│   ├── substack.py
│   ├── youtube.py
│   ├── rss.py
│   ├── arxiv.py
│   ├── smart_blog.py          # Cascading discovery strategies
│   ├── twitter.py             # Official X API v2
│   ├── page.py                # AI-powered page analysis
│   └── strategies/            # Blog discovery strategies
├── database/
│   ├── models.py              # SQLAlchemy models
│   ├── repository.py          # Async database operations
│   └── vector_store.py        # Embedding storage (zvec)
├── discord/cogs/
│   ├── source_management.py   # /source commands
│   ├── config_management.py   # /config commands
│   ├── content_posting.py     # Background polling loop
│   ├── summarize.py           # /summarize command
│   ├── channel_summary.py     # /summary command
│   ├── message_forwarding.py  # /forward commands + listener
│   ├── github.py              # /github commands
│   ├── github_polling.py      # GitHub polling loop
│   ├── lore.py                # /lore commands + message ingestion
│   └── search.py              # /search command
├── services/
│   ├── pipeline.py            # Content pipeline orchestration
│   ├── llm_client.py          # Multi-provider LLM abstraction
│   ├── summarizer.py          # LLM summarization
│   ├── content_poster.py      # Discord message formatting
│   ├── content_extractor.py   # HTML content extraction
│   ├── embedding_service.py   # Text embedding for search
│   ├── message_ingestion.py   # Server history ingestion
│   ├── message_forwarder.py   # Message forwarding logic
│   ├── page_analyzer.py       # LLM page structure analysis
│   ├── web_fetcher.py         # HTTP fetching
│   ├── github_service.py      # GitHub API client
│   └── github_poster.py       # GitHub embed formatting
├── bot.py                     # Bot class and startup
├── config.py                  # Pydantic settings
└── main.py                    # Entry point
```

## License

MIT
