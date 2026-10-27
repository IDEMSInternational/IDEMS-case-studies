// This site's plug-in for the feedback tool (assets/feedback-tool/): what can be commented on, what each part is
// called, and how proposed edits (pull requests opened by tools/apply-edit.js) map onto the page.
// Loaded on demand by the tool. Parts of a page carry permanent ids from the JSON content: data-block, data-section and
// data-doc on case studies, data-pf in a persona's profile, and data-sf and data-cf for page text on the home and
// category pages. Edit mode (assets/editor.js) marks its parts of the page the same way.
(function () {
  const A = window.SiteAPI, T = window.FeedbackTool;
  const REPO = T.config.repository, API = T.api;
  const plain = s => T.plain(String(s ?? "").replace(/\{\{[^}]+\}\}/g, "").replace(/\[\[[a-z]+:[^|\]]+\|?([^\]]*)\]\]/g, "$1"));
  const cut = (s, n) => (s = plain(s)).length > n ? s.slice(0, n - 1) + "…" : s;

  // ---------- Targets ----------
  const TARGETS = "[data-block],[data-section],[data-doc],[data-pf],[data-sf],[data-cf]";
  function keyOf(el) {
    const d = el.dataset;
    if (d.block) return `blk:${d.block}`;
    if (d.section) return `sec:${d.section}`;
    if (d.doc) return `doc:${d.doc}`;
    if (d.pf) return `per:${A.dialog.dataset.id}:${d.pf}`;
    if (d.sf) return `site:${d.sf}`;
    if (d.cf) return `cat:${A.CAT}:${d.cf}`;
  }
  function elFor(key) {
    const [kind, a, b] = key.split(":"), q = s => document.querySelector(s);
    if (kind === "blk") return q(`[data-block="${a}"]`);
    if (kind === "sec") return q(`[data-section="${a}"]`);
    if (kind === "doc") return q(`[data-doc="${a}"]`);
    if (kind === "per") return A.dialog.open && A.dialog.dataset.id === a ? A.dialog.querySelector(`[data-pf="${b}"]`) : null;
    if (kind === "site") return q(`[data-sf="${a}"]`);
    if (kind === "cat") return q(`[data-cf="${b}"]`);
    return null;
  }
  // Persona fields belong to the page even while the profile dialog is closed.
  const isOnPage = key => !!elFor(key) || key.startsWith("per:");
  const TYPE = { paragraph: "paragraph", subheading: "subheading", quote: "quote", personas: "persona cards", list: "list", timeline: "timeline", table: "table", box: "box", sti: "social, technical and innovation section" };
  const PF = { name: "name", tagline: "tagline", age: "age", where: "location", quote: "quote", grounded: "“grounded in”", background: "background", looking: "“what they’re looking for”", hopes: "hopes & dreams", worries: "worries & fears", data: "data and expertise", day: "day in the life" };
  const PAGEF = { lede: "introduction", personasNote: "note above the personas", sources: "sources", creditsNote: "photo credits note" };
  function labelFor(key) {
    const [kind, a, b] = key.split(":");
    if (kind === "blk") {
      const d = A.CASES[A.CASE];
      for (const s of (d && d.sections) || []) for (const blk of s.blocks) for (const x of [blk, ...(blk.blocks || [])])
        if (x.id === a) return `${cut(s.heading, 60)} · ${TYPE[x.type] || "block"}${x.text ? `: “${cut(x.text, 50)}”` : ""}`;
      return "a block";
    }
    if (kind === "sec") { const s = (A.CASES[A.CASE] || { sections: [] }).sections.find(x => x.id === a); return `section heading “${cut(s ? s.heading : a, 60)}”`; }
    if (kind === "doc") return { title: "title", standfirst: "introduction", note: "note", stats: "key figures" }[a] || a;
    if (kind === "per") { const p = A.byId[a], [f, i] = (b || "").split("|"); return `${p ? p.name : a} · ${PF[f] || f}${i !== undefined ? `, item ${+i + 1}` : ""}`; }
    if (kind === "site") return `home page · ${PAGEF[a] || a}`;
    if (kind === "cat") return `${A.CATEGORIES[a] ? A.CATEGORIES[a].label : a} page · ${PAGEF[b] || b}`;
    return key;
  }
  const pageTitle = () => A.CASE ? A.CASES[A.CASE].short : A.CAT ? A.CATEGORIES[A.CAT].label : "Home page";
  const fieldName = f => ({ text: "", heading: "heading", title: "title", standfirst: "introduction", note: "note", stats: "key figures", items: "entries", rows: "rows", head: "column headings",
    cite: "attribution", ids: "personas shown" })[f] ?? (PF[f] || PAGEF[f] || f);

  // ---------- Proposed edits ----------
  // Open pull requests made from the website (branch edit/issue-<n>, titled "<page title>: …"). What they change is
  // read from the pull request's files (raw files are not counted against GitHub's limit), so it includes later
  // additions and anything a reviewer changed.
  async function listEdits() {
    const prs = await T.ghJSON(`${API}/pulls?state=open&per_page=100&sort=updated&direction=desc`);
    return prs.filter(pr => /^edit\/issue-\d+$/.test(pr.head.ref) && pr.title.startsWith(`${pageTitle()}:`)).map(pr => ({
      key: `pr-${pr.number}`, kind: "edit", number: pr.number, url: pr.html_url, updated: pr.updated_at, head: pr.head.sha, base: pr.base.ref,
      title: pr.title.slice(pageTitle().length + 1).trim(),
      author: `@${((pr.body || "").match(/by @([A-Za-z0-9-]+)/) || [])[1] || pr.user.login}`,
    }));
  }
  // What a proposed edit changes on this page: compare its files with where its branch started.
  const raw = (sha, file) => fetch(`https://raw.githubusercontent.com/${REPO}/${sha}/${file}`, { cache: "force-cache" }).then(r => r.ok ? r.json() : null);
  function diff(file, a, b) {
    const out = [], add = (target, change) => out.push({ target, change });
    const differs = (x, y) => JSON.stringify(x ?? null) !== JSON.stringify(y ?? null);
    const fields = (x, y, skip = []) => [...new Set([...Object.keys(x || {}), ...Object.keys(y || {})])].filter(f => !skip.includes(f) && differs(x && x[f], y && y[f]));
    if (/\/case-studies\//.test(file)) {
      if (!A.CASE || !file.endsWith(`/${A.CASE}.json`)) return out;
      for (const f of fields(a, b).filter(f => ["title", "standfirst", "note", "stats"].includes(f))) add(`doc:${f}`, { field: f, old: a[f], new: b[f] });
      const lists = d => { const m = {}; for (const s of d.sections || []) { m[`sec:${s.id}`] = s.blocks; for (const x of s.blocks) if (x.blocks) m[`blk:${x.id}`] = x.blocks; } return m; };
      const flat = d => { const m = {}; for (const s of d.sections || []) for (const x of s.blocks) for (const y of [x, ...(x.blocks || [])]) m[y.id] = y; return m; };
      const secA = Object.fromEntries((a.sections || []).map(s => [s.id, s]));
      for (const sb of b.sections || []) if (secA[sb.id] && differs(secA[sb.id].heading, sb.heading)) add(`sec:${sb.id}`, { field: "heading", old: secA[sb.id].heading, new: sb.heading });
      const fa = flat(a), fb = flat(b), la = lists(a), lb = lists(b);
      for (const id in fa) {
        if (!fb[id]) { add(`blk:${id}`, { deleted: true, type: fa[id].type }); continue; }
        for (const f of fields(fa[id], fb[id], ["id", "type", "blocks"])) add(`blk:${id}`, { field: f, old: fa[id][f], new: fb[id][f] });
      }
      for (const key in lb) {
        const list = lb[key], before = la[key] || [];
        list.forEach((x, i) => {
          if (fa[x.id]) return;
          let j = i - 1; while (j >= 0 && !fa[list[j].id]) j--;
          add(j >= 0 ? `blk:${list[j].id}` : key, { inserted: x.text || "", atStart: j < 0 });
        });
        const was = before.map(x => x.id).filter(id => fb[id] && list.some(y => y.id === id)), now = list.map(x => x.id).filter(id => fa[id]);
        if (differs(was, now)) add(key, { reordered: now.length });
      }
      return out;
    }
    if (/\/personas\.json$/.test(file)) {
      const pa = Object.fromEntries((a || []).map(x => [x.id, x]));
      for (const x of b || []) if (pa[x.id]) for (const f of fields(pa[x.id], x, ["id"])) add(`per:${x.id}:${f}`, { field: f, old: pa[x.id][f], new: x[f] });
      return out;
    }
    if (/content\/site\.json$/.test(file)) { for (const f of fields(a, b)) add(`site:${f}`, { field: f, old: a[f], new: b[f] }); return out; }
    if (/content\/categories\.json$/.test(file)) {
      const ca = Object.fromEntries((a || []).map(x => [x.id, x]));
      for (const x of b || []) if (ca[x.id]) for (const f of fields(ca[x.id], x, ["id"])) add(`cat:${x.id}:${f}`, { field: f, old: ca[x.id][f], new: x[f] });
      return out;
    }
    return out;
  }
  async function editCards(it) {
    const cmp = await T.ghJSON(`${API}/compare/${encodeURIComponent(it.base)}...${it.head}`);
    const from = cmp.merge_base_commit.sha, files = (cmp.files || []).map(f => f.filename).filter(f => /^content\/.+\.json$/.test(f));
    const changes = (await Promise.all(files.map(async f => { const [a, b] = await Promise.all([raw(from, f), raw(it.head, f)]); return a && b ? diff(f, a, b) : []; }))).flat();
    return changes.map((c, i) => ({ ...c, id: `pr${it.number}-${i}`, issue: it.number, url: it.url, author: it.author }));
  }

  // Opening a persona's profile adds fields that may have comments.
  document.addEventListener("persona-opened", () => T.refresh());

  T.register("site", {
    targets: TARGETS, ignore: ".pf-nav, .close", keyOf, elFor, labelFor, isOnPage, pageTitle, plain,
    typeName: t => TYPE[t], fieldName, proposedEdits: { list: listEdits, cards: editCards },
  });
})();
