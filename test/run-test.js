// Test harness for coach-vibe-coder: stubs window.codioIDE, evals index.js,
// and exercises (1) the response parser + path safety, (2) a full button-press
// drive that checks spec/SVG context gathering, file writing, and history.
// Run: node test/run-test.js
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");

let failures = 0;
function check(label, cond) {
  if (cond) console.log("  ok  " + label);
  else { console.error("  FAIL " + label); failures++; }
}

function boot(context, filesApi, askResponses) {
  const captured = { asks: [], writes: [], added: [], inputCount: 0, fs: {} };
  let inputCount = 0;
  const inputs = ["build my site", "make the header purple"];
  if (filesApi) {
    // Model Codio's files API as an in-memory FS so addVerified()'s read-back works:
    // add() stores content, getContent() returns stored content (falling back to the
    // fixture's own getContent for pre-seeded files), deleteFiles() removes it.
    const origGetContent = typeof filesApi.getContent === "function" ? filesApi.getContent.bind(filesApi) : null;
    const origDelete = typeof filesApi.deleteFiles === "function" ? filesApi.deleteFiles.bind(filesApi) : null;
    filesApi.add = async (p, content) => { captured.added.push({ path: p, content }); captured.fs[p] = content; };
    filesApi.getContent = async (p) => {
      if (Object.prototype.hasOwnProperty.call(captured.fs, p)) return captured.fs[p];
      if (origGetContent) return origGetContent(p);
      throw new Error("none");
    };
    filesApi.deleteFiles = async (paths) => {
      for (const p of paths) delete captured.fs[p];
      if (origDelete) return origDelete(paths);
    };
  }
  const codioIDE = {
    coachBot: {
      register(id, label, cb) { captured.cb = cb; },
      async getContext() { return context; },
      async input() {
        captured.inputCount++;
        if (inputCount < inputs.length) return inputs[inputCount++];
        throw new Error("cancelled");
      },
      async ask(payload) {
        captured.asks.push(JSON.parse(JSON.stringify(payload)));
        return { result: askResponses[Math.min(captured.asks.length - 1, askResponses.length - 1)] };
      },
      write(t) { captured.writes.push(String(t)); },
      showMenu() {}, showThinkingAnimation() {}, hideThinkingAnimation() {},
      MESSAGE_ROLES: { ASSISTANT: "assistant" },
    },
    files: filesApi,
  };
  const window = { codioIDE };
  new Function("window", src)(window);
  return { captured, window };
}

(async () => {
  // ---------- parser unit tests ----------
  console.log("parser:");
  const { window: w } = boot({ files: [] }, undefined, ["x"]);
  const T = w.__vibeCoderTest;

  const resp = `I built your site! Here it is.

===FILE: index.html===
<!DOCTYPE html>
<html><body><h1>Hi</h1></body></html>
===END FILE===

===FILE: css/style.css===
\`\`\`css
h1 { color: blue; }
\`\`\`
===END FILE===

===FILE: ../evil.html===
hacked
===END FILE===

===FILE: script.py===
print("nope")
===END FILE===

Next, you could spec a footer!`;

  const parsed = T.parseFilesFromResponse(resp);
  check("extracts safe files only", parsed.files.length === 2);
  check("html body intact", parsed.files[0].path === "index.html" && parsed.files[0].content.includes("<h1>Hi</h1>"));
  check("strips stray code fences", parsed.files[1].content.trim() === "h1 { color: blue; }");
  check("prose keeps message text", parsed.prose.includes("I built your site!") && parsed.prose.includes("spec a footer"));
  check("prose stubs file bodies", parsed.prose.includes("[file: index.html]") && !parsed.prose.includes("<h1>Hi</h1>"));
  check("rejects .. path", parsed.prose.includes("disallowed") && !parsed.files.some(f => f.path.includes("..")));
  check("isSafePath basics", T.isSafePath("index.html") && T.isSafePath("css/style.css")
    && !T.isSafePath("/etc/passwd.html") && !T.isSafePath("a/../b.html") && !T.isSafePath("app.py")
    && !T.isSafePath("a/b/c/d.html"));

  // ---------- full drive: spec + SVG in, files written, refresh works ----------
  console.log("full drive:");
  const state = { css: "h1 { color: red; }" };
  const filesApi = {
    async getStructure() {
      return { "spec.md": 1, "README.md": 1, "wireframe.svg": 1, "style.css": 1, "logo.png": 1, "mockup.fig": 1, ".git": { "c": 1 } };
    },
    async getContent(p) {
      if (p === "spec.md") return "SPEC: a site about axolotls";
      if (p === "README.md") return "ASSIGNMENT_README should be skipped";
      if (p === "wireframe.svg") return "<svg><text>Header goes here</text></svg>";
      if (p === "style.css") return state.css;
      throw new Error("unreadable");
    },
  };
  const build1 = `Here you go!\n\n===FILE: index.html===\n<html>axolotls</html>\n===END FILE===`;
  const build2 = `Purple it is!\n\n===FILE: style.css===\nh1 { color: purple; }\n===END FILE===`;
  const { captured: c } = boot({ files: [], guidesPage: { content: "GUIDE" }, assignmentData: null }, filesApi, [build1, build2]);
  // simulate the student editing style.css after turn 1's build lands
  const origAdd = filesApi.add;
  filesApi.add = async (p, content) => {
    if (p === "index.html") state.css = "h1 { color: green; } /* student edit */";
    return origAdd(p, content);
  };
  await c.cb();

  const m0 = c.asks[0].messages[0].content;
  check("spec.md in context", m0.includes("SPEC: a site about axolotls"));
  check("assignment README skipped when a real spec exists", !m0.includes("ASSIGNMENT_README"));
  check("svg text in context", m0.includes("Header goes here"));
  check("png listed as usable asset", /Image assets[^\n]*logo\.png/.test(m0));
  check("fig flagged design-only", /NOT readable[^\n]*mockup\.fig/.test(m0));
  check("dotdirs skipped", !m0.includes(".git"));
  check("guide included", m0.includes("GUIDE"));
  check("file written turn 1", c.added.some(a => a.path === "index.html" && a.content.includes("axolotls")));
  check("file written turn 2", c.added.some(a => a.path === "style.css" && a.content.includes("purple")));
  check("report names written files", c.writes.some(t => t.includes("Files updated") && t.includes("index.html")));
  check("turn-2 context sees student's edit", c.asks[1].messages[0].content.includes("color: green"));
  check("turn-1 context had the original css", c.asks[0].messages[0].content.includes("color: red"));
  check("history keeps stub not body", JSON.stringify(c.asks[1].messages).includes("[file: index.html]"));

  // session log written and autograder-parseable
  const logAdds = c.added.filter(a => a.path === ".coach-log.json");
  check("session log written each turn", logAdds.length >= 3);
  const log = JSON.parse(logAdds[logAdds.length - 1].content);
  const s = Array.isArray(log) ? log[0] : {};
  check("session log records questions", log.length === 1 && s.questions.join("|") === "build my site|make the header purple");
  check("session log records files", s.filesWritten.includes("index.html") && s.filesWritten.includes("style.css"));
  check("session log stamps end", typeof s.ended === "string" && s.exchanges === 2);
  check("session log tags coach", s.coach === "vibe-coder");

  // a prior session in the log survives a new session (append, not clobber)
  {
    const prior = JSON.stringify([{ started: "2026-08-15T10:00:00Z", questions: ["old"], filesWritten: [], exchanges: 1 }]);
    const fApiA = {
      async getStructure() { return {}; },
      async getContent(p) { if (p === ".coach-log.json") return prior; throw new Error("none"); },
    };
    const { captured: cA } = boot({ files: [], guidesPage: null, assignmentData: null }, fApiA, ["No files here, just chatting!"]);
    await cA.cb();
    const adds = cA.added.filter(a => a.path === ".coach-log.json");
    const logA = JSON.parse(adds[adds.length - 1].content);
    check("prior session preserved, new appended", logA.length === 2 && logA[0].questions[0] === "old" && logA[1].questions[0] === "build my site");
  }

  // ---------- degraded: no files API -> code shown in chat ----------
  console.log("degraded:");
  const { captured: c2 } = boot({ files: [], guidesPage: null, assignmentData: null }, undefined, [build1]);
  await c2.cb();
  check("workspace-unavailable note in context", c2.asks[0].messages[0].content.includes("could not be read"));
  check("write failure names the file, no code wall", c2.writes.some(t => t.includes("couldn't save") && t.includes("index.html") && !t.includes("axolotls")));

  // ---------- truncation recovery: cut-off file re-asked and saved ----------
  console.log("truncation recovery:");
  const truncResp = `Here's your game!\n\n===FILE: index.html===\n<html><canvas id="gameCanvas"></canvas><p>Press SPACEBAR to start</p></html>\n===END FILE===\n\n===FILE: script.js===\n// this file gets cut off mid-\nconst canvas = docu`;
  const contResp = `Here it is complete.\n\n===FILE: script.js===\n// complete game logic\nconst canvas = document.getElementById("c");\n===END FILE===`;
  const build2b = `Done!\n\n===FILE: style.css===\nh1 { color: purple; }\n===END FILE===`;
  const fApi3 = {
    async getStructure() { return { "plan.md": 1, "old.js": 1 }; },
    async getContent(p) {
      if (p === "plan.md") return "SPECDOC keep this";
      if (p === "old.js") return "OLD_SITE_BODY drop from recovery";
      throw new Error("none");
    },
  };
  const { captured: c3 } = boot({ files: [], guidesPage: null, assignmentData: null }, fApi3, [truncResp, contResp, build2b]);
  await c3.cb();
  check("continuation ask happened", c3.asks.length === 3);
  // Trim (v1.5.2): the recovery ask reuses a slim first message — spec/guide kept,
  // current-site files dropped (companionFilesBlock already carries the just-built
  // files, so resending the whole site every recovery ask was redundant).
  check("initial ask includes current-site files", c3.asks[0].messages[0].content.includes("OLD_SITE_BODY"));
  check("recovery ask drops current-site files", !c3.asks[1].messages[0].content.includes("OLD_SITE_BODY"));
  check("recovery ask keeps the spec", c3.asks[1].messages[0].content.includes("SPECDOC"));
  const contReq = c3.asks[1].messages[c3.asks[1].messages.length - 1];
  check("continuation asks for just script.js", contReq.role === "user" && contReq.content.includes("Resend ONLY script.js"));
  // Regression (v1.5.1): the recovery ask must SHOW the saved index.html verbatim
  // so the resent script.js wires into the real ids/controls instead of inventing
  // a #startBtn/#score the HTML never had (which broke the game on load, Aug 2026).
  check("continuation includes saved index.html body verbatim",
    contReq.content.includes('<canvas id="gameCanvas">') && contReq.content.includes("Press SPACEBAR to start"));
  check("continuation excludes the cut-off file's own partial body",
    !contReq.content.includes("this file gets cut off mid-"));
  check("complete html written from first response", c3.added.some(a => a.path === "index.html"));
  check("recovered script.js written", c3.added.some(a => a.path === "script.js" && a.content.includes("complete game logic")));
  check("partial script.js never written", !c3.added.some(a => a.path === "script.js" && a.content.includes("cut off mid-")));
  check("report lists both files", c3.writes.some(t => t.includes("Files updated") && t.includes("script.js") && t.includes("index.html")));
  check("history stub patched after recovery", JSON.stringify(c3.asks[2].messages).includes("[file: script.js]"));
  check("no cut-off note after recovery", !JSON.stringify(c3.asks[2].messages).includes("cut off"));

  // ---------- unrecoverable truncation: student told what to do ----------
  const { captured: c4 } = boot({ files: [], guidesPage: null, assignmentData: null }, fApi3, [truncResp, truncResp, truncResp]);
  await c4.cb();
  check("gives up after MAX_CONTINUES and tells student", c4.writes.some(t => t.includes("kept getting cut off") && t.includes("shorter")));

  // ---------- overwrite: add() rejects on existing file -> delete + re-add ----------
  console.log("overwrite fallback:");
  const existing = new Set(["style.css"]);
  const deleted = [];
  const fApi5 = {
    async getStructure() { return {}; },
    async getContent() { throw new Error("none"); },
    async deleteFiles(paths) { deleted.push(...paths); paths.forEach(p => existing.delete(p)); },
  };
  const { captured: c5 } = boot({ files: [], guidesPage: null, assignmentData: null }, fApi5, [build2b]);
  // wrap the capture add() with exists-semantics like live Codio
  const capAdd = fApi5.add;
  fApi5.add = async (p, content) => {
    if (existing.has(p)) throw new Error("file exists");
    existing.add(p);
    return capAdd(p, content);
  };
  await c5.cb();
  check("existing file deleted then re-added", deleted.includes("style.css") && c5.added.some(a => a.path === "style.css" && a.content.includes("purple")));
  check("overwrite reported as success", c5.writes.some(t => t.includes("Files updated") && t.includes("style.css")));

  // ---------- input loop survives a stalled log write (v1.5.2) ----------
  // Regression for the "lost the ability to respond" bug: a .coach-log.json write
  // that never resolves must NOT freeze the conversation. Per-turn saves are now
  // fire-and-forget (queueSave), so both turns run even though every log write hangs.
  console.log("log write never blocks the loop:");
  {
    const hang = {
      async getStructure() { return {}; },
      async getContent() { throw new Error("none"); },
      async deleteFiles() {},
    };
    const { captured: cH } = boot({ files: [], guidesPage: null, assignmentData: null }, hang, [build1, build2b]);
    const capAddH = hang.add; // boot installed a capturing add()
    hang.add = (p, content) => {
      capAddH(p, content);                                   // still record the write
      if (p === ".coach-log.json") return new Promise(() => {}); // ...but the log write hangs forever
      return Promise.resolve();
    };
    // cb() itself stays pending on the awaited end-of-session flush (post-loop, fine),
    // so race it against a short timer and assert the loop still completed both turns.
    await Promise.race([cH.cb(), new Promise(r => setTimeout(r, 800))]);
    check("both turns ran despite a hanging log write",
      cH.asks.length === 2 && cH.added.some(a => a.path === "index.html") && cH.added.some(a => a.path === "style.css"));
  }

  // ---------- 0-byte write bug: verify+retry recovers, never reports success on empty (v1.5.3) ----------
  // Regression for the file-destroying bug: Codio's deleteFiles()+add() overwrite
  // landed 0-byte files while add() threw nothing, so the coach reported success and
  // wiped the file. addVerified() must read back, see the empty write, and retry.
  console.log("0-byte write recovery:");
  {
    let addCount = 0;
    const fApi6 = {
      async getStructure() { return {}; },
      async getContent() { throw new Error("none"); },
      async deleteFiles() {},
    };
    const { captured: c6 } = boot({ files: [], guidesPage: null, assignmentData: null }, fApi6,
      ["Done!\n\n===FILE: game.js===\nGAMELOGIC\n===END FILE==="]);
    const capAdd6 = fApi6.add; // boot's capturing add (stores fs + captures)
    fApi6.add = async (p, content) => {
      addCount++;
      // First write of game.js lands EMPTY (the Codio bug); later writes are fine.
      return capAdd6(p, (p === "game.js" && addCount <= 1) ? "" : content);
    };
    await c6.cb();
    const finalGame = c6.added.filter(a => a.path === "game.js").pop();
    check("empty write retried until real content lands", finalGame && finalGame.content === "GAMELOGIC");
    check("not reported saved on the empty write, not dumped",
      c6.writes.some(t => t.includes("Files updated") && t.includes("game.js")) &&
      !c6.writes.some(t => t.includes("couldn't save")));
  }

  console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
