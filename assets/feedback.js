// Feedback and comments. Loaded by assets/editor.js for people who are not contributors (with a GitHub account or
// anonymously), and for contributors who want to see open feedback while editing.
// A comment points at a "target" (a block, section, page field or persona field, by its permanent id) and may quote
// some selected words. The whole set of a person's comments on a page is sent each time, as a GitHub issue
// ("[feedback] …"); later sends are added to the same issue. GitHub users send through a pre-filled GitHub page;
// anonymous people send through a Google Apps Script web app (content/site.json feedbackEndpoint).
(function () {
  const A = window.SiteAPI;
  const { esc } = A;
  const REPO = A.site.repository;
  const API = `https://api.github.com/repos/${REPO}`;
  const PAGE = location.pathname;
  const clone = x => JSON.parse(JSON.stringify(x));
  const plain = s => String(s ?? "").replace(/\{\{[^}]+\}\}/g, "").replace(/\[\[[a-z]+:[^|\]]+\|?([^\]]*)\]\]/g, "$1").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*`]/g, "").replace(/\s+/g, " ").trim();
  const cut = (s, n) => (s = plain(s)).length > n ? s.slice(0, n - 1) + "…" : s;
  const newId = () => Math.random().toString(16).slice(2, 8);
  const ghJSON = async url => { const r = await fetch(url, { cache: "no-store" }); if (!r.ok) throw new Error(r.status); return r.json(); };

  let me = null;            // { via: "github", user } or { via: "anon", name }
  let active = false;       // feedback mode on
  let comments = [];        // this person's comments on this page
  let thread = null;        // { issue, key?, sent: { id: comment as last sent } }
  let reviewOn = false, reviewItems = null; // contributors: open feedback from everyone
  const draftKey = () => `fb:${PAGE}:${me.via === "anon" ? "anon" : me.user.toLowerCase()}`;
  const save = () => { try { localStorage.setItem(draftKey(), JSON.stringify({ comments, thread })); } catch (_) {} };
  const load = () => { try { return JSON.parse(localStorage.getItem(draftKey()) || "null"); } catch (_) { return null; } };

  // ---------- Encoding (same scheme as edits, under its own tag) ----------
  async function encode(obj) {
    const json = JSON.stringify(obj);
    const bytes = new Uint8Array(await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
    let bin = ""; bytes.forEach(b => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  async function decode(b64) {
    const bin = atob(b64.trim().replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    return JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text());
  }
  // The latest set of comments in a feedback issue: the last feedback-v1 block written by its author or by the robots.
  async function latestState(n) {
    const [iss, coms] = await Promise.all([ghJSON(`${API}/issues/${n}`), ghJSON(`${API}/issues/${n}/comments?per_page=100`)]);
    const ok = new Set([iss.user.login, "github-actions[bot]", A.site.feedbackBot].filter(Boolean).map(x => x.toLowerCase()));
    const texts = [iss.body, ...coms.filter(c => ok.has(c.user.login.toLowerCase())).map(c => c.body)];
    for (let i = texts.length - 1; i >= 0; i--) {
      const m = (texts[i] || "").match(/```feedback-v1\s*\n([\s\S]*?)\n```/);
      if (m) { try { return { state: await decode(m[1]), issue: iss }; } catch (_) {} }
    }
    return { state: null, issue: iss };
  }

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
    if (kind === "blk") return q(`[data-block="${a}"]`) || q(`.ed-block[data-bid="${a}"]`);
    if (kind === "sec") return q(`[data-section="${a}"]`) || q(`[data-f="sec|${a}|heading"]`);
    if (kind === "doc") return q(`[data-doc="${a}"]`) || (a === "stats" ? q(".stats") : q(`[data-f="doc|${a}"]`));
    if (kind === "per") return A.dialog.open && A.dialog.dataset.id === a ? A.dialog.querySelector(`[data-pf="${b}"]`) : null;
    if (kind === "site") return q(`[data-sf="${a}"]`);
    if (kind === "cat") return q(`[data-cf="${b}"]`);
    return null;
  }
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
  // Cards go after the target's block-level host, never inside a target (so they don't disturb its text).
  function hostOf(el) {
    let h = el;
    if (/^(SPAN|B|STRONG|I|EM|A|CITE|CODE)$/.test(h.tagName)) h = h.closest("p,h1,h2,h3,li,blockquote,div") || h;
    if (h.tagName === "LI") h = h.closest("ul,ol") || h;
    return h.closest(".ed-block") || h;
  }
  function stackFor(el) {
    const host = hostOf(el);
    let st = host.nextElementSibling;
    if (!st || !st.classList.contains("fb-stack")) { st = document.createElement("div"); st.className = "fb-stack"; st.contentEditable = "false"; host.after(st); }
    return st;
  }

  // ---------- Highlighting quoted words (CSS Custom Highlight API, where supported) ----------
  function rangeFor(el, quote) {
    const nodes = [], walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let norm = "", map = [];
    for (let n; (n = walker.nextNode());) {
      if (n.parentElement.closest(".fb-stack")) continue;
      for (let i = 0; i < n.data.length; i++) {
        const ws = /\s/.test(n.data[i]);
        if (ws && (norm.endsWith(" ") || norm === "")) continue;
        norm += ws ? " " : n.data[i]; map.push([n, i]);
      }
    }
    let at = -1, from = 0;
    for (let i; (i = norm.indexOf(quote.exact, from)) >= 0; from = i + 1) {
      if (at < 0) at = i;
      if (quote.prefix && norm.slice(Math.max(0, i - quote.prefix.length), i).trim().endsWith(quote.prefix.trim().slice(-12))) { at = i; break; }
    }
    if (at < 0) return null;
    const s = map[at], e = map[at + quote.exact.length - 1];
    const r = document.createRange(); r.setStart(s[0], s[1]); r.setEnd(e[0], e[1] + 1);
    return r;
  }
  function highlight(list) {
    if (!(window.CSS && CSS.highlights && window.Highlight)) return;
    const ranges = [];
    for (const { c } of list) if (c.quote) { const el = elFor(c.target), r = el && rangeFor(el, c.quote); if (r) ranges.push(r); }
    CSS.highlights.set("fb", new Highlight(...ranges));
  }

  // ---------- Cards ----------
  const snap = c => JSON.stringify([c.target, c.quote || null, c.text]);
  function stateOf(c) { if (!thread || !thread.sent[c.id]) return "not sent yet"; return snap(thread.sent[c.id]) === snap(c) ? "sent" : "changed, not sent yet"; }
  function card(c, own) {
    const head = own ? `💬 Your comment <span class="fb-state">· ${stateOf(c)}</span>` : `💬 ${esc(c.author)} · <a href="${esc(c.url)}" target="_blank" rel="noopener">#${c.issue}</a>`;
    return `<div class="fb-card${own ? "" : " fb-other"}" data-cid="${c.id}"><div class="fb-head">${head}</div>
      ${c.quote ? `<blockquote class="fb-quote">“${esc(c.quote.exact)}”</blockquote>` : ""}<p class="fb-text">${esc(c.text)}</p>
      ${own ? `<div class="fb-actions"><button type="button" data-fb="edit">Edit</button><button type="button" data-fb="del">Delete</button></div>` : ""}</div>`;
  }
  function refresh() {
    document.querySelectorAll(".fb-stack").forEach(x => x.remove());
    const list = [];
    if (active) comments.forEach(c => list.push({ c, own: true }));
    if (reviewOn && reviewItems) reviewItems.forEach(c => list.push({ c, own: false }));
    for (const { c, own } of list) { const el = elFor(c.target); if (el) stackFor(el).insertAdjacentHTML("beforeend", card(c, own)); }
    highlight(list);
    updateBar();
  }
  function openComposer(key, quote, id) {
    const el = elFor(key); if (!el) return;
    document.querySelectorAll(".fb-composer").forEach(x => x.remove());
    const existing = id && comments.find(c => c.id === id);
    const html = `<div class="fb-card fb-composer" data-key="${esc(key)}"${id ? ` data-cid="${id}"` : ""}>
      <div class="fb-head">💬 ${quote || (existing && existing.quote) ? "Comment on the selected words" : `Comment on ${esc(labelFor(key))}`}</div>
      ${(quote || (existing && existing.quote)) ? `<blockquote class="fb-quote">“${esc((quote || existing.quote).exact)}”</blockquote>` : ""}
      <textarea rows="3" placeholder="Your comment…">${existing ? esc(existing.text) : ""}</textarea>
      <div class="fb-actions"><button type="button" data-fb="cancel">Cancel</button><button type="button" class="primary" data-fb="save">Save comment</button></div></div>`;
    const cardEl = id && document.querySelector(`.fb-card[data-cid="${id}"]:not(.fb-other)`);
    if (cardEl) cardEl.outerHTML = html; else stackFor(el).insertAdjacentHTML("beforeend", html);
    const comp = document.querySelector(".fb-composer");
    comp._quote = quote || null;
    comp.querySelector("textarea").focus();
    hideButtons();
  }

  // ---------- Floating "💬" buttons ----------
  let hoverBtn, selBtn, hoverTarget = null, selInfo = null;
  function makeButtons() {
    hoverBtn = document.createElement("button"); hoverBtn.type = "button"; hoverBtn.className = "fb-float"; hoverBtn.textContent = "💬 Comment"; hoverBtn.hidden = true;
    selBtn = document.createElement("button"); selBtn.type = "button"; selBtn.className = "fb-float fb-float-sel"; selBtn.textContent = "💬 Comment on selection"; selBtn.hidden = true;
    hoverBtn.addEventListener("mousedown", e => e.preventDefault());
    selBtn.addEventListener("mousedown", e => e.preventDefault());
    hoverBtn.addEventListener("click", () => { if (hoverTarget) openComposer(keyOf(hoverTarget), null); });
    selBtn.addEventListener("click", () => { if (selInfo) { openComposer(keyOf(selInfo.el), selInfo.quote); getSelection().removeAllRanges(); } });
  }
  function place(btn, el, rect, x, y) {
    const parent = el.closest("dialog") || document.body;
    if (btn.parentElement !== parent) parent.appendChild(btn);
    btn.hidden = false;
    btn.style.top = `${Math.max(4, y)}px`;
    btn.style.left = `${Math.min(innerWidth - btn.offsetWidth - 8, Math.max(4, x))}px`;
  }
  function hideButtons() { if (hoverBtn) hoverBtn.hidden = true; if (selBtn) selBtn.hidden = true; }
  const ignore = n => !n || n.closest(".fb-stack, .fb-float, .ed-bar, .edit-fab, .pf-nav, .close, dialog.ed-review");
  function onOver(e) {
    if (!active || ignore(e.target)) return;
    const t = e.target.closest(TARGETS); if (!t || t === hoverTarget) return;
    hoverTarget = t;
    const r = t.getBoundingClientRect();
    place(hoverBtn, t, r, r.right - 120, r.top - 14);
  }
  function selectionInfo() {
    const sel = getSelection(); if (!sel.rangeCount || sel.isCollapsed) return null;
    const r = sel.getRangeAt(0), el = n => n.nodeType === 1 ? n : n.parentElement;
    if (ignore(el(r.startContainer))) return null;
    const t1 = el(r.startContainer).closest(TARGETS), t2 = el(r.endContainer).closest(TARGETS);
    if (!t1 || t1 !== t2) return null;
    const exact = sel.toString().replace(/\s+/g, " ").trim(); if (!exact || exact.length > 600) return null;
    const pre = document.createRange(); pre.selectNodeContents(t1); pre.setEnd(r.startContainer, r.startOffset);
    const post = document.createRange(); post.selectNodeContents(t1); post.setStart(r.endContainer, r.endOffset);
    return { el: t1, quote: { exact, prefix: pre.toString().replace(/\s+/g, " ").slice(-32), suffix: post.toString().replace(/\s+/g, " ").slice(0, 32) }, rect: r.getBoundingClientRect() };
  }
  function onSelect() {
    if (!active) return;
    selInfo = selectionInfo();
    if (!selInfo) { selBtn.hidden = true; return; }
    const r = selInfo.rect;
    place(selBtn, selInfo.el, r, r.left, r.bottom + 6);
  }

  // ---------- Card actions ----------
  function onClick(e) {
    const b = e.target.closest("[data-fb]"); if (!b) return;
    const box = b.closest(".fb-card"), id = box && box.dataset.cid;
    if (b.dataset.fb === "cancel") { box.remove(); refresh(); }
    if (b.dataset.fb === "edit") { const c = comments.find(x => x.id === id); if (c) openComposer(c.target, null, id); }
    if (b.dataset.fb === "del") { if (confirm("Delete this comment?")) { comments = comments.filter(x => x.id !== id); save(); refresh(); } }
    if (b.dataset.fb === "save") {
      const text = box.querySelector("textarea").value.trim();
      if (!text) return box.querySelector("textarea").focus();
      const existing = id && comments.find(x => x.id === id);
      if (existing) existing.text = text;
      else { const key = box.dataset.key; comments.push({ id: newId(), target: key, where: labelFor(key), ...(box._quote ? { quote: box._quote } : {}), text }); }
      save(); refresh();
    }
  }

  // ---------- Bar ----------
  let bar;
  function changes() {
    const sent = thread ? thread.sent : {}, now = new Set(comments.map(c => c.id));
    return {
      added: comments.filter(c => !sent[c.id]),
      changed: comments.filter(c => sent[c.id] && snap(sent[c.id]) !== snap(c)),
      withdrawn: Object.values(sent).filter(c => !now.has(c.id)),
    };
  }
  const pending = () => { const ch = changes(); return ch.added.length + ch.changed.length + ch.withdrawn.length; };
  const whoLabel = () => me.via === "anon" ? (me.name ? `${esc(me.name)} (anonymous)` : "anonymous") : `@${esc(me.user)}`;
  function updateBar() {
    if (!bar) return;
    const n = pending(), total = comments.length;
    bar.querySelector(".ed-count").textContent = !total && !n ? "No comments yet" : `${total} comment${total === 1 ? "" : "s"}${n ? ` · ${n} not sent` : " · all sent"}`;
    bar.querySelector("[data-fbbar=send]").disabled = !n;
    const t = bar.querySelector(".fb-thread");
    t.innerHTML = thread ? `In <a href="https://github.com/${esc(REPO)}/issues/${thread.issue}" target="_blank" rel="noopener">#${thread.issue}</a>${thread.key ? ` · <button type="button" class="ed-link" data-fbbar="link">copy private link</button>` : ""}` : "";
  }
  function showBar() {
    bar = document.createElement("div");
    bar.className = "ed-bar fb-bar";
    bar.innerHTML = `<div class="ed-bar-in"><b>💬 Feedback</b><span class="ed-who">as ${whoLabel()} · <button type="button" class="ed-link" data-fbbar="signout">not you?</button></span>
      <span class="ed-count"></span><span class="fb-thread"></span>
      <span class="ed-hint">Point at any part of the page and click 💬, or select some words.</span>
      <button type="button" data-fbbar="stop">Close</button><button type="button" class="primary" data-fbbar="send">Review &amp; send</button></div>`;
    document.body.appendChild(bar);
    bar.addEventListener("click", e => {
      const b = e.target.closest("[data-fbbar]"); if (!b) return;
      if (b.dataset.fbbar === "send") review();
      if (b.dataset.fbbar === "stop") { if (!pending() || confirm("Close feedback? Comments you haven't sent stay saved in this browser.")) location.reload(); }
      if (b.dataset.fbbar === "signout") { try { localStorage.removeItem("fb-identity"); localStorage.removeItem("editor-github"); } catch (_) {} location.reload(); }
      if (b.dataset.fbbar === "link") copyLink(b);
    });
    updateBar();
  }
  const privateLink = () => `${location.origin}${location.pathname}#fb=${thread.issue}-${thread.key}`;
  function copyLink(btn) {
    try { navigator.clipboard.writeText(privateLink()); btn.textContent = "link copied"; setTimeout(() => { btn.textContent = "copy private link"; }, 2000); }
    catch (_) { prompt("Your private link:", privateLink()); }
  }

  // ---------- Review and send ----------
  function bodyFor(note, payload64) {
    const pageTitle = A.CASE ? A.CASES[A.CASE].short : A.CAT ? A.CATEGORIES[A.CAT].label : "Home page";
    const ch = changes();
    const item = (c, i) => `${i + 1}. **On ${c.where}**\n${c.quote ? `   > ${c.quote.exact}\n\n` : ""}   ${c.text.replace(/\n/g, "\n   ")}`;
    const parts = [thread ? `**More feedback for #${thread.issue}** (${pageTitle})` : `**Feedback on ${pageTitle}**`,
      `From: ${me.via === "anon" ? (me.name ? `${me.name} (anonymous)` : "anonymous") : `@${me.user}`}`];
    if (ch.added.length) parts.push(`**New**\n\n${ch.added.map(item).join("\n\n")}`);
    if (ch.changed.length) parts.push(`**Changed**\n\n${ch.changed.map(item).join("\n\n")}`);
    if (ch.withdrawn.length) parts.push(`**Withdrawn**\n\n${ch.withdrawn.map((c, i) => `${i + 1}. ~~On ${c.where}: ${cut(c.text, 80)}~~`).join("\n")}`);
    if (note) parts.push(`**Note**\n\n${note}`);
    parts.push(`Page: ${PAGE}`, `<details><summary>Technical details for the robot (please do not edit)</summary>\n\n\`\`\`feedback-v1\n${payload64}\n\`\`\`\n</details>`);
    return { pageTitle, body: parts.join("\n\n") + "\n" };
  }
  function review() {
    const ch = changes(), dlg = document.createElement("dialog");
    dlg.className = "ed-review";
    const li = (c, tag) => `<li><span><b>${tag}</b> on ${esc(c.where)}: “${esc(cut(c.text, 80))}”</span></li>`;
    dlg.innerHTML = `<h2>Send your feedback</h2>
      ${thread ? `<p class="ed-explain">This will be added to your earlier feedback, <a href="https://github.com/${esc(REPO)}/issues/${thread.issue}" target="_blank" rel="noopener">#${thread.issue}</a>.</p>` : ""}
      <ul class="ed-changes">${[...ch.added.map(c => li(c, "New")), ...ch.changed.map(c => li(c, "Changed")), ...ch.withdrawn.map(c => li(c, "Withdrawn"))].join("")}</ul>
      <label class="ed-note">Anything else? <span>(optional)</span><textarea rows="2"></textarea></label>
      <p class="ed-explain">${me.via === "anon" ? "Your feedback is sent straight away, and you get a private link to come back to it." : "Sending opens GitHub in a new tab with your feedback filled in. Click <b>Create</b> there."} Feedback is public on GitHub.</p>
      <div class="ed-actions"><button type="button" data-r="back">Keep going</button><button type="button" class="primary" data-r="send">Send</button></div>`;
    document.body.appendChild(dlg); dlg.showModal();
    dlg.addEventListener("close", () => dlg.remove());
    dlg.addEventListener("click", e => {
      const r = e.target.closest("[data-r]"); if (!r) return;
      if (r.dataset.r === "back") (dlg.close(), dlg.remove());
      if (r.dataset.r === "send") (me.via === "anon" ? sendAnon : sendGitHub)(dlg, dlg.querySelector("textarea").value.trim());
    });
  }
  const payloadNow = () => ({ version: 1, kind: "feedback", page: PAGE, from: me.via === "anon" ? { via: "anon", name: me.name || "" } : { via: "github", user: me.user },
    ...(thread ? { follows: thread.issue } : {}), comments: comments.map(clone) });
  const markSent = () => { thread.sent = Object.fromEntries(comments.map(c => [c.id, clone(c)])); save(); refresh(); };

  async function sendAnon(dlg, note) {
    dlg.innerHTML = `<h2>Sending…</h2>`;
    const { pageTitle, body } = bodyFor(note, await encode(payloadNow()));
    const first = comments[0] ? cut(comments[0].text, 60) : "comments";
    const title = thread ? `[feedback] ${pageTitle}: update to #${thread.issue}` : `[feedback] ${pageTitle}: ${first}`;
    let res = null;
    try { res = await (await fetch(A.site.feedbackEndpoint, { method: "POST", body: JSON.stringify({ title, body, ...(thread ? { follows: thread.issue, key: thread.key } : {}), website: "" }) })).json(); } catch (_) {}
    if (!res || !res.issue) {
      dlg.innerHTML = `<h2>That didn't work</h2><p>Your feedback couldn't be sent${res && res.error ? ` (${esc(res.error)})` : ""}. It's still saved in this browser; please try again later.</p><div class="ed-actions"><button type="button" class="primary" data-r="back">OK</button></div>`;
      return;
    }
    if (!thread) thread = { issue: res.issue, key: res.key, sent: {} };
    markSent();
    dlg.innerHTML = `<h2>Thank you!</h2>
      <p>Your feedback is <a href="https://github.com/${esc(REPO)}/issues/${thread.issue}" target="_blank" rel="noopener">#${thread.issue}</a>. If you add more comments, they'll be added to it.</p>
      <p><b>Your private link</b>: use it to come back to your feedback from any device. Keep it to yourself; anyone with it can add to your feedback.</p>
      <p class="fb-linkbox"><input type="text" readonly value="${esc(privateLink())}"><button type="button" data-r="copy">Copy</button></p>
      <div class="ed-actions"><button type="button" data-r="back">Keep going</button><button type="button" class="primary" data-r="done">I'm finished</button></div>`;
    dlg.addEventListener("click", e => {
      const r = e.target.closest("[data-r]"); if (!r) return;
      if (r.dataset.r === "copy") copyLink(r);
      if (r.dataset.r === "done") location.reload();
    });
  }

  async function sendGitHub(dlg, note) {
    const { pageTitle, body } = bodyFor(note, await encode(payloadNow()));
    const first = comments[0] ? cut(comments[0].text, 60) : "comments";
    const title = thread ? `[feedback] ${pageTitle}: update to #${thread.issue}` : `[feedback] ${pageTitle}: ${first}`;
    const base = `https://github.com/${REPO}/issues/new`;
    let url = `${base}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`, pasted = false;
    if (url.length > 6000) { pasted = true; try { navigator.clipboard.writeText(body); } catch (_) {} url = `${base}?title=${encodeURIComponent(title)}&body=${encodeURIComponent("Paste your feedback here (Ctrl+V or ⌘V), replacing this line.")}`; }
    const sentAt = Date.now();
    window.open(url, "_blank", "noopener");
    dlg.innerHTML = `<h2>Almost done</h2>
      <p>GitHub has opened in a new tab.${pasted ? " Your feedback was too long to fill in automatically, so it has been <b>copied</b>: paste it into the description box." : ""} Click <b>Create</b> there to send it.</p>
      <p class="ed-explain">If GitHub showed an error while you were signing in, <button type="button" class="ed-link" data-r="again">open GitHub again</button>.</p>
      ${pasted ? `<details><summary>If pasting doesn't work, copy this text</summary><textarea rows="6" readonly>${esc(body)}</textarea></details>` : ""}
      <div class="ed-actions ed-actions-wrap"><button type="button" data-r="back">Not sent yet</button><button type="button" data-r="sentkeep">I've sent it: keep going</button><button type="button" class="primary" data-r="sentdone">I've sent it: I'm finished</button></div>`;
    dlg.addEventListener("click", async e => {
      const r = e.target.closest("[data-r]"); if (!r) return;
      if (r.dataset.r === "again") return void window.open(url, "_blank", "noopener");
      if (r.dataset.r !== "sentkeep" && r.dataset.r !== "sentdone") return;
      if (!thread) {
        dlg.innerHTML = `<h2>Finding your feedback on GitHub…</h2><p class="ed-explain">This takes a few seconds.</p>`;
        const n = await findIssue(sentAt);
        if (!n) { dlg.innerHTML = `<h2>Couldn't find it yet</h2><p>If you did click Create, your next comments will be sent as separate feedback, which works too.</p><div class="ed-actions"><button type="button" class="primary" data-r="back">OK</button></div>`; return; }
        thread = { issue: n, sent: {} };
      }
      markSent();
      if (r.dataset.r === "sentdone") location.reload(); else (dlg.close(), dlg.remove());
    });
  }
  async function findIssue(since) {
    for (let i = 0; i < 8; i++) {
      try {
        const list = await ghJSON(`${API}/issues?creator=${encodeURIComponent(me.user)}&state=open&sort=created&direction=desc&per_page=10`);
        const hit = list.find(x => !x.pull_request && /^\[feedback\]/.test(x.title) && !/update to #\d+/.test(x.title) && (x.body || "").includes(`Page: ${PAGE}`) && Date.parse(x.created_at) > since - 120000);
        if (hit) return hit.number;
      } catch (_) {}
      await new Promise(r => setTimeout(r, 4000));
    }
    return null;
  }

  // ---------- Start ----------
  async function adopt(n, key) {
    const { state, issue } = await latestState(n);
    if (issue.state === "closed") return false;
    comments = state ? state.comments : [];
    thread = { issue: n, ...(key ? { key } : {}), sent: Object.fromEntries(comments.map(c => [c.id, clone(c)])) };
    if (state && state.from && state.from.via === "anon" && state.from.name && !me.name) me.name = state.from.name;
    save();
    return true;
  }
  async function start(who) {
    if (active) return;
    me = { via: who.via, ...(who.user ? { user: who.user } : {}), ...(who.via === "anon" ? { name: who.name || "" } : {}) };
    active = true;
    document.body.classList.add("feedback-mode");
    const fab = document.querySelector(".edit-fab"); if (fab) fab.hidden = true;
    try {
      if (who.recover) {
        // Private link: continue that anonymous feedback here.
        if (!(await adopt(who.recover.issue, who.recover.key))) alert(`Feedback #${who.recover.issue} has been closed by the team. You can start new feedback.`);
        history.replaceState(null, "", location.pathname + location.search);
      } else {
        const d = load();
        if (d) { comments = d.comments || []; thread = d.thread || null; }
        if (thread) {
          // Drop the link once the team has closed that feedback; keep anything not yet sent.
          const st = await ghJSON(`${API}/issues/${thread.issue}`).catch(() => null);
          if (st && st.state === "closed") { comments = comments.filter(c => !thread.sent[c.id]); thread = null; save(); }
        } else if (me.via === "github") {
          // Offer to continue earlier open feedback on this page.
          const list = await ghJSON(`${API}/issues?creator=${encodeURIComponent(me.user)}&state=open&per_page=30`).catch(() => []);
          const prev = list.find(x => !x.pull_request && /^\[feedback\]/.test(x.title) && !/update to #\d+/.test(x.title) && (x.body || "").includes(`Page: ${PAGE}`));
          if (prev && confirm(`You left feedback on this page before (#${prev.number}). Continue with it?`)) {
            const mine = comments.filter(c => !(thread && thread.sent[c.id]));
            await adopt(prev.number);
            comments.push(...mine.filter(c => !comments.some(x => x.id === c.id))); save();
          }
        }
      }
    } catch (_) {}
    makeButtons();
    document.addEventListener("mouseover", onOver);
    document.addEventListener("mouseup", () => setTimeout(onSelect, 0));
    document.addEventListener("keyup", () => setTimeout(onSelect, 0));
    document.addEventListener("click", onClick);
    addEventListener("scroll", () => { if (hoverBtn) hoverBtn.hidden = true; if (selBtn) selBtn.hidden = true; hoverTarget = null; }, true);
    showBar();
    refresh();
  }

  // ---------- Contributors: show open feedback ----------
  async function loadOpen() {
    const q = encodeURIComponent(`repo:${REPO} is:issue is:open in:title "[feedback]"`);
    const res = await ghJSON(`https://api.github.com/search/issues?q=${q}&per_page=50`).catch(() => ({ items: [] }));
    const items = (res.items || []).filter(it => !/update to #\d+/.test(it.title) && (it.body || "").includes(`Page: ${PAGE}`));
    const out = [];
    for (const it of items) {
      const { state } = await latestState(it.number).catch(() => ({ state: null }));
      if (!state) continue;
      const author = state.from.via === "anon" ? (state.from.name ? `${state.from.name} (anonymous)` : "anonymous") : `@${state.from.user}`;
      state.comments.forEach(c => out.push({ ...c, id: `${it.number}-${c.id}`, issue: it.number, url: it.html_url, author }));
    }
    return out;
  }
  function toggleOpenFeedback() {
    reviewOn = !reviewOn;
    if (reviewOn && !reviewItems) loadOpen().then(items => { reviewItems = items; refresh(); if (!items.length) alert("There's no open feedback on this page."); });
    else refresh();
    return reviewOn;
  }

  document.addEventListener("persona-opened", () => { if (active || reviewOn) refresh(); });
  window.SiteFeedback = { start, refresh, toggleOpenFeedback };
})();
