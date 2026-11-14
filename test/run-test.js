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

function boot(context, filesApi, askResponses, inputsOverride) {
  const captured = { asks: [], writes: [], added: [], inputCount: 0, fs: {} };
  let inputCount = 0;
  const inputs = inputsOverride || ["build my site", "make the header purple"];
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

  // ---------- v1.7.0 additions ----------
  const ctx0 = { files: [], guidesPage: { content: "GUIDE" }, assignmentData: null };
  const noEmptyAssistant = (asks) => asks.every(a => a.messages.every(m => typeof m.content === "string" && m.content.trim() !== ""));
  const lastLog = (cap) => { const a = cap.added.filter(x => x.path === ".coach-log.json"); return a.length ? JSON.parse(a[a.length - 1].content) : null; };
  // An EMPTY structure map is treated as unreadable by loadSessionHistory (S2), so an
  // "empty workspace" fixture carries a dot-file (skipped by collectPaths).
  const mkApi = (tree, files) => ({
    async getStructure() { return Object.keys(tree).length ? tree : { ".keep": 1 }; },
    async getContent(p) { if (files && Object.prototype.hasOwnProperty.call(files, p)) return typeof files[p] === "function" ? files[p]() : files[p]; throw new Error("none"); },
  });

  console.log("isExitMessage:");
  {
    const X = T.isExitMessage;
    for (const t of ["thanks!", "ok bye", "no thanks", "i\u2019m good thanks", "thank you so much", "that's all", "stop", "done", "Thank you", "no thanks \u{1F642}", "bye"]) check("exits: " + t, X(t));
    for (const t of ["thanks still broken", "im done with loops", "im good at this", "stop button doesn't work", "thanks, but why?", "ok", "good",
      "thanks can you make the header bigger please", "make the footer stay at the bottom", null, undefined, "   ", "!!!"]) check("stays open: " + t, !X(t));
  }

  console.log("first message is a goodbye:");
  {
    const { captured: cx } = boot(ctx0, mkApi({}), ["never used"], ["thanks!"]);
    await cx.cb();
    check("no ask and no log session", cx.asks.length === 0 && cx.added.length === 0);
    check("goodbye written", cx.writes.some(t => t.includes("Okay, bye!")));
  }

  console.log("empty replies:");
  {
    // first reply empty, student asks again: new question must be answered (not the old one)
    const { captured: ce } = boot(ctx0, mkApi({}), ["", "Built!\n\n===FILE: index.html===\n<p>pond</p>\n===END FILE==="],
      ["make a frog page", "make a pond page"]);
    await ce.cb();
    check("empty first reply: friendly retry message", ce.writes.some(t => t.includes("didn't get an answer")));
    check("never write empty/undefined", ce.writes.every(t => t.trim() !== "" && t !== "undefined"));
    check("second ask carries the NEW question, only one message", ce.asks[1].messages.length === 1 && ce.asks[1].messages[0].content.includes("The student says: make a pond page") && !ce.asks[1].messages[0].content.includes("frog"));
    check("no empty assistant turn ever sent", noEmptyAssistant(ce.asks));
    const l = lastLog(ce);
    check("failedReplies logged", l && l[0].failedReplies === 1);
  }
  {
    // empty reply on a follow-up: user turn dropped, history clean
    const { captured: cf } = boot(ctx0, mkApi({}), ["Hello there", "", "OK again"], ["a", "b", "c"]);
    await cf.cb();
    check("follow-up empty: no empty assistant", noEmptyAssistant(cf.asks));
    check("follow-up empty: failed user turn removed", cf.asks.length === 3 && cf.asks[2].messages.length === 3 && !JSON.stringify(cf.asks[2].messages.slice(1)).includes('"b"'));
    const { captured: cu } = boot(ctx0, mkApi({}), [undefined], ["x"]);
    await cu.cb();
    check("undefined result isn't shown as 'undefined'", cu.writes.every(t => t !== "undefined" && !t.includes("undefined")));
  }
  {
    // empty continuation ends recovery, adds no empty turn, reports the file as not saved
    const trunc = `Game!\n\n===FILE: index.html===\n<p>x</p>\n===END FILE===\n\n===FILE: script.js===\nconst a = docu`;
    const { captured: cc } = boot(ctx0, mkApi({}), [trunc, "", "fine"], ["build", "thanks!"]);
    await cc.cb();
    check("empty continuation: one recovery ask then stop", cc.asks.length === 2);
    check("empty continuation: reported not saved", cc.writes.some(t => t.includes("kept getting cut off") && t.includes("script.js")));
    check("empty continuation: nothing empty in history", noEmptyAssistant(cc.asks));
    check("empty continuation: partial never written", !cc.added.some(a => a.path === "script.js"));
  }

  console.log("files-changed note, write note, fingerprints:");
  {
    // Fixture file content flips after turn 2 (read at getContent time); boot()'s
    // in-memory-FS wrapper stays in place so log read-backs work.
    const api = mkApi({ "style.css": 1 }, { "style.css": () => (cn.asks.length >= 2 ? "h1{color:green}" : "h1{color:red}") });
    const resp = (n) => `Turn ${n}.`;
    const { captured: cn } = boot(ctx0, api, [resp(1), resp(2), resp(3), resp(4)], ["first", "second", "third", "fourth"]);
    await cn.cb();
    const userMsg = (i) => cn.asks[i].messages[cn.asks[i].messages.length - 1].content;
    check("turn 2 (no change): no note", userMsg(1) === "second");
    check("turn 3 (changed): note + raw input", userMsg(2) === "(Note: the student's files have changed since your last reply.)\n\nthird");
    check("turn 4 (unchanged again): no note", userMsg(3) === "fourth");
    check("refresh labels first question as old", cn.asks[1].messages[0].content.includes("The student's first question in this chat was: first") && !cn.asks[1].messages[0].content.includes("The student says:"));
    check("first turn says 'The student says'", cn.asks[0].messages[0].content.includes("The student says: first"));
    const l = lastLog(cn)[0];
    check("contextFingerprints logged per turn", l.contextFingerprints.length === 4 && l.contextFingerprints.every(f => /^[0-9a-f]{8}$/.test(f.hash) && typeof f.len === "number"));
    check("changed flags are [false,false,true,false]", l.contextFingerprints.map(f => f.changed).join() === "false,false,true,false");
    check("questions log the raw input", l.questions.join("|") === "first|second|third|fourth");
  }
  {
    // "last turn you wrote ..." note on the next message (and combined with files-changed)
    const resp1 = "Built!\n\n===FILE: index.html===\n<p>a</p>\n===END FILE===\n\n===FILE: style.css===\np{}\n===END FILE===";
    const { captured: cw } = boot(ctx0, mkApi({}), [resp1, "ok"], ["build it", "tweak it"]);
    await cw.cb();
    const um = cw.asks[1].messages[cw.asks[1].messages.length - 1].content;
    check("write note names files written", um.startsWith("(Note: last turn you wrote index.html, style.css. Failed: none. Cut off by the length limit: none.)"));
    check("write note followed by raw input", um.endsWith("tweak it"));
  }

  console.log("queueSave serializes:");
  {
    let inFlight = 0, maxInFlight = 0;
    const api = mkApi({});
    const { captured: cq } = boot(ctx0, api, ["a", "b", "c", "d"], ["1", "2", "3"]);
    const capAdd = api.add;
    api.add = async (p, content) => {
      if (p === ".coach-log.json") {
        inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise(r => setTimeout(r, 25));
        inFlight--;
      }
      return capAdd(p, content);
    };
    await cq.cb();
    check("never two log writes at once", maxInFlight === 1 && cq.added.filter(a => a.path === ".coach-log.json").length >= 3);
  }

  console.log("log read failure never wipes the log:");
  {
    const api = {
      async getStructure() { return { ".coach-log.json": 1 }; },
      async getContent(p) { throw new Error("transient"); },
    };
    const { captured: cl } = boot(ctx0, api, ["hi", "ok"], ["q1", "thanks"]);
    // boot's in-memory fs would make getContent succeed after a write; assert nothing was ever written
    await cl.cb();
    check("conversation still works", cl.asks.length === 1);
    check("log is not overwritten", !cl.added.some(a => a.path === ".coach-log.json"));
  }

  console.log("Not shown line:");
  {
    const big = "x".repeat(9000);
    const api = mkApi(
      { "a.md": 1, "b.md": 1, "c.md": 1, "d.md": 1, "index.html": 1, "bad.css": 1 },
      { "a.md": big, "b.md": big, "c.md": big, "d.md": big, "index.html": "<p>SITE_BODY</p>", "bad.css": () => { throw new Error("nope"); } });
    const { captured: cs } = boot(ctx0, api, ["ok"], ["build"]);
    await cs.cb();
    const m = cs.asks[0].messages[0].content;
    check("site file read before big specs", m.includes("SITE_BODY"));
    check("Not shown line lists unreadable and over-budget files", /Not shown \(too long to include, or couldn't be read\):[^\n]*bad\.css/.test(m) && /Not shown[^\n]*d\.md/.test(m));
  }

  console.log("blank input ignored:");
  {
    const { captured: cb } = boot(ctx0, mkApi({}), ["ok"], ["  ", "build", "   ", "  VERSION ", "thanks"]);
    await cb.cb();
    check("blank messages never reach ask(); version is trimmed", cb.asks.length === 1 && cb.writes.some(t => t.startsWith("Current version")));
  }

  console.log("round 2:");
  {
    // SF-1: getStructure reflects the coach's own writes; its own write must not trigger the changed note
    const store = { ".keep": "" }; // non-empty map (S2)
    const api = {
      async getStructure() { const t = {}; for (const p of Object.keys(store)) t[p] = 1; return t; },
      async getContent(p) { if (p in store) return store[p]; throw new Error("none"); },
      async add(p, c) { store[p] = c; },
      async deleteFiles(ps) { for (const p of ps) delete store[p]; },
    };
    const build = "Built!\n\n===FILE: index.html===\n<p>a</p>\n===END FILE===";
    const { captured: c1 } = boot(ctx0, api, [build, "ok", "ok", "ok"], ["build it", "tweak it", "again", "once more"]);
    // boot() replaces add/getContent with its own in-memory FS; mirror it into the store too
    const bootAdd = api.add, bootGet = api.getContent;
    api.add = async (p, c) => { store[p] = c; return bootAdd(p, c); };
    api.getContent = async (p) => (p in store ? store[p] : bootGet(p));
    await c1.cb();
    const um = (i) => c1.asks[i].messages[c1.asks[i].messages.length - 1].content;
    check("own write: write note but NO files-changed note", um(1).startsWith("(Note: last turn you wrote index.html.") && !um(1).includes("have changed"));
    check("no note on a quiet turn", um(2) === "again");
    const l = lastLog(c1)[0];
    check("changed flags all false after own write", l.contextFingerprints.map(f => f.changed).join() === "false,false,false,false");
    // student edit after a write DOES count
    const { captured: c1b } = boot(ctx0, api, [build, "ok", "ok"], ["build it", "tweak it", "again"]);
    const g2 = api.getContent;
    api.getContent = async (p) => (p === "index.html" && c1b.asks.length >= 2 ? "<p>student edit</p>" : g2(p));
    await c1b.cb();
    const um2 = c1b.asks[2].messages[c1b.asks[2].messages.length - 1].content;
    check("student edit after turn 2 still flagged", um2.startsWith("(Note: the student's files have changed since your last reply.)"));
  }
  {
    // SF-2: continuation replies with prose but no file block
    const trunc = "Game!\n\n===FILE: index.html===\n<p>x</p>\n===END FILE===\n\n===FILE: script.js===\nconst a = docu";
    const { captured: c2 } = boot(ctx0, mkApi({}), [trunc, "Sorry, no file this time.", "ok"], ["build", "next"]);
    await c2.cb();
    check("lost file reported to the student", c2.writes.some(t => t.includes("kept getting cut off") && t.includes("script.js")));
    const um = c2.asks[2].messages[c2.asks[2].messages.length - 1].content;
    check("write note lists script.js as cut off", um.includes("Cut off by the length limit: script.js"));
    check("filesLostToLengthLimit === 1", lastLog(c2)[0].filesLostToLengthLimit === 1);
  }
  {
    // NIT-2/3: over-cap files appear in the write note
    let r = "Many!\n\n";
    for (let i = 1; i <= 9; i++) r += `===FILE: f${i}.js===\nvar a${i}=1;\n===END FILE===\n\n`;
    const { captured: c3 } = boot(ctx0, mkApi({}), [r, "ok"], ["build", "next"]);
    await c3.cb();
    const um = c3.asks[1].messages[c3.asks[1].messages.length - 1].content;
    check("over-cap file in write note", um.includes("Not saved (too many files): f9.js"));
  }
  {
    // S4: a transient getStructure()/getContext() failure on a REFRESH keeps the old context
    for (const mode of ["structure", "context"]) {
      const api = mkApi({ "a.html": 1 }, { "a.html": "<p>SITE</p>" });
      let capRef = null, failedOnce = false;
      const ctx = { files: [], guidesPage: { content: "REAL GUIDE" }, assignmentData: null };
      Object.defineProperty(ctx, "guidesPage", { get() { if (mode === "context" && capRef && capRef.asks.length === 1 && !failedOnce) { failedOnce = true; throw new Error("ctx down"); } return { content: "REAL GUIDE" }; } });
      const { captured: c4 } = boot(ctx, api, ["one", "two", "three"], ["q1", "q2", "q3"]);
      capRef = c4;
      const orig = api.getStructure;
      api.getStructure = async () => { if (mode === "structure" && c4.asks.length === 1 && !failedOnce) { failedOnce = true; throw new Error("boom"); } return orig(); };
      await c4.cb();
      const l = lastLog(c4)[0];
      const m1 = c4.asks[1].messages[0].content;
      check(mode + " refresh failure: old context kept", m1.includes("<p>SITE</p>") && m1.includes("REAL GUIDE") && !m1.includes("paste their spec"));
      check(mode + " refresh failure: logged as refreshFailed, one entry per turn", l.contextFingerprints.length === 3 && l.contextFingerprints[1].refreshFailed === true && l.contextFingerprints[1].hash === null);
      check(mode + " refresh failure: no spurious files-changed flags", l.contextFingerprints.every(f => f.changed === false));
      const u2 = c4.asks[2].messages[c4.asks[2].messages.length - 1].content;
      check(mode + " refresh failure: no note on the next turn", u2 === "q3");
    }
  }
  {
    // S2: both log reads fail and getStructure() returns an EMPTY map -> never write the log
    const api = { async getStructure() { return {}; }, async getContent() { throw new Error("transient"); } };
    const { captured: cz } = boot(ctx0, api, ["hi"], ["q1"]);
    // boot's FS wrapper would serve written files back; nothing must be written
    await cz.cb();
    check("empty structure map + failed reads: log not written", !cz.added.some(a => a.path === ".coach-log.json"));
  }
  {
    const { captured: c5 } = boot({ get files() { return []; }, guidesPage: null, assignmentData: null }, mkApi({ "a.html": 1 }, { "a.html": "<p>x</p>" }), ["one", "", "three"], ["q1", "q2", "q3"]);
    // empty reply on turn 2: turn 3 (retry) is not "changed" and baseline wasn't advanced wrongly
    await c5.cb();
    check("retry after empty reply works", c5.asks.length === 3);
  }
  {
    const api = mkApi({ "a.html": 1, "b.css": 1, "e.js": 1, "n.js": 1 }, { "a.html": "<p>hi</p>", "b.css": "", "e.js": "y".repeat(9000), "n.js": () => 42 });
    const { captured: c7 } = boot(ctx0, api, ["ok"], ["build"]);
    await c7.cb();
    const m = c7.asks[0].messages[0].content;
    check("empty file shown as (empty file)", /--- Current site files — b\.css ---\n\(empty file\)/.test(m));
    check("capped file marked, not on Not shown", m.includes("(cut off after 8000 characters)") && !/Not shown[^\n]*e\.js/.test(m));
    check("non-string read is Not shown", /Not shown[^\n]*n\.js/.test(m));
    const iA = m.indexOf("— a.html"), iB = m.indexOf("— b.css"), iE = m.indexOf("— e.js");
    check("files displayed sorted by path", iA > 0 && iA < iB && iB < iE);
  }
  {
    // R5: a throwing getContext / hung context doesn't kill the first turn
    const captured = { asks: [], writes: [] };
    const codioIDE = { coachBot: { register(i, l, cb) { captured.cb = cb; }, async getContext() { throw new Error("no ctx"); },
      async input() { captured.n = (captured.n || 0) + 1; if (captured.n === 1) return "build a page"; throw new Error("x"); },
      async ask(p) { captured.asks.push(p); return { result: "Sure." }; }, write(t) { captured.writes.push(t); }, showMenu() {}, showThinkingAnimation() {}, hideThinkingAnimation() {}, MESSAGE_ROLES: { ASSISTANT: "a" } }, files: undefined };
    new Function("window", src)({ codioIDE });
    await captured.cb();
    check("answers even when context can't be read", captured.asks.length === 1 && (captured.asks[0].messages[0].content.includes("couldn't read") || captured.asks[0].messages[0].content.includes("could not be read")));
  }
  {
    // R5: recovery path logs the question before building; failed build can't drop it
    const captured = { asks: [], writes: [], added: [], fs: {} };
    let n = 0, ctxFail = false;
    const files = { async getStructure() { return { ".keep": 1 }; }, async getContent(p) { if (p in captured.fs) return captured.fs[p]; throw new Error("none"); },
      async add(p, c) { captured.fs[p] = c; captured.added.push({ path: p, content: c }); }, async deleteFiles(ps) { ps.forEach(p => delete captured.fs[p]); } };
    const inputs = ["q1", "q2"];
    const codioIDE = { coachBot: { register(i, l, cb) { captured.cb = cb; }, async getContext() { if (ctxFail) throw new Error("x"); return { files: [], guidesPage: null, assignmentData: null }; },
      async input() { if (n < inputs.length) return inputs[n++]; throw new Error("x"); },
      async ask(p) { captured.asks.push(JSON.parse(JSON.stringify(p))); return { result: captured.asks.length === 1 ? "" : "ok" }; },
      write(t) { captured.writes.push(t); }, showMenu() {}, showThinkingAnimation() {}, hideThinkingAnimation() {}, MESSAGE_ROLES: { ASSISTANT: "a" } }, files };
    const origInput = codioIDE.coachBot.input;
    codioIDE.coachBot.input = async () => { const v = await origInput(); if (v === "q2") ctxFail = true; return v; };
    new Function("window", src)({ codioIDE });
    await captured.cb();
    const adds = captured.added.filter(a => a.path === ".coach-log.json");
    const lg = JSON.parse(adds[adds.length - 1].content)[0];
    check("recovery: question logged, fallback context used", lg.questions.join("|") === "q1|q2" && captured.asks[1].messages[0].content.includes("The student says: q2"));
  }

  console.log("assignment context (.guides/coach-context.md):");
  {
    const NOTES = "Use plain HTML, CSS and JS only. Keep scores in localStorage.";
    const ctxN = { files: [], guidesPage: { content: "GUIDE" }, assignmentData: null };
    const build = "Built!\n\n===FILE: index.html===\n<p>x</p>\n===END FILE===";
    const withNotes = (n) => mkApi({ "index.html": 1, ".guides": { "coach-context.md": 1 } }, { "index.html": "<p>x</p>", ".guides/coach-context.md": n });
    const noFeature = mkApi({ "index.html": 1 }, { "index.html": "<p>x</p>" });
    const inputsN = ["build it", "bigger header", "thanks!"];
    const { captured: cP } = boot(ctxN, withNotes(NOTES), [build, "ok", "ok"], inputsN);
    await cP.cb();
    const blk = "Notes from the teacher for this assignment (follow these; the student can't see them):\n<assignment_context>\n" + NOTES + "\n</assignment_context>\n";
    const ws0 = cP.asks[0].messages[0].content;
    check("present: block in messages[0] on first turn", ws0.includes(blk));
    check("present: block in messages[0] on follow-up", cP.asks[1].messages[0].content.includes(blk));
    check("present: block sits after </guide>, outside <workspace>",
      ws0.indexOf("</guide>") < ws0.indexOf("<assignment_context>") && !ws0.split("</workspace>")[0].includes("assignment_context"));
    check("present: not shown as a spec doc in workspace", !ws0.split("</workspace>")[0].includes("coach-context"));
    check("present: system prompt has the notes section", cP.asks[0].systemPrompt.includes("## Notes from the teacher"));

    const { captured: cM } = boot(ctxN, noFeature, [build, "ok", "ok"], inputsN);
    await cM.cb();
    check("missing: no block", cM.asks.every(a => !a.messages[0].content.includes("assignment_context")));
    const all = (c) => c.asks.map(a => a.messages[0].content).join("\n--\n");
    const { captured: cE } = boot(ctxN, withNotes("  \n \n"), [build, "ok", "ok"], inputsN);
    await cE.cb();
    check("empty file: byte-identical to missing", all(cE) === all(cM));
    check("fingerprints unchanged by the notes", JSON.stringify(lastLog(cM)[0].contextFingerprints) === JSON.stringify(lastLog(cP)[0].contextFingerprints));

    const { captured: cB } = boot(ctxN, withNotes("A".repeat(5000)), [build, "ok"], ["build it", "thanks!"]);
    await cB.cb();
    const bm = cB.asks[0].messages[0].content;
    check("over cap: cut at 4000 with a marker", bm.includes("(teacher notes cut off here)") && !bm.includes("A".repeat(4001)) && bm.includes("A".repeat(3900)));

    let reads = 0;
    const counting = withNotes(NOTES);
    const origGC = counting.getContent;
    counting.getContent = async (p) => { if (p === ".guides/coach-context.md") reads++; return origGC(p); };
    const { captured: cC } = boot(ctxN, counting, [build, "ok", "ok"], inputsN);
    await cC.cb();
    check("read once per session", reads === 1);

    let mreads = 0;
    const missing = mkApi({ "index.html": 1 }, { "index.html": "<p>x</p>" });
    const origM = missing.getContent;
    missing.getContent = async (p) => { if (p === ".guides/coach-context.md") mreads++; return origM(p); };
    const { captured: cMi } = boot(ctxN, missing, [build, "ok", "ok"], inputsN);
    await cMi.cb();
    check("definitely missing: one read per session", mreads === 1);

    // a throw on turn 1 then success: notes appear on turn 2
    let tcalls = 0;
    const flaky = withNotes(NOTES);
    const origF = flaky.getContent;
    flaky.getContent = async (p) => { if (p === ".guides/coach-context.md" && tcalls++ === 0) throw new Error("blip"); return origF(p); };
    const { captured: cF } = boot(ctxN, flaky, [build, "ok", "ok"], inputsN);
    await cF.cb();
    check("throw on turn 1: no block then", !cF.asks[0].messages[0].content.includes("assignment_context"));
    check("throw on turn 1: notes appear on turn 2", cF.asks[1].messages[0].content.includes(blk));

    const trunc = "Game!\n\n===FILE: index.html===\n<p>x</p>\n===END FILE===\n\n===FILE: script.js===\nconst a = docu";
    const { captured: cR } = boot(ctxN, withNotes(NOTES), [trunc, "===FILE: script.js===\nconst a = 1;\n===END FILE===", "ok"], ["build", "thanks!"]);
    await cR.cb();
    check("recovery ask includes the notes", cR.asks.length >= 2 && cR.asks[1].messages[0].content.includes("<assignment_context>"));

    // hung read: coach still answers (uses the real 8s timeout)
    const hung = withNotes(NOTES);
    const origGC2 = hung.getContent;
    hung.getContent = (p) => p === ".guides/coach-context.md" ? new Promise(() => {}) : origGC2(p);
    const { captured: cH2 } = boot(ctxN, hung, [build], ["build it", "thanks!"]);
    await cH2.cb();
    check("hung read: coach still answers, no block", cH2.asks.length === 1 && !cH2.asks[0].messages[0].content.includes("assignment_context"));
  }

  console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
