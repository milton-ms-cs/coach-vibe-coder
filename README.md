# Vibe Coder

A Codio Custom Assistant (Virtual Coach) for 8th grade students that **builds websites from their design specs**. Unlike the tutoring coaches in this set, it deliberately *does* write complete code: the learning objective is writing clear, complete design specs, not writing the code itself.

## How students use it

1. Write a spec — in the chat, or better, in a `spec.md` / `.txt` file in the workspace.
2. (Optional) Add a wireframe: in Figma, **export the frame as SVG** into the workspace. The coach reads SVG layout, shapes, and text labels. PNG/JPG/`.fig` files can't be read — the coach will ask for an SVG export or a description.
3. (Optional) Upload image assets — sprites, characters, photos (PNG with transparent background works best). The coach can't see inside them but uses them by filename. Art source is treated as part of the spec: when a spec involves characters or detailed visuals, the coach asks whether to draw them with simple shapes or use uploaded images (and recommends a free pixel editor like Piskel for sprites).
4. Click **Vibe Coder** and say what to build. The coach writes `index.html` / `style.css` / `script.js` (plain HTML/CSS/JS, beginner-readable, commented) directly into the workspace.
5. Click **🌐 Open Preview** in Codio, then refine the spec and iterate.

## The pedagogy

The spec drives everything. Vague specs get clarifying questions or a draft with an explicit **"ASSUMPTIONS I MADE — your spec didn't say:"** list — so students learn that better specs get better builds. The coach builds only what's specified, changes only what's asked, and stays classroom-appropriate.

## Limits

- Plain HTML/CSS/JS only, no frameworks/CDNs (Google Fonts allowed).
- Writes only `.html`/`.css`/`.js`-type files, max 8 per turn, top level or one folder deep, no absolute/`..` paths.
- If the Codio files API is unavailable, the code is shown in chat for copy-paste instead.

## Session log

Each session adds a short summary to the hidden `.coach-log.json` file in the student's workspace. This file is shared with the other coaches in this set, and each entry is tagged `"coach": "vibe-coder"`. Vibe Coder entries also record which files were written:

```json
{
  "coach": "vibe-coder",
  "started": "2026-08-16T17:22:03Z", "updated": "...", "ended": "...",
  "coachVersion": "1.6.0", "exchanges": 4,
  "questions": ["Make me a space invaders game...", "..."],
  "filesWritten": ["index.html", "style.css", "script.js"],
  "writeFailures": 0, "filesLostToLengthLimit": 0
}
```

The file is never sent to the model, and autograders can `json.load` it. It's the only record of what students asked: Codio's own coach-log export leaves the student's question blank for message-based coaches like this one.

## Development

```bash
node --check index.js    # syntax
node test/run-test.js    # harness: parser, path safety, full button-press drive
```

To deploy: bump `VERSION` in `index.js`, publish a GitHub release with a matching tag, then click **Check for Updates** under **Organization > Extensions** in Codio. Typing `version` at any coach prompt shows which version is running. To add the coach to Codio in the first place, go to **Organization > Extensions**, click **Add extension**, and paste this repository's URL.
