# Contributing to Claude Code Orchestrator

Thank you for your interest in contributing! This document explains how to get involved.

## Before You Start

**Please open a [Discussion](https://github.com/trillion-labs/claude-code-orchestrator/discussions) before submitting a pull request.** We want to make sure your contribution aligns with the project's direction before you invest time in implementation.

Pull requests without prior discussion may be closed without review.

## Contribution Workflow

1. **Start a Discussion** — Describe what you'd like to change or add
2. **Get alignment** — Wait for maintainer feedback and approval
3. **Fork & branch** — Fork the repo and create a feature branch from `dev`
4. **Implement** — Make your changes following the guidelines below
5. **Submit a PR** — Open a pull request targeting the `dev` branch

## Development Setup

```bash
git clone https://github.com/<your-fork>/claude-code-orchestrator.git
cd claude-code-orchestrator
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the app.

### Prerequisites

- Node.js 20+
- Claude Code CLI installed and authenticated ([guide](https://docs.anthropic.com/en/docs/claude-code))

## Guidelines

### Branch & PR Rules

- Always branch from `dev`, not `main`
- Use conventional branch names: `feat/<description>` or `fix/<description>`
- Target `dev` as the base branch for your PR

### Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add session grouping by machine
fix: prevent WebSocket reconnect loop on auth failure
refactor: extract SSH config parsing into separate module
```

### Code Style

- Run `npx tsc --noEmit` before submitting to ensure no type errors
- Follow existing patterns in the codebase
- Keep changes focused — one concern per PR

## Reporting Bugs

Open an [Issue](https://github.com/trillion-labs/claude-code-orchestrator/issues) with:

- Steps to reproduce
- Expected vs actual behavior
- Node.js version and OS
- Relevant logs or screenshots

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
