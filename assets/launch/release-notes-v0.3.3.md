## Grok Executive Suite v0.3.3

Community macOS GUI for [Grok Build](https://x.ai/news/grok-build-cli) — delegate outcomes, not terminal commands.

### What's new

- **README screenshots** — marketing images for full workspace, scheduled tasks, and sidebar panels
- **Marketing capture pipeline** — `scripts/capture-marketing-screenshots.sh` for privacy-safe demo screenshots
- **Scheduled task process isolation** — cron runs no longer cancel active conversation tasks
- **Tilde path expansion** — `~/project` paths resolve correctly for Grok `--cwd`
- **Missing project directory guard** — clear error when project root doesn't exist

### Requirements

- Mac with Apple Silicon (M1/M2/M3/M4)
- macOS 13+ recommended
- SuperGrok or X Premium Plus subscription
- Grok Build CLI: `curl -fsSL https://x.ai/cli/install.sh | bash`

### Install

1. Download **`Grok Executive Suite-0.3.3-arm64.dmg`**
2. Open DMG → drag **Grok Executive Suite.app** to **Applications**
3. First launch: **Right-click → Open** (unsigned community build)

### Disclaimer

Community project — not affiliated with xAI. See [DISCLAIMER.md](https://github.com/Printerpilot/grok-executive-suite/blob/main/DISCLAIMER.md).