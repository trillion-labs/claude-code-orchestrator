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

### Workspace Layout

작업 디렉토리는 항상 `main` 브랜치를 유지한다. `dev`는 고정 worktree로 운영.

| Path | Branch | Purpose |
|------|--------|---------|
| `/` (project root) | `main` | 기본 작업 디렉토리. 항상 main 유지. |
| `.claude/worktrees/dev` | `dev` | dev 전용 고정 worktree. 삭제하지 말 것. |
| `.claude/worktrees/<name>` | `feat/*`, `fix/*` | 임시 feature/fix worktree. PR 완료 후 정리. |

- **절대 project root에서 `git checkout dev` 하지 말 것.** dev 작업은 `.claude/worktrees/dev`에서 수행.

### Dev Server 실행

Bash로 직접 `npm run dev:*`를 실행하면 Claude Code 환경변수(`CLAUDECODE` 등)가 상속되어 MCP permission 서버가 작동하지 않음. 반드시 `env -u CLAUDECODE`로 환경변수를 제거해서 실행할 것.

| 용도 | 명령어 | Port |
|------|--------|------|
| main 서버 | `npm run dev:main` | 8888 |
| dev/feat worktree 서버 | `npm run dev:preview` | 9000 |
| 테스트/프리뷰 서버 | `npm run dev:test` | 3333 |

**실행 방법** (worktree에서 임의 포트로 띄우는 예시):
```bash
# 1. 기존 포트 정리
lsof -ti:<PORT> | xargs kill -9 2>/dev/null

# 2. Next.js lock 파일 제거 (다른 인스턴스가 사용하던 것)
rm -f <worktree-path>/.next/dev/lock

# 3. CLAUDECODE 환경변수 제거 후 실행 (run_in_background로)
env -u CLAUDECODE PORT=<PORT> npx tsx watch server.ts
```

**주의사항:**
- `env -u CLAUDECODE` 없이 실행하면 MCP permission이 깨짐
- `.next/dev/lock` 파일이 남아있으면 서버 시작 실패함 — 반드시 삭제 후 재시작
- worktree에서 실행할 때는 해당 worktree 디렉토리가 cwd여야 함

### Git Workflow

Every feature or fix MUST follow this workflow:

1. **Branch off dev** — `cd .claude/worktrees/dev && git checkout -b feat/<name>`
   (or create worktree: `git worktree add .claude/worktrees/<name> -b feat/<name> dev`)
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
