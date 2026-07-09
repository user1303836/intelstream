# IntelStream

AI-assisted Discord bot for monitoring content sources, summarizing new items, posting them into Discord channels or threads, and searching the content it has already ingested.

[![CI](https://github.com/user1303836/intelstream/actions/workflows/ci.yml/badge.svg)](https://github.com/user1303836/intelstream/actions/workflows/ci.yml)
[![Python 3.12+](https://img.shields.io/badge/python-3.12+-blue.svg)](https://www.python.org/downloads/)
[![discord.py 2.4+](https://img.shields.io/badge/discord.py-2.4+-5865f2.svg)](https://discordpy.readthedocs.io/)

## Table of Contents

- [What It Does](#what-it-does)
- [Quickstart](#quickstart)
- [Discord Bot Setup](#discord-bot-setup)
- [Configuration](#configuration)
- [Commands](#commands)
- [Supported Sources](#supported-sources)
- [Feature Behavior](#feature-behavior)
- [Data And Files](#data-and-files)
- [Running Locally](#running-locally)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [Project Structure](#project-structure)
- [License](#license)

## What It Does

IntelStream is a Python 3.12 Discord bot built with `discord.py`. It polls external sources, stores fetched items in SQLite, optionally summarizes them with an LLM, posts them to Discord, and maintains local vector indexes for semantic article search.

| Capability | Current behavior |
| --- | --- |
| Content monitoring | Substack, YouTube, RSS/Atom, Arxiv categories, generic page listings, blog sites, and Twitter/X profiles. |
| Discord posting | Posts summaries or bare URLs into per-source channels/threads, with a guild-level fallback channel. |
| LLM summaries | Uses Anthropic, OpenAI, Gemini, or Kimi/Moonshot for summaries. Blog and page analysis still require Anthropic. |
| On-demand summaries | `/summarize` handles YouTube videos, Substack articles, and ordinary web pages. Twitter/X URLs are rejected by that command. |
| Channel summaries | `/summary` summarizes recent non-bot Discord messages in a text channel. |
| Article search | `/search` performs semantic search over summarized articles using sentence-transformers, zvec, and an optional cross-encoder reranker. |
| Lore/message history | Message ingestion and indexing exist, but the `/lore` query command currently returns a temporary-disabled message in code. |
| GitHub monitoring | Polls repositories for new commits, pull requests, and issues, then posts Discord embeds. |
| Message forwarding | Forwards messages from source channels/threads to destination channels/threads. |
| Health commands | `/status` reports bot, source, content, and forwarding status. `/ping` reports latency. |

## Quickstart

### Prerequisites

- Python 3.12 or newer.
- `uv` for dependency management.
- A Discord application and bot token.
- At least one LLM API key for the selected `LLM_PROVIDER`.

### Install

```bash
git clone https://github.com/user1303836/intelstream.git
cd intelstream
uv sync --extra dev
```

### Configure

Start from the tracked example file:

```bash
cp .env.example .env
```

Then replace the placeholders you need. Remove or comment out `DISCORD_CHANNEL_ID` unless you intentionally want legacy command restriction to a single channel.

Minimum Anthropic-based configuration:

```dotenv
DISCORD_BOT_TOKEN=replace_with_discord_bot_token
DISCORD_GUILD_ID=replace_with_discord_server_id
DISCORD_OWNER_ID=replace_with_your_discord_user_id

LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=replace_with_anthropic_key
```

Add source-specific keys only for the integrations you use:

```dotenv
YOUTUBE_API_KEY=replace_with_youtube_data_api_key
TWITTER_BEARER_TOKEN=replace_with_x_api_bearer_token
GITHUB_TOKEN=replace_with_github_personal_access_token
```

### Run

```bash
uv run intelstream
```

On startup the bot initializes the SQLite database, loads cogs, initializes search services when enabled, and syncs guild-scoped slash commands for `DISCORD_GUILD_ID`.

### First Discord Commands

Use these from your Discord server after the bot is online:

```text
/config channel channel:#intel
/source add source_type:RSS name:"Example Feed" url:https://example.com/feed.xml
/source add source_type:Substack name:"Example Newsletter" url:https://example.substack.com
/status
```

## Discord Bot Setup

1. Create a Discord application in the Discord Developer Portal.
2. Add a bot user and copy its token into `DISCORD_BOT_TOKEN`.
3. Enable these privileged gateway intents for the bot:
   - Server Members Intent
   - Message Content Intent
4. Create an install URL with these OAuth2 scopes:
   - `bot`
   - `applications.commands`
5. Give the bot permissions appropriate for the features you use:

| Permission | Needed for |
| --- | --- |
| View Channels | Seeing configured channels and threads. |
| Send Messages | Posting summaries, command responses, forwarded messages, and GitHub updates. |
| Embed Links | Posting summary and GitHub embeds. |
| Read Message History | `/summary`, lore ingestion, and forwarding context. |
| Attach Files | Forwarding attachments. |
| Send Messages in Threads | Posting to configured threads. |
| Manage Threads | Unarchiving destination threads during forwarding. |

To get IDs, enable Developer Mode in Discord, then right-click the server or user and choose Copy ID:

| Environment variable | Discord value |
| --- | --- |
| `DISCORD_GUILD_ID` | Server ID. |
| `DISCORD_OWNER_ID` | Bot owner's user ID. Used for error DMs. |
| `DISCORD_CHANNEL_ID` | Optional legacy command-restriction/default channel. Prefer `/config channel` and per-source channels for new installs. |

## Configuration

Configuration is loaded with `pydantic-settings` from environment variables and `.env`. Names are case-insensitive and unknown variables are ignored.

Do not commit `.env`. It is ignored by `.gitignore`; `.env.example` is the safe template.

### Required Runtime Variables

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `DISCORD_BOT_TOKEN` | Yes | None | Discord bot token. Empty strings are rejected. |
| `DISCORD_GUILD_ID` | Yes | None | Guild where slash commands are synced. |
| `DISCORD_OWNER_ID` | Yes | None | User ID for owner notifications. |
| `LLM_PROVIDER` | No | `anthropic` | One of `anthropic`, `openai`, `gemini`, or `kimi`. |
| Provider API key | Yes | None | Must match `LLM_PROVIDER`; see the next table. |

### LLM Providers

| Provider | API key variable | Background model default | Interactive model default |
| --- | --- | --- | --- |
| Anthropic | `ANTHROPIC_API_KEY` | `claude-haiku-4-5-20251001` | `claude-sonnet-4-6` |
| OpenAI | `OPENAI_API_KEY` | `gpt-5.4-mini` | `gpt-5.4` |
| Gemini | `GEMINI_API_KEY` | `gemini-3.5-flash` | `gemini-3.1-pro-preview` |
| Kimi/Moonshot | `KIMI_API_KEY` | `moonshot-v1-8k` | `moonshot-v1-32k` |

`SUMMARY_MODEL` and `SUMMARY_MODEL_INTERACTIVE` override these defaults. Kimi uses the OpenAI-compatible Moonshot endpoint in `llm_client.py`.
The OpenAI defaults use `gpt-5.4-mini` for budget-aware background summaries and `gpt-5.4` for interactive work. Reserve `gpt-5.5` for premium or high-headroom workflows.

Important: Blog and Page source setup uses Anthropic-specific analyzers. Set `ANTHROPIC_API_KEY` if you plan to add `Blog` or `Page` sources, even when `LLM_PROVIDER` is not `anthropic`.

### Integration Keys

| Variable | Required for | Notes |
| --- | --- | --- |
| `YOUTUBE_API_KEY` | YouTube sources and `/summarize` on YouTube URLs | Uses the YouTube Data API and transcript fetching. |
| `TWITTER_BEARER_TOKEN` | Twitter/X sources | Uses X API v2 user timeline endpoints. |
| `GITHUB_TOKEN` | GitHub monitoring | Used as a bearer token against the GitHub REST API. |

### Polling And Rate Controls

| Variable | Default | Bounds | Notes |
| --- | --- | --- | --- |
| `CONTENT_POLL_INTERVAL_MINUTES` | `5` | 1-60 | Background content loop cadence. |
| `GITHUB_POLL_INTERVAL_MINUTES` | `5` | 1-60 | GitHub polling loop cadence. |
| `DEFAULT_POLL_INTERVAL_MINUTES` | `5` | 1-60 | Fallback source due interval. |
| `SUBSTACK_POLL_INTERVAL_MINUTES` | unset | 1-1440 | Per-source-type override. |
| `YOUTUBE_POLL_INTERVAL_MINUTES` | unset | 1-1440 | Per-source-type override. |
| `RSS_POLL_INTERVAL_MINUTES` | unset | 1-1440 | Per-source-type override. |
| `ARXIV_POLL_INTERVAL_MINUTES` | unset | 1-1440 | Per-source-type override. |
| `BLOG_POLL_INTERVAL_MINUTES` | unset | 1-1440 | Per-source-type override. |
| `TWITTER_POLL_INTERVAL_MINUTES` | unset | 1-1440 | Per-source-type override. |
| `PAGE_POLL_INTERVAL_MINUTES` | unset | 1-1440 | Per-source-type override. |
| `FETCH_DELAY_SECONDS` | `1.0` | 0-30 | Delay between source fetches. |
| `SUMMARIZATION_DELAY_SECONDS` | `0.5` | 0.1-5.0 | Delay between summary calls. |
| `MAX_CONSECUTIVE_FAILURES` | `3` | 1-20 | Threshold for `SmartBlogAdapter` to re-analyze a Blog source after repeated empty or failed fetches. General content and GitHub polling loop thresholds are hard-coded separately. |
| `YOUTUBE_MAX_RESULTS` | `5` | 1-50 | Videos fetched per YouTube poll. |
| `MAX_CONCURRENT_FORWARDS` | `5` | 1-20 | Semaphore limit for forwarding. |

The source table stores `poll_interval_minutes`, but the active fetch path currently uses the environment-driven per-source-type intervals above.

### Summarization And HTTP

| Variable | Default | Bounds | Notes |
| --- | --- | --- | --- |
| `SUMMARY_MAX_TOKENS` | `2048` | 256-8192 | Max generated summary tokens. |
| `SUMMARY_MAX_INPUT_LENGTH` | `100000` | 1000-500000 | Input is truncated before summarization. |
| `DISCORD_MAX_MESSAGE_LENGTH` | `2000` | 500-2000 | Poster truncates summaries to fit Discord. |
| `HTTP_TIMEOUT_SECONDS` | `30.0` | 5-120 | Shared HTTP client timeout. |
| `MAX_HTML_LENGTH` | `50000` | 10000-200000 | Max HTML sent into page/blog analysis. |

### Search, Vectors, And Lore

| Variable | Default | Bounds | Notes |
| --- | --- | --- | --- |
| `SEARCH_ENABLED` | `true` | bool | Enables embedding service, vector store, `/search`, `/index`, and lore ingestion. |
| `EMBEDDING_MODEL` | `all-MiniLM-L6-v2` | string | Sentence-transformers embedding model. |
| `EMBEDDING_DIMENSIONS` | `384` | >=1 | Must match the embedding model. |
| `ZVEC_DATA_DIR` | `data/vectors` | path | Local vector collection directory. |
| `SEARCH_RESULT_LIMIT` | `5` | 1-25 | Final article results returned. |
| `ARTICLE_CHUNK_SIZE_CHARS` | `1200` | 200-4000 | Article chunk target size. |
| `ARTICLE_CHUNK_OVERLAP_CHARS` | `200` | 0-1000 | Chunk overlap. |
| `ARTICLE_SEARCH_CANDIDATE_LIMIT` | `24` | 5-100 | Vector candidates before reranking. |
| `ARTICLE_SEARCH_MIN_RELEVANCE_SCORE` | `0.35` | 0.0-1.0 | Result cutoff. |
| `ARTICLE_SEARCH_RERANKER_ENABLED` | `true` | bool | Uses a cross-encoder when available. |
| `ARTICLE_SEARCH_RERANKER_MODEL` | `cross-encoder/ms-marco-MiniLM-L6-v2` | string | Reranker model. |
| `LORE_CHUNK_GAP_MINUTES` | `10` | 1-60 | Gap that starts a new message chunk. |
| `LORE_CHUNK_MAX_MESSAGES` | `20` | 5-100 | Max messages per lore chunk. |
| `LORE_SEARCH_RESULTS` | `15` | 1-50 | Intended lore retrieval count. Query is currently disabled. |

Changing `EMBEDDING_MODEL` usually requires changing `EMBEDDING_DIMENSIONS`. The vector store writes metadata and recreates incompatible collections when dimensions or model metadata do not match.

### Storage And Logging

| Variable | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `sqlite+aiosqlite:///./data/intelstream.db` | Runtime repository supports SQLite only, even though `Settings` can parse other URLs. |
| `DISCORD_CHANNEL_ID` | unset | Legacy default channel and command restriction. When set, commands are allowed only in that channel and legacy sources without channels are migrated to it. |
| `LOG_LEVEL` | `INFO` | One of `DEBUG`, `INFO`, `WARNING`, `ERROR`, `CRITICAL`. |

## Commands

Commands are guild-scoped slash commands synced on startup.

### Content Source Commands

| Command | Permission | Description |
| --- | --- | --- |
| `/source add source_type:<choice> name:<name> url:<url> [summarize:true] [channel:#channel]` | Manage Server | Add a source. Defaults to the current channel if `channel` is omitted. |
| `/source list` | None | List sources configured for the current channel. |
| `/source info name:<name>` | None | Show source details, status, failures, feed URL, discovery strategy, and summary setting. |
| `/source remove name:<name>` | Manage Server | Archives the source after confirmation. Existing content remains in the database and search index. |
| `/source toggle name:<name>` | Manage Server | Enable or pause polling for a source. |

Examples:

```text
/source add source_type:RSS name:"Release Feed" url:https://github.blog/changelog/feed/
/source add source_type:YouTube name:"3Blue1Brown" url:https://www.youtube.com/@3blue1brown summarize:false channel:#videos
/source add source_type:Arxiv name:"AI Papers" url:cs.AI channel:#papers
/source info name:"AI Papers"
/source toggle name:"Release Feed"
```

`summarize:false` stores and posts the item URL without fetching transcripts or generating summaries. This lets Discord generate native embeds, which is especially useful for YouTube.

### Configuration Commands

| Command | Permission | Description |
| --- | --- | --- |
| `/config channel channel:#channel` | Manage Server | Set the guild fallback output channel. |
| `/config show` | Manage Server group default | Show output channel, active source count, and content poll interval. |

Per-source `channel` settings take priority over the guild fallback channel.

### Summaries, Search, And Lore

| Command | Permission | Cooldown | Description |
| --- | --- | --- | --- |
| `/summarize url:<url>` | None | 10 uses per 5 minutes | Fetch and summarize a YouTube video, Substack article, or web page. |
| `/summary [count:200] [channel:#channel]` | None | 1 use per channel per minute | Summarize 10-500 recent non-bot messages. |
| `/search query:<text>` | None | 5 uses per minute | Search indexed summarized articles. |
| `/index` | Administrator | None | Rebuild the article semantic search index. |
| `/lore query:<text> [channel:#channel] [timeframe:<text>]` | None | None | Registered, but currently responds that lore is temporarily disabled. |

Examples:

```text
/summarize url:https://example.com/article
/summary count:100 channel:#general
/search query:"articles about model evaluation and data quality"
/index
```

### GitHub Commands

| Command | Permission | Description |
| --- | --- | --- |
| `/github add repo_url:<owner/repo-or-url> [channel:#channel] [track_commits:true] [track_prs:true] [track_issues:true]` | Manage Server | Validate and monitor a repository. |
| `/github list [channel:#channel]` | None | List repositories monitored in the current or selected channel. |
| `/github remove repo:<owner/repo>` | Manage Server | Stop monitoring after confirmation. |
| `/github toggle repo:<owner/repo>` | Manage Server | Pause or resume monitoring. |

Examples:

```text
/github add repo_url:python/cpython channel:#github track_commits:true track_prs:false track_issues:false
/github list channel:#github
/github toggle repo:python/cpython
```

The first GitHub poll initializes state without posting historical events. Later polls post new commits, PRs, and issues.

### Message Forwarding Commands

| Command | Permission | Description |
| --- | --- | --- |
| `/forward add source:#channel destination:#thread` | Administrator command default; Manage Server runtime check | Create a forwarding rule. |
| `/forward list` | Administrator command default | List forwarding rules for the server. |
| `/forward remove source:#channel destination:#thread` | Administrator command default; Manage Server runtime check | Delete a forwarding rule. |
| `/forward pause source:#channel destination:#thread` | Administrator command default; Manage Server runtime check | Disable a rule. |
| `/forward resume source:#channel destination:#thread` | Administrator command default; Manage Server runtime check | Enable a paused rule. |

Forwarding preserves message text and up to 10 attachments, subject to Discord file-size limits and a 25 MB total attachment cap. Forwarded text cannot trigger user, role, or `@everyone` notifications. If a message has content, embeds are not copied so Discord can generate native previews. Embed-only messages forward up to Discord's 10-embed limit.

### Status And Other Commands

| Command | Description |
| --- | --- |
| `/status` | Show uptime, latency, content counts, source status, forwarding rules, and default output channel. |
| `/ping` | Show bot latency. |
| `/suck_boobs` | Novelty command loaded by `SuckBoobs` cog. |
| `/suck_boobs_score` | Novelty leaderboard stored in `suck_boobs_stats`. |

Remove `SuckBoobs` from `IntelStreamBot.setup_hook()` if that cog is not appropriate for your server.

## Supported Sources

| Source type | Example `url` | Required key | How it works |
| --- | --- | --- | --- |
| `Substack` | `https://example.substack.com` or custom domain | None | Builds `https://host/feed` and parses RSS content. |
| `YouTube` | `https://www.youtube.com/@channel`, `/channel/UC...`, `/c/name` | `YOUTUBE_API_KEY` | Resolves channel, reads uploads playlist, fetches up to `YOUTUBE_MAX_RESULTS`, and fetches transcripts unless `summarize:false`. |
| `RSS` | `https://example.com/feed.xml` | None | Parses RSS or Atom with `feedparser`. |
| `Arxiv` | `cs.AI`, `stat.ML`, `https://arxiv.org/list/cs.AI/recent`, `https://arxiv.org/rss/cs.AI` | None | Uses `https://arxiv.org/rss/<category>`, tries arxiv HTML full text, and falls back to the abstract. |
| `Blog` | `https://example.com/blog` | `ANTHROPIC_API_KEY` | Tries RSS discovery, sitemap discovery, then Anthropic-assisted extraction. Extracts article text with `trafilatura` and HTML fallbacks. |
| `Twitter` | `https://x.com/username` or `https://twitter.com/username` | `TWITTER_BEARER_TOKEN` | Uses X API v2, excludes retweets/replies, fetches 5 tweets per poll, includes quoted tweet text when available. |
| `Page` | `https://example.com/articles` | `ANTHROPIC_API_KEY` | Anthropic analyzes the listing page and stores CSS selectors in the source extraction profile. |

URL fetches use SSRF validation that rejects localhost, private IPs, link-local addresses, non-HTTP schemes, obfuscated IP forms, and hostnames resolving to private IPs. Redirects are followed manually and every hop is revalidated; decoded response bodies and sitemap decompression are size-limited before parsing.

## Feature Behavior

### Content Pipeline

The background content loop lives in `ContentPosting` and runs every `CONTENT_POLL_INTERVAL_MINUTES`.

```text
Source rows in SQLite
  -> adapter fetch
  -> content_items rows
  -> pending summarization
  -> optional article chunk embeddings
  -> Discord posting
```

Notable details:

- Existing content is de-duplicated by `external_id`.
- On the first poll for a source, older fetched items are marked as `backfilled` so a new source does not dump a large history into Discord. The newest item remains eligible for posting.
- Items from `summarize:false` sources are marked ready with an empty summary and posted as bare URLs.
- Source-specific channels win over `/config channel`.
- If the content loop fails repeatedly, it applies exponential backoff and eventually switches to hourly retries.

### Summaries

`SummarizationService` asks the LLM for:

- One `Thesis` sentence.
- A `Key Arguments` list.
- Specific details, examples, caveats, and numbers where present.

The service retries LLM rate-limit errors up to 3 attempts with exponential backoff. It also rejects common "I cannot access this article" style model refusals.

### Article Search

When search is enabled:

- `EmbeddingService` loads the configured sentence-transformers model.
- `VectorStore` stores article chunks under `data/vectors/article_chunks`.
- New summarized content is chunked and embedded during summarization.
- `/index` can rebuild the article chunk metadata and vector collection.
- `/search` embeds the query, retrieves vector candidates, optionally reranks them, aggregates chunks by article, and returns only results above `ARTICLE_SEARCH_MIN_RELEVANCE_SCORE`.

The first run can download model weights and may take longer than normal startup.

### Lore Ingestion

The lore subsystem stores real-time and historical message chunks with embeddings, and `auto_start_ingestion()` starts a backfill for the first guild on bot ready. It skips bot messages, system messages, slash-command messages, empty messages, emoji-only chunks, URL-only chunks, and very small chunks.

Current limitation: the public `/lore` command is intentionally disabled in `src/intelstream/discord/cogs/lore.py`; it always sends a temporary-disabled response.

### GitHub Monitoring

GitHub monitoring uses `GITHUB_TOKEN` and the GitHub REST API version `2022-11-28`.

- Commits are tracked by latest SHA.
- Pull requests and issues are tracked by latest number.
- Pull requests are fetched with `state=all`; merged PRs are labeled as merged.
- Issues skip PR-backed issue objects.
- Repositories are disabled after repeated per-repo failures.
- The polling loop also has exponential backoff and owner notifications.

### Message Forwarding

The forwarding cog caches active rules and listens for messages in source channels. It does not forward messages sent by the bot itself.

Forwarding destinations can be text channels or threads. Archived destination threads are unarchived before posting when permissions allow it.

## Data And Files

| Path | Purpose |
| --- | --- |
| `.env` | Local secrets and runtime configuration. Ignored by git. |
| `.env.example` | Safe configuration template. |
| `pyproject.toml` | Package metadata, dependencies, script entry point, ruff, mypy, pytest, coverage, and bandit config. |
| `uv.lock` | Locked Python dependency graph. |
| `data/intelstream.db` | Default SQLite database path. Created at runtime. Ignored by git. |
| `data/vectors/` | zvec article and message vector collections. Created at runtime. Ignored by git. |
| `scripts/eval_article_search.py` | Semantic search evaluation script. |
| `.github/workflows/ci.yml` | CI jobs for lint, typecheck, tests, coverage upload, and security scans. |
| `tests/` | Unit and integration-style tests for adapters, services, cogs, config, database, and utilities. |

Main database tables are declared in `src/intelstream/database/models.py`:

| Table | Stores |
| --- | --- |
| `sources` | Content source configuration, channel routing, discovery metadata, failures, and summary mode. |
| `content_items` | Fetched articles/videos/tweets/posts and posting state. |
| `article_chunk_meta` | Search chunks for summarized content. |
| `discord_config` | Guild-level output channel. |
| `extraction_cache` | Cached blog LLM extraction results. |
| `forwarding_rules` | Channel/thread forwarding rules. |
| `message_chunk_meta` | Lore/message-history chunks. |
| `ingestion_progress` | Lore backfill checkpoints. |
| `github_repos` | GitHub repository monitor state. |
| `suck_boobs_stats` | Novelty command usage and leaderboard data. |

## Running Locally

Basic run:

```bash
uv run intelstream
```

Run with debug logs:

```bash
LOG_LEVEL=DEBUG uv run intelstream
```

Use a separate local database:

```bash
DATABASE_URL=sqlite+aiosqlite:///./data/dev-intelstream.db uv run intelstream
```

For a long-running deployment, run the command under your process manager of choice and persist both `data/intelstream.db` and `data/vectors/`. There is no Dockerfile or migration tool in the current repository; SQLite tables are created at startup and selected `sources` columns are migrated opportunistically.

## Development

Install dev dependencies:

```bash
uv sync --extra dev
```

Validation commands used by CI:

```bash
uv run ruff check .
uv run ruff format --check .
uv run mypy src/
uv run pytest --cov=intelstream --cov-report=xml --cov-report=term-missing
uv run pip-audit
uv run bandit -r src/ -c pyproject.toml
```

Useful local test commands:

```bash
uv run pytest
uv run pytest -x
uv run pytest -k "youtube"
uv run pytest tests/test_config.py
```

Article search evaluation:

```bash
uv run python scripts/eval_article_search.py path/to/eval_cases.json
```

Evaluation file format:

```json
[
  {
    "label": "policy post",
    "query": "What did we post about frontier model regulation?",
    "expected_content_item_id": "8f3d7c0e-..."
  },
  {
    "label": "training writeup",
    "query": "article about data quality problems during training",
    "expected_ids": ["1d2c3b4a-...", "5e6f7a8b-..."]
  }
]
```

## Troubleshooting

| Symptom | Likely cause | What to check |
| --- | --- | --- |
| Bot exits with `No API key configured for LLM provider` | `LLM_PROVIDER` does not have its matching API key. | Set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, or `KIMI_API_KEY`. |
| Slash commands do not appear | Bot is not installed with `applications.commands`, wrong guild ID, or startup did not complete. | Check install scopes, `DISCORD_GUILD_ID`, and startup logs for command sync. |
| Commands work only in one channel | `DISCORD_CHANNEL_ID` is set. | Remove it unless you intentionally want command restriction. |
| `/source add` rejects YouTube | Missing `YOUTUBE_API_KEY`. | Add a YouTube Data API key. |
| `/source add` rejects Blog or Page | Missing `ANTHROPIC_API_KEY`. | Blog and Page analysis are Anthropic-specific. |
| `/github add` says monitoring unavailable | Missing `GITHUB_TOKEN`. | Set a GitHub PAT with access to the target repository. |
| `/summarize` rejects a URL | Invalid URL, unsupported scheme, SSRF protection, Twitter/X URL, missing YouTube key, or insufficient page content. | Use public HTTP/HTTPS URLs and check source-specific keys. |
| No content posts after adding a source | First poll may only post the newest item; source may not be due yet; no output channel; missing bot permissions; source has no new content. | Run `/status`, `/source info`, and `/config show`; check logs. |
| Search unavailable on startup | Search index is rebuilding or model/vector initialization failed. | Wait for index rebuild, check logs, verify `EMBEDDING_DIMENSIONS`, and ensure model downloads can complete. |
| `/lore` does not answer questions | Current code disables the query command. | This is expected until `lore.py` is completed. |
| Forwarding misses embeds | Expected for messages with text content. | Embed-only messages are copied; URL messages rely on Discord previews. |
| SQLite path error | Empty SQLite URL or unsupported database backend. | Use a non-empty `sqlite+aiosqlite:///...` URL. |

## Project Structure

```text
src/intelstream/
|-- adapters/                  # Source adapters and discovery strategies
|   |-- arxiv.py
|   |-- page.py
|   |-- rss.py
|   |-- smart_blog.py
|   |-- substack.py
|   |-- twitter.py
|   |-- youtube.py
|   `-- strategies/
|-- database/
|   |-- models.py              # SQLAlchemy models
|   |-- repository.py          # Async SQLite repository
|   `-- vector_store.py        # zvec collections
|-- discord/cogs/
|   |-- channel_summary.py     # /summary
|   |-- config_management.py   # /config
|   |-- content_posting.py     # background content loop
|   |-- github.py              # /github
|   |-- github_polling.py      # GitHub background loop
|   |-- lore.py                # message ingestion and disabled /lore command
|   |-- message_forwarding.py  # /forward and listener
|   |-- search.py              # /search and /index
|   |-- source_management.py   # /source
|   |-- summarize.py           # /summarize
|   `-- suck_boobs.py          # novelty commands
|-- services/
|   |-- article_search.py
|   |-- content_extractor.py
|   |-- content_poster.py
|   |-- embedding_service.py
|   |-- github_poster.py
|   |-- github_service.py
|   |-- llm_client.py
|   |-- message_forwarder.py
|   |-- message_ingestion.py
|   |-- page_analyzer.py
|   |-- pipeline.py
|   |-- search_eval.py
|   |-- summarizer.py
|   `-- web_fetcher.py
|-- bot.py                     # Bot class, cogs, startup, shutdown
|-- config.py                  # Pydantic settings
`-- main.py                    # Console entry point
```

## License

This repository currently does not include a root `LICENSE` file or a license field in `pyproject.toml`. Add one before distributing it as open source.
