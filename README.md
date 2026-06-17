# Grok Executive Suite

[![Release](https://img.shields.io/github/v/release/Printerpilot/grok-executive-suite?label=release&sort=semver)](https://github.com/Printerpilot/grok-executive-suite/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![macOS](https://img.shields.io/badge/macOS-Apple%20Silicon-000000?logo=apple)](https://github.com/Printerpilot/grok-executive-suite/releases/latest)
[![Grok Build](https://img.shields.io/badge/Requires-Grok%20Build-ff9500)](https://x.ai/news/grok-build-cli)
[![Community](https://img.shields.io/badge/Community-not%20official%20xAI-8e8e93)](DISCLAIMER.md)

**Delegate outcomes, not terminal commands.** A native macOS GUI for [Grok Build](https://x.ai/news/grok-build-cli) — projects, tasks, scheduled jobs, and full agentic delegation in one desktop workspace.

> **Community project.** Not affiliated with xAI. See [DISCLAIMER.md](DISCLAIMER.md).

**Download:** [Latest release (DMG)](https://github.com/Printerpilot/grok-executive-suite/releases/latest) · **Docs:** [Install guide](#install-end-users) · **Verify:** [`verify-setup.sh`](scripts/verify-setup.sh)

## The idea

Reduce everything on your computer to **executive functions**. You decide *what* needs done. Grok handles *how*.

Grok Executive Suite wraps Grok Build's full agentic power — projects, resumable tasks, scheduled jobs, working-folder context, connectors, progress tracking, and autonomy controls — in a desktop workspace built for people who prefer GUIs over shells.

## Features

- **Projects** — scoped workspaces with root path + working folders
- **Tasks** — persistent, resumable conversation threads per project
- **Scheduled tasks** — cron jobs with isolated run history and unread indicators
- **Progress** — per-task checklist synced via Grok's `update_goal` tool
- **Working folders** — directories injected into every Grok prompt
- **Connectors** — tools/MCPs used in each session (auto-tracked)
- **Act without asking** — toggles `--always-approve` for full autonomy
- **Desktop capture** — screenshot attach via menu or drag-and-drop
- **Message queue** — type while Grok runs; sends when done
- **Spellcheck** — native macOS spelling suggestions in the prompt

## Requirements

| Requirement | Details |
|-------------|---------|
| **Mac** | Apple Silicon (M1/M2/M3/M4) |
| **macOS** | 13 Ventura or newer (recommended) |
| **Subscription** | SuperGrok or X Premium Plus |
| **Grok Build CLI** | Installed at `~/.grok/bin/grok` |

Verify your system before installing:

```bash
curl -fsSL https://raw.githubusercontent.com/Printerpilot/grok-executive-suite/main/scripts/verify-setup.sh | bash
```

Or clone the repo and run:

```bash
npm run verify
```

## Install (end users)

### 1. Install Grok Build CLI

```bash
curl -fsSL https://x.ai/cli/install.sh | bash
```

Confirm it works:

```bash
~/.grok/bin/grok --version
```

Sign in with your xAI account when prompted.

### 2. Download Grok Executive Suite

1. Go to [GitHub Releases](https://github.com/Printerpilot/grok-executive-suite/releases)
2. Download **`Grok Executive Suite-0.3.2-arm64.dmg`**
3. Open the DMG and drag **Grok Executive Suite.app** to **Applications**

### 3. First launch (unsigned app)

macOS may block the first open because the build is not notarized:

- **Right-click** the app → **Open** → confirm, **or**
- **System Settings → Privacy & Security** → allow anyway

### 4. Start delegating

1. Launch **Grok Executive Suite**
2. Click **+ New Project** and pick any folder
3. Type what you need done in the chat — e.g. *"Review this repo and list the top 3 priorities"*
4. Optional: add **Working folders**, create **Scheduled tasks**, toggle **Act without asking**

If Grok Build is missing, an orange banner at the top explains how to install it.

## Data & persistence

All state lives locally at:

```
~/.grok-cowork/
├── state.json              # projects, scheduled tasks, settings
└── projects/
    └── <project-id>/
        ├── manifest.json   # tasks, progress, connectors
        └── <task-id>/
            ├── chat.jsonl
            └── attachments/
```

Your projects, tasks, and chat history survive app restarts.

## Build from source (developers)

```bash
git clone https://github.com/Printerpilot/grok-executive-suite.git
cd grok-executive-suite
npm install
npm run verify    # checks Grok CLI + Apple Silicon
npm start         # development
npm run dist      # produces dist/Grok Executive Suite-<version>-arm64.dmg
```

## Quick open of latest DMG (local build)

```bash
./install-update.sh
```

## Architecture

| Layer | Role |
|-------|------|
| `renderer/index.html` | UI (Electron renderer) |
| `main.js` | IPC, Grok process spawn, cron, persistence |
| `preload.js` | Secure bridge to renderer |
| `lib/task-store.js` | Per-project task/chat persistence |
| `lib/session-tracker.js` | Connector backfill from Grok session events |

Grok is invoked as:

```
~/.grok/bin/grok -p "<prompt>" --output-format streaming-json --cwd <project-root> [--always-approve] [--resume <session>]
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Orange "Grok Build CLI not found" banner | Run `curl -fsSL https://x.ai/cli/install.sh \| bash` |
| App won't open | Right-click → Open, or allow in Privacy & Security |
| Grok fails immediately | Ensure you're signed in; run `~/.grok/bin/grok` in Terminal |
| Scheduled task shows in main chat | Update to v0.3.0+ — runs are isolated to task details |
| Spellcheck not working | Restart app; requires macOS spellchecker enabled |

## License

MIT — see [LICENSE](LICENSE).

## Acknowledgments

Built by an enthusiastic Grok user who prefers GUIs to terminals. Thanks to Elon and the xAI team for Grok Build and the innovation they bring to builders worldwide.