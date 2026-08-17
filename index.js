// Vibe Coder — spec-to-code build assistant for Grade 8 tech.
// Unlike the other coaches, this one DOES write complete code: the learning
// objective is writing clear design specs, not writing the code itself.
// Students spec (text, spec.md, SVG wireframe exports) -> the coach builds
// HTML/CSS/JS files directly into the workspace -> students preview + refine.
(async function(codioIDE, window) {

  const VERSION = "1.5.4";

  const MAX_CONTEXT_CHARS = 20000;  // budget for spec + diagram + site context (resent every turn — keep lean)
  const MAX_FILE_READ = 8000;       // per-file read cap
  const MAX_WRITE_FILES = 8;        // per-turn file write cap
  const MAX_CONTINUES = 2;          // extra asks to recover cut-off files

  const SPEC_EXTS = [".md", ".txt"];
  const SVG_EXTS = [".svg"];
  const SITE_EXTS = [".html", ".css", ".js"];
  const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".gif", ".webp"];  // usable assets
  const DESIGN_ONLY_EXTS = [".fig", ".pdf"];  // can neither read nor use
  const WRITABLE_EXTS = [".html", ".css", ".js", ".svg", ".md", ".txt"];

  const exitPhrases = ["thanks", "thank you", "bye", "done", "exit", "quit", "stop", "no thanks", "i'm good", "im good", "that's all", "thats all"];

  const systemPrompt = `You are "Vibe Coder," a friendly build assistant for 8th grade tech students who are learning to write clear DESIGN SPECS. Unlike a tutor, you DO write complete, working code — but ONLY what the student's spec clearly describes. Their job is the design thinking; your job is the build.

## The core rule: the spec drives everything

- If the spec (or request) is clear and specific, build exactly that. Don't add features they didn't ask for.
- If it's vague or missing key details (colors, layout, text content, what happens when you click...), DON'T guess silently. Either ask up to 3 short, pointed clarifying questions BEFORE building, or build a first draft and end with a section titled "ASSUMPTIONS I MADE — your spec didn't say:" listing each guess. Help them see that better specs get better builds.
- If they point to a wireframe or diagram (SVG), follow it faithfully — match the layout, sections, and any text labels you can read in it — and mention which parts of the build came from the diagram.
- If they ask you to change something, change ONLY that. Keep the rest of their site exactly as it is.

## What you build

- Plain HTML, CSS, and JavaScript only — no frameworks, no build tools, no libraries or CDN scripts. A Google Fonts <link> is okay.
- Multi-file sites: index.html + style.css (+ script.js when the spec needs behavior), connected with relative links.
- Beginner-readable code: clear names, consistent indentation, and short comments explaining what each section does. An 8th grader should be able to open any file and follow along.
- Never hotlink images from the internet — only use image files that are in the workspace (see below).

## Images and assets

- The workspace listing shows any image files the student has uploaded. USE them (by relative path) wherever the spec calls for that visual. You can't see inside an image, so if a filename doesn't make its content obvious, ask the student what it shows.
- Art source is part of the spec! Characters, creatures, and detailed sprites look rough when drawn from code. When the spec involves visuals like that, no matching image is in the workspace, and the spec doesn't say where the art comes from, make it one of your clarifying questions: "Want me to draw the squirrel with simple shapes, or will you upload an image of one?" A good spec says which.
- If they choose images, tell them exactly what to upload: the filename to use (like squirrel.png), that a PNG with a transparent background works best, a rough size (like 50x50 for a game sprite), and that they can draw one free in a pixel editor like Piskel or use their own drawing or photo. Then use it by that filename. If they choose shapes (or don't say), build simple shapes — and you can still mention image uploads as a later upgrade.
- In canvas games, create each Image() once at the top and draw it with ctx.drawImage() inside the game loop — the loop redraws every frame, so the image appears as soon as it loads.

## Output format — STRICT

When you build or change files, output each COMPLETE file between marker lines, exactly like this:

===FILE: index.html===
<!DOCTYPE html>
...the entire file...
===END FILE===

- Marker lines go alone on their own line, with no code fences around them or the file content.
- Always output the FULL content of every file you create or change — never fragments, never "the rest stays the same."
- Only create files ending in .html, .css, or .js, in the top level or a folder like css/ or js/. Never paths starting with / or containing ..
- Before the files: 2-4 friendly sentences (middle school reading level) about what you built and how it follows their spec. After the files: suggest ONE specific thing they could spec next.
- If you're only answering a question or asking for clarification, don't output any file blocks.

## Split every build into small files — your response has a hard length limit

Your WHOLE response shares one length cap. If it runs over, the last file is cut off mid-line and lost. Small files are the defense: a small file is more likely to fit, and if one is cut off it can be resent on its own. So:
- NEVER put a whole program in a single big script.js. Split the JavaScript BY JOB into small files loaded in order with their own <script> tags. A canvas game is typically: input.js (controls + game state), game.js (update, spawn, collisions), draw.js (rendering + the game loop). A page with little behavior needs no JS or one small script.js.
- Keep EVERY file under about 60 lines, with one short comment per section. If a file is heading past that, split it further by job — don't let any single file grow large.
- Split by JOB, not per function. 2-4 files is right; a dozen tiny files is not. Files share globals (plain <script> tags, no modules), so fewer, job-sized files stay consistent more easily.
- Order the <script> tags so each file's functions/variables are defined before another file uses them (e.g. input.js, then game.js, then draw.js).
- index.html and style.css are always their own files.
- Build the SIMPLEST version that matches the spec first. If the spec implies a big build (like a full game), build a minimal working version, say what you left out, and let the student spec upgrades one at a time.
- When changing an existing site, resend ONLY the files that change — and keep them consistent with the files you're NOT resending (same element ids, classes, and function names).

## Workspace context

Each request includes the current workspace in <workspace> tags: spec documents, SVG design exports, the current site files, and a list of files you can't read (PNG/JPG/Figma). If an unreadable design file looks important, ask the student to export it from Figma as an SVG into the workspace, or describe it to you.

## Keep it classroom-appropriate

This is a middle school class. If a request is inappropriate, unkind toward a real person, or isn't about building their project (like doing homework for another class), decline kindly and steer back to their site.`;

  // ============================================================
  // Workspace reading via codioIDE.files
  // (codioIDE.workspace does NOT exist in the Custom Assistant runtime;
  //  getContext().files only lists files open in the editor.)
  // ============================================================

  function normalizePath(p) {
    return String(p).replace(/^\.\//, "").replace(/^\//, "");
  }

  function extOf(name) {
    const m = String(name).toLowerCase().match(/\.[a-z0-9]+$/);
    return m ? m[0] : "";
  }

  // getStructure() returns a name->value MAP: a file's value is a leaf (Codio
  // uses 1), a directory's value is a nested map — not an array of nodes.
  function collectPaths(node, path, out) {
    if (!node || typeof node !== "object") return out;
    for (const name in node) {
      if (!Object.prototype.hasOwnProperty.call(node, name)) continue;
      if (name.startsWith(".")) continue;
      const full = path ? `${path}/${name}` : name;
      const value = node[name];
      if (value && typeof value === "object") {
        collectPaths(value, full, out);
      } else {
        const ext = extOf(name);
        if (SPEC_EXTS.includes(ext)) out.specs.push(full);
        else if (SVG_EXTS.includes(ext)) out.svgs.push(full);
        else if (SITE_EXTS.includes(ext)) out.site.push(full);
        else if (IMAGE_EXTS.includes(ext)) out.images.push(full);
        else if (DESIGN_ONLY_EXTS.includes(ext)) out.designOnly.push(full);
      }
    }
    return out;
  }

  async function readCapped(F, path, budgetLeft) {
    const content = await F.getContent(path);
    if (typeof content !== "string" || content.length === 0) return null;
    const maxLen = Math.min(MAX_FILE_READ, budgetLeft);
    if (content.length <= maxLen) return content;
    return content.slice(0, maxLen) + "\n...(truncated)";
  }

  // Drop the assignment's own README.md from the spec list when the student has
  // real spec docs too — otherwise the (often long) README is re-embedded in
  // context every turn as if it were the spec. Keep it if it's the ONLY doc, in
  // case a student actually wrote their spec there.
  function dropRedundantReadme(specs) {
    if (specs.length <= 1) return specs;
    const filtered = specs.filter(p => !/(^|\/)readme\.md$/i.test(p));
    return filtered.length > 0 ? filtered : specs;
  }

  // Build the <workspace> text block: specs, SVG designs, current site files.
  // opts.includeSite=false omits the current-site-files section — used for the
  // truncation-recovery ask, where companionFilesBlock() already carries the
  // just-built files, so resending the whole site would be redundant.
  async function gatherWorkspaceText(opts) {
    const includeSite = !opts || opts.includeSite !== false;
    const F = codioIDE.files;
    if (!F || typeof F.getStructure !== "function" || typeof F.getContent !== "function") {
      return "The workspace could not be read (Codio files API unavailable). Ask the student to paste their spec and describe their design.";
    }

    let paths = { specs: [], svgs: [], site: [], images: [], designOnly: [] };
    try {
      collectPaths(await F.getStructure(), "", paths);
    } catch (e) {
      return "The workspace could not be read. Ask the student to paste their spec and describe their design.";
    }
    paths.specs = dropRedundantReadme(paths.specs);

    let out = "";
    const sections = [
      ["Spec / design documents", paths.specs],
      ["SVG design exports (read the shapes and text to understand the layout)", paths.svgs],
    ];
    if (includeSite) {
      sections.push(["Current site files", paths.site]);
    }
    for (const [label, list] of sections) {
      for (const p of list) {
        if (out.length >= MAX_CONTEXT_CHARS) break;
        try {
          const content = await readCapped(F, p, MAX_CONTEXT_CHARS - out.length);
          if (content !== null) out += `\n--- ${label} — ${p} ---\n${content}\n`;
        } catch (e) {
          // Silent — skip unreadable file
        }
      }
    }

    if (paths.images.length > 0) {
      out += `\nImage assets the student has uploaded (you can't see inside them, but the site CAN use them by relative path): ${paths.images.join(", ")}\n`;
    }

    if (paths.designOnly.length > 0) {
      out += `\nDesign files present but NOT readable (binary): ${paths.designOnly.join(", ")}. If one matters, ask the student to export it as an SVG or describe it.\n`;
    }

    if (!out) {
      out = "The workspace has no spec documents, SVG designs, or site files yet.";
    }
    return out;
  }

  // ============================================================
  // Response parsing + file writing
  // ============================================================

  function isSafePath(p) {
    const path = String(p);
    if (!path || path.length > 120) return false;
    if (path.startsWith("/") || path.includes("..") || path.includes("\\")) return false;
    if (!/^[A-Za-z0-9._\/-]+$/.test(path)) return false;
    if (path.split("/").length > 3) return false;
    return WRITABLE_EXTS.includes(extOf(path));
  }

  // Extract ===FILE: path=== ... ===END FILE=== blocks from the LLM response.
  // Returns {files, prose, truncated}: prose is the response with file bodies
  // replaced by short stubs (safe to show and to keep in history); truncated
  // lists any file whose block was cut off before its END marker — ask()
  // responses have a hard output-length cap, so this happens on big builds.
  function parseFilesFromResponse(text) {
    const files = [];
    const re = /^[ \t]*===FILE:\s*(.+?)\s*===[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*===END FILE===[ \t]*$/gm;
    let prose = String(text).replace(re, function(whole, path, content) {
      // Tolerate a model that wrapped the body in a code fence anyway
      let body = content.replace(/^\s*```[a-z]*\r?\n/, "").replace(/\r?\n```\s*$/, "");
      const cleanPath = normalizePath(path);
      if (isSafePath(cleanPath) && files.length < MAX_WRITE_FILES) {
        files.push({ path: cleanPath, content: body });
        return `[file: ${cleanPath}]`;
      }
      return `[skipped a file with a disallowed path: ${path}]`;
    });

    // A FILE marker still left means the response ended mid-file. Drop the
    // partial body from the prose and remember the path so we can re-ask.
    const truncated = [];
    prose = prose.replace(/[ \t]*===FILE:\s*(.+?)\s*===[ \t]*\r?\n[\s\S]*$/, function(whole, path) {
      const cleanPath = normalizePath(path);
      if (isSafePath(cleanPath)) truncated.push(cleanPath);
      return truncStub(cleanPath);
    });

    return { files: files, prose: prose.trim(), truncated: truncated };
  }

  function truncStub(path) {
    return `[${path} got cut off before it finished]`;
  }

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  // Bound any files-API call — a hung deleteFiles/add/getContent must not stall
  // the coach forever.
  function withTimeout(promise, ms, label) {
    let t;
    const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error("timeout: " + label)), ms); });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
  }

  // Confirm what actually landed on disk — add() reporting success is NOT proof
  // the bytes are there. Observed live Aug 2026: an iteration turn's overwrites of
  // game.js, draw.js AND .coach-log.json all landed as 0-BYTE files — the deletes
  // succeeded and the racing adds wrote empty, yet add() threw nothing, so the
  // coach reported success and silently destroyed the files. Every write is now
  // read back before it counts as written.
  async function readbackOk(F, path, content) {
    if (typeof F.getContent !== "function") return true; // can't verify — trust the write
    try {
      const got = await withTimeout(F.getContent(path), 8000, "read " + path);
      // Guard against the 0-byte / truncated write — don't demand exact equality
      // (Codio may normalize trailing newlines, which would falsely fail every
      // write and dump it to chat). Just confirm the bytes really landed.
      return typeof got === "string" && got.length > 0 && got.length >= content.length - 4;
    } catch (e) {
      return false;
    }
  }

  // Write one file and VERIFY it landed. add() can't overwrite (rejects if the
  // path exists), so an existing file needs deleteFiles()+add — but add() right
  // after a delete can land empty if the delete hasn't settled, or if a concurrent
  // write (e.g. the fire-and-forget log save) is racing it. So: pause after the
  // delete, re-add, read back, and retry. The retry self-heals transient
  // corruption — by the next attempt the racing write has finished — without a
  // global lock (which would let a hung log write stall the next build). A 0-byte
  // write fails the read-back and is retried, never reported as success.
  async function addVerified(F, path, content) {
    try {
      await withTimeout(F.add(path, content), 8000, "add " + path);
      if (await readbackOk(F, path, content)) return true;
    } catch (e) {
      // exists (or wrote empty) — fall through to the delete+re-add path
    }
    if (typeof F.deleteFiles !== "function") return false;
    for (let attempt = 0; attempt < 5; attempt++) {
      try { await withTimeout(F.deleteFiles([path]), 8000, "del " + path); } catch (e) {}
      await delay(150 + attempt * 150); // let the delete settle / racing write finish
      try { await withTimeout(F.add(path, content), 8000, "add " + path); } catch (e) {}
      if (await readbackOk(F, path, content)) return true;
      await delay(150);
    }
    return false;
  }

  async function writeFiles(files) {
    const F = codioIDE.files;
    const written = [];
    const failed = [];
    if (!F || typeof F.add !== "function") {
      return { written: written, failed: files.map(f => f.path) };
    }
    for (const f of files) {
      const ok = await addVerified(F, f.path, f.content);
      (ok ? written : failed).push(f.path);
    }
    return { written: written, failed: failed };
  }

  // ============================================================
  // Conversation
  // ============================================================

  // Build the context-bearing first message from a fresh read. Re-run before
  // every ask() so the coach sees the student's latest spec and site edits.
  async function buildContextMessage(initialInput, opts) {
    const context = await codioIDE.coachBot.getContext();

    const workspaceText = await gatherWorkspaceText(opts);

    const guideContent = (context.guidesPage && context.guidesPage.content)
      ? context.guidesPage.content
      : "No guide available.";

    const assignmentName = (context.assignmentData && context.assignmentData.name)
      ? context.assignmentData.name
      : null;

    return `Here is the student's workspace (current as of their latest message):
<workspace>
${workspaceText}
</workspace>
Here is the assignment guide:
<guide>
${guideContent}
</guide>
${assignmentName ? `\nAssignment: ${assignmentName}\n` : ''}
The student says: ${initialInput}`;
  }

  async function askOnce(messages) {
    return codioIDE.coachBot.ask({
      systemPrompt: systemPrompt,
      messages: messages
    }, { preventMenu: true });
  }

  function mergeFile(allFiles, f) {
    for (let i = 0; i < allFiles.length; i++) {
      if (allFiles[i].path === f.path) { allFiles[i] = f; return; }
    }
    if (allFiles.length < MAX_WRITE_FILES) allFiles.push(f);
  }

  // Render the files already completed this turn as ===FILE=== blocks, so a
  // continuation ask for a cut-off file can be made consistent with them.
  // Without this the recovery model is BLIND to the HTML it must wire into:
  // messages[0]'s workspace snapshot predates this turn's writes (writeFiles
  // runs after the continuation loop) and the stubbed prose hides the file
  // bodies — so the model reinvents element ids/controls the saved HTML never
  // had (observed live Aug 2026: a resent script.js referenced a #startBtn and
  // #score that index.html lacked, throwing on load and killing the game).
  function companionFilesBlock(allFiles, excludePath) {
    let block = "";
    for (const f of allFiles) {
      if (f.path === excludePath) continue;
      let body = f.content;
      if (body.length > MAX_FILE_READ) body = body.slice(0, MAX_FILE_READ) + "\n...(truncated)";
      block += `===FILE: ${f.path}===\n${body}\n===END FILE===\n`;
    }
    return block;
  }

  // One generate -> parse -> (recover cut-off files) -> write -> report turn.
  async function runTurn(messages, initialInput) {
    try {
      codioIDE.coachBot.showThinkingAnimation();
      const result = await askOnce(messages);

      const parsed = parseFilesFromResponse(result.result);
      const allFiles = parsed.files.slice();
      let prose = parsed.prose;

      // ask() responses have an output-length cap. If a file got cut off,
      // immediately re-ask for just that file, complete. These bookkeeping
      // exchanges stay local — they are never added to the real history.
      let pending = parsed.truncated;
      let tries = 0;
      // Recovery asks reuse a SLIM first message (spec + guide, no current-site
      // files): companionFilesBlock() below already carries the just-built files
      // verbatim, so resending the whole site would be redundant — and this whole
      // block goes out on every recovery ask. Built lazily, only if truncation
      // actually happens; falls back to the full context if the rebuild fails.
      let slimFirst = null;
      while (pending.length > 0 && tries < MAX_CONTINUES) {
        tries++;
        if (slimFirst === null) {
          try {
            slimFirst = { "role": "user", "content": await buildContextMessage(initialInput, { includeSite: false }) };
          } catch (e) {
            slimFirst = messages[0];
          }
        }
        const p = pending[0];
        // Show the recovery model the files that DID save this turn (verbatim),
        // so the resend wires into their real ids/controls instead of inventing
        // its own. messages[0]'s workspace snapshot predates these writes and
        // the stubbed prose hides the bodies, so this is the only place the
        // model can see them.
        const saved = companionFilesBlock(allFiles, p);
        const savedNote = saved
          ? `The OTHER files from your response WERE already saved to the workspace exactly as shown here:\n${saved}\n`
          : "";
        const matchNote = saved
          ? ` It MUST match the saved files above: use the EXACT element ids, classes, and function names they define — do NOT invent new ones (no #startBtn or #score element the HTML doesn't have) — and wire up every control and element they contain (if the HTML says "press SPACEBAR", start on SPACEBAR; if it mentions mouse control, add a mousemove handler).`
          : "";
        const contMessages = [slimFirst].concat(messages.slice(1)).concat([
          { "role": "assistant", "content": prose },
          { "role": "user", "content": `Your last response got cut off before ${p} was finished, so ${p} was NOT saved. ${savedNote}Resend ONLY ${p}, complete from its first line, in the ===FILE format — no other files, one short sentence of prose at most.${matchNote} If you need to shorten, simplify logic inside functions; never drop features the ${saved ? "saved files above" : "other files"} expect.` }
        ]);
        const cont = parseFilesFromResponse((await askOnce(contMessages)).result);
        for (const f of cont.files) {
          mergeFile(allFiles, f);
          prose = prose.replace(truncStub(f.path), `[file: ${f.path}]`);
        }
        pending = cont.truncated;
      }

      let report = prose;
      if (pending.length > 0) {
        report += `\n\n**Heads up:** ${pending.join(", ")} kept getting cut off by the response length limit and was NOT saved. Try: "make ${pending[0]} shorter and resend it".`;
      }

      let res = { written: [], failed: [] };
      if (allFiles.length > 0) {
        res = await writeFiles(allFiles);
        if (res.written.length > 0) {
          report += `\n\n**Files updated in your workspace:** ${res.written.join(", ")}\n\nOpen the preview to see your site!`;
        }
        if (res.failed.length > 0) {
          // Verified writes retry hard (see writeFiles), so a failure here is
          // rare and usually transient. Don't dump the files' full source into
          // the chat — a wall of code overwhelms a middle schooler and they
          // can't reliably hand-copy several files anyway. Ask them to retry;
          // the next attempt regenerates and re-writes, which usually clears it.
          report += `\n\n**Heads up:** I couldn't save ${res.failed.join(", ")} this time. Just ask me to save it again (like "try saving that again") and I'll retry — you don't need to copy anything.`;
        }
      }

      codioIDE.coachBot.write(report, codioIDE.coachBot.MESSAGE_ROLES.ASSISTANT);
      // Keep the stubbed prose (not full file bodies) in history — the fresh
      // workspace context in messages[0] carries the current file state.
      messages.push({ "role": "assistant", "content": prose });
      return { written: res.written, failed: res.failed, truncated: pending };
    } catch (e) {
      codioIDE.coachBot.write("Hmm, something went wrong on my end. Try asking that again!");
      messages.pop();
      return null;
    } finally {
      codioIDE.coachBot.hideThinkingAnimation();
    }
  }

  // ============================================================
  // Session log — a hidden, shared workspace file (.coach-log.json) that every
  // coach appends to (one entry per session, tagged with `coach`), readable by
  // autograders. Dot-prefixed, so collectPaths() never feeds it back into the
  // LLM context. Deliberately records the student's questions: Codio's own
  // course coach-log export logs only the userPrompt field, which is empty for
  // messages-based coaches like these — this file is where the questions live.
  // This coach additionally records file-write stats per entry. Sessions are
  // never dropped (always appended).
  // ============================================================

  const SESSION_LOG_PATH = ".coach-log.json";
  const COACH_ID = "vibe-coder";
  const MAX_LOGGED_QUESTIONS = 50;

  async function loadSessionHistory() {
    const F = codioIDE.files;
    if (!F || typeof F.getContent !== "function") return [];
    try {
      const parsed = JSON.parse(await F.getContent(SESSION_LOG_PATH));
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  // Verified log write — same read-back-and-retry as site files, so a racy
  // deleteFiles()+add() can't silently zero the shared log (observed live: the
  // whole .coach-log.json history was wiped to 0 bytes by this exact bug).
  async function saveSessionHistory(history) {
    const F = codioIDE.files;
    if (!F || typeof F.add !== "function") return;
    const text = JSON.stringify(history, null, 2);
    await addVerified(F, SESSION_LOG_PATH, text);
  }

  // Never block the conversation on a log write. Awaiting the save in the turn
  // loop means a stalled write freezes the coach with no input box. queueSave()
  // is called WITHOUT await each turn (fire-and-forget); serialization/verification
  // live in saveSessionHistory→runExclusive. Only the end-of-session save is awaited.
  function queueSave(history) {
    return saveSessionHistory(history).catch(function() {});
  }

  codioIDE.coachBot.register("vibeCoder", "Vibe Coder", onButtonPress);

  async function onButtonPress() {
    codioIDE.coachBot.write(
      `Vibe Coder v${VERSION} - Give me a clear design spec and I'll build it! I can read spec files (.md/.txt) and SVG wireframes in your workspace.`,
      codioIDE.coachBot.MESSAGE_ROLES.ASSISTANT
    );

    let messages = [];

    let initialInput;
    while (true) {
      try {
        initialInput = await codioIDE.coachBot.input("What should I build? (Describe it, or point me at your spec file.)");
      } catch (e) {
        codioIDE.coachBot.showMenu();
        return;
      }

      if (initialInput === "version") {
        codioIDE.coachBot.write(`Current version: ${VERSION}`, codioIDE.coachBot.MESSAGE_ROLES.ASSISTANT);
        continue;
      }

      break;
    }

    const history = await loadSessionHistory();
    const session = {
      coach: COACH_ID,
      started: new Date().toISOString(),
      updated: null,
      ended: null,
      coachVersion: VERSION,
      exchanges: 0,
      questions: [],
      filesWritten: [],
      writeFailures: 0,
      filesLostToLengthLimit: 0
    };
    history.push(session);

    async function recordTurn(question, stats) {
      session.exchanges += 1;
      if (session.questions.length < MAX_LOGGED_QUESTIONS) {
        session.questions.push(String(question).slice(0, 300));
      }
      if (stats) {
        for (const p of stats.written) {
          if (!session.filesWritten.includes(p)) session.filesWritten.push(p);
        }
        session.writeFailures += stats.failed.length;
        session.filesLostToLengthLimit += stats.truncated.length;
      }
      session.updated = new Date().toISOString();
      queueSave(history); // fire-and-forget: never block the input loop on a log write
    }

    messages.push({ "role": "user", "content": await buildContextMessage(initialInput) });
    await recordTurn(initialInput, await runTurn(messages, initialInput));

    while (true) {
      let input;
      try {
        input = await codioIDE.coachBot.input("What next? Refine your spec, ask for changes, or say 'thanks' when you're done.");
      } catch (e) {
        break;
      }

      if (input === "version") {
        codioIDE.coachBot.write(`Current version: ${VERSION}`, codioIDE.coachBot.MESSAGE_ROLES.ASSISTANT);
        continue;
      }

      const trimmedInput = input.trim().toLowerCase();
      if (exitPhrases.includes(trimmedInput)) {
        break;
      }

      messages.push({ "role": "user", "content": input });

      // Refresh the context block so the coach sees the student's latest
      // spec/site edits (including files it just wrote last turn)
      try {
        messages[0] = { "role": "user", "content": await buildContextMessage(initialInput) };
      } catch (e) {
        // Keep the previous context if the refresh fails
      }

      await recordTurn(input, await runTurn(messages, initialInput));

      // Keep first message (workspace + guide) + last 8 messages (4 exchanges)
      while (messages.length > 9) {
        messages.splice(1, 2); // drop the oldest user+assistant pair, keep messages[0] intact
      }
    }

    session.ended = new Date().toISOString();
    await queueSave(history); // flush everything queued this session (safe to await — no input follows)

    codioIDE.coachBot.write("You're welcome! Keep refining that spec — great specs make great sites.");
    codioIDE.coachBot.showMenu();
  }

  // Exposed only for the Node test harness (unused inside Codio)
  window.__vibeCoderTest = { parseFilesFromResponse, isSafePath, collectPaths, normalizePath };

})(window.codioIDE, window);
