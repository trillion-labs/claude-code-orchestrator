# Claude Code Orchestrator — Project Instructions

## Branch Strategy

| Branch | Purpose | Direct push |
|--------|---------|-------------|
| `main` | Release/production — always stable | **NO** |
| `dev` | Development baseline — integration branch | **NO** |
| `feat/*`, `fix/*` | Feature/fix branches — branch off `dev` | YES |

### Rules
- **main**: Release only. Never push directly. Update only via PR merge from `dev` → `main`.
- **dev**: Development baseline. Never push directly. Update only via PR merge from feature/fix branches.
- **feature/fix branches**: Always branch off `dev`. Create PR to `dev` when done.

### Workspace Layout

The working directory always stays on the `main` branch. `dev` runs as a permanent worktree.

| Path | Branch | Purpose |
|------|--------|---------|
| `/` (project root) | `main` | Default working directory. Always stays on main. |
| `.claude/worktrees/dev` | `dev` | Permanent dev worktree. Do not delete. |
| `.claude/worktrees/<name>` | `feat/*`, `fix/*` | Temporary feature/fix worktrees. Clean up after PR is merged. |

- **Never run `git checkout dev` in the project root.** All dev work must happen in `.claude/worktrees/dev`.

### Dev Server

Running `npm run dev:*` directly from Bash inherits Claude Code environment variables (`CLAUDECODE`, etc.), which breaks the MCP permission server. Always strip them with `env -u CLAUDECODE`.

| Purpose | Command | Port |
|---------|---------|------|
| Main server | `npm run dev:main` | 8888 |
| Dev/feat worktree server | `npm run dev:preview` | 9000 |
| Test/preview server | `npm run dev:test` | 3333 |

**How to run** (example: starting a server in a worktree on a custom port):
```bash
# 1. Kill any process on the target port
lsof -ti:<PORT> | xargs kill -9 2>/dev/null

# 2. Remove Next.js lock file (left by another instance)
rm -f <worktree-path>/.next/dev/lock

# 3. Run with CLAUDECODE env var stripped (use run_in_background)
env -u CLAUDECODE PORT=<PORT> npx tsx watch server.ts
```

**Important notes:**
- Running without `env -u CLAUDECODE` breaks MCP permissions
- Server won't start if `.next/dev/lock` exists — always remove before restarting
- When running in a worktree, the worktree directory must be the cwd

### Git Workflow

Every feature or fix MUST follow this workflow:

1. **Create worktree from dev** — `git worktree add .claude/worktrees/<name> -b feat/<name> dev`
   (Never run `git checkout -b` inside the dev worktree — it must always stay on the dev branch)
2. **Implement** — work inside the feature branch/worktree
3. **Commit & push** — commit with clear message, push the feature branch
4. **Create PR → dev** — `gh pr create --base dev` with summary and test plan
5. **Return to main** — switch back to project root (always on main)

### Branch Naming
- Features: `feat/<short-description>`
- Fixes: `fix/<short-description>`

### Commit Messages
- Use conventional style: `feat:`, `fix:`, `refactor:`, `docs:`, etc.
- Keep the first line under 72 characters
- Always include `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>`

## Tech Stack

- **Runtime**: Node.js 20+, TypeScript 5
- **Frontend**: Next.js 16, React 19, Tailwind CSS 4, shadcn/ui, Radix UI, Zustand
- **Backend**: Custom WebSocket server (ws), ssh2 for remote execution
- **Validation**: Zod 4
- **Package manager**: npm

## Code Conventions

- Always run `npx tsc --noEmit` before committing to verify no type errors
- Prefer editing existing files over creating new ones
- UI components go in `src/components/`, base UI in `src/components/ui/`
- Server logic goes in `src/lib/server/`
- Shared types/protocol in `src/lib/shared/`
- State management in `src/store/index.ts` (single Zustand store)
- Custom CSS must be inside `@layer base` in `globals.css` (Tailwind v4 requirement)

## Architecture Notes

- All state is in-memory (no database)
- Streaming: text via `content_block_delta`, tool_use from completed `assistant` messages
- Permission handling via MCP tool (`--permission-prompt-tool`)
- Remote SSH: reverse port forward + Python MCP server deployed via SFTP
- Plan file tracking: scan Write/Edit tool_use blocks for `.claude/plans/` or `plan.md` paths
