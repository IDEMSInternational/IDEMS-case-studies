// Checks that the content in content/ is consistent. Run with: node tools/validate.js
// Exits with an error listing every problem, in plain language, so a broken edit cannot reach the site unnoticed.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const problems = [];
const warnings = [];
const problem = (where, msg) => problems.push(`${where}: ${msg}`);

function load(rel) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8")); }
  catch (e) { problem(rel, `could not be read as JSON (${e.message})`); return null; }
}

const site = load("content/site.json");
const cats = load("content/categories.json") || [];
const refs = load("content/references.json") || [];
const editorsFile = load("content/editors.json");
if (editorsFile) {
  const seen = new Set();
  if (!Array.isArray(editorsFile.editors)) problem("content/editors.json", '"editors" should be a list');
  else for (const e of editorsFile.editors) {
    if (!e.github || !/^[A-Za-z0-9-]+$/.test(e.github)) problem("content/editors.json", `"${e.github}" is not a valid GitHub username`);
    else if (seen.has(e.github.toLowerCase())) problem("content/editors.json", `"${e.github}" is listed twice`);
    seen.add(String(e.github).toLowerCase());
  }
}

const BLOCK_TYPES = ["paragraph", "subheading", "quote", "personas", "list", "timeline", "table", "box", "sti"];
const REF_FIELDS = {
  article: ["authors", "year", "title", "journal", "volume", "issue", "pages", "doi"],
  chapter: ["authors", "year", "title", "editors", "book", "pages", "publisher", "doi"],
  preprint: ["authors", "year", "title", "number", "publisher", "doi"],
  "case-study": ["year", "title", "url"],
  podcast: ["authors", "year", "day", "title", "number", "url"],
  web: ["authors", "title", "retrieved", "url"],
  unpublished: ["authors", "year", "title", "note"],
};

// References
const refKeys = new Set();
for (const r of refs) {
  const where = `content/references.json (${r.key || "entry without key"})`;
  if (!r.key) { problem(where, "missing key"); continue; }
  if (refKeys.has(r.key)) problem(where, "key is used twice");
  refKeys.add(r.key);
  if (!REF_FIELDS[r.kind]) { problem(where, `unknown kind "${r.kind}"`); continue; }
  for (const f of ["inText", "year", "sort", ...REF_FIELDS[r.kind]]) if (r[f] === undefined || r[f] === "" && f !== "authors") problem(where, `missing "${f}"`);
}

// Categories and personas
const personaIds = new Set(), caseIds = new Set(), usedRefs = new Set();
const allCases = [];
for (const c of cats) {
  if (c.comingSoon) continue;
  const sets = new Set((c.sets || []).map(s => s.id));
  for (const id of c.caseStudies || []) {
    const rel = `content/${c.id}/case-studies/${id}.json`;
    if (!fs.existsSync(path.join(ROOT, rel))) problem("content/categories.json", `case study "${id}" has no file ${rel}`);
    else { caseIds.add(id); allCases.push([rel, c]); }
    if (!fs.existsSync(path.join(ROOT, c.id, `${id}.html`))) problem("content/categories.json", `case study "${id}" has no page ${c.id}/${id}.html`);
  }
  const rel = `content/${c.id}/personas.json`;
  for (const p of load(rel) || []) {
    const where = `${rel} (${p.id || p.name || "persona without id"})`;
    if (!p.id) { problem(where, "missing id"); continue; }
    if (personaIds.has(p.id)) problem(where, "id is used twice");
    personaIds.add(p.id);
    for (const f of ["name", "tagline", "where", "age", "quote", "grounded", "pos", "prompt"]) if (p[f] === undefined || p[f] === "") problem(where, `missing "${f}"`);
    for (const f of ["background", "looking", "hopes", "worries", "data", "day", "cases"]) if (!Array.isArray(p[f])) problem(where, `"${f}" should be a list`);
    if (!sets.has(p.set)) problem(where, `set "${p.set}" is not defined for ${c.id}`);
    for (const k of p.cases || []) if (!(c.caseStudies || []).includes(k)) problem(where, `case study "${k}" does not exist`);
    if (!p.credit || !p.credit.url) problem(where, "missing photo credit");
    if (!fs.existsSync(path.join(ROOT, "images", `${p.id}.jpg`))) problem(where, `no photo at images/${p.id}.jpg`);
  }
}

// Inline markup used in any text field
function checkText(where, s) {
  if (typeof s !== "string") return;
  for (const m of s.matchAll(/\{\{([^}|]+)(\|n)?\}\}/g)) { usedRefs.add(m[1]); if (!refKeys.has(m[1])) problem(where, `cites unknown reference "${m[1]}"`); }
  for (const m of s.matchAll(/\[\[(p|case):([^\]|]+)/g)) {
    if (m[1] === "p" && !personaIds.has(m[2])) problem(where, `links to unknown persona "${m[2]}"`);
    if (m[1] === "case" && !caseIds.has(m[2])) problem(where, `links to unknown case study "${m[2]}"`);
  }
  if ((s.match(/\{\{/g) || []).length !== (s.match(/\}\}/g) || []).length) problem(where, "has unmatched {{ or }}");
  if ((s.match(/\[\[/g) || []).length !== (s.match(/\]\]/g) || []).length) problem(where, "has unmatched [[ or ]]");
}
function walkText(where, v) {
  if (typeof v === "string") checkText(where, v);
  else if (Array.isArray(v)) v.forEach(x => walkText(where, x));
  else if (v && typeof v === "object") Object.entries(v).forEach(([k, x]) => k !== "id" && walkText(where, x));
}

// Case studies
for (const [rel, c] of allCases) {
  const d = load(rel); if (!d) continue;
  const ids = new Set();
  for (const f of ["id", "short", "title", "summary", "standfirst"]) if (!d[f]) problem(rel, `missing "${f}"`);
  function checkBlock(b, where) {
    if (!b.id) problem(where, "block without id");
    else if (ids.has(b.id)) problem(where, `block id "${b.id}" is used twice`);
    ids.add(b.id);
    if (!BLOCK_TYPES.includes(b.type)) problem(where, `unknown block type "${b.type}"`);
    if (b.type === "quote" && b.persona && !personaIds.has(b.persona)) problem(where, `quotes unknown persona "${b.persona}"`);
    if (b.type === "personas") for (const id of b.ids || []) if (!personaIds.has(id)) problem(where, `shows unknown persona "${id}"`);
    if (b.type === "box") (b.blocks || []).forEach(x => checkBlock(x, where));
    walkText(where, b);
  }
  walkText(rel, { title: d.title, standfirst: d.standfirst, note: d.note, stats: d.stats });
  for (const s of d.sections || []) {
    if (!s.id || !s.heading) problem(rel, "section without id or heading");
    (s.blocks || []).forEach(b => checkBlock(b, `${rel} › ${s.heading}`));
  }
}
if (site) walkText("content/site.json", site);
cats.forEach(c => walkText(`content/categories.json (${c.id})`, c));

for (const k of refKeys) if (!usedRefs.has(k)) warnings.push(`content/references.json: "${k}" is not cited anywhere`);

warnings.forEach(w => console.log("warning: " + w));
if (problems.length) {
  console.error(`\n${problems.length} problem(s) found:\n` + problems.map(p => "  • " + p).join("\n"));
  process.exit(1);
}
console.log(`Content OK: ${personaIds.size} personas, ${caseIds.size} case studies, ${refKeys.size} references.`);
