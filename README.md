# Claude Code Orchestrator

A web-based dashboard for managing multiple [Claude Code](https://docs.anthropic.com/en/docs/claude-code) sessions across local and remote machines. Run, monitor, and interact with parallel Claude coding sessions from a single unified interface.

![Claude Code Orchestrator](docs/screenshot.png)

## Features

### Multi-Session Management
- Launch multiple Claude Code sessions simultaneously
- Real-time streaming output with syntax-highlighted code blocks
- Session status tracking (starting, idle, busy, error, terminated)
- Per-session cost tracking
- Rename sessions with inline double-click editing

### Multi-Machine Support
- **Local execution** — run Claude directly on your machine
- **SSH remote execution** — run Claude on remote servers via SSH
- Auto-discovery of SSH hosts from `~/.ssh/config`
- SSH connection pooling for performance
- Configurable machine definitions in `machines.json`

### Permission Modes
Four permission levels with dynamic runtime switching:

| Mode | Description |
|------|-------------|
| **Default** | Asks for approval on every tool use |
| **Plan** | Read-only — allows analysis tools only (Grep, Read, WebSearch, etc.) |
| **Accept Edits** | Auto-approves file edits and safe commands (npm, node, etc.) |
| **No Restrictions** | Skips all permission checks |

### Plan Panel
- Side panel rendering Claude's plan in rich Markdown (GFM tables, syntax highlighting)
- **Resizable** — drag the left edge to adjust width (320px–800px)
- Independent vertical scrolling
- Automatically restored on session resume

### Git Worktrees
- Create isolated git worktrees per session
- Automatic branch creation (`claude/<name>`)
- Branch tracking displayed on session cards
- Support for both local and remote worktrees

### Session Discovery & Resume
- Scan for existing Claude sessions on any machine
- Resume sessions with full chat history restoration
- Plan panel recovery on resume via JSONL history analysis
- Session metadata: first message preview, message count, last activity

### Show User (Visual Side Panel)
- Claude can render rich HTML content in a side panel next to the chat
- Perfect for diagrams, charts, interactive visualizations, and formatted explanations
- Supports CDN libraries (Chart.js, D3.js, Mermaid, etc.)
- Triggered automatically when visual presentation would help understanding

### Project & Task Management
- Create projects and break them down into tasks
- Link tasks to Claude Code sessions for traceable execution
- Kanban board view for visual task management
- Track task status across multiple sessions and machines

### Attention System
- Visual pulse indicator on session cards when user action is needed
- Permission request and question prompts surfaced in the UI
- Automatically cleared when addressed

## Tech Stack

- **Frontend** — [Next.js 16](https://nextjs.org) · [React 19](https://react.dev) · [TypeScript 5](https://www.typescriptlang.org)
- **UI** — [Tailwind CSS 4](https://tailwindcss.com) · [shadcn/ui](https://ui.shadcn.com) · [Radix UI](https://www.radix-ui.com) · [Lucide Icons](https://lucide.dev)
- **State** — [Zustand](https://zustand.docs.pmnd.rs)
- **Real-time** — [WebSocket (ws)](https://github.com/websockets/ws)
- **SSH** — [ssh2](https://github.com/mscdex/ssh2) · [ssh-config](https://github.com/nickolasburr/ssh-config)
- **Markdown** — [react-markdown](https://github.com/remarkjs/react-markdown) · [remark-gfm](https://github.com/remarkjs/remark-gfm) · [react-syntax-highlighter](https://github.com/react-syntax-highlighter/react-syntax-highlighter)
- **Validation** — [Zod 4](https://zod.dev)

## Getting Started

### Prerequisites

- **Node.js** 20+
- **Claude Code CLI** installed and authenticated ([installation guide](https://docs.anthropic.com/en/docs/claude-code))
- (Optional) SSH access to remote machines with Claude Code installed

### Installation

```bash
git clone https://github.com/trillion-labs/claude-code-orchestrator.git
cd claude-code-orchestrator
npm install
```

### Development

```bash
npm run dev
```

This starts both the custom WebSocket server and the Next.js dev server with hot reload. Open [http://localhost:3000](http://localhost:3000) in your browser.

### Production

```bash
npm run build
npm start
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |

Create a `.env.local` file to override defaults:

```env
PORT=3000
```

## Configuration

### Machine Configuration

Edit `machines.json` to define available machines:

```json
{
  "machines": [
    {
      "id": "local",
      "name": "Local Machine",
      "type": "local",
      "defaultWorkDir": "~"
    },
    {
      "id": "my-server",
      "name": "Dev Server",
      "type": "ssh",
      "host": "dev.example.com",
      "username": "deploy",
      "defaultWorkDir": "/home/deploy/projects"
    }
  ]
}
```

SSH machines from `~/.ssh/config` are also auto-discovered and available alongside explicitly configured machines.

## Architecture

```
┌──────────────────────────────────────────────────────┐
│  Browser (React + Zustand)                           │
│  ┌─────────────┐ ┌──────────┐ ┌───────────────────┐ │
│  │  Dashboard   │ │ Session  │ │   Plan Panel      │ │
│  │  + Sidebar   │ │ View     │ │   (resizable)     │ │
│  └──────┬──────┘ └─────┬────┘ └───────────────────┘ │
│         │              │                              │
│         └──────┬───────┘                              │
│                │ WebSocket                            │
└────────────────┼─────────────────────────────────────┘
                 │
┌────────────────┼─────────────────────────────────────┐
│  Server (Node.js)                                     │
│  ┌─────────────┴──────────────┐                       │
│  │  WebSocket Handler         │                       │
│  │  (typed protocol msgs)     │                       │
│  └─────────────┬──────────────┘                       │
│  ┌─────────────┴──────────────┐                       │
│  │  Session Manager           │                       │
│  │  ┌──────────┐ ┌──────────┐ │                       │
│  │  │  Local   │ │   SSH    │ │                       │
│  │  │ Adapter  │ │ Adapter  │ │                       │
│  │  └────┬─────┘ └────┬─────┘ │                       │
│  └───────┼─────────────┼──────┘                       │
│          │             │                              │
│     child_process   ssh2 channel                      │
│          │             │                              │
│      claude CLI    claude CLI                         │
│      (local)       (remote)                           │
└──────────────────────────────────────────────────────┘
```

### Key Components

| Layer | File | Responsibility |
|-------|------|---------------|
| Entry | `server.ts` | HTTP + WebSocket server, Next.js integration |
| Transport | `src/lib/server/ws-handler.ts` | Typed WebSocket message routing |
| Core | `src/lib/server/session-manager.ts` | Session lifecycle, history loading, plan recovery |
| Projects | `src/lib/server/project-manager.ts` | Project & task management |
| Adapters | `src/lib/server/adapters/` | Local & SSH process execution |
| Protocol | `src/lib/shared/protocol.ts` | Client ↔ Server message types |
| State | `src/store/index.ts` | Zustand store (sessions, messages, plans, etc.) |
| UI | `src/components/` | Dashboard, SessionView, PlanPanel, Kanban, etc. |

## Project Structure

```
├── server.ts                 # Entry point: HTTP + WS server
├── machines.json             # Machine configuration
├── src/
│   ├── app/                  # Next.js app directory
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/           # React components
│   │   ├── Dashboard.tsx     # Main layout with sidebar
│   │   ├── SessionView.tsx   # Active session view
│   │   ├── SessionCard.tsx   # Sidebar session card
│   │   ├── PlanPanel.tsx     # Resizable plan side panel
│   │   ├── ShowUserPanel.tsx # Visual HTML side panel
│   │   ├── ProjectBoard.tsx  # Project management view
│   │   ├── AllTasksBoard.tsx # Kanban board for tasks
│   │   ├── KanbanColumn.tsx  # Kanban column component
│   │   ├── TaskCard.tsx      # Task card component
│   │   ├── TaskDialog.tsx    # Task create/edit dialog
│   │   ├── StreamOutput.tsx  # Message stream renderer
│   │   ├── PromptInput.tsx   # Chat input
│   │   ├── MachineSelector.tsx # Machine & path selector
│   │   ├── FilePreviewPanel.tsx # File preview side panel
│   │   ├── ManagerChatPanel.tsx # Manager chat interface
│   │   └── ui/              # shadcn/ui base components
│   ├── hooks/
│   │   ├── useWebSocket.ts   # WebSocket connection hook
│   │   ├── useSessionStore.ts # Session state hook
│   │   ├── useProjectStore.ts # Project state hook
│   │   └── useTheme.ts       # Theme management hook
│   ├── lib/
│   │   ├── server/
│   │   │   ├── session-manager.ts
│   │   │   ├── project-manager.ts
│   │   │   ├── ws-handler.ts
│   │   │   ├── ssh-manager.ts
│   │   │   ├── stream-parser.ts
│   │   │   ├── permission-utils.ts
│   │   │   ├── orchestrator-prompt.ts
│   │   │   ├── ssh-config-loader.ts
│   │   │   └── adapters/
│   │   │       ├── base.ts
│   │   │       ├── local-adapter.ts
│   │   │       ├── process-adapter.ts
│   │   │       └── ssh-adapter.ts
│   │   └── shared/
│   │       ├── types.ts      # Shared type definitions
│   │       ├── protocol.ts   # WebSocket message protocol
│   │       └── worktree-names.ts # Worktree name utilities
│   └── store/
│       └── index.ts          # Zustand global store
└── scripts/
    ├── permission-mcp-server.mjs  # MCP permission tool
    └── orchestrator-mcp-server.mjs # Orchestrator MCP server
```

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md) before getting started.

## License

[MIT](LICENSE) © [Trillion Labs](https://trillionlabs.co/ko/)
