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
- [Hands Activity](#hands-activity)
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
| Hands Activity | Discord's App Launcher Entry Point launches an authoritative two-fighter boxing Activity with read-only spectators and posts a native **Play now** message; `/hands_scoreboard` reports server-persisted ELO and records. |

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

Then replace the required placeholders. Leave `DISCORD_CHANNEL_ID` commented unless you intentionally want legacy command restriction to a single channel; uncomment optional integrations only when you configure them.

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

Configuration is loaded with `pydantic-settings` from environment variables and `.env`. Names are case-insensitive and unknown variables are ignored. Credential values are trimmed, blank credentials are rejected, and secret values remain masked in settings representations and serialization.

Do not commit `.env`. It is ignored by `.gitignore`; `.env.example` is the copy-safe template and lists every supported runtime setting. Optional values are commented out until you need them.

### Required Runtime Variables

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `DISCORD_BOT_TOKEN` | Yes | None | Discord bot token. Empty strings are rejected. |
| `DISCORD_GUILD_ID` | Yes | None | Positive guild ID where slash commands are synced. |
| `DISCORD_OWNER_ID` | Yes | None | Positive user ID for owner notifications. |
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

At pipeline startup, the effective environment-driven intervals above are synchronized to each source's stored `poll_interval_minutes`. The fetch path then uses those stored values for due-time checks, so configuration changes take effect after restart without adding delay for sources that are not due.

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
| `ARTICLE_CHUNK_OVERLAP_CHARS` | `200` | 0-1000 | Chunk overlap; must also be smaller than `ARTICLE_CHUNK_SIZE_CHARS`. |
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
| `DATABASE_URL` | `sqlite+aiosqlite:///./data/intelstream.db` | SQLite with the async `aiosqlite` driver is required; unsupported URLs fail during configuration loading. |
| `DISCORD_CHANNEL_ID` | unset | Legacy default channel and command restriction. When set, commands are allowed only in that channel and legacy sources without channels are migrated to it. |
| `LOG_LEVEL` | `INFO` | One of `DEBUG`, `INFO`, `WARNING`, `ERROR`, `CRITICAL`. |

### Hands Activity Configuration

Hands is disabled unless `HANDS_ENABLED=true`. It additionally requires `DISCORD_CLIENT_SECRET`, the existing `DISCORD_GUILD_ID` and bot token, and the authenticated application's ID supplied by Discord at startup.

| Variable | Default | Notes |
| --- | --- | --- |
| `HANDS_ENABLED` | `false` | When true, starts the Activity server and configures its App Launcher Entry Point; when false, removes that managed Entry Point at startup. |
| `DISCORD_CLIENT_SECRET` | unset | Required only when Hands is enabled. Server-only OAuth credential; never expose it to Vite or a browser. |
| `HANDS_HOST` | `127.0.0.1` | Keep this loopback bind behind a same-host reverse proxy. Use `0.0.0.0` only when a container/platform requires it. |
| `HANDS_PORT` | `8080` | Local HTTP/WebSocket listener port. |
| `HANDS_DEV_MODE` | `false` | Allows localhost browser origins for the two-process development setup. Never use as a substitute for production TLS/origin policy. |
| `HANDS_TRUSTED_PROXY_CIDRS` | unset | Comma-separated exact proxy networks allowed to supply `X-Forwarded-For`; leave unset for direct peers and never trust an all-addresses network. |

Log timestamps are emitted in UTC. Human-friendly ANSI colors are used only when standard output is attached to a terminal, so redirected logs remain plain text. The startup record includes the selected models, polling cadence, search state, and enabled optional integrations without including credentials.

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
| `/hands_scoreboard` | Show the guild's top ten Hands ELO records and the caller's rank. |
| App Launcher → BunkerIntel | Launch Hands through Discord's native Entry Point and post **Play now** in the channel. |

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

## Hands Activity

Hands is a guild-only, ranked, two-fighter boxing Activity with up to 20 concurrent read-only spectators per fight. Open Discord's **App Launcher** in a guild text or voice channel, search for **BunkerIntel**, and select it; the Entry Point is not a slash command. Discord launches the Activity and automatically posts its native **Play now** message in the channel. The first two distinct authenticated members in the Activity receive immutable fighter seats. Later authenticated guild members in that same Activity instance spectate the safe public fight state without input, seat, result, persistence, or ELO authority. A disconnected spectator is never promoted, while disconnected fighters retain their seats for the normal reconnect grace period.

`/hands_scoreboard` displays the guild's top ten plus the caller's rank, W-L-D record, knockouts, streak, bouts, and rating. New fighters start at **1000 ELO**. Completed results are written by the server with **K=32** ELO; draws score 0.5 and the applied integer delta is zero-sum. The browser cannot submit winners, scorecards, damage, identities, seats, or rating changes.

### Authority, authentication, and reconnects

The Python engine is authoritative at 30 ticks per second. Clients send only bounded movement, held guard, and semantic actions; they interpolate server snapshots and authoritative events. OAuth derives the canonical Discord user, verifies configured-guild membership and the current Activity instance, and then uses short-lived, one-use, HMAC-signed game tickets. The SDK requests only `identify` and `guilds.members.read` and uses `prompt: "none"`, so Discord can silently reuse an existing grant after the first consent. OAuth codes, access tokens, state, tickets, the bot token, and the client secret stay out of URLs and logs; only nonsensitive display preferences use browser storage.

A disconnect pauses the bout and shows the connected opponent a live reconnect countdown. Inputs arriving while either seat is disconnected are counted for abuse control but discarded before parsing or changing authoritative sequence/engine state. The disconnected user can reconnect during the server's cumulative 20-second grace period with a rotated one-use ticket and receive current state; if the opponent is still absent, recovery is ordered as welcome, redacted snapshot, then paused state with the remaining opponent grace. The server refreshes the in-memory reconnect ticket before expiry during long waits and bouts; the client keeps only the latest ticket inside its network controller and acknowledges receipt before the server invalidates the older ticket generation. Grace expiry awards a server-side forfeit. A client's own transport drop uses an independent fresh 20-second retry window rather than reusing any opponent countdown it was displaying. If ticket delivery was interrupted, the client performs fresh OAuth. A final message is sent only after the idempotent match/rating transaction succeeds and includes method, winner or draw, all three cards, and before/after ratings.

### Match and boxing mechanics

- A standard bout has three two-minute rounds, a three-second opening countdown, and 15-second rests. Movement is bounded by the ring, fighters auto-face, cannot overlap, and center position/forward pressure contribute ring control.
- Each left or right jab, straight, hook, and uppercut has distinct startup, active, recovery, reach, lateral arc, impact, guard/poise damage, stamina cost, and whiff cost. Head/body and normal/power variants change those tradeoffs. Stance determines lead-hand jab speed and rear-straight power.
- Compatible jab→straight, jab→hook, straight→hook, hook→uppercut, and uppercut→hook chains reduce cost and add impact inside the combo window. Startup/recovery vulnerability, successful evasions, and perfectly timed blocks open counter windows; counters receive an impact/poise bonus.
- High guard covers head and low guard covers body. Guard absorbs damage until it breaks and regenerates only while sufficiently inactive; a narrow new-guard window is a stronger perfect block. Slips evade the matching straight-line hand, weaving handles hooks, and a pull evades long head jabs/straights. Evasions cost stamina and do not make every punch miss.
- Stamina governs the current exchange. Fight-long conditioning and body trauma reduce maximum stamina, regeneration, movement/hand speed, guard recovery, and effective output; attacks, power, misses, evasions, clinches, fouls, and damage impose costs. Walking and residual movement do not spend stamina or conditioning, but stamina regeneration waits until the fighter actually stops. Rest restores bounded stamina/guard/poise but does not erase accumulated fatigue.
- Discrete controls use a responsive short intent buffer rather than a command backlog. Repeated identical actions coalesce, only the newest changed intent is retained, newer input replaces stale intent, held guard cancels stale buffered attacks, and unexecuted intent expires after six simulation ticks. Client queues apply the same newest-intent policy, while the Python engine remains authoritative.
- A close-range clinch has vulnerable startup and can be denied or interrupted. A successful finite hold cancels attacks, lets both regain a little stamina while spending conditioning, and ends in referee separation.
- Low blows and headbutts are deliberate, costly fouls: misses still cost resources; a landed foul causes a recovery pause and warning, warning two deducts a point, and warning three disqualifies the offender.
- Head/body and left/right eye trauma persist. Hooks intensify eye damage; damaged eyes reduce reach/accuracy. Cuts increase bleeding, bleeding adds head trauma and fatigue, swelling accumulates, and cut/swelling thresholds can cause a doctor stoppage. Blood event amounts are authoritative, while spray, pooling, audio, and shake are cosmetic only.
- Poise depletion or a sufficiently damaging head shot causes a knockdown; three knockdowns cause a TKO. During the ten-count, the downed fighter alone sees a seeded private left/right rhythm prompt. Press the shown direction inside its timing window: centered timing gains more meter, while early, late, wrong, or spam inputs lose progress. Repeated knockdowns and head trauma raise the requirement; failure by ten is a KO.
- A rare seeded flash KO is possible only from a clean, unguarded, non-jab power counter when the attacker retains stamina and the defender is already hurt or fatigued. The deterministic roll is recorded in the event ledger; ordinary neutral or guarded shots do not qualify.
- At each bell, three transparent judges score damage, clean hits, defense (blocks/evasions), and control with different **Impact**, **Craft**, and **Generalship** weights. Ten-point scoring includes knockdown and foul deductions (floor six); card votes produce decision or draw. Other final methods are KO, flash KO, TKO, doctor stoppage, disqualification, and forfeit.

### Exact controls

Keyboard controls use physical key positions (`KeyboardEvent.code`):

| Action | Keyboard |
| --- | --- |
| Move | `W` / `A` / `S` / `D` |
| High / low guard | Hold `Q` / `E` |
| Left / right jab | `F` / `J` |
| Left / right straight | `R` / `U` |
| Left / right hook | `G` / `H` |
| Left / right uppercut | `T` / `Y` |
| Body / power modifier | Hold either `Shift` / either `Alt` while starting the punch |
| Slip left / slip right | `Z` / `X` |
| Weave / pull | `C` / `V` |
| Clinch / switch stance | `B` / `N` |
| Low blow / headbutt | `1` / `2` |
| Private get-up rhythm | `Left Arrow` / `Right Arrow` |

Standard-controller controls are:

| Action | Controller |
| --- | --- |
| Move | Left stick |
| High / low guard | Left shoulder / right shoulder; guard is independent of punch selection |
| Face-button punch class | Bottom (`A`/Cross) jab; right (`B`/Circle) straight; left (`X`/Square) hook; top (`Y`/Triangle) uppercut |
| Face-button hand | Hold D-pad left for left hand or D-pad right for right hand, then press a face button; without a selector it uses the right hand. A selector used by a punch is consumed and does not also evade. |
| Body / power | Left trigger / right trigger; right-stick gestures latch these modifiers when the gesture starts |
| Slip left / right | Tap and release D-pad left / right without consuming it in a face punch |
| Weave / pull | D-pad up / down |
| Clinch / switch stance | Left-stick press / right-stick press |
| Low blow / headbutt | View/Back / Menu/Start |
| Private get-up rhythm | While down, press D-pad left / right; it registers immediately rather than waiting for release |

The right stick also performs one punch after a center→peak→center gesture. Left/right direction selects the hand. Using the absolute angle from horizontal: **0–22.5° hook**, **22.5–45° jab**, **45–70° straight**, and **70–90° uppercut**. The gesture fires once only after returning to center; trigger modifiers are captured at gesture start. Face/D-pad punches are the accessibility alternative when stick gestures are impractical.

### Presentation and settings

The committed client renders a real-time 3D broadcast presentation with WebGL (pinned three.js): a procedurally modeled arena, canvas-textured ring, a referee, dynamic lighting and shadows, and GPU particle effects—including deliberately over-the-top, full-mode arcade gore—plus generated Web Audio. The fighters use the realistic “Boxer” rig by Texel, Inc. (CC BY 4.0; source, attribution, and modification notice in `web/hands/assets-src/Boxer.LICENSE.txt`) driven by authored clips retarget-baked from the project's own boxing motion (idle, movement, guards, all punches both hands, reactions, knockdown, get-up), phase-locked to the authoritative simulation via combat-manifest.json. All arena meshes, textures, and sounds remain generated in code. **Blood defaults to graphic `full` mode**; Settings can select `full`, `reduced`, or `off` without changing authoritative trauma or HUD information. Settings also provide master audio volume, haptics on/off, and reduced motion. Audio unlocks only after user interaction and suspends while hidden; haptics are feature-detected and limited to bounded authoritative impact events. Reduced motion removes particles/shake while preserving match state and private get-up information.

Before a public release, review Discord's current violent-content rules, age rating/restriction controls, store/application disclosures, and regional requirements. Do not add external/borrowed assets, commercial boxing-game UI, audio, animation traces, real-fighter or celebrity likenesses, sanctioning-body/brand marks, logos, or recognizable trade dress. All fighter art, interface, motion, terminology, and sound must remain original.

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
| `scripts/check_hands_wheel.py` | Executable stdlib wheel check for the exact nonempty Hands HTML/JS/CSS bundle and its safety invariants. |
| `web/hands/` | Node 24 strict TypeScript/Vite source, Vitest tests, lockfile, and production scanner for Hands. |
| `src/intelstream/hands/static/` | Three committed generated Activity artifacts shipped as Python package resources. Do not hand-edit them. |
| `.github/workflows/ci.yml` | CI jobs for Python quality/security plus Hands frontend drift and installed-wheel resource gates. |
| `tests/` | Unit and integration-style tests, including Hands engine/auth/server/static/wheel coverage. |

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
| `hands_ratings` | Per-guild Hands ELO, W-L-D, KO, knockdown, streak, and bout totals. |
| `hands_matches` | Idempotent authoritative match result, scorecards, and pre/post ratings. |

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

For a long-running deployment, run the command under your process manager of choice and persist both `data/intelstream.db` and `data/vectors/`. There is no Dockerfile or standalone migration tool in the current repository; SQLite tables, selected `sources` columns, and content-query indexes are reconciled at startup.

### Deploying Hands and configuring the Developer Portal

1. In the **same Discord application as the bot**, enable Activities and set the Activity URL mapping for `/` to the public HTTPS origin that serves Hands. The mapping target must be public HTTPS, not the loopback listener.
2. On the application's **OAuth2** page, add `https://127.0.0.1` under **Redirects** and save it. Discord requires a Redirect URI for Activity authorization even though the Embedded App SDK handles returning to the Activity; this placeholder is the value specified by Discord's Activity guide.
3. Configure Activity OAuth for exactly `identify` and `guilds.members.read`. Install the guild app with both `bot` and `applications.commands` scopes, and keep **Server Members Intent** enabled. Message Content Intent remains needed by other IntelStream features.
4. Verify `DISCORD_GUILD_ID`, the authenticated application/client ID, and `DISCORD_CLIENT_SECRET`. Store the client secret and bot token only in the server environment. Never put either secret—or OAuth codes, access tokens, or game tickets—in a URL, Vite variable, browser/local storage, analytics, or logs.
5. Run the Python listener on `127.0.0.1:HANDS_PORT`. Put a public TLS reverse proxy on the mapped origin and proxy `/`, `/api/hands/*`, and WebSocket upgrades to that listener. Preserve HTTPS/WSS, Host, and upgrade headers; do not expose the plaintext loopback port publicly. Hands applies global and per-client request/concurrency ceilings using the direct peer address. If the proxy supplies `X-Forwarded-For`, set `HANDS_TRUSTED_PROXY_CIDRS` to only the exact proxy network(s) that connect to Hands (for example `127.0.0.1/32,::1/128` for a loopback proxy), configure the proxy to overwrite or append the real client address, and prevent clients from bypassing that proxy. Forwarded headers from any unlisted peer are ignored; never configure an all-addresses CIDR.
6. Start `uv run intelstream` and confirm startup configures one guild-only global `hands` Entry Point with Discord handler `DISCORD_LAUNCH_ACTIVITY`. Confirm the public `/healthz`, open Discord's App Launcher, search for BunkerIntel, and launch it. Have a second distinct guild member select **Play now** on Discord's channel message, then have a third member join and confirm they see **SPECTATING · READ ONLY** with no gameplay input. Confirm only the first two seats affect the match and ELO. A single process owns in-memory OAuth state, rooms, spectators, and reconnect tickets; do not horizontally scale Hands without shared authoritative state/routing.
7. Complete the violent-content/age-rating/disclosure and originality reviews described above before public distribution.

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

### Hands frontend and generated bundle

Use Node.js 24. The lockfile is authoritative; do not use an unlocked install:

```bash
npm --prefix web/hands ci
npm --prefix web/hands run typecheck
npm --prefix web/hands run test:run
npm --prefix web/hands audit --audit-level=high
npm --prefix web/hands run build
npm --prefix web/hands run scan:build
git diff --exit-code -- src/intelstream/hands/static
```

`npm run build` typechecks, writes exactly `index.html`, `assets/hands.js`, and `assets/hands.css` into `src/intelstream/hands/static`, and runs the scanner. Those generated files are committed so production Python installations do not require Node. Change TypeScript/CSS in `web/hands`, rebuild, inspect the output, commit source and generated files together, and require the final `git diff --exit-code` after a clean rebuild. Never hand-edit the generated bundle.

The fixed three-file deployment contract embeds the Boxer rig and its five source textures in `hands.js`; the resulting production script is intentionally about 5.6 MB (about 2.9 MB gzip). This startup-cost tradeoff keeps the Activity self-contained and avoids runtime asset requests.

For a standalone presentation fixture, run `npm --prefix web/hands run dev` and open the printed URL with `?fixture=1`. For the real two-process localhost flow, terminal one runs the Python bot/Hands server with valid Discord credentials:

```bash
HANDS_ENABLED=true HANDS_DEV_MODE=true HANDS_HOST=127.0.0.1 HANDS_PORT=8080 uv run intelstream
```

Terminal two runs Vite and proxies HTTP plus WebSocket `/api/hands` requests to Python:

```bash
HANDS_DEV_BACKEND=http://127.0.0.1:8080 npm --prefix web/hands run dev
```

`HANDS_DEV_BACKEND` is a Node/Vite development-process setting, not a browser `VITE_*` value and not a production origin. Real OAuth still needs a valid Activity instance; the fixture is only recorded presentation data. Keep `HANDS_DEV_MODE=false` in production.

### Wheel/package verification

Build both distributions and inspect the one wheel path:

```bash
rm -rf dist
uv build
scripts/check_hands_wheel.py dist/intelstream-*.whl
uv run pytest tests/test_hands/test_static_bundle.py tests/test_hands/test_wheel_checker.py
```

Smoke the installed wheel without dependencies in a temporary environment (POSIX example):

```bash
uv venv /tmp/intelstream-hands-wheel --python 3.12
uv pip install --python /tmp/intelstream-hands-wheel/bin/python --no-deps dist/intelstream-*.whl
/tmp/intelstream-hands-wheel/bin/python - <<'PY'
from importlib import resources

root = resources.files("intelstream.hands").joinpath("static")
assert root.joinpath("index.html").read_bytes()
assert root.joinpath("assets", "hands.js").read_bytes()
assert root.joinpath("assets", "hands.css").read_bytes()
print("installed Hands resources are present and nonempty")
PY
```

The CI packaging job additionally proves that these are the exact three files in the installed resource tree and serves them in the static tests with their production MIME, cache, CSP, and security headers.

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
| Hands fails to launch or shows unavailable | `HANDS_ENABLED` is false, `DISCORD_CLIENT_SECRET`/application auth is missing, Entry Point setup or bind failed, or startup did not complete. | Check Hands startup logs, enabled settings, the global `hands` Entry Point, loopback host/port, and the client secret in the server environment. |
| Hands page fails to load or WebSocket disconnects | Activity `/` mapping, public TLS/WSS proxy, upgrade headers, CSP/origin, or proxy path is wrong. | Map `/` to the public HTTPS origin and proxy `/api/hands/ws` upgrades to `127.0.0.1:HANDS_PORT`; never map Discord to localhost. |
| Hands shows `authorize_failed` after consent | The application's required OAuth2 Redirect URI is missing or the Activity OAuth configuration is incomplete. | In the same application's OAuth2 settings, add `https://127.0.0.1` under Redirects and save it; verify `identify` and `guilds.members.read`. |
| Hands OAuth returns invalid activity/member | Wrong guild/application IDs, missing OAuth scopes, Server Members Intent disabled, stale launch, or user not in the Activity. | Verify `identify`, `guilds.members.read`, the configured guild, and two real guild members in the same Activity. |
| Vite cannot reach Python | The backend port differs or Python is not in development mode. | Set `HANDS_DEV_BACKEND=http://127.0.0.1:8080`, match `HANDS_PORT`, set `HANDS_DEV_MODE=true` locally only, and run both processes. |
| CI reports generated Hands drift | Frontend source and committed package bundle differ. | With Node 24 run `npm ci`, test, build, scanner, inspect the three generated files, and commit source plus bundle together. |
| Wheel checker reports missing/wrong assets | A stale build, wrong wheel glob, or package layout changed. | Remove `dist/`, run `uv build`, pass exactly one `.whl` to `scripts/check_hands_wheel.py`, then run the installed-resource smoke. |

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
|   |-- hands.py               # App Launcher Entry Point, /hands_scoreboard, server lifecycle
|   |-- lore.py                # message ingestion and disabled /lore command
|   |-- message_forwarding.py  # /forward and listener
|   |-- search.py              # /search and /index
|   |-- source_management.py   # /source
|   |-- summarize.py           # /summarize
|   `-- suck_boobs.py          # novelty commands
|-- hands/
|   |-- auth.py                # Discord OAuth/Activity validation and signed tickets
|   |-- engine.py              # deterministic authoritative boxing simulation
|   |-- protocol.py            # strict versioned WebSocket messages
|   |-- rating.py              # 1000-default, K=32 ELO calculation
|   |-- rooms.py               # two-fighter rooms, spectators, reconnect, persistence
|   |-- rules.py               # centralized combat/round tuning
|   |-- server.py              # aiohttp API, WebSocket, packaged static server
|   `-- static/                # committed generated HTML/JS/CSS package resources
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

web/hands/
|-- scripts/scan-build.mjs     # production bundle safety scanner
|-- src/                       # strict Activity client, input, rendering, tests
|-- package-lock.json          # Node 24 reproducible dependency graph
`-- vite.config.ts             # relative stable output and local Python proxy
```

`scripts/check_hands_wheel.py` verifies the built distribution independently with stdlib ZIP inspection.

## License

This repository currently does not include a root `LICENSE` file or a license field in `pyproject.toml`. Add one before distributing it as open source.
