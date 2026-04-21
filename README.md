<div align="center">
  <a href="https://openread.ai" target="_blank">
    <img src="https://github.com/openread-ai/openread/blob/main/apps/openread-app/src-tauri/icons/icon.png?raw=true" alt="OpenRead Logo" width="20%" />
  </a>
  <h1>OpenRead</h1>

An open-source ebook reader for macOS, Windows, Linux, Android, iOS, and the Web.
Built with [Next.js](https://github.com/vercel/next.js) and [Tauri](https://github.com/tauri-apps/tauri).

[![Website](https://img.shields.io/badge/website-openread.ai-orange)](https://openread.ai)
[![AGPL-3.0](https://img.shields.io/github/license/openread-ai/openread?color=teal)](LICENSE)

</div>

## Features

| Feature                        | Description                                                 |
| ------------------------------ | ----------------------------------------------------------- |
| **Multi-Format Support**       | EPUB, MOBI, KF8 (AZW3), FB2, CBZ, TXT, PDF                  |
| **Annotations & Highlighting** | Highlights, bookmarks, and notes                            |
| **Full-Text Search**           | Search across the entire book                               |
| **Parallel Read**              | Split-screen view for two books side by side                |
| **Translate**                  | DeepL and Yandex translation — sentences or full books      |
| **Text-to-Speech**             | Multilingual narration                                      |
| **Sync**                       | Reading progress, notes, and bookmarks across all platforms |
| **AI-Powered Reading**         | Chat with your books, summaries, and Q&A                    |
| **MCP Server**                 | Connect your library to AI assistants                       |
| **Library Management**         | Organize, sort, and manage your ebook library               |
| **OPDS/Calibre**               | Access online libraries and catalogs                        |
| **Accessibility**              | Keyboard navigation, VoiceOver, TalkBack, NVDA, Orca        |

## Quick Start

```bash
git clone https://github.com/openread-ai/openread.git
cd openread
git submodule update --init --recursive
pnpm install
pnpm --filter @openread/openread-app setup-vendors
pnpm dev-web
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for full build instructions including desktop and mobile.

## MCP Server

Connect your OpenRead book library to AI assistants like Claude, Cursor, and VS Code Copilot.

1. Get an API key from [Settings > API Keys](https://app.openread.ai/settings)
2. Add to your AI client config:

```json
{
  "mcpServers": {
    "openread": {
      "command": "npx",
      "args": ["-y", "@openread/mcp"],
      "env": {
        "OPENREAD_API_KEY": "orsk-your-key-here"
      }
    }
  }
}
```

| Client         | Config file                                                       |
| -------------- | ----------------------------------------------------------------- |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Code    | `~/.claude/settings.json`                                         |
| Cursor         | `~/.cursor/mcp.json`                                              |
| VS Code        | `.vscode/mcp.json`                                                |
| Windsurf       | `~/.windsurf/mcp.json`                                            |
| Codex          | `~/.codex/mcp.json`                                               |
| Gemini CLI     | `~/.gemini/settings.json`                                         |

## Contributing

Contributions are welcome! Please review the [contributing guidelines](CONTRIBUTING.md) before getting started.

## License

AGPL-3.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE) for details.
