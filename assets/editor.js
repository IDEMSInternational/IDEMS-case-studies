// In-page editor. Loaded by assets/site.js when someone clicks "Edit".
// Edits are kept as a working copy of the JSON content. On submit they become a list of operations keyed by
// permanent block ids, each with the original value, sent as a GitHub issue. A GitHub Action
// (tools/apply-edit.js) applies them and opens a pull request for review.
(function () {
  const A = window.SiteAPI;
  const { esc, md } = A;
  const clone = x => JSON.parse(JSON.stringify(x));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const newId = used => { let id; do { id = Math.random().toString(16).slice(2, 8); } while (used.has(id)); used.add(id); return id; };
  const plainSnippet = (s, n = 90) => { const t = String(s ?? "").replace(/\{\{[^}]+\}\}/g, "").replace(/\[\[[a-z]+:[^|\]]+\|?([^\]]*)\]\]/g, "$1").replace(/[*`]/g, "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };

  // ---------- State ----------
  const caseFile = A.page === "case" ? `content/${A.CAT}/case-studies/${A.CASE}.json` : null;
  const personaFile = cat => `content/${cat}/personas.json`;
  const DRAFT_KEY = "edit-draft:" + location.pathname;
  const SITE_FIELDS = ["personasNote", "creditsNote"];                       // editable on the home page
  const CAT_FIELDS = ["lede", "personasNote", "sources", "creditsNote"];     // editable on a category page
  let editing = false;
  let docOrig = null, doc = null;     // case study: original and working copy
  let deleted = new Set();            // ids of blocks marked for deletion
  const personaOrig = {};             // persona id -> original copy, taken the first time it is edited
  let siteOrig = null, catOrig = null; // page text: original copies
  const usedIds = new Set();

  function stripPersona(p) { const { category, ...rest } = p; return clone(rest); }
  function allBlocks(d) { return d.sections.flatMap(s => s.blocks.flatMap(b => [b, ...(b.blocks || [])])); }
  function findBlock(d, id) {
    for (const s of d.sections) for (const b of s.blocks) {
      if (b.id === id) return { b, s, list: s.blocks };
      for (const c of b.blocks || []) if (c.id === id) return { b: c, s, parent: b, list: b.blocks };
    }
    return null;
  }

  function saveDraft() {
    try {
      const personas = {};
      for (const id of Object.keys(personaOrig)) personas[id] = { orig: personaOrig[id], cur: stripPersona(A.byId[id]) };
      const site = siteOrig && { orig: siteOrig, cur: pick(A.site, SITE_FIELDS) };
      const cat = catOrig && { orig: catOrig, cur: pick(A.CATEGORIES[A.CAT], CAT_FIELDS) };
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ docOrig, doc, deleted: [...deleted], personas, site, cat, saved: Date.now() }));
    } catch (_) {}
  }
  function loadDraft() { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); } catch (_) { return null; } }
  function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch (_) {} }
  const pick = (o, keys) => Object.fromEntries(keys.filter(k => o[k] !== undefined).map(k => [k, clone(o[k])]));

  // ---------- Paths ----------
  // "doc|title", "doc|stats|0|label", "sec|<id>|heading", "blk|<id>|items|2|text", "per|<id>|background|3",
  // "site|personasNote", "cat|<id>|lede"
  function resolve(path) {
    const [kind, ...rest] = path.split("|");
    if (kind === "doc") return { obj: doc, orig: docOrig, keys: rest };
    if (kind === "sec") return { obj: doc.sections.find(s => s.id === rest[0]), orig: docOrig.sections.find(s => s.id === rest[0]), keys: rest.slice(1) };
    if (kind === "blk") { const f = findBlock(doc, rest[0]), o = findBlock(docOrig, rest[0]); return { obj: f && f.b, orig: o && o.b, keys: rest.slice(1) }; }
    if (kind === "per") return { obj: A.byId[rest[0]], orig: personaOrig[rest[0]] || A.byId[rest[0]], keys: rest.slice(1) };
    if (kind === "site") return { obj: A.site, orig: siteOrig, keys: rest };
    if (kind === "cat") return { obj: A.CATEGORIES[rest[0]], orig: catOrig, keys: rest.slice(1) };
  }
  const key = k => /^\d+$/.test(k) ? +k : k;
  const dig = (o, keys) => keys.reduce((x, k) => x == null ? x : x[key(k)], o);
  function getVal(path, orig) { const r = resolve(path); return dig(orig ? r.orig : r.obj, r.keys); }
  function setVal(path, v) { const r = resolve(path); dig(r.obj, r.keys.slice(0, -1))[key(r.keys.at(-1))] = v; }

  // ---------- Reading edited text back into markup ----------
  function ser(node) {
    let s = "";
    node.childNodes.forEach(n => {
      if (n.nodeType === 3) s += n.nodeValue;
      else if (n.nodeType === 1) {
        const t = n.tagName;
        if (n.dataset && n.dataset.token) s += n.dataset.token;
        else if (n.classList && n.classList.contains("ed-itools")) return;
        else if (t === "STRONG" || t === "B") { const i = ser(n); s += i.trim() ? `**${i}**` : i; }
        else if (t === "EM" || t === "I") { const i = ser(n); s += i.trim() ? `*${i}*` : i; }
        else if (t === "CODE") s += "`" + n.textContent + "`";
        else if (t === "BR") s += " ";
        else s += ser(n);
      }
    });
    return s;
  }
  const tidy = s => s.replace(/ /g, " ").replace(/\s+/g, " ").trim();
  const readField = el => el.dataset.plain ? tidy(el.textContent) : tidy(ser(el));

  // ---------- Rendering the case study in edit mode ----------
  const F = (path, value, tag, cls = "", plain = false) =>
    `<${tag} class="ed ${cls}" contenteditable="true" spellcheck="true" data-f="${path}"${plain ? ' data-plain="1"' : ""}>${plain ? esc(value) : md(value, true)}</${tag}>`;
  // Small add/remove controls for one item of a list-like field (timeline entries, table rows, panel points, key figures)
  const itools = (arr, i, what) => `<span class="ed-itools" contenteditable="false"><button type="button" data-iact="add" data-arr="${arr}" data-i="${i}" title="Add ${what} below">＋</button><button type="button" data-iact="del" data-arr="${arr}" data-i="${i}" title="Remove this ${what}">×</button></span>`;
  const tools = b => deleted.has(b.id)
    ? `<div class="ed-tools"><button type="button" data-act="restore">Restore</button></div>`
    : `<div class="ed-tools"><button type="button" data-act="up" title="Move up">↑</button><button type="button" data-act="down" title="Move down">↓</button><button type="button" data-act="add" title="Add a paragraph below">＋ Paragraph</button><button type="button" data-act="del" title="Delete">Delete</button></div>`;

  function personaPicker(b) {
    const inRow = new Set(b.ids);
    const options = A.PERSONAS.filter(p => p.category === A.CAT && !inRow.has(p.id)).map(p => `<option value="${p.id}">${esc(p.name)}, ${esc(p.tagline)}</option>`).join("");
    return `<div class="personas">${b.ids.map((id, i) => `<span class="ed-pwrap">${A.pcard(id)}<button type="button" class="ed-px" data-pact="del" data-bid="${b.id}" data-i="${i}" title="Remove from this row">×</button></span>`).join("")}
      <select class="ed-padd" data-pact="add" data-bid="${b.id}"><option value="">＋ Add a persona…</option>${options}</select></div>`;
  }

  function blockInner(b) {
    const P = `blk|${b.id}|`;
    switch (b.type) {
      case "paragraph": return F(P + "text", b.text, "p");
      case "subheading": return F(P + "text", b.text, "h3");
      case "quote":
        if (b.persona) { const p = A.byId[b.persona]; return `<blockquote class="voice">“${esc(p ? p.quote : "")}”<cite>${esc(p ? p.name : b.persona)} (fictional persona) · <i>edit this quote in the persona's profile</i></cite></blockquote>`; }
        return `<blockquote class="voice">“${F(P + "text", b.text, "span")}”${F(P + "source", b.source, "cite")}</blockquote>`;
      case "personas": return `<div class="personas-label">${esc(b.label || "Personas in this chapter")}</div>${personaPicker(b)}`;
      case "list": return `<ul>${b.items.map((it, i) => F(`${P}items|${i}`, it, "li", "ed-li")).join("")}</ul>`;
      case "timeline": return `<ul class="timeline">${b.items.map((it, i) => `<li>${F(`${P}items|${i}|label`, it.label, "b", "", true)} ${F(`${P}items|${i}|text`, it.text, "span")}${itools(P + "items", i, "entry")}</li>`).join("")}</ul>`;
      case "table": return `<div class="tablewrap"><table class="ed-table"><thead><tr>${b.head.map((h, i) => `<th>${F(`${P}head|${i}`, h, "span")}<span class="ed-itools" contenteditable="false"><button type="button" data-iact="addcol" data-arr="${P}head" data-i="${i}" title="Add a column to the right">＋</button><button type="button" data-iact="delcol" data-arr="${P}head" data-i="${i}" title="Remove this column">×</button></span></th>`).join("")}<th class="ed-rowtools"></th></tr></thead>
          <tbody>${b.rows.map((r, ri) => `<tr>${r.map((c, ci) => `<td>${F(`${P}rows|${ri}|${ci}`, c, "span")}</td>`).join("")}<td class="ed-rowtools">${itools(P + "rows", ri, "row")}</td></tr>`).join("")}</tbody></table></div>`;
      case "box": return `<div class="box">${F(P + "title", b.title, "h3")}${b.blocks.map(c => blockHTML(c)).join("")}</div>`;
      case "sti": return `${F(P + "intro", b.intro, "p", "sti-intro")}<div class="sti">${["social", "technical", "innovation"].map(k =>
        `<section class="${k}"><h3>The ${k[0].toUpperCase() + k.slice(1)}</h3><ul>${(b[k] || []).map((it, i) => `<li>${F(`${P}${k}|${i}|title`, it.title, "strong")} ${F(`${P}${k}|${i}|text`, it.text, "span")}${itools(P + k, i, "point")}</li>`).join("")}</ul>
          ${(b[k] || []).length ? "" : `<button type="button" class="ed-addfirst" data-iact="add" data-arr="${P}${k}" data-i="-1">＋ Add a point</button>`}</section>`).join("")}</div>`;
      default: return "";
    }
  }
  function blockHTML(b) {
    const cls = ["ed-block", deleted.has(b.id) ? "ed-deleted" : "", findBlock(docOrig, b.id) ? "" : "ed-new"].join(" ");
    return `<div class="${cls}" data-bid="${b.id}">${tools(b)}${blockInner(b)}</div>`;
  }
  function renderCase() {
    const all = A.CATEGORIES[A.CAT].caseStudies, idx = all.indexOf(A.CASE);
    const html = `<header class="hero"><div class="eyebrow">Case study ${idx + 1} of ${all.length} · editing</div>
        ${F("doc|title", doc.title, "h1")}${F("doc|standfirst", doc.standfirst, "p", "standfirst")}${F("doc|note", doc.note || "", "p", "note")}</header>
      <div class="stats">${doc.stats.map((s, i) => `<div class="stat">${F(`doc|stats|${i}|value`, s.value, "b", "", true)}${F(`doc|stats|${i}|label`, s.label, "span")}${itools("doc|stats", i, "figure")}</div>`).join("")}</div>
      ${doc.sections.map(s => `<section class="ed-section" data-sid="${s.id}">${F(`sec|${s.id}|heading`, s.heading, "h2")}
        <div class="ed-tools ed-tools-sec"><button type="button" data-act="add-start">＋ Paragraph at the start of this section</button></div>
        ${s.blocks.map(b => blockHTML(b)).join("")}</section>`).join("")}
      <p class="ed-footnote">References and persona cards update automatically once your changes are approved.</p>`;
    A.app.querySelector("main").innerHTML = html;
    A.app.querySelectorAll(".ed-deleted [contenteditable], .ed-deleted button:not([data-act=restore]), .ed-deleted select").forEach(el => {
      if (el.hasAttribute("contenteditable")) el.setAttribute("contenteditable", "false"); else el.disabled = true;
    });
    markAll();
  }

  // ---------- Page text on the home and category pages ----------
  function enablePageText() {
    document.querySelectorAll("[data-sf], [data-cf]").forEach(el => {
      const path = el.dataset.sf ? `site|${el.dataset.sf}` : `cat|${A.CAT}|${el.dataset.cf}`;
      el.dataset.f = path;
      el.innerHTML = md(getVal(path), true);
      el.setAttribute("contenteditable", "true");
      el.classList.add("ed");
    });
  }

  // Highlight fields that differ from the original
  function mark(el) {
    const path = el.dataset.f, orig = getVal(path, true);
    el.classList.toggle("ed-changed", orig === undefined || !same(getVal(path), orig));
  }
  function markAll() { document.querySelectorAll("[data-f]").forEach(mark); updateBar(); }

  // ---------- Persona dialog ----------
  function enablePersona(id, dlg) {
    if (!editing) return;
    dlg.classList.add("pf-editing");
    dlg.querySelectorAll("[data-pf]").forEach(el => {
      el.dataset.f = `per|${id}|${el.dataset.pf}`;
      el.dataset.plain = "1";
      el.setAttribute("contenteditable", "true");
      el.classList.add("ed");
      mark(el);
    });
    if (!dlg.querySelector(".pf-edit-note")) dlg.querySelector(".pf-head > div").insertAdjacentHTML("beforeend",
      `<p class="pf-edit-note">You are editing this profile. Press Enter in a list to add an item; empty an item and press Backspace to remove it.</p>`);
  }
  document.addEventListener("persona-opened", e => enablePersona(e.detail.id, e.detail.dialog));
  function touchPersona(id) { if (!personaOrig[id]) personaOrig[id] = stripPersona(A.byId[id]); }

  // ---------- Editing events ----------
  function onInput(e) {
    const el = e.target.closest("[data-f]"); if (!el) return;
    const path = el.dataset.f;
    if (path.startsWith("per|")) touchPersona(path.split("|")[1]);
    let v = readField(el);
    if (/\|age$/.test(path) && /^\d+$/.test(v)) v = +v;
    setVal(path, v);
    mark(el); updateBar(); saveDraft();
  }
  function caretAtStart(el) {
    const sel = getSelection(); if (!sel.rangeCount) return false;
    const r = document.createRange(); r.selectNodeContents(el); r.setEnd(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset);
    return r.toString().length === 0;
  }
  function splitAtCaret(el) {
    const sel = getSelection(); const r = sel.getRangeAt(0); r.deleteContents();
    const tail = document.createRange(); tail.setStart(r.endContainer, r.endOffset); tail.setEnd(el, el.childNodes.length);
    const box = document.createElement("div"); box.appendChild(tail.extractContents());
    return tidy(ser(box));
  }
  function focusPath(path, atStart) {
    const el = document.querySelector(`[data-f="${CSS.escape(path)}"]`); if (!el) return;
    el.focus();
    const r = document.createRange(); r.selectNodeContents(el); r.collapse(!!atStart);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  }
  function onKey(e) {
    const el = e.target.closest("[data-f]"); if (!el) return;
    const path = el.dataset.f, parts = path.split("|");
    const isItem = (parts[0] === "blk" && parts[2] === "items" && parts.length === 4) || (parts[0] === "per" && parts.length === 4);
    if (e.key === "Enter") {
      e.preventDefault();
      if (parts[0] === "blk" && parts[2] === "text" && findBlock(doc, parts[1]).b.type === "paragraph") {
        const rest = splitAtCaret(el); setVal(path, readField(el));
        const at = insertParagraph(parts[1], rest);
        rerender(); focusPath(`blk|${at}|text`, true);
      } else if (isItem) {
        const rest = splitAtCaret(el); setVal(path, readField(el));
        const listPath = parts.slice(0, -1).join("|"), i = +parts.at(-1);
        if (parts[0] === "per") touchPersona(parts[1]);
        getVal(listPath).splice(i + 1, 0, rest);
        rerender(parts[0] === "per" ? parts[1] : null); focusPath(`${listPath}|${i + 1}`, true);
      }
      saveDraft();
    } else if (e.key === "Backspace" && isItem && !el.textContent.trim() && caretAtStart(el)) {
      e.preventDefault();
      const listPath = parts.slice(0, -1).join("|"), i = +parts.at(-1), arr = getVal(listPath);
      if (arr.length <= 1) return;
      if (parts[0] === "per") touchPersona(parts[1]);
      arr.splice(i, 1);
      rerender(parts[0] === "per" ? parts[1] : null); focusPath(`${listPath}|${Math.max(0, i - 1)}`, false); saveDraft();
    }
  }
  function onPaste(e) {
    if (!e.target.closest("[data-f]")) return;
    e.preventDefault();
    document.execCommand("insertText", false, (e.clipboardData.getData("text/plain") || "").replace(/\s+/g, " "));
  }
  function rerender(personaId) {
    if (personaId) { A.open(personaId); return; }
    if (doc) renderCase();
  }

  // ---------- Block and item operations ----------
  function insertParagraph(afterId, text) {
    const id = newId(usedIds), f = findBlock(doc, afterId);
    f.list.splice(f.list.indexOf(f.b) + 1, 0, { id, type: "paragraph", text });
    return id;
  }
  const BLANK = { items: { label: "", text: "" }, social: { title: "", text: "" }, technical: { title: "", text: "" }, innovation: { title: "", text: "" }, stats: { value: "", label: "" } };
  function onItemTool(btn) {
    const arrPath = btn.dataset.arr, i = +btn.dataset.i, act = btn.dataset.iact, field = arrPath.split("|").at(-1);
    if (act === "addcol" || act === "delcol") {
      const b = findBlock(doc, arrPath.split("|")[1]).b;
      if (act === "addcol") { b.head.splice(i + 1, 0, ""); b.rows.forEach(r => r.splice(i + 1, 0, "")); }
      else if (b.head.length > 1) { b.head.splice(i, 1); b.rows.forEach(r => r.splice(i, 1)); }
      renderCase(); if (act === "addcol") focusPath(`${arrPath}|${i + 1}`, true); saveDraft(); return;
    }
    let arr = getVal(arrPath);
    if (!arr) { setVal(arrPath, []); arr = getVal(arrPath); }
    if (act === "add") {
      const blank = field === "rows" ? Array(findBlock(doc, arrPath.split("|")[1]).b.head.length).fill("") : clone(BLANK[field] || { label: "", text: "" });
      arr.splice(i + 1, 0, blank);
      renderCase();
      focusPath(field === "rows" ? `${arrPath}|${i + 1}|0` : `${arrPath}|${i + 1}|${field === "stats" ? "value" : field === "items" ? "label" : "title"}`, true);
    } else if (act === "del") {
      arr.splice(i, 1);
      renderCase();
    }
    saveDraft();
  }
  function onTool(e) {
    const ib = e.target.closest("[data-iact]"); if (ib && doc) { e.preventDefault(); return onItemTool(ib); }
    const pb = e.target.closest("button[data-pact=del]");
    if (pb) { e.preventDefault(); findBlock(doc, pb.dataset.bid).b.ids.splice(+pb.dataset.i, 1); renderCase(); saveDraft(); return; }
    const btn = e.target.closest("[data-act]"); if (!btn || !doc) return;
    const act = btn.dataset.act;
    if (act === "add-start") {
      const s = doc.sections.find(x => x.id === btn.closest("[data-sid]").dataset.sid), id = newId(usedIds);
      s.blocks.unshift({ id, type: "paragraph", text: "" });
      renderCase(); focusPath(`blk|${id}|text`, true); saveDraft(); return;
    }
    const bid = btn.closest("[data-bid]").dataset.bid, f = findBlock(doc, bid), list = f.list, i = list.indexOf(f.b);
    if (act === "up" && i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
    if (act === "down" && i < list.length - 1) [list[i + 1], list[i]] = [list[i], list[i + 1]];
    if (act === "add") { const id = insertParagraph(bid, ""); renderCase(); focusPath(`blk|${id}|text`, true); saveDraft(); return; }
    if (act === "del") { if (findBlock(docOrig, bid)) deleted.add(bid); else list.splice(i, 1); }
    if (act === "restore") deleted.delete(bid);
    renderCase(); saveDraft();
    const moved = document.querySelector(`[data-bid="${bid}"]`); if (moved) moved.scrollIntoView({ block: "nearest" });
  }
  function onChange(e) {
    const sel = e.target.closest("select[data-pact=add]"); if (!sel || !sel.value) return;
    findBlock(doc, sel.dataset.bid).b.ids.push(sel.value);
    renderCase(); saveDraft();
  }

  // ---------- Turning edits into operations ----------
  function listOps(ops, s, list, origList, parent, where) {
    const origIds = origList.map(b => b.id);
    for (const id of origIds) if (deleted.has(id)) ops.push({ op: "delete", block: id, old: origList.find(b => b.id === id), where });
    const keep = id => origIds.includes(id) && !deleted.has(id);
    const was = origIds.filter(keep), now = list.map(b => b.id).filter(keep);
    if (!same(was, now)) ops.push({ op: "order", section: s.id, ...(parent ? { parent } : {}), old: was, new: now, where });
    list.forEach((b, i) => {
      if (origIds.includes(b.id) || (b.type === "paragraph" && !b.text)) return;
      const prev = list.slice(0, i).reverse().find(x => !deleted.has(x.id) && (origIds.includes(x.id) || x.text !== ""));
      ops.push({ op: "insert", section: s.id, ...(parent ? { parent } : {}), after: prev ? prev.id : null, block: b, where });
    });
  }
  function caseOps() {
    if (!doc) return [];
    const ops = [];
    for (const f of ["title", "standfirst", "note", "stats"]) if (!same(doc[f] ?? "", docOrig[f] ?? "")) ops.push({ op: "set", target: "doc", field: f, old: docOrig[f], new: doc[f] });
    for (const s of doc.sections) {
      const so = docOrig.sections.find(x => x.id === s.id);
      if (so.heading !== s.heading) ops.push({ op: "set", target: "section", section: s.id, field: "heading", old: so.heading, new: s.heading, where: so.heading });
      for (const b of s.blocks.flatMap(b => [b, ...(b.blocks || [])])) {
        const o = findBlock(docOrig, b.id); if (!o || deleted.has(b.id) || (o.parent && deleted.has(o.parent.id))) continue;
        for (const k of new Set([...Object.keys(b), ...Object.keys(o.b)])) if (k !== "id" && k !== "blocks" && !same(b[k], o.b[k]))
          ops.push({ op: "set", target: "block", block: b.id, field: k, old: o.b[k], new: b[k], where: so.heading, type: b.type });
      }
      listOps(ops, s, s.blocks, so.blocks, null, so.heading);
      for (const box of s.blocks.filter(b => b.type === "box" && !deleted.has(b.id))) {
        const ob = findBlock(docOrig, box.id);
        if (ob) listOps(ops, s, box.blocks, ob.b.blocks, box.id, `${plainSnippet(ob.b.title, 40)}`);
      }
    }
    return ops;
  }
  function otherOps() {
    const byFile = {};
    for (const [id, orig] of Object.entries(personaOrig)) {
      const cur = stripPersona(A.byId[id]), cat = A.byId[id].category;
      for (const k of Object.keys(cur)) if (!same(cur[k], orig[k])) (byFile[personaFile(cat)] ||= []).push({ op: "set", target: "persona", persona: id, field: k, old: orig[k], new: cur[k], name: orig.name });
    }
    if (siteOrig) for (const k of SITE_FIELDS) if (!same(A.site[k], siteOrig[k])) (byFile["content/site.json"] ||= []).push({ op: "set", target: "site", field: k, old: siteOrig[k], new: A.site[k] });
    if (catOrig) for (const k of CAT_FIELDS) if (!same(A.CATEGORIES[A.CAT][k], catOrig[k])) (byFile["content/categories.json"] ||= []).push({ op: "set", target: "category", category: A.CAT, field: k, old: catOrig[k], new: A.CATEGORIES[A.CAT][k] });
    return byFile;
  }
  function allEdits() {
    const edits = [];
    const c = caseOps(); if (c.length) edits.push({ file: caseFile, ops: c });
    for (const [file, ops] of Object.entries(otherOps())) edits.push({ file, ops });
    return edits;
  }
  const FIELD = { background: "background", looking: "“what they’re looking for”", hopes: "hopes & dreams", worries: "worries & fears", data: "data and expertise", day: "day in the life", grounded: "“grounded in”" };
  const PAGE_FIELD = { lede: "introduction", personasNote: "note above the personas", sources: "sources paragraph", creditsNote: "photo credits note" };
  const TYPE = { paragraph: "paragraph", subheading: "subheading", quote: "quote", list: "list", timeline: "timeline", table: "table", box: "box", personas: "row of persona cards", sti: "social, technical and innovation section" };
  function describe(op) {
    const w = op.where ? ` in “${plainSnippet(op.where, 50)}”` : "";
    if (op.target === "persona") return `Edited ${op.name}’s ${FIELD[op.field] || op.field}`;
    if (op.target === "site") return `Edited the home page’s ${PAGE_FIELD[op.field] || op.field}`;
    if (op.target === "category") return `Edited the ${A.CATEGORIES[op.category].label} page’s ${PAGE_FIELD[op.field] || op.field}`;
    if (op.target === "doc") return `Edited the case study’s ${op.field === "stats" ? "key figures" : op.field}`;
    if (op.target === "section") return `Renamed section “${plainSnippet(op.old, 50)}” to “${plainSnippet(op.new, 50)}”`;
    if (op.op === "set") return op.field === "ids" ? `Changed the personas shown${w}` : `Edited ${TYPE[op.type] || "block"}${w}`;
    if (op.op === "delete") {
      if (op.old.persona) return `Deleted ${A.byId[op.old.persona] ? A.byId[op.old.persona].name + "’s" : "a persona"} quote${w}`;
      if (op.old.type === "personas") return `Deleted a row of persona cards${w}`;
      const t = plainSnippet(op.old.text || op.old.title || op.old.intro || "");
      return `Deleted ${TYPE[op.old.type] || "block"}${w}${t ? `: “${t}”` : ""}`;
    }
    if (op.op === "insert") return `Added paragraph${w}: “${plainSnippet(op.block.text)}”`;
    if (op.op === "order") return `Moved blocks${w}`;
    return op.op;
  }
  function revert(op) {
    if (op.target === "persona") A.byId[op.persona][op.field] = clone(op.old);
    else if (op.target === "site") { A.site[op.field] = clone(op.old); enablePageText(); }
    else if (op.target === "category") { A.CATEGORIES[op.category][op.field] = clone(op.old); enablePageText(); }
    else if (op.target === "doc") doc[op.field] = clone(op.old);
    else if (op.target === "section") doc.sections.find(s => s.id === op.section).heading = op.old;
    else if (op.op === "set") findBlock(doc, op.block).b[op.field] = clone(op.old);
    else if (op.op === "delete") deleted.delete(op.block);
    else if (op.op === "insert") { const f = findBlock(doc, op.block.id); f.list.splice(f.list.indexOf(f.b), 1); }
    else if (op.op === "order") {
      const list = op.parent ? findBlock(doc, op.parent).b.blocks : doc.sections.find(x => x.id === op.section).blocks;
      const pos = list.map((b, i) => op.new.includes(b.id) ? i : -1).filter(i => i >= 0), byId = Object.fromEntries(list.map(b => [b.id, b]));
      op.old.forEach((id, n) => { list[pos[n]] = byId[id]; });
    }
    if (doc) renderCase();
    if (A.dialog.open) A.open(A.dialog.dataset.id);
    markAll(); saveDraft();
  }

  // ---------- Bar, review and submit ----------
  let bar;
  function count() { return allEdits().reduce((n, e) => n + e.ops.length, 0); }
  function updateBar() {
    if (!bar) return;
    const n = count();
    bar.querySelector(".ed-count").textContent = n ? `${n} change${n === 1 ? "" : "s"}` : "No changes yet";
    bar.querySelector("[data-bar=review]").disabled = !n;
  }
  function showBar() {
    bar = document.createElement("div");
    bar.className = "ed-bar";
    bar.innerHTML = `<div class="ed-bar-in"><b>Editing</b><span class="ed-count"></span>
      <span class="ed-hint">${doc ? "Click any text to change it. Use the buttons beside a block to move, add or delete it, and ＋ / × to add or remove entries." : "Click the highlighted text to change it, or open a persona to edit their profile."}</span>
      <button type="button" data-bar="cancel">Stop editing</button><button type="button" class="primary" data-bar="review">Review &amp; submit</button></div>`;
    document.body.appendChild(bar);
    bar.addEventListener("click", e => {
      const b = e.target.closest("[data-bar]"); if (!b) return;
      if (b.dataset.bar === "review") review();
      if (b.dataset.bar === "cancel") stop();
    });
    updateBar();
  }

  function review() {
    const edits = allEdits(), dlg = document.createElement("dialog");
    dlg.className = "ed-review";
    const items = edits.flatMap(e => e.ops.map(op => ({ op })));
    dlg.innerHTML = `<h2>Review your changes</h2>
      <ul class="ed-changes">${items.map((it, i) => `<li><span>${esc(describe(it.op))}</span><button type="button" data-undo="${i}">Undo</button></li>`).join("")}</ul>
      <label class="ed-note">What did you change, and why? <span>(a short note for the reviewer)</span><textarea rows="3" placeholder="e.g. Corrected Faith's age and tightened the Kenya section"></textarea></label>
      <p class="ed-explain">Submitting opens GitHub in a new tab with your changes filled in. Click <b>Create</b> there to send them. You need to be logged in to GitHub.</p>
      <div class="ed-actions"><button type="button" data-r="back">Keep editing</button><button type="button" class="primary" data-r="submit">Submit for review</button></div>`;
    document.body.appendChild(dlg);
    dlg.showModal();
    dlg.addEventListener("close", () => dlg.remove());
    dlg.addEventListener("click", e => {
      const u = e.target.closest("[data-undo]");
      if (u) { revert(items[+u.dataset.undo].op); dlg.close(); updateBar(); if (count()) review(); return; }
      const r = e.target.closest("[data-r]"); if (!r) return;
      if (r.dataset.r === "back") dlg.close();
      if (r.dataset.r === "submit") submit(dlg, dlg.querySelector("textarea").value.trim());
    });
  }

  function submit(dlg, note) {
    const edits = allEdits();
    const pageTitle = doc ? doc.short : A.CAT ? A.CATEGORIES[A.CAT].label : "Home page";
    const lines = edits.flatMap(e => e.ops.map(op => "- " + describe(op)));
    const payload = { version: 1, page: location.pathname, edits: edits.map(e => ({ file: e.file, ops: e.ops.map(({ where, type, name, ...op }) => op) })) };
    const title = `[edit] ${pageTitle}: ${note ? note.slice(0, 70) : lines.length + " change" + (lines.length === 1 ? "" : "s")}`;
    const full = `**Suggested changes to ${pageTitle}**\n\n${lines.join("\n")}\n\n**Note from the editor**\n\n${note || "_No note._"}\n\n<details><summary>Technical details for the robot (please do not edit)</summary>\n\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\`\n</details>\n`;
    const base = `https://github.com/${A.site.repository}/issues/new`;
    let url = `${base}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(full)}`, pasted = false;
    if (url.length > 7500) {
      // Too long for a link: copy the text and ask the editor to paste it.
      pasted = true;
      try { navigator.clipboard.writeText(full); } catch (_) {}
      url = `${base}?title=${encodeURIComponent(title)}&body=${encodeURIComponent("Paste your changes here (Ctrl+V or ⌘V), replacing this line.")}`;
    }
    window.open(url, "_blank", "noopener");
    dlg.innerHTML = `<h2>Almost done</h2>
      <p>GitHub has opened in a new tab.${pasted ? " Your changes were too long to fill in automatically, so they have been <b>copied</b>: paste them into the description box." : ""} Click <b>Create</b> there to send your changes.</p>
      <p>A reviewer will be notified, and the page updates once they approve. You can follow progress on the GitHub page.</p>
      ${pasted ? `<details><summary>If pasting doesn't work, copy this text</summary><textarea rows="6" readonly>${esc(full)}</textarea></details>` : ""}
      <div class="ed-actions"><button type="button" data-r="back">Keep editing</button><button type="button" class="primary" data-r="done">I've sent it: clear my changes</button></div>`;
    dlg.querySelector("[data-r=done]").addEventListener("click", () => { clearDraft(); dlg.close(); stop(true); });
  }

  // ---------- Start and stop ----------
  function start() {
    if (editing) return;
    editing = true;
    document.body.classList.add("editing");
    document.querySelector(".edit-fab").hidden = true;
    let draft = loadDraft();
    const hasDraft = draft && ((draft.doc && caseFile) || (draft.personas && Object.keys(draft.personas).length) || draft.site || draft.cat);
    if (hasDraft && !confirm("You have unsent changes from an earlier visit. Restore them?")) { clearDraft(); draft = null; }
    if (A.page === "home") { siteOrig = pick(A.site, SITE_FIELDS); if (draft && draft.site) { siteOrig = draft.site.orig; Object.assign(A.site, draft.site.cur); } }
    if (A.page === "category" && !A.CATEGORIES[A.CAT].comingSoon) { catOrig = pick(A.CATEGORIES[A.CAT], CAT_FIELDS); if (draft && draft.cat) { catOrig = draft.cat.orig; Object.assign(A.CATEGORIES[A.CAT], draft.cat.cur); } }
    if (caseFile) {
      const fresh = () => { const d = clone(A.CASES[A.CASE]); delete d.category; return d; };
      docOrig = fresh(); doc = clone(docOrig);
      if (draft && draft.doc) {
        docOrig = draft.docOrig; doc = draft.doc; deleted = new Set(draft.deleted || []);
        if (!same(draft.docOrig, fresh())) alert("This page has been updated since you started. Your changes will be checked against the latest version when you submit.");
      }
      allBlocks(doc).forEach(b => usedIds.add(b.id));
      renderCase();
    } else enablePageText();
    if (draft && draft.personas) for (const [id, v] of Object.entries(draft.personas)) if (A.byId[id]) { personaOrig[id] = v.orig; Object.assign(A.byId[id], v.cur); }
    for (const t of [A.app, A.dialog]) { t.addEventListener("input", onInput); t.addEventListener("keydown", onKey); t.addEventListener("paste", onPaste); }
    A.app.addEventListener("click", onTool);
    A.app.addEventListener("change", onChange);
    document.addEventListener("click", blockLinks, true);
    if (A.dialog.open) enablePersona(A.dialog.dataset.id, A.dialog);
    showBar();
    markAll();
  }
  // While editing, links inside editable text and persona cards in rows should not navigate away.
  function blockLinks(e) { if (e.target.closest(".ed a, .chip, .ed-pwrap a")) e.preventDefault(); }
  function stop(force) {
    if (!force && count() && !confirm("Stop editing? Your changes stay saved in this browser, and you can continue next time you click Edit.")) return;
    location.reload();
  }

  window.SiteEditor = { start, ops: allEdits };
})();
