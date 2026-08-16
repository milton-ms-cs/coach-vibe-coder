// Vibe Coder — spec-to-code build assistant for Grade 8 tech.
// Unlike the other coaches, this one DOES write complete code: the learning
// objective is writing clear design specs, not writing the code itself.
// Students spec (text, spec.md, SVG wireframe exports) -> the coach builds
// HTML/CSS/JS files directly into the workspace -> students preview + refine.
(async function(codioIDE, window) {

  const VERSION = "1.0.0";

  const MAX_CONTEXT_CHARS = 40000;  // budget for spec + diagram + site context
  const MAX_FILE_READ = 12000;      // per-file read cap
  const MAX_WRITE_FILES = 8;        // per-turn file write cap

  const SPEC_EXTS = [".md", ".txt"];
  const SVG_EXTS = [".svg"];
  const SITE_EXTS = [".html", ".css", ".js"];
  const UNREADABLE_EXTS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".fig", ".pdf"];
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
- For images: if the workspace listing shows the student's own image files, reference them by relative path. Otherwise use CSS colors/shapes as placeholders. Never hotlink images from the internet.

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
        else if (UNREADABLE_EXTS.includes(ext)) out.unreadable.push(full);
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

  // Build the <workspace> text block: specs, SVG designs, current site files.
  async function gatherWorkspaceText() {
    const F = codioIDE.files;
    if (!F || typeof F.getStructure !== "function" || typeof F.getContent !== "function") {
      return "The workspace could not be read (Codio files API unavailable). Ask the student to paste their spec and describe their design.";
    }

    let paths = { specs: [], svgs: [], site: [], unreadable: [] };
    try {
      collectPaths(await F.getStructure(), "", paths);
    } catch (e) {
      return "The workspace could not be read. Ask the student to paste their spec and describe their design.";
    }

    let out = "";
    const sections = [
      ["Spec / design documents", paths.specs],
      ["SVG design exports (read the shapes and text to understand the layout)", paths.svgs],
      ["Current site files", paths.site],
    ];
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

    if (paths.unreadable.length > 0) {
      out += `\nDesign files present but NOT readable (binary): ${paths.unreadable.join(", ")}. If one matters, ask the student to export it as an SVG or describe it.\n`;
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
  // Returns {files: [{path, content}], prose} where prose is the response with
  // file bodies replaced by short stubs (safe to show and to keep in history).
  function parseFilesFromResponse(text) {
    const files = [];
    const re = /^[ \t]*===FILE:\s*(.+?)\s*===[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*===END FILE===[ \t]*$/gm;
    const prose = String(text).replace(re, function(whole, path, content) {
      // Tolerate a model that wrapped the body in a code fence anyway
      let body = content.replace(/^\s*```[a-z]*\r?\n/, "").replace(/\r?\n```\s*$/, "");
      const cleanPath = normalizePath(path);
      if (isSafePath(cleanPath) && files.length < MAX_WRITE_FILES) {
        files.push({ path: cleanPath, content: body });
        return `[file: ${cleanPath}]`;
      }
      return `[skipped a file with a disallowed path: ${path}]`;
    });
    return { files: files, prose: prose.trim() };
  }

  async function writeFiles(files) {
    const F = codioIDE.files;
    const written = [];
    const failed = [];
    if (!F || typeof F.add !== "function") {
      return { written: written, failed: files.map(f => f.path) };
    }
    for (const f of files) {
      try {
        await F.add(f.path, f.content);
        written.push(f.path);
      } catch (e) {
        failed.push(f.path);
      }
    }
    return { written: written, failed: failed };
  }

  // ============================================================
  // Conversation
  // ============================================================

  // Build the context-bearing first message from a fresh read. Re-run before
  // every ask() so the coach sees the student's latest spec and site edits.
  async function buildContextMessage(initialInput) {
    const context = await codioIDE.coachBot.getContext();

    const workspaceText = await gatherWorkspaceText();

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

  // One generate -> parse -> write-files -> report turn.
  async function runTurn(messages) {
    try {
      codioIDE.coachBot.showThinkingAnimation();
      const result = await codioIDE.coachBot.ask({
        systemPrompt: systemPrompt,
        messages: messages
      }, { preventMenu: true });

      const parsed = parseFilesFromResponse(result.result);
      let report = parsed.prose;

      if (parsed.files.length > 0) {
        const res = await writeFiles(parsed.files);
        if (res.written.length > 0) {
          report += `\n\n**Files updated in your workspace:** ${res.written.join(", ")}\n\nOpen the preview to see your site!`;
        }
        if (res.failed.length > 0) {
          // Couldn't write — show the code so the student can copy it in
          report += `\n\nI couldn't save these files myself, so copy them in yourself:\n`;
          for (const f of parsed.files) {
            if (res.failed.includes(f.path)) {
              report += `\n**${f.path}**\n\`\`\`\n${f.content}\n\`\`\`\n`;
            }
          }
        }
      }

      codioIDE.coachBot.write(report, codioIDE.coachBot.MESSAGE_ROLES.ASSISTANT);
      // Keep the stubbed prose (not full file bodies) in history — the fresh
      // workspace context in messages[0] carries the current file state.
      messages.push({ "role": "assistant", "content": parsed.prose });
      return true;
    } catch (e) {
      codioIDE.coachBot.write("Hmm, something went wrong on my end. Try asking that again!");
      messages.pop();
      return false;
    } finally {
      codioIDE.coachBot.hideThinkingAnimation();
    }
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

    messages.push({ "role": "user", "content": await buildContextMessage(initialInput) });
    await runTurn(messages);

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

      await runTurn(messages);

      // Keep first message (workspace + guide) + last 8 messages (4 exchanges)
      while (messages.length > 9) {
        messages.splice(1, 2); // drop the oldest user+assistant pair, keep messages[0] intact
      }
    }

    codioIDE.coachBot.write("You're welcome! Keep refining that spec — great specs make great sites.");
    codioIDE.coachBot.showMenu();
  }

  // Exposed only for the Node test harness (unused inside Codio)
  window.__vibeCoderTest = { parseFilesFromResponse, isSafePath, collectPaths, normalizePath };

})(window.codioIDE, window);
