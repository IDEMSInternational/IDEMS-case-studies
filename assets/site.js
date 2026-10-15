// Renders every page from the JSON files in content/. Each HTML page is a shell:
// <body data-page="home|category|case" data-category="…" data-case="…"><div id="app"></div><script src="…/assets/site.js"></script>
(async function () {
  const ROOT = new URL("../", document.currentScript.src).href;
  const { page, category: CAT, case: CASE } = document.body.dataset;
  const app = document.getElementById("app");

  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const getJSON = path => fetch(ROOT + path).then(r => { if (!r.ok) throw new Error(`${path}: ${r.status}`); return r.json(); });

  // ---------- Load content ----------
  let site, cats, PERSONAS, caseDocs, REFS = {};
  try {
    [site, cats] = await Promise.all([getJSON("content/site.json"), getJSON("content/categories.json")]);
    const active = cats.filter(c => !c.comingSoon && (page === "home" || c.id === CAT));
    const [personaLists, docLists] = await Promise.all([
      Promise.all(active.map(c => getJSON(`content/${c.id}/personas.json`).then(ps => ps.map(p => ({ ...p, category: c.id }))))),
      Promise.all(active.map(c => Promise.all((c.caseStudies || []).map(id =>
        getJSON(`content/${c.id}/case-studies/${id}.json`).then(d => ({ ...d, category: c.id })))))),
    ]);
    PERSONAS = personaLists.flat();
    caseDocs = docLists.flat();
    if (page === "case") (await getJSON("content/references.json")).forEach(r => { REFS[r.key] = r; });
  } catch (err) {
    app.innerHTML = `<main class="wrap"><p class="coming-soon">This page could not load its content (${esc(err.message)}). If you opened the file directly from your computer, view it through a local web server instead.</p></main>`;
    throw err;
  }

  const CATEGORIES = Object.fromEntries(cats.map(c => [c.id, c]));
  const SETS = Object.fromEntries(cats.flatMap(c => (c.sets || []).map(s => [s.id, s])));
  const CASES = Object.fromEntries(caseDocs.map(d => [d.id, d]));
  const byId = Object.fromEntries(PERSONAS.map(p => [p.id, p]));

  const img = p => `${ROOT}images/${p.id}.jpg`;
  const categoryHref = k => `${ROOT}${k}/index.html`;
  const caseHref = k => `${ROOT}${CASES[k].category}/${k}.html`;
  const personaHref = p => `${categoryHref(p.category)}#${p.id}`;
  const casesIn = cat => (CATEGORIES[cat].caseStudies || []).filter(k => CASES[k]);
  const personasIn = cat => PERSONAS.filter(p => p.category === cat);
  const color = p => (SETS[p.set] || CATEGORIES[p.category]).color;
  const list = (items, field) => `<ul>${items.map((i, n) => `<li data-pf="${field}|${n}">${esc(i)}</li>`).join("")}</ul>`;
  const firstName = p => p.name.replace(/^(Dr|Prof|Mr|Mrs|Ms)\.\s*/, "").split(" ")[0];

  // ---------- Inline text markup ----------
  // **bold**, *italic*, `code`, [text](https://…), [[p:persona-id]] or [[p:id|text]],
  // [[case:case-id|text]], {{ref-key}} for (Authors, year) and {{ref-key|n}} for Authors (year).
  const cited = [];
  const TOKEN = /\{\{([a-z0-9]+)(\|n)?\}\}|\[\[(p|case):([a-z0-9-]+)(?:\|([^\]]+))?\]\]|\[([^\]]+)\]\((https?:[^)\s]+)\)|\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`/g;
  // In edit mode, links and citations become non-editable "chips" that carry their original markup.
  const chip = (token, html) => `<span class="chip" contenteditable="false" data-token="${esc(token)}">${html}</span>`;
  function md(s, edit) {
    s = String(s ?? "");
    const re = new RegExp(TOKEN.source, "g"); // fresh copy: md() recurses into link and emphasis text
    let out = "", last = 0, m;
    while ((m = re.exec(s))) {
      out += esc(s.slice(last, m.index));
      last = re.lastIndex;
      const [, key, narrative, kind, id, label, ltext, url, bold, em, code] = m;
      if (key) {
        const r = REFS[key];
        if (!r) { out += edit ? chip(m[0], esc(key)) : `<mark title="Unknown reference">${esc(key)}</mark>`; continue; }
        if (!cited.includes(key) && !edit) cited.push(key);
        const a = md(r.inText), shown = narrative ? `${a} (${esc(r.year)})` : `${a}, ${esc(r.year)}`;
        out += edit ? chip(m[0], shown) : `<a class="cref" href="#ref-${key}">${shown}</a>`;
      } else if (kind === "p") {
        const p = byId[id], shown = p ? (label ? md(label) : esc(`${p.name}, ${p.tagline}`)) : esc(id);
        out += edit ? chip(m[0], shown) : p ? `<a href="${personaHref(p)}">${shown}</a>` : `<mark title="Unknown persona">${esc(id)}</mark>`;
      } else if (kind === "case") {
        const shown = md(label || (CASES[id] ? CASES[id].short : id));
        out += edit ? chip(m[0], shown) : CASES[id] ? `<a href="${caseHref(id)}">${shown}</a>` : shown;
      } else if (ltext) out += edit ? chip(m[0], md(ltext)) : `<a href="${esc(url)}" target="_blank" rel="noopener">${md(ltext)}</a>`;
      else if (bold) out += `<strong>${md(bold, edit)}</strong>`;
      else if (em) out += `<em>${md(em, edit)}</em>`;
      else if (code) out += `<code>${esc(code)}</code>`;
    }
    return out + esc(s.slice(last));
  }

  // ---------- Theme and navigation ----------
  try { const t = localStorage.getItem("persona-theme"); if (t) document.documentElement.dataset.theme = t; } catch (_) {}
  function toggleTheme() {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("persona-theme", root.dataset.theme); } catch (_) {}
  }
  function navHTML() {
    const cur = (on, section) => on ? ' aria-current="page"' : section ? ' aria-current="true"' : "";
    let html = `<div class="in"><a class="brand" href="${ROOT}index.html"${cur(!CAT)}>${esc(site.title)}</a>`;
    html += cats.map(c => `<a href="${categoryHref(c.id)}"${cur(c.id === CAT && !CASE, c.id === CAT)}>${esc(c.label)}</a>`).join("");
    html += `<button class="theme-btn" aria-label="Toggle dark mode" title="Toggle theme">◐</button></div>`;
    if (page === "case") html += `<div class="in sub">` + casesIn(CAT).map((k, i) => `<a href="${caseHref(k)}"${cur(k === CASE)}>${i + 1} · ${esc(CASES[k].short)}</a>`).join("") + `</div>`;
    return `<nav class="topnav">${html}</nav>`;
  }

  // ---------- Page bodies ----------
  const creditsHTML = cat => `<ol id="credits">${PERSONAS.filter(p => !cat || p.category === cat).map(p =>
    `<li>${esc(p.name)}: <a href="${esc(p.credit.url)}" target="_blank" rel="noopener">${esc(p.credit.title)}</a> by ${esc(p.credit.author)}, ${esc(p.credit.licence)}</li>`).join("")}</ol>`;

  function homeHTML() {
    const cards = cats.map(c => {
      const nc = casesIn(c.id).length, np = personasIn(c.id).length;
      const meta = nc || np ? `${nc} case ${nc === 1 ? "study" : "studies"} · ${np} personas` : "Coming soon";
      return `<a class="cat-card" href="${categoryHref(c.id)}" style="--c:${c.color}"><b>${esc(c.label)}</b><span>${meta}</span></a>`;
    }).join("");
    return `<header class="top"><div class="wrap"><div class="eyebrow">${esc(site.organisation)} · ${esc(site.status)}</div><h1>${esc(site.title)}</h1></div></header>
      <main class="wrap"><div class="cat-list">${cards}</div>
        <h2 class="section">${esc(site.personasHeading)}</h2><p class="note">${md(site.personasNote)}</p><div id="persona-browser"></div></main>
      <footer class="site"><div class="wrap"><h2>${esc(site.creditsHeading)}</h2><p>${md(site.creditsNote)}</p>${creditsHTML()}</div></footer>`;
  }

  function categoryHTML() {
    const c = CATEGORIES[CAT];
    const head = `<header class="top"><div class="wrap"><div class="eyebrow">${esc(site.organisation)} · ${esc(c.label)} · ${esc(site.status)}</div><h1>${esc(c.label)}</h1>${c.lede ? `<p class="lede">${md(c.lede)}</p>` : ""}</div></header>`;
    if (c.comingSoon) return head + `<main class="wrap"><p class="coming-soon">${esc(site.comingSoon)}</p></main>`;
    const caseCards = casesIn(CAT).map((k, i) => `<a class="case-card" href="${caseHref(k)}"><span>Case study ${i + 1}</span><b>${esc(CASES[k].title)}</b><p>${esc(CASES[k].summary)}</p></a>`).join("");
    return head + `<main class="wrap"><h2 class="section">Case studies</h2><div class="case-list">${caseCards}</div>
        <h2 class="section">${esc(site.personasHeading)}</h2><p class="note">${md(c.personasNote)}</p><div id="persona-browser" data-category="${CAT}"></div></main>
      <footer class="site"><div class="wrap">${c.sources ? `<h2>Sources</h2><p>${md(c.sources)}</p>` : ""}
        <h2>${esc(site.creditsHeading)}</h2><p>${md(c.creditsNote)}</p>${creditsHTML(CAT)}</div></footer>`;
  }

  // Case-study blocks. Every rendered block carries data-block="<id>" so it can be traced back to the JSON.
  const pcard = id => { const p = byId[id]; return p ? `<a class="pcard" href="${personaHref(p)}" style="--c:${color(p)}"><img src="${img(p)}" alt="" style="object-position:${p.pos}"><span><b>${esc(p.name)}</b><i>${esc(p.tagline)} · ${esc(p.where)}</i></span></a>` : ""; };
  const STI = { social: "The Social", technical: "The Technical", innovation: "The Innovation" };
  function blockHTML(b) {
    const at = `data-block="${b.id}"`;
    switch (b.type) {
      case "paragraph": return `<p ${at}>${md(b.text)}</p>`;
      case "subheading": return `<h3 ${at}>${md(b.text)}</h3>`;
      case "quote":
        if (b.persona) {
          const p = byId[b.persona];
          return p ? `<blockquote class="voice" ${at}>“${esc(p.quote)}”<cite><a href="${personaHref(p)}">${esc(p.name)}, ${esc(p.tagline)}</a> (fictional persona)</cite></blockquote>` : "";
        }
        return `<blockquote class="voice" ${at}>“${md(b.text)}”<cite>${md(b.source)}</cite></blockquote>`;
      case "personas": return `<div class="personas-label">${esc(b.label || "Personas in this chapter")}</div><div class="personas" ${at}>${b.ids.map(pcard).join("")}</div>`;
      case "list": return `<ul ${at}>${b.items.map(i => `<li>${md(i)}</li>`).join("")}</ul>`;
      case "timeline": return `<ul class="timeline" ${at}>${b.items.map(i => `<li><b>${esc(i.label)}</b> ${md(i.text)}</li>`).join("")}</ul>`;
      case "table": return `<div class="tablewrap" ${at}><table><thead><tr>${b.head.map(h => `<th>${md(h)}</th>`).join("")}</tr></thead><tbody>${b.rows.map(r => `<tr>${r.map(c => `<td>${md(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
      case "box": return `<div class="box" ${at}><h3>${md(b.title)}</h3>${b.blocks.map(blockHTML).join("")}</div>`;
      case "sti": return `<p class="sti-intro" ${at}>${md(b.intro)}</p><div class="sti">${Object.keys(STI).map(k =>
        `<section class="${k}"><h3>${STI[k]}</h3><ul>${(b[k] || []).map(i => `<li><strong>${md(i.title)}</strong> ${md(i.text)}</li>`).join("")}</ul></section>`).join("")}</div>`;
      default: return "";
    }
  }

  function fmtRef(r) {
    const e = esc, link = u => `<a href="${e(u)}">${e(u)}</a>`, doi = d => link("https://doi.org/" + d);
    const A = r.authors ? e(r.authors) + (r.authors.endsWith(".") ? " " : ". ") : "";
    switch (r.kind) {
      case "article": return `${A}(${e(r.year)}). ${e(r.title)}. <em>${e(r.journal)}</em>, <em>${e(r.volume)}</em>(${e(r.issue)}), ${e(r.pages)}. ${doi(r.doi)}`;
      case "chapter": return `${A}(${e(r.year)}). ${e(r.title)}. In ${e(r.editors)}, <em>${e(r.book)}</em> (pp. ${e(r.pages)}). ${e(r.publisher)}. ${doi(r.doi)}`;
      case "preprint": return `${A}(${e(r.year)}). <em>${e(r.title)}</em> (${e(r.number)}). ${e(r.publisher)}. ${doi(r.doi)}`;
      case "case-study": return r.authors ? `${A}(${e(r.year)}). <em>${e(r.title)}</em>. STACK case studies. ${link(r.url)}` : `<em>${e(r.title)}</em>. (${e(r.year)}). STACK case studies. ${link(r.url)}`;
      case "podcast": return `${e(r.authors)} (Hosts). (${e(r.year)}, ${e(r.day)}). ${e(r.title)} (No. ${e(r.number)}) [Audio podcast episode]. In <em>IDEMS podcast</em>. IDEMS International. ${link(r.url)}`;
      case "web": return `${A}(${e(r.date || r.year)}). <em>${e(r.title)}</em>${r.description ? ` [${e(r.description)}]` : ""}. ${r.site ? e(r.site) + ". " : ""}Retrieved ${e(r.retrieved)}, from ${link(r.url)}`;
      case "unpublished": return `${A}(${e(r.year)}). <em>${e(r.title)}</em> [${e(r.note)}].`;
      default: return e(r.title || r.key);
    }
  }

  function caseHTML() {
    const d = CASES[CASE], all = casesIn(CAT), idx = all.indexOf(CASE), c = CATEGORIES[CAT];
    const hero = `<header class="hero"><div class="eyebrow">Case study ${idx + 1} of ${all.length} · ${esc(site.status)}</div>
      <h1>${md(d.title)}</h1><p class="standfirst">${md(d.standfirst)}</p>${d.note ? `<p class="note">${md(d.note)}</p>` : ""}</header>`;
    const stats = `<div class="stats">${d.stats.map(s => `<div class="stat"><b>${esc(s.value)}</b><span>${md(s.label)}</span></div>`).join("")}</div>`;
    const sections = d.sections.map(s => `<h2 id="${s.id}" data-section="${s.id}">${md(s.heading)}</h2>${s.blocks.map(blockHTML).join("")}`).join("\n");
    const next = `<div class="next">${all.filter(k => k !== CASE).map(k => {
      const j = all.indexOf(k), before = j < idx;
      const lab = j === idx + 1 ? "Next case study" : j === idx - 1 ? "Previous case study" : `Case study ${j + 1}`;
      return `<a href="${caseHref(k)}"><span>${lab}</span><b>${before ? "← " : ""}${esc(CASES[k].short)}${before ? "" : " →"}</b></a>`;
    }).join("")}</div>`;
    const refs = cited.map(k => REFS[k]).sort((a, b) => a.sort.localeCompare(b.sort));
    const footer = `<footer><h2 class="refs-title">References</h2><ul class="refs">${refs.map(r => `<li id="ref-${r.key}">${fmtRef(r)}</li>`).join("")}</ul>
      <p>${md(site.caseStudyNote)} Placeholder photos are credited on the <a href="${categoryHref(CAT)}">${esc(c.label)} page</a>.</p></footer>`;
    document.title = d.short + " · " + site.title;
    return `<main class="wrap">${hero}${stats}${sections}${next}${footer}</main>`;
  }

  app.innerHTML = navHTML() + (page === "home" ? homeHTML() : page === "category" ? categoryHTML() : caseHTML());
  app.querySelector(".theme-btn").addEventListener("click", toggleTheme);

  // ---------- Persona browser ----------
  function tagsHTML(p, withCategory) {
    let t = "";
    if (withCategory) t += `<span class="tag" style="--c:${CATEGORIES[p.category].color}">${esc(CATEGORIES[p.category].label)}</span>`;
    if (SETS[p.set]) t += `<span class="tag" style="--c:${SETS[p.set].color}">${esc(SETS[p.set].label)}</span>`;
    return t;
  }
  const browser = document.getElementById("persona-browser");
  let order = [];
  const onBrowserPage = !!browser;
  if (browser) {
    const scopeCat = browser.dataset.category || "";
    const state = { category: scopeCat, case: "", set: "", q: "" };
    browser.innerHTML = `<div class="controls"><div class="filters"></div>
        <input class="search" type="search" placeholder="Search personas…" aria-label="Search personas"></div>
      <p class="result-count" aria-live="polite"></p><div class="grid"></div><p class="empty">No personas match these filters.</p>`;
    const filtersEl = browser.querySelector(".filters"), grid = browser.querySelector(".grid");
    const dims = [
      ...(scopeCat ? [] : [["category", "Category", () => cats.map(c => c.id), k => CATEGORIES[k].label, (p, v) => p.category === v]]),
      ["case", "Case study", () => Object.keys(CASES), k => CASES[k].short, (p, v) => p.cases.includes(v)],
      ["set", "Set", () => Object.keys(SETS), k => SETS[k].label, (p, v) => p.set === v],
    ];
    const matches = (p, skip) => dims.every(([key, , , , test]) => key === skip || !state[key] || test(p, state[key]));
    function renderFilters() {
      filtersEl.innerHTML = dims.map(([key, label, keys, name, test]) => {
        const pool = PERSONAS.filter(p => matches(p, key));
        const soon = k => key === "category" && !personasIn(k).length;
        const opts = keys().map(k => [k, pool.filter(p => test(p, k)).length]).filter(([k, n]) => n || k === state[key] || soon(k));
        if (!opts.length) return "";
        return `<label class="filter"><span>${label}</span><select data-dim="${key}">
          <option value="">All</option>${opts.map(([k, n]) => `<option value="${esc(k)}"${k === state[key] ? " selected" : ""}${n ? "" : " disabled"}>${esc(name(k))} (${soon(k) ? "coming soon" : n})</option>`).join("")}
        </select></label>`;
      }).join("") + `<button class="reset" type="button">Clear filters</button>`;
    }
    function render() {
      const q = state.q.trim().toLowerCase();
      order = PERSONAS.filter(p => matches(p) && (!q || [p.name, p.tagline, p.where, p.quote, ...p.background, ...p.looking, ...p.hopes, ...p.worries].join(" ").toLowerCase().includes(q)));
      grid.innerHTML = order.map(p => `<button class="card" style="--c:${color(p)}" data-id="${p.id}" aria-label="Open profile: ${esc(p.name)}, ${esc(p.tagline)}">
        <div class="ph"><img src="${img(p)}" alt="" loading="lazy" style="object-position:${p.pos}"></div>
        <div class="body"><h3 class="name">${esc(p.name)}</h3><p class="tagline">${esc(p.tagline)}</p>
          <div class="meta">${p.age} · ${esc(p.where)}</div><div class="tags">${tagsHTML(p, !scopeCat)}</div>
          <blockquote>“${esc(p.quote)}”</blockquote></div></button>`).join("");
      const total = scopeCat ? personasIn(scopeCat).length : PERSONAS.length;
      browser.querySelector(".result-count").textContent = `Showing ${order.length} of ${total} personas`;
      browser.querySelector(".empty").style.display = order.length ? "none" : "block";
      renderFilters();
    }
    filtersEl.addEventListener("change", e => { const s = e.target.closest("select[data-dim]"); if (s) { state[s.dataset.dim] = s.value; render(); } });
    filtersEl.addEventListener("click", e => {
      if (!e.target.closest(".reset")) return;
      Object.assign(state, { category: scopeCat, case: "", set: "", q: "" });
      browser.querySelector(".search").value = "";
      render();
    });
    browser.querySelector(".search").addEventListener("input", e => { state.q = e.target.value; render(); });
    grid.addEventListener("click", e => { const card = e.target.closest(".card"); if (card) open(card.dataset.id); });
    render();
  }

  const linkedId = a => {
    if (!a.hash) return null;
    const id = decodeURIComponent(a.hash.slice(1));
    return byId[id] ? id : null;
  };
  if (!onBrowserPage) {
    // On case-study pages, step through personas in order of first appearance.
    app.querySelectorAll("a[href]").forEach(a => { const id = linkedId(a); if (id && !order.includes(id)) order.push(id); });
    order = order.map(id => byId[id]);
  }

  // ---------- Profile dialog ----------
  if (!PERSONAS.length) return;
  const dlg = document.createElement("dialog");
  dlg.id = "persona-dlg";
  dlg.setAttribute("aria-labelledby", "dlg-title");
  document.body.appendChild(dlg);

  function open(id) {
    const p = byId[id], c = p.credit, i = order.findIndex(x => x.id === id);
    const appears = p.cases.filter(k => CASES[k]).map(k => `<a href="${caseHref(k)}">${esc(CASES[k].short)}</a>`).join(" · ");
    dlg.style.setProperty("--c", color(p));
    dlg.innerHTML = `<div class="pf">
      <aside class="pf-side">
        <img src="${img(p)}" alt="Placeholder photo for ${esc(p.name)}" style="object-position:${p.pos}">
        <blockquote class="pf-quote">“<span data-pf="quote">${esc(p.quote)}</span>”</blockquote>
        <details class="prompt"><summary>Image-generation prompt</summary><p>${esc(p.prompt)}</p></details>
        <div class="credit">Placeholder photo: <a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.title)}</a> by ${esc(c.author)}, ${esc(c.licence)}, via Wikimedia Commons (cropped).</div>
      </aside>
      <section class="pf-main">
        <div class="pf-head"><div>
            <h2 id="dlg-title" data-pf="name">${esc(p.name)}</h2>
            <p class="pf-tagline"><span data-pf="tagline">${esc(p.tagline)}</span> · <span data-pf="age">${p.age}</span> · <span data-pf="where">${esc(p.where)}</span></p>
            <div class="tags">${tagsHTML(p, true)}</div>
            ${appears ? `<p class="appears">Appears in: ${appears}</p>` : ""}
          </div><button class="close" aria-label="Close" data-close autofocus>×</button></div>
        <div class="sections">
          <div class="sec"><h3>Background</h3>${list(p.background, "background")}</div>
          <div class="sec"><h3>What ${p.pronoun === "she" ? "she’s" : p.pronoun === "he" ? "he’s" : "they’re"} looking for</h3>${list(p.looking, "looking")}</div>
          <div class="sec"><h3>Hopes &amp; dreams</h3>${list(p.hopes, "hopes")}</div>
          <div class="sec"><h3>Worries &amp; fears</h3>${list(p.worries, "worries")}</div>
          <div class="sec wide"><h3>Their data and expertise</h3>${list(p.data, "data")}</div>
          <div class="sec wide"><h3>A day in the life of ${esc(firstName(p))}</h3>${list(p.day, "day")}</div>
        </div>
        <p class="grounded"><strong>Grounded in:</strong> <span data-pf="grounded">${esc(p.grounded)}</span></p>
        <div class="pf-nav">
          <button data-step="-1" ${i <= 0 ? "disabled" : ""}>← Previous</button>
          <button data-step="1" ${i < 0 || i >= order.length - 1 ? "disabled" : ""}>Next →</button>
          ${onBrowserPage ? "" : `<a href="${categoryHref(p.category)}" data-nav>See all ${esc(CATEGORIES[p.category].label.toLowerCase())} personas</a>`}
        </div>
      </section></div>`;
    dlg.dataset.id = id;
    if (!dlg.open) dlg.showModal();
    dlg.querySelector(".pf-main").scrollTop = 0;
    document.dispatchEvent(new CustomEvent("persona-opened", { detail: { id, dialog: dlg } }));
  }
  const step = d => { const next = order[order.findIndex(x => x.id === dlg.dataset.id) + d]; if (next) open(next.id); };

  document.addEventListener("click", e => {
    const a = e.target.closest("a[href]");
    if (!a || a.hasAttribute("data-nav") || dlg.contains(a) || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const id = linkedId(a);
    if (!id) return;
    e.preventDefault();
    open(id);
  });
  dlg.addEventListener("click", e => {
    if (e.target === dlg || e.target.closest("[data-close]")) return dlg.close();
    const b = e.target.closest("[data-step]");
    if (b && !b.disabled) step(Number(b.dataset.step));
  });
  document.addEventListener("keydown", e => {
    if (!dlg.open || e.target.closest("summary")) return;
    if (e.key === "ArrowRight") step(1);
    if (e.key === "ArrowLeft") step(-1);
  });

  // ---------- Edit mode (assets/editor.js is loaded on demand) ----------
  window.SiteAPI = { ROOT, site, cats, CATEGORIES, CASES, SETS, PERSONAS, byId, REFS, page, CAT, CASE, md, esc, pcard, personaHref, color, open, dialog: dlg, app };
  const editBtn = document.createElement("button");
  editBtn.className = "edit-fab";
  editBtn.type = "button";
  editBtn.textContent = "✎ Edit";
  editBtn.title = "Suggest changes to this page";
  editBtn.addEventListener("click", () => {
    if (window.SiteEditor) return window.SiteEditor.start();
    const sc = document.createElement("script");
    sc.src = ROOT + "assets/editor.js";
    sc.onload = () => window.SiteEditor.start();
    document.body.appendChild(sc);
  });
  document.body.appendChild(editBtn);
  if (new URLSearchParams(location.search).has("edit")) editBtn.click(); // links ending in ?edit open in edit mode

  const hashId = decodeURIComponent(location.hash.slice(1));
  if (byId[hashId]) open(hashId);
  else if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
})();
