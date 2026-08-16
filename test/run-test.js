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
  const captured = { asks: [], writes: [], added: [] };
  let inputCount = 0;
  const inputs = ["build my site", "make the header purple"];
  if (filesApi) {
    filesApi.add = async (p, content) => { captured.added.push({ path: p, content }); };
  }
  const codioIDE = {
    coachBot: {
      register(id, label, cb) { captured.cb = cb; },
      async getContext() { return context; },
      async input() {
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
      return { "spec.md": 1, "wireframe.svg": 1, "style.css": 1, "logo.png": 1, ".git": { "c": 1 } };
    },
    async getContent(p) {
      if (p === "spec.md") return "SPEC: a site about axolotls";
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
  check("svg text in context", m0.includes("Header goes here"));
  check("binary flagged not read", m0.includes("logo.png") && m0.includes("NOT readable"));
  check("dotdirs skipped", !m0.includes(".git"));
  check("guide included", m0.includes("GUIDE"));
  check("file written turn 1", c.added.some(a => a.path === "index.html" && a.content.includes("axolotls")));
  check("file written turn 2", c.added.some(a => a.path === "style.css" && a.content.includes("purple")));
  check("report names written files", c.writes.some(t => t.includes("Files updated") && t.includes("index.html")));
  check("turn-2 context sees student's edit", c.asks[1].messages[0].content.includes("color: green"));
  check("turn-1 context had the original css", c.asks[0].messages[0].content.includes("color: red"));
  check("history keeps stub not body", JSON.stringify(c.asks[1].messages).includes("[file: index.html]"));

  // ---------- degraded: no files API -> code shown in chat ----------
  console.log("degraded:");
  const { captured: c2 } = boot({ files: [], guidesPage: null, assignmentData: null }, undefined, [build1]);
  await c2.cb();
  check("workspace-unavailable note in context", c2.asks[0].messages[0].content.includes("could not be read"));
  check("code shown for copy-paste", c2.writes.some(t => t.includes("couldn't save") && t.includes("axolotls")));

  console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
