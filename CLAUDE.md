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
- **Path safety**: `isSafePath()` — writable extensions only (`.html/.css/.js/.svg/.md/.txt`), no `/` prefix, no `..`, no `\`, max 3 path segments, max 8 files per turn. Keep this strict; the LLM's output is untrusted.
- **Writes** go through `codioIDE.files.add(path, content)` (it's the only coach that writes). Never call `deleteFiles`. If `add` is unavailable/fails, the file content is shown in chat for manual copy-paste — preserve that degradation.
- **Workspace reading**: `gatherWorkspaceText()` reads spec docs (`.md/.txt`), SVG design exports (as text — the model reads layout/labels from SVG markup), and current site files, budgeted at 40k chars / 12k per file. Binary design files (PNG/JPG/`.fig`/PDF) are *listed but not read* — `ask()` messages are text-only (no image blocks; confirmed against the coachBot docs, Aug 2026), so the prompt tells the model to request an SVG export or a description.
- Shares the standard skeleton: `buildContextMessage()` refresh before every `ask()`, first-message + last-8 trimming, version banner + "version" easter egg, exit phrases.
- `window.__vibeCoderTest` exposes internals solely for the Node harness.
