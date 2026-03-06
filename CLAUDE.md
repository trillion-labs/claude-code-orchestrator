# Claude Code Orchestrator — Project Instructions

## Branch Strategy

| Branch | Purpose | Direct push |
|--------|---------|-------------|
| `main` | Release/production — always stable | **NO** |
| `dev` | Development baseline — integration branch | **NO** |
| `feat/*`, `fix/*` | Feature/fix branches — branch off `dev` | YES |

### Rules
- **main**: release 전용. 직접 작업/push 절대 금지. `dev` → `main` PR merge로만 업데이트.
- **dev**: 개발 기준 브랜치. 직접 작업/push 금지. feature/fix 브랜치에서 PR merge로만 업데이트.
- **feature/fix 브랜치**: 항상 `dev`에서 branch out. 작업 완료 후 `dev`로 PR.

### Git Workflow

Every feature or fix MUST follow this workflow:

1. **Branch off dev** — `git checkout dev && git checkout -b feat/<name>`
   (or use worktree: `git worktree add .claude/worktrees/<name> -b feat/<name> dev`)
2. **Implement** — work inside the feature branch
3. **Commit & push** — commit with clear message, push the feature branch
4. **Create PR → dev** — `gh pr create --base dev` with summary and test plan
5. **Return to dev** — switch back after PR is created

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
