# Vibe Coder

A Codio Virtual Coach for Grade 8 tech that **builds websites from student design specs** — a low-budget Lovable. Unlike the other Milton MS coaches, this one deliberately *does* write complete code: the learning objective is writing clear, complete design specs, not writing the code itself.

## How students use it

1. Write a spec — in the chat, or better, in a `spec.md` / `.txt` file in the workspace.
2. (Optional) Add a wireframe: in Figma, **export the frame as SVG** into the workspace. The coach reads SVG layout, shapes, and text labels. PNG/JPG/`.fig` files can't be read — the coach will ask for an SVG export or a description.
3. (Optional) Upload image assets — sprites, characters, photos (PNG with transparent background works best). The coach can't see inside them but uses them by filename. Art source is treated as part of the spec: when a spec involves characters or detailed visuals, the coach asks whether to draw them with simple shapes or use uploaded images (and recommends a free pixel editor like Piskel for sprites).
4. Click **Vibe Coder** and say what to build. The coach writes `index.html` / `style.css` / `script.js` (plain HTML/CSS/JS, beginner-readable, commented) directly into the workspace.
5. Open the Codio preview, then refine the spec and iterate.

## The pedagogy

The spec drives everything. Vague specs get clarifying questions or a draft with an explicit **"ASSUMPTIONS I MADE — your spec didn't say:"** list — so students learn that better specs get better builds. The coach builds only what's specified, changes only what's asked, and stays classroom-appropriate.

## Limits

- Plain HTML/CSS/JS only, no frameworks/CDNs (Google Fonts allowed).
- Writes only `.html`/`.css`/`.js`-type files, max 8 per turn, top level or one folder deep, no absolute/`..` paths.
- If the Codio files API is unavailable, the code is shown in chat for copy-paste instead.

## Session log (for autograders)

The coach maintains `.vibe-coder-log.json` in the student's workspace — hidden from the file tree by the leading dot and never fed into the LLM's context. It's a JSON array with one entry per coach session:

```json
{
  "started": "2026-08-16T17:22:03Z", "updated": "...", "ended": "...",
  "coachVersion": "1.4.0", "exchanges": 4,
  "questions": ["Make me a space invaders game...", "..."],
  "filesWritten": ["index.html", "style.css", "script.js"],
  "writeFailures": 0, "filesLostToLengthLimit": 0
}
```

Autograders can `json.load` it to see how the student used the coach. Note this is the **only** record of student questions: Codio's course coach-log export logs the `userPrompt` field, which is empty for messages-based coaches — full platform logs (see `codio-mcp/scripts/export_coach_logs.py`) contain system prompts and responses but blank user prompts.

## Development

```bash
node --check index.js    # syntax
node test/run-test.js    # harness: parser, path safety, full button-press drive
```

Deployment: bump `VERSION` in `index.js`, commit, then run `../publish_coaches.sh --publish` from the parent `coaches/` folder, and Check for Updates in Codio. Typing `version` at any coach prompt confirms propagation.
