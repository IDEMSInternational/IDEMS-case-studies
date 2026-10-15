// Applies an edit submitted from the website (a GitHub issue whose title starts with "[edit]") and opens a pull request.
// Run by .github/workflows/apply-edit.yml. The issue content is untrusted: it is only ever parsed as JSON, file paths
// are restricted to content/, and the result must pass tools/validate.js before a pull request is opened.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
const issue = event.issue;
const repo = process.env.GITHUB_REPOSITORY;
const DRY = !!process.env.DRY_RUN; // local testing: print instead of commenting, committing or opening a pull request
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], ...opts });
const comment = text => DRY ? console.log("COMMENT: " + text) : run("gh", ["issue", "comment", String(issue.number), "--repo", repo, "--body-file", "-"], { input: text });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const snippet = v => { const s = typeof v === "string" ? v : JSON.stringify(v); return s.length > 300 ? s.slice(0, 299) + "…" : s; };

function fail(msg) { comment(`⚠️ ${msg}`); console.log(msg); process.exit(0); }

// Only people with access to the repository can submit edits; the site is public. The check uses the account that
// actually created the issue, whatever username was typed on the website.
const siteJson = JSON.parse(fs.readFileSync(path.join(ROOT, "content/site.json"), "utf8"));
const contact = (siteJson.editorsContact || "the site maintainer") + (siteJson.editorsEmail ? ` (${siteJson.editorsEmail})` : "");
if (!["OWNER", "MEMBER", "COLLABORATOR"].includes(issue.author_association))
  fail(`Thanks for the suggestion! @${issue.user.login} doesn't have access to this repository yet, so these changes were not applied. Please contact ${contact} and ask to be added, then submit your changes again from the website (they are still saved in your browser).`);

const m = (issue.body || "").match(/```json\s*\n([\s\S]*?)\n```/);
if (!m) fail("I couldn't find the changes in this issue. Please submit them again from the website using the Edit button.");
let payload;
try { payload = JSON.parse(m[1]); } catch (e) { fail("The changes in this issue could not be read (they may have been edited by hand). Please submit them again from the website."); }
if (payload.version !== 1 || !Array.isArray(payload.edits)) fail("These changes come from an older or unknown version of the editor. Please submit them again from the website.");

const FILE_OK = /^content\/([a-z0-9-]+\/(personas|case-studies\/[a-z0-9-]+)|site|categories)\.json$/;
const SITE_FIELDS = ["personasNote", "creditsNote"], CAT_FIELDS = ["lede", "personasNote", "sources", "creditsNote"];
const applied = [], conflicts = [];

function findBlock(doc, id) {
  for (const s of doc.sections) for (const b of s.blocks) {
    if (b.id === id) return { b, s, list: s.blocks };
    for (const c of b.blocks || []) if (c.id === id) return { b: c, s, list: b.blocks };
  }
  return null;
}
function usedIds(doc) { const ids = new Set(); for (const s of doc.sections) for (const b of s.blocks) { ids.add(b.id); (b.blocks || []).forEach(c => ids.add(c.id)); } return ids; }

for (const edit of payload.edits) {
  if (!FILE_OK.test(edit.file || "") || !fs.existsSync(path.join(ROOT, edit.file))) fail(`The changes refer to a file I can't edit (${edit.file}).`);
  const file = path.join(ROOT, edit.file);
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const label = edit.file.replace(/^content\//, "");
  const conflict = (op, why, current) => conflicts.push({ file: label, op, why, current });
  const ok = op => applied.push({ file: label, op });
  const order = { set: 0, delete: 1, order: 2, insert: 3 };
  const ops = [...edit.ops].sort((a, b) => (order[a.op] ?? 9) - (order[b.op] ?? 9));

  for (const op of ops) {
    if (op.target === "persona") {
      const p = Array.isArray(data) && data.find(x => x.id === op.persona);
      if (!p) { conflict(op, "this persona no longer exists"); continue; }
      if (!same(p[op.field], op.old)) { conflict(op, "someone else changed this field in the meantime", p[op.field]); continue; }
      p[op.field] = op.new; ok(op); continue;
    }
    if (op.target === "site" || op.target === "category") {
      const obj = op.target === "site" ? (!Array.isArray(data) && data) : Array.isArray(data) && data.find(c => c.id === op.category);
      const allowed = op.target === "site" ? SITE_FIELDS : CAT_FIELDS;
      if (!obj || !allowed.includes(op.field)) { conflict(op, "this text cannot be edited"); continue; }
      if (!same(obj[op.field], op.old)) { conflict(op, "someone else changed this text in the meantime", obj[op.field]); continue; }
      obj[op.field] = op.new; ok(op); continue;
    }
    if (!data.sections) { conflict(op, "unexpected change for this file"); continue; }
    if (op.target === "doc") {
      if (!["title", "standfirst", "note", "stats"].includes(op.field)) { conflict(op, "this field cannot be edited"); continue; }
      if (!same(data[op.field], op.old)) { conflict(op, "someone else changed this in the meantime", data[op.field]); continue; }
      data[op.field] = op.new; ok(op); continue;
    }
    if (op.target === "section") {
      const s = data.sections.find(x => x.id === op.section);
      if (!s) { conflict(op, "this section no longer exists"); continue; }
      if (s.heading !== op.old) { conflict(op, "someone else renamed this section in the meantime", s.heading); continue; }
      s.heading = op.new; ok(op); continue;
    }
    if (op.op === "set") {
      const f = findBlock(data, op.block);
      if (!f) { conflict(op, "this block has been removed in the meantime"); continue; }
      if (["id", "type", "blocks"].includes(op.field)) { conflict(op, "this field cannot be edited"); continue; }
      if (!same(f.b[op.field], op.old)) { conflict(op, "someone else changed this text in the meantime", f.b[op.field]); continue; }
      f.b[op.field] = op.new; ok(op); continue;
    }
    if (op.op === "delete") {
      const f = findBlock(data, op.block);
      if (!f) { ok(op); continue; } // already gone
      if (!same(f.b, op.old)) { conflict(op, "someone else changed this block after you decided to delete it", f.b); continue; }
      f.list.splice(f.list.indexOf(f.b), 1); ok(op); continue;
    }
    // Lists of blocks: a section, or the inside of a box (op.parent)
    const listFor = op => {
      const s = data.sections.find(x => x.id === op.section); if (!s) return null;
      if (!op.parent) return s.blocks;
      const box = s.blocks.find(b => b.id === op.parent);
      return box && box.type === "box" ? box.blocks : null;
    };
    if (op.op === "order") {
      const list = listFor(op);
      if (!list) { conflict(op, "this section or box no longer exists"); continue; }
      const s = { blocks: list };
      const present = s.blocks.map(b => b.id).filter(id => op.old.includes(id));
      if (!same([...present].sort(), [...op.old].sort()) || !same([...op.new].sort(), [...op.old].sort())) { conflict(op, "the blocks in this section changed in the meantime, so the new order could not be applied"); continue; }
      const pos = s.blocks.map((b, i) => op.old.includes(b.id) ? i : -1).filter(i => i >= 0);
      const byId = Object.fromEntries(s.blocks.map(b => [b.id, b]));
      op.new.forEach((id, n) => { s.blocks[pos[n]] = byId[id]; });
      ok(op); continue;
    }
    if (op.op === "insert") {
      const list = listFor(op);
      if (!list) { conflict(op, "this section or box no longer exists"); continue; }
      const s = { blocks: list };
      const b = op.block || {};
      if (b.type !== "paragraph" || typeof b.text !== "string") { conflict(op, "only new paragraphs can be added from the website"); continue; }
      const ids = usedIds(data);
      let id = /^[0-9a-f]{6}$/.test(b.id || "") ? b.id : null;
      while (!id || ids.has(id)) id = Math.random().toString(16).slice(2, 8);
      const at = op.after ? s.blocks.findIndex(x => x.id === op.after) : -1;
      s.blocks.splice(op.after && at < 0 ? s.blocks.length : at + 1, 0, { id, type: "paragraph", text: b.text });
      ok(op); continue;
    }
    conflict(op, "unknown kind of change");
  }
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

// Plain-language list of what happened, for the pull request and the issue.
const what = op => op.target === "persona" ? `persona \`${op.persona}\`: ${op.field}` :
  op.target === "site" ? `home page: ${op.field}` : op.target === "category" ? `${op.category} page: ${op.field}` :
  op.target === "doc" ? `case study ${op.field}` : op.target === "section" ? `section heading “${snippet(op.old)}”` :
  op.op === "set" ? `block \`${op.block}\` (${op.field})` : op.op === "delete" ? `deleted block \`${op.block}\`` :
  op.op === "insert" ? `new paragraph after \`${op.after || "start of section"}\`` : op.op === "order" ? `order of blocks in section \`${op.section}\`` : op.op;

if (!applied.length) {
  fail(`None of the changes could be applied, because the page changed since they were made:\n\n${conflicts.map(c => `- ${what(c.op)}: ${c.why}`).join("\n")}\n\nPlease reload the page and make your changes again.`);
}

try { run("node", ["tools/validate.js"]); }
catch (e) {
  fail(`These changes would break something on the site, so they were not applied:\n\n\`\`\`\n${(e.stderr || e.stdout || "").trim()}\n\`\`\`\n\nThis usually means a link or citation marker was damaged. Please try again from the website, or ask a maintainer.`);
}

if (DRY) { console.log("DRY RUN: would commit and open a pull request. Applied:", applied.length, "Conflicts:", conflicts.length); conflicts.forEach(c => console.log(" conflict:", c.why)); process.exit(0); }
const branch = `edit/issue-${issue.number}`;
const author = issue.user.login;
const title = issue.title.replace(/^\[edit\]\s*/i, "") || `Website edit #${issue.number}`;
run("git", ["config", "user.name", "github-actions[bot]"]);
run("git", ["config", "user.email", "41898099+github-actions[bot]@users.noreply.github.com"]);
run("git", ["checkout", "-b", branch]);
run("git", ["add", "content"]);
run("git", ["commit", "-m", `${title}\n\nSubmitted from the website by @${author} in #${issue.number}.`, "--author", `${author} <${issue.user.id}+${author}@users.noreply.github.com>`]);
run("git", ["push", "--force", "origin", branch]);

const conflictText = conflicts.length ? `\n\n### ⚠️ Not applied: ${conflicts.length} change(s) clashed with newer edits\n\n` + conflicts.map(c =>
  `**${what(c.op)}** (${c.file}): ${c.why}.\n\n- Before their edit: ${snippet(c.op.old ?? "")}\n- Their version: ${snippet(c.op.new ?? c.op.block?.text ?? "")}\n${c.current !== undefined ? `- Current version: ${snippet(c.current)}\n` : ""}`).join("\n") +
  "\nApply these by hand if they are still wanted." : "";
const body = `Edit submitted from the website by @${author}. Closes #${issue.number}.\n\n` +
  `${issue.body.split("<details>")[0].trim()}\n\n### Applied\n\n${applied.map(a => `- ${what(a.op)} (${a.file})`).join("\n")}${conflictText}`;
const prUrl = run("gh", ["pr", "create", "--repo", repo, "--base", "main", "--head", branch, "--title", title, "--body-file", "-"], { input: body }).trim();
comment(`✅ Thanks @${author}! Your changes are ready for review: ${prUrl}${conflicts.length ? `\n\n${conflicts.length} change(s) clashed with newer edits and need a maintainer's attention; details are in the pull request.` : ""}\n\nThe website updates once a maintainer approves them.`);
console.log("Opened", prUrl);
