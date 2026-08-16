# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Vibe Coder — a Codio Custom Assistant for Grade 8 tech that builds HTML/CSS/JS sites from student design specs. **Read the parent `../CLAUDE.md` first** for the shared coach architecture, API quirks, and deployment flow. This file covers only what is specific to this coach.

## The inverted rule

Every other coach in this workspace enforces "never write complete programs." **This coach intentionally does the opposite** — it writes complete, working files, because the learning objective is spec-writing, not coding. Do not "fix" it by adding the no-solutions guardrail. The pedagogical pressure lives elsewhere: the system prompt makes the coach interrogate vague specs (clarifying questions, or an explicit ASSUMPTIONS list) and build *only* what the spec says.

## Commands

```bash
node --check index.js
node test/run-test.js    # stubs codioIDE, drives a full 2-turn build, tests parser + path safety
```

## Architecture specifics

- **File output protocol**: the LLM emits complete files between `===FILE: path===` / `===END FILE===` marker lines. `parseFilesFromResponse()` extracts them, tolerates stray code fences around bodies, replaces bodies with `[file: path]` stubs in the prose (stubs are what's shown and kept in message history — the refreshed `messages[0]` workspace block carries current file state instead).
- **`ask()` has a hard output-length cap** (observed live, Aug 2026: a full game's script.js was cut off mid-file). The parser detects a trailing `===FILE:` block with no END marker, and `runTurn()` immediately re-asks for just that file (up to `MAX_CONTINUES` extra asks, bookkeeping messages kept out of real history); partial files are never written. The system prompt also pushes small files (~100 lines) and minimal-first builds. If recovery fails, the student is told to ask for a shorter resend.
- **`files.add()` cannot overwrite an existing file** (observed live, Aug 2026: turn-1 writes succeeded, turn-2 rewrites of the same paths rejected). There is no update method, so `writeFiles()` falls back to `deleteFiles([path])` + `add()` — the sole permitted `deleteFiles` use, and only for a path it is immediately re-adding with new content.
- Codio's chat panel renders `write()` output as markdown — displayed code shows curly quotes and eaten `++`. That's display-only; files are written from the raw `ask()` result and are clean.
- **Path safety**: `isSafePath()` — writable extensions only (`.html/.css/.js/.svg/.md/.txt`), no `/` prefix, no `..`, no `\`, max 3 path segments, max 8 files per turn. Keep this strict; the LLM's output is untrusted.
- **Writes** go through `codioIDE.files.add(path, content)` (it's the only coach that writes), with the delete+re-add overwrite fallback above. Never call `deleteFiles` for any other purpose. If writing ultimately fails, the file content is shown in chat for manual copy-paste — preserve that degradation.
- **Workspace reading**: `gatherWorkspaceText()` reads spec docs (`.md/.txt`), SVG design exports (as text — the model reads layout/labels from SVG markup), and current site files, budgeted at 40k chars / 12k per file. `ask()` messages are text-only (no image blocks; confirmed against the coachBot docs, Aug 2026), so binaries are listed, never read — in two distinct buckets: PNG/JPG/GIF/WebP are surfaced as *usable assets* (the site can reference them by relative path; the prompt treats art source as a spec dimension — when a spec involves characters/sprites and no matching image exists, the model asks "shapes drawn from code, or will you upload an image?" as a clarifying question, with upload instructions when they choose images); `.fig`/PDF are *design-only* (the model asks for an SVG export or a description).
- Shares the standard skeleton: `buildContextMessage()` refresh before every `ask()`, first-message + last-8 trimming, version banner + "version" easter egg, exit phrases.
- `window.__vibeCoderTest` exposes internals solely for the Node harness.
