# IntelStream Development Notes

This document summarizes the development work completed on IntelStream, a Discord bot for content aggregation and AI-powered summarization.

## Project Overview

IntelStream monitors content sources (Substack newsletters, YouTube channels, RSS feeds) and automatically posts AI-generated summaries to a Discord channel. The bot uses Claude for summarization and discord.py for Discord integration.

## Architecture

```
intelstream/
├── src/intelstream/
│   ├── bot.py                 # Discord bot main class
│   ├── config.py              # Pydantic settings
│   ├── adapters/              # Source adapters
│   │   ├── base.py            # Adapter protocol
│   │   ├── substack.py        # Substack RSS adapter
│   │   ├── youtube.py         # YouTube Data API adapter
│   │   ├── rss.py             # Generic RSS adapter
│   │   └── factory.py         # Adapter factory
│   ├── database/
│   │   ├── models.py          # SQLAlchemy models
│   │   └── repository.py      # Database operations
│   ├── discord/cogs/
│   │   ├── source_management.py   # /source commands
│   │   ├── config_management.py   # /config commands
│   │   └── content_posting.py     # Background posting task
│   └── services/
│       ├── pipeline.py        # Content pipeline orchestrator
│       ├── summarizer.py      # Claude summarization
│       └── content_poster.py  # Discord embed creation
└── tests/                     # Unit tests (137 total)
```

## Development Phases

### Phase 1: Infrastructure

**Objective**: Set up project foundation with database, bot framework, and configuration.

**Files Created**:
- `src/intelstream/database/models.py` - SQLAlchemy async models
  - `Source`: Content sources with type, identifier, feed URL, polling state
  - `ContentItem`: Fetched content with title, summary, URL, timestamps
  - `DiscordConfig`: Per-guild configuration for output channel
  - `SourceType` enum: SUBSTACK, YOUTUBE, RSS

- `src/intelstream/database/repository.py` - Repository pattern
  - CRUD operations for sources and content items
  - Deduplication via `get_or_create_content_item()`
  - Batch operations for efficient database access

- `src/intelstream/config.py` - Pydantic Settings
  - Environment variable loading with validation
  - Discord tokens, API keys, database URL
  - Configurable poll intervals and log levels

- `src/intelstream/bot.py` - IntelStreamBot class
  - Async SQLAlchemy session management
  - Repository injection
  - Owner notification system
  - Cog loading in setup_hook()

**Key Decisions**:
- Used SQLAlchemy 2.0 async for database operations
- Used Pydantic v2 for settings with `model_config`
- Structured logging with structlog

### Phase 2: Source Adapters

**Objective**: Create adapters for fetching content from different source types.

**Files Created**:
- `src/intelstream/adapters/base.py` - Protocol definition
  - `SourceAdapter` protocol with `fetch_new_items()` method
  - `FetchedItem` dataclass for adapter output

- `src/intelstream/adapters/substack.py` - Substack adapter
  - Parses Substack RSS feeds using feedparser
  - Extracts title, content, author, published date
  - Handles both substack.com and custom domain URLs

- `src/intelstream/adapters/youtube.py` - YouTube adapter
  - Uses YouTube Data API v3
  - Resolves channel handles (@username) to channel IDs
  - Fetches video metadata and thumbnails
  - Constructs RSS feed URL for channel

- `src/intelstream/adapters/rss.py` - Generic RSS adapter
  - Supports RSS 2.0 and Atom feeds
  - Extracts standard feed fields
  - Handles various date formats

- `src/intelstream/adapters/factory.py` - Adapter factory
  - Creates appropriate adapter based on SourceType
  - Injects YouTube API key when needed

**Key Decisions**:
- Used feedparser for RSS/Atom parsing (handles edge cases well)
- YouTube requires API key; Substack/RSS work without authentication
- Adapters are stateless and receive configuration at creation

### Phase 3: Content Pipeline

**Objective**: Create orchestration layer for fetching and summarizing content.

**Files Created**:
- `src/intelstream/services/summarizer.py` - SummarizationService
  - Uses Anthropic Python SDK with async client
  - Configurable model (default: claude-sonnet-4-20250514)
  - Generates concise 2-3 sentence summaries
  - Includes source context in prompts

- `src/intelstream/services/pipeline.py` - ContentPipeline
  - Orchestrates fetch and summarization cycles
  - `run_cycle()`: Fetches all sources, then summarizes pending items
  - `_fetch_source()`: Handles individual source with error isolation
  - `_summarize_pending()`: Batch processes unsummarized content
  - Manages aiohttp session lifecycle

**Key Decisions**:
- Pipeline runs as single cycle, called by Discord background task
- Each source fetch is isolated (one failure doesn't stop others)
- Summarization happens after all fetching completes
- Used aiohttp ClientSession for HTTP requests in adapters

### Phase 4: Discord Integration

**Objective**: Connect pipeline to Discord with slash commands and automated posting.

**Files Created**:
- `src/intelstream/services/content_poster.py` - ContentPoster
  - Creates rich Discord embeds from ContentItem
  - Source-specific colors (orange/red/blue for Substack/YouTube/RSS)
  - Source-specific icons in footer
  - Truncates long titles/descriptions to Discord limits
  - `post_unposted_items()`: Posts all pending items for a guild

- `src/intelstream/discord/cogs/source_management.py` - SourceManagement cog
  - `/source add type:<type> name:<name> url:<url>` - Add source
  - `/source list` - List all sources with status
  - `/source remove name:<name>` - Remove source
  - `/source toggle name:<name>` - Enable/disable source
  - `parse_source_identifier()`: Extracts identifiers from URLs

- `src/intelstream/discord/cogs/config_management.py` - ConfigManagement cog
  - `/config channel #channel` - Set output channel
  - `/config show` - Display current configuration
  - Permission checks for bot access to channel

- `src/intelstream/discord/cogs/content_posting.py` - ContentPosting cog
  - Background task with `@tasks.loop()`
  - Runs pipeline cycle on interval
  - Posts to all configured guilds
  - Error handling with owner notification

**Key Decisions**:
- Used discord.py app_commands for slash commands
- Commands grouped under `/source` and `/config`
- Background task interval configurable via settings
- Embeds use images for YouTube thumbnails

## Testing

**Total Tests**: 137 passing

**Test Files**:
- `tests/test_database/test_models.py` - Model validation
- `tests/test_database/test_repository.py` - Repository operations
- `tests/test_adapters/test_substack.py` - Substack adapter
- `tests/test_adapters/test_youtube.py` - YouTube adapter
- `tests/test_adapters/test_rss.py` - RSS adapter
- `tests/test_services/test_summarizer.py` - Summarization service
- `tests/test_services/test_pipeline.py` - Pipeline orchestration
- `tests/test_services/test_content_poster.py` - Content poster
- `tests/test_discord/test_source_management.py` - Source commands
- `tests/test_discord/test_config_management.py` - Config commands
- `tests/test_discord/test_content_posting.py` - Background task

**Testing Patterns**:
- Used pytest with pytest-asyncio for async tests
- Extensive use of `unittest.mock.AsyncMock` for async mocking
- Discord command tests call `.callback()` method directly
- Database tests use in-memory SQLite

## Technical Challenges Resolved

### Discord.py Command Testing
Discord app_commands decorated methods can't be called directly in tests. Solution: call the `.callback()` method with the cog instance as first argument.

```python
# Instead of:
await cog.command(interaction, arg=value)

# Use:
await cog.command.callback(cog, interaction, arg=value)
```

### Mypy Type Errors
1. **Union type attribute access**: `channel.mention` on union of channel types. Fixed with `hasattr()` check.
2. **Loop.error decorator**: discord.py typing issue. Fixed with `# type: ignore[type-var]`.

### Discord Embed.Empty Deprecation
Newer discord.py versions removed `discord.Embed.Empty`. Changed tests to check for `None` instead.

## Configuration

**Required Environment Variables**:
- `DISCORD_BOT_TOKEN` - Bot authentication
- `DISCORD_GUILD_ID` - Server ID for command sync
- `DISCORD_OWNER_ID` - User ID for error notifications
- `ANTHROPIC_API_KEY` - Claude API access

**Optional Environment Variables**:
- `YOUTUBE_API_KEY` - Required only for YouTube sources
- `DATABASE_URL` - Defaults to SQLite
- `CONTENT_POLL_INTERVAL_MINUTES` - Defaults to 5
- `DEFAULT_POLL_INTERVAL_MINUTES` - Source poll interval
- `LOG_LEVEL` - Logging verbosity

## Dependencies

**Runtime**:
- discord.py ~= 2.5 - Discord API wrapper
- SQLAlchemy[asyncio] ~= 2.0 - Async ORM
- aiosqlite - SQLite async driver
- pydantic-settings - Configuration management
- anthropic - Claude API client
- aiohttp - Async HTTP client
- feedparser - RSS/Atom parsing
- structlog - Structured logging

**Development**:
- pytest, pytest-asyncio - Testing
- ruff - Linting and formatting
- mypy - Type checking

## Pull Requests

1. **Phase 1**: Infrastructure setup (merged)
2. **Phase 2**: Source adapters (merged)
3. **Phase 3**: Content pipeline (merged)
4. **Phase 4**: Discord integration (PR #3, merged)

All PRs included greptile code review via @greptile comment.
