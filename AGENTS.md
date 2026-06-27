# AGENTS.md

This file helps AI coding agents work productively in this repository.

## Project Snapshot

- Stack: React 19 + TypeScript + Vite.
- Product shape: Chrome extension popup UI (Manifest V3).
- Main feature location: src/App.tsx.
- Extension manifest: public/manifest.json.

## Runbook

- Install dependencies: npm install
- Start dev server: npm run dev
- Build extension bundle: npm run build
- Build in watch mode: npm run watch
- Lint code: npm run lint
- Preview production build: npm run preview

Notes:
- There is no dedicated test script yet.
- Type checking happens during npm run build via tsc -b.

## Codebase Map

- src/main.tsx: React app entry point.
- src/App.tsx: Main popup component, bookmark tree loading, and validation trigger UI.
- public/manifest.json: Extension metadata, permissions, and popup entry.
- eslint.config.js: Flat ESLint config (TypeScript + React hooks + React refresh).
- tsconfig.app.json: Strict TypeScript app settings.
- vite.config.ts: Build output configuration (dist).

## Editing Conventions

- Prefer TypeScript types and keep strict-mode compatibility (noUnusedLocals and noUnusedParameters are enabled).
- Keep browser extension behavior intact: this project depends on chrome.bookmarks APIs.
- Preserve callback-based Chrome API patterns unless doing a deliberate refactor.
- Keep changes focused and minimal; avoid unrelated structural rewrites.
- dist is generated output. Do not hand-edit generated artifacts.

## Chrome Extension Constraints

- When running outside extension context, chrome APIs may be unavailable. App.tsx includes a local fallback path for development.
- If a change needs new Chrome capabilities, update public/manifest.json permissions explicitly.

## Completion Checklist For Agents

Before finishing code changes:

- Run npm run lint
- Run npm run build
- If extension behavior changed, verify popup flow in Chrome extension context

## Related Documentation

- Project overview and starter notes: README.md