// Applies an edit submitted from the website (a GitHub issue whose title starts with "[edit]") and opens a pull request.
// A submission that "follows" an earlier one (the editor kept editing after sending) is added to the earlier pull
// request instead, and its own issue is closed with a pointer to the original.
// Run by .github/workflows/apply-edit.yml. The issue content is untrusted: it is only ever parsed as JSON, file paths
// are restricted to content/, and the result must pass tools/validate.js before anything is pushed.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
const issue = event.issue;
const repo = process.env.GITHUB_REPOSITORY;
const DRY = !!process.env.DRY_RUN; // local testing: print instead of commenting, committing or opening a pull request
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], ...opts });
const commentOn = (n, text) => DRY ? console.log(`COMMENT on #${n}: ${text}`) : run("gh", ["issue", "comment", String(n), "--repo", repo, "--body-file", "-"], { input: text });
const comment = text => commentOn(issue.number, text);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Must match fingerprint() in assets/editor.js
const fingerprint = v => crypto.createHash("sha256").update(JSON.stringify(v ?? null)).digest("hex").slice(0, 16);
const snippet = v => { const s = typeof v === "string" ? v : JSON.stringify(v); return s == null ? "" : s.length > 300 ? s.slice(0, 299) + "…" : s; };

function fail(msg) { comment(`⚠️ ${msg}`); console.log(msg); process.exit(0); }

// Only people added directly as collaborators on the repository can submit edits; the site is public. The check uses
// the account that actually created the issue, whatever username was typed on the website.
const siteJson = JSON.parse(fs.readFileSync(path.join(ROOT, "content/site.json"), "utf8"));
const contact = (siteJson.editorsContact || "the site maintainer") + (siteJson.editorsEmail ? ` (${siteJson.editorsEmail})` : "");
const collaborators = DRY ? (process.env.DRY_COLLABORATORS || "").split(",") :
  run("gh", ["api", "--paginate", `repos/${repo}/collaborators?affiliation=direct&per_page=100`, "--jq", ".[].login"]).split(/\r?\n/);
if (!collaborators.some(l => l && l.toLowerCase() === issue.user.login.toLowerCase()))
  fail(`Thanks for the suggestion! @${issue.user.login} doesn't have access to this repository yet, so these changes were not applied. Please contact ${contact} and ask to be added, then submit your changes again from the website (they are still saved in your browser).`);

// The changes: compressed (```edit-v2 base64url of deflate-raw JSON) or, from older editors, plain JSON.
let payload;
try {
  const body = issue.body || "";
  const v2 = body.match(/```edit-v2\s*\n([\s\S]*?)\n```/), v1 = body.match(/```json\s*\n([\s\S]*?)\n```/);
  if (v2) payload = JSON.parse(zlib.inflateRawSync(Buffer.from(v2[1].trim(), "base64url")).toString("utf8"));
  else if (v1) payload = JSON.parse(v1[1]);
} catch (e) { fail("The changes in this issue could not be read (they may have been edited by hand). Please submit them again from the website."); }
if (!payload) fail("I couldn't find the changes in this issue. Please submit them again from the website using the Edit button.");
if (![1, 2].includes(payload.version) || !Array.isArray(payload.edits)) fail("These changes come from an older or unknown version of the editor. Please submit them again from the website.");

// Is this an update to an earlier submission whose pull request is still open?
let followPR = null;
const follows = Number.isInteger(payload.follows) ? payload.follows : null;
if (follows && !DRY) {
  const found = run("gh", ["pr", "list", "--repo", repo, "--head", `edit/issue-${follows}`, "--state", "open", "--json", "number,url", "--jq", ".[0] // empty"]).trim();
  if (found) followPR = JSON.parse(found);
}
if (followPR) {
  // Work on top of the existing pull request, so anything a reviewer changed there is kept.
  run("git", ["fetch", "origin", `edit/issue-${follows}`]);
  run("git", ["checkout", "-B", `edit/issue-${follows}`, "FETCH_HEAD"]);
}

const FILE_OK = /^content\/([a-z0-9-]+\/(personas|case-studies\/[a-z0-9-]+)|site|categories)\.json$/;
const SITE_FIELDS = ["personasNote", "creditsNote"], CAT_FIELDS = ["lede", "personasNote", "sources", "creditsNote"];
const applied = [], already = [], conflicts = [];

function findBlock(doc, id) {
  for (const s of doc.sections) for (const b of s.blocks) {
    if (b.id === id) return { b, s, list: s.blocks };
    for (const c of b.blocks || []) if (c.id === id) return { b: c, s, list: b.blocks };
  }
  return null;
}
function usedIds(doc) { const ids = new Set(); for (const s of doc.sections) for (const b of s.blocks) { ids.add(b.id); (b.blocks || []).forEach(c => ids.add(c.id)); } return ids; }
// The editor sends a fingerprint of the original value (oldHash) instead of the value itself, to keep links short.
const matchesOld = (current, op) => op.oldHash ? fingerprint(current) === op.oldHash : same(current, op.old);

for (const edit of payload.edits) {
  if (!FILE_OK.test(edit.file || "") || !fs.existsSync(path.join(ROOT, edit.file))) fail(`The changes refer to a file I can't edit (${edit.file}).`);
  const file = path.join(ROOT, edit.file);
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const label = edit.file.replace(/^content\//, "");
  const conflict = (op, why, current) => conflicts.push({ file: label, op, why, current });
  const ok = op => applied.push({ file: label, op });
  const done = op => already.push({ file: label, op }); // already in place, e.g. sent before in the same session
  // Set a field, unless it already has the new value; refuse if someone else changed it in the meantime.
  const setField = (obj, field, op, who) => {
    if (same(obj[field], op.new)) return done(op);
    if (!matchesOld(obj[field], op)) return conflict(op, `someone else changed ${who} in the meantime`, obj[field]);
    obj[field] = op.new; ok(op);
  };
  const order = { set: 0, delete: 1, order: 2, insert: 3 };
  const ops = [...edit.ops].sort((a, b) => (order[a.op] ?? 9) - (order[b.op] ?? 9));

  for (const op of ops) {
    if (op.target === "persona") {
      const p = Array.isArray(data) && data.find(x => x.id === op.persona);
      if (!p) { conflict(op, "this persona no longer exists"); continue; }
      if (op.field === "id") { conflict(op, "this field cannot be edited"); continue; }
      setField(p, op.field, op, "this field"); continue;
    }
    if (op.target === "site" || op.target === "category") {
      const obj = op.target === "site" ? (!Array.isArray(data) && data) : Array.isArray(data) && data.find(c => c.id === op.category);
      const allowed = op.target === "site" ? SITE_FIELDS : CAT_FIELDS;
      if (!obj || !allowed.includes(op.field)) { conflict(op, "this text cannot be edited"); continue; }
      setField(obj, op.field, op, "this text"); continue;
    }
    if (!data.sections) { conflict(op, "unexpected change for this file"); continue; }
    if (op.target === "doc") {
      if (!["title", "standfirst", "note", "stats"].includes(op.field)) { conflict(op, "this field cannot be edited"); continue; }
      setField(data, op.field, op, "this"); continue;
    }
    if (op.target === "section") {
      const s = data.sections.find(x => x.id === op.section);
      if (!s) { conflict(op, "this section no longer exists"); continue; }
      setField(s, "heading", op, "this heading"); continue;
    }
    if (op.op === "set") {
      const f = findBlock(data, op.block);
      if (!f) { conflict(op, "this block has been removed in the meantime"); continue; }
      if (["id", "type", "blocks"].includes(op.field)) { conflict(op, "this field cannot be edited"); continue; }
      setField(f.b, op.field, op, "this text"); continue;
    }
    if (op.op === "delete") {
      const f = findBlock(data, op.block);
      if (!f) { done(op); continue; } // already gone
      if (!matchesOld(f.b, op)) { conflict(op, "someone else changed this block after you decided to delete it", f.b); continue; }
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
      const present = list.map(b => b.id).filter(id => op.old.includes(id));
      if (same(present, op.new)) { done(op); continue; }
      if (!same([...present].sort(), [...op.old].sort()) || !same([...op.new].sort(), [...op.old].sort())) { conflict(op, "the blocks in this section changed in the meantime, so the new order could not be applied"); continue; }
      const pos = list.map((b, i) => op.old.includes(b.id) ? i : -1).filter(i => i >= 0);
      const byId = Object.fromEntries(list.map(b => [b.id, b]));
      op.new.forEach((id, n) => { list[pos[n]] = byId[id]; });
      ok(op); continue;
    }
    if (op.op === "insert") {
      const list = listFor(op);
      if (!list) { conflict(op, "this section or box no longer exists"); continue; }
      const b = op.block || {};
      if (b.type !== "paragraph" || typeof b.text !== "string") { conflict(op, "only new paragraphs can be added from the website"); continue; }
      const ids = usedIds(data);
      if (b.id && ids.has(b.id)) {
        // Added in an earlier submission: bring its text up to date if it changed since.
        const f = findBlock(data, b.id);
        if (f.b.text === b.text) done(op); else { f.b.text = b.text; ok(op); }
        continue;
      }
      let id = /^[0-9a-f]{6}$/.test(b.id || "") ? b.id : null;
      while (!id || ids.has(id)) id = Math.random().toString(16).slice(2, 8);
      const at = op.after ? list.findIndex(x => x.id === op.after) : -1;
      list.splice(op.after && at < 0 ? list.length : at + 1, 0, { id, type: "paragraph", text: b.text });
      ok(op); continue;
    }
    conflict(op, "unknown kind of change");
  }
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

// Plain-language list of what happened, for the pull request and the issue.
const what = op => op.target === "persona" ? `persona \`${op.persona}\`: ${op.field}` :
  op.target === "site" ? `home page: ${op.field}` : op.target === "category" ? `${op.category} page: ${op.field}` :
  op.target === "doc" ? `case study ${op.field}` : op.target === "section" ? `section heading` :
  op.op === "set" ? `block \`${op.block}\` (${op.field})` : op.op === "delete" ? `deleted block \`${op.block}\`` :
  op.op === "insert" ? `new paragraph after \`${op.after || "start of section"}\`` : op.op === "order" ? `order of blocks in section \`${op.section}\`` : op.op;
const conflictText = conflicts.length ? `\n\n### ⚠️ Not applied: ${conflicts.length} change(s) clashed with newer edits\n\n` + conflicts.map(c =>
  `**${what(c.op)}** (${c.file}): ${c.why}.\n\n- Their version: ${snippet(c.op.new ?? c.op.block?.text ?? "")}\n${c.current !== undefined ? `- Current version: ${snippet(c.current)}\n` : ""}`).join("\n") +
  "\nApply these by hand if they are still wanted." : "";

if (!applied.length) {
  if (already.length && !conflicts.length) {
    if (followPR) { commentOn(issue.number, `Nothing new to add: these changes are already in ${followPR.url}.`); if (!DRY) run("gh", ["issue", "close", String(issue.number), "--repo", repo, "--reason", "not planned"]); process.exit(0); }
    fail("Nothing to do: all of these changes are already on the site.");
  }
  fail(`None of the changes could be applied, because the page changed since they were made:\n\n${conflicts.map(c => `- ${what(c.op)}: ${c.why}`).join("\n")}\n\nPlease reload the page and make your changes again.`);
}

try { run("node", ["tools/validate.js"]); }
catch (e) {
  fail(`These changes would break something on the site, so they were not applied:\n\n\`\`\`\n${(e.stderr || e.stdout || "").trim()}\n\`\`\`\n\nThis usually means a link or citation marker was damaged. Please try again from the website, or ask a maintainer.`);
}

if (DRY) { console.log("DRY RUN: would commit and push. Applied:", applied.length, "Already in place:", already.length, "Conflicts:", conflicts.length); conflicts.forEach(c => console.log(" conflict:", c.why)); process.exit(0); }

const author = issue.user.login;
const summary = (issue.body || "").split("<details>")[0].trim();
const appliedText = applied.map(a => `- ${what(a.op)} (${a.file})`).join("\n");
run("git", ["config", "user.name", "github-actions[bot]"]);
run("git", ["config", "user.email", "41898099+github-actions[bot]@users.noreply.github.com"]);
const commit = msg => { run("git", ["add", "content"]); run("git", ["commit", "-m", msg, "--author", `${author} <${issue.user.id}+${author}@users.noreply.github.com>`]); };

if (followPR) {
  // Add to the earlier pull request, record it on the original issue, and close this one.
  commit(`More changes from @${author} (#${issue.number})`);
  run("git", ["push", "origin", `edit/issue-${follows}`]);
  run("gh", ["pr", "comment", String(followPR.number), "--repo", repo, "--body-file", "-"], { input: `More changes from @${author} (submitted in #${issue.number}):\n\n${appliedText}${conflictText}` });
  commentOn(follows, `➕ @${author} added more changes, now included in ${followPR.url}:\n\n${summary}`);
  comment(`✅ Added to #${follows}: these changes are now part of ${followPR.url}. Closing this issue so everything stays in one place.`);
  run("gh", ["issue", "close", String(issue.number), "--repo", repo]);
  console.log("Updated", followPR.url);
  process.exit(0);
}

const branch = `edit/issue-${issue.number}`;
const title = issue.title.replace(/^\[edit\]\s*/i, "").replace(/:?\s*update to #\d+$/i, "") || `Website edit #${issue.number}`;
run("git", ["checkout", "-b", branch]);
commit(`${title}\n\nSubmitted from the website by @${author} in #${issue.number}.`);
run("git", ["push", "--force", "origin", branch]);
const note = follows ? `\n\n_#${follows} had already been closed, so these changes start a new pull request._` : "";
const body = `Edit submitted from the website by @${author}. Closes #${issue.number}.${note}\n\n${summary}\n\n### Applied\n\n${appliedText}${conflictText}`;
const prUrl = run("gh", ["pr", "create", "--repo", repo, "--base", "main", "--head", branch, "--title", title, "--body-file", "-"], { input: body }).trim();
comment(`✅ Thanks @${author}! Your changes are ready for review: ${prUrl}${conflicts.length ? `\n\n${conflicts.length} change(s) clashed with newer edits and need a maintainer's attention; details are in the pull request.` : ""}\n\nThe website updates once a maintainer approves them.`);
console.log("Opened", prUrl);
