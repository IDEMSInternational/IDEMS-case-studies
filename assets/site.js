// Shared behaviour for every page: navigation, theme, category and case lists, the persona browser,
// persona cards on case-study pages and the profile dialog. Load after data/catalogue.js and the category data files.
(function () {
  const ROOT = new URL("../", document.currentScript.src).href;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const list = items => `<ul>${items.map(i => `<li>${esc(i)}</li>`).join("")}</ul>`;
  const firstName = p => p.name.replace(/^(Dr|Prof|Mr|Mrs|Ms)\.\s*/, "").split(" ")[0];
  const byId = Object.fromEntries(PERSONAS.map(p => [p.id, p]));
  const img = p => `${ROOT}images/${p.id}.jpg`;
  const categoryHref = k => `${ROOT}${k}/index.html`;
  const caseHref = k => `${ROOT}${CASES[k].category}/${CASES[k].page}`;
  const personaHref = p => `${categoryHref(p.category)}#${p.id}`;
  const casesIn = cat => Object.keys(CASES).filter(k => CASES[k].category === cat);
  const personasIn = cat => PERSONAS.filter(p => p.category === cat);

  // Theme
  try { const t = localStorage.getItem("persona-theme"); if (t) document.documentElement.dataset.theme = t; } catch (_) {}
  function toggleTheme() {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("persona-theme", root.dataset.theme); } catch (_) {}
  }

  // Top navigation: <nav class="topnav" data-category="education" data-case="textbooks"></nav>
  document.querySelectorAll("nav.topnav").forEach(nav => {
    const cat = nav.dataset.category, cs = nav.dataset.case;
    const cur = (on, section) => on ? ' aria-current="page"' : section ? ' aria-current="true"' : "";
    let html = `<div class="in"><a class="brand" href="${ROOT}index.html"${cur(!cat)}>IDEMS case studies</a>`;
    html += Object.entries(CATEGORIES).map(([k, c]) => `<a href="${categoryHref(k)}"${cur(k === cat && !cs, k === cat)}>${esc(c.label)}</a>`).join("");
    html += `<button class="theme-btn" aria-label="Toggle dark mode" title="Toggle theme">◐</button></div>`;
    if (cat && nav.hasAttribute("data-case")) {
      html += `<div class="in sub">` + casesIn(cat).map((k, i) => `<a href="${caseHref(k)}"${cur(k === cs)}>${i + 1} · ${esc(CASES[k].short)}</a>`).join("") + `</div>`;
    }
    nav.innerHTML = html;
    nav.querySelector(".theme-btn").addEventListener("click", toggleTheme);
  });

  // Category cards (home page)
  const catList = document.getElementById("category-list");
  if (catList) {
    catList.innerHTML = Object.entries(CATEGORIES).map(([k, c]) => {
      const nc = casesIn(k).length, np = personasIn(k).length;
      const meta = nc || np ? `${nc} case ${nc === 1 ? "study" : "studies"} · ${np} personas` : "Coming soon";
      return `<a class="cat-card" href="${categoryHref(k)}" style="--c:${c.color}"><b>${esc(c.label)}</b><span>${meta}</span></a>`;
    }).join("");
  }

  // Case-study cards (category pages): <div class="case-list" data-category="education"></div>
  document.querySelectorAll(".case-list[data-category]").forEach(el => {
    el.innerHTML = casesIn(el.dataset.category).map((k, i) =>
      `<a class="case-card" href="${caseHref(k)}"><span>Case study ${i + 1}</span><b>${esc(CASES[k].title)}</b><p>${esc(CASES[k].summary)}</p></a>`
    ).join("");
  });

  // Tags shown on cards and in the dialog
  function tagsHTML(p, withCategory) {
    let t = "";
    if (withCategory) t += `<span class="tag" style="--c:${CATEGORIES[p.category].color}">${esc(CATEGORIES[p.category].label)}</span>`;
    if (SETS[p.set]) t += `<span class="tag" style="--c:${SETS[p.set].color}">${esc(SETS[p.set].label)}</span>`;
    return t;
  }

  // Accent colour for a persona: its set, falling back to its category.
  const color = p => (SETS[p.set] || CATEGORIES[p.category]).color;

  // Persona browser: <div id="persona-browser" data-category="education"></div> (no data-category = all personas)
  const browser = document.getElementById("persona-browser");
  let order = [];           // personas the dialog steps through
  let onBrowserPage = false;
  if (browser) {
    onBrowserPage = true;
    const scopeCat = browser.dataset.category || "";
    const state = { category: scopeCat, case: "", set: "", q: "" };
    browser.innerHTML = `<div class="controls"><div class="filters"></div>
        <input class="search" type="search" placeholder="Search personas…" aria-label="Search personas"></div>
      <p class="result-count" aria-live="polite"></p>
      <div class="grid"></div>
      <p class="empty">No personas match these filters.</p>`;
    const filtersEl = browser.querySelector(".filters"), grid = browser.querySelector(".grid");

    const dims = [
      ...(scopeCat ? [] : [["category", "Category", () => Object.keys(CATEGORIES), k => CATEGORIES[k].label, (p, v) => p.category === v]]),
      ["case", "Case study", () => Object.keys(CASES), k => CASES[k].short, (p, v) => p.cases.includes(v)],
      ["set", "Set", () => Object.keys(SETS), k => SETS[k].label, (p, v) => p.set === v],
    ];
    const matches = (p, skip) => dims.every(([key, , , , test]) => key === skip || !state[key] || test(p, state[key]));

    function renderFilters() {
      filtersEl.innerHTML = dims.map(([key, label, keys, name, test]) => {
        // Counts reflect the other active filters, so options never lead to an empty result.
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
        <div class="body">
          <h3 class="name">${esc(p.name)}</h3>
          <p class="tagline">${esc(p.tagline)}</p>
          <div class="meta">${p.age} · ${esc(p.where)}</div>
          <div class="tags">${tagsHTML(p, !scopeCat)}</div>
          <blockquote>“${esc(p.quote)}”</blockquote>
        </div>
      </button>`).join("");
      const total = scopeCat ? personasIn(scopeCat).length : PERSONAS.length;
      browser.querySelector(".result-count").textContent = `Showing ${order.length} of ${total} personas`;
      browser.querySelector(".empty").style.display = order.length ? "none" : "block";
      renderFilters();
    }

    filtersEl.addEventListener("change", e => {
      const s = e.target.closest("select[data-dim]");
      if (s) { state[s.dataset.dim] = s.value; render(); }
    });
    filtersEl.addEventListener("click", e => {
      if (!e.target.closest(".reset")) return;
      Object.assign(state, { category: scopeCat, case: "", set: "", q: "" });
      browser.querySelector(".search").value = "";
      render();
    });
    browser.querySelector(".search").addEventListener("input", e => { state.q = e.target.value; render(); });
    grid.addEventListener("click", e => {
      const card = e.target.closest(".card");
      if (card) open(card.dataset.id);
    });
    render();
  }

  // Persona cards and quote citations on case-study pages
  document.querySelectorAll("a.pcard[data-p]").forEach(a => {
    const p = byId[a.dataset.p]; if (!p) return;
    a.href = personaHref(p);
    a.style.setProperty("--c", color(p));
    a.innerHTML = `<img src="${img(p)}" alt="" style="object-position:${p.pos}"><span><b>${esc(p.name)}</b><i>${esc(p.tagline)} · ${esc(p.where)}</i></span>`;
  });
  document.querySelectorAll("cite[data-p]").forEach(c => {
    const p = byId[c.dataset.p]; if (!p) return;
    c.innerHTML = `<a href="${personaHref(p)}">${esc(p.name)}, ${esc(p.tagline)}</a> (fictional persona)`;
  });
  const linkedId = a => {
    if (!a.hash) return null;
    const id = decodeURIComponent(a.hash.slice(1));
    return byId[id] ? id : null;
  };
  if (!onBrowserPage) {
    // On case-study pages, step through personas in order of first appearance.
    document.querySelectorAll("a[href]").forEach(a => {
      const id = linkedId(a);
      if (id && !order.includes(id)) order.push(id);
    });
    order = order.map(id => byId[id]);
  }

  // Credits: <ol id="credits" data-category="education"></ol>
  const credits = document.getElementById("credits");
  if (credits) {
    const cat = credits.dataset.category;
    credits.innerHTML = PERSONAS.filter(p => !cat || p.category === cat).map(p =>
      `<li>${esc(p.name)}: <a href="${p.credit.url}" target="_blank" rel="noopener">${esc(p.credit.title)}</a> by ${esc(p.credit.author)}, ${esc(p.credit.licence)}</li>`
    ).join("");
  }

  // Profile dialog
  if (!PERSONAS.length) return;
  const dlg = document.createElement("dialog");
  dlg.id = "persona-dlg";
  dlg.setAttribute("aria-labelledby", "dlg-title");
  document.body.appendChild(dlg);

  function open(id) {
    const p = byId[id], c = p.credit, i = order.findIndex(x => x.id === id);
    const appears = p.cases.map(k => `<a href="${caseHref(k)}">${esc(CASES[k].short)}</a>`).join(" · ");
    dlg.style.setProperty("--c", color(p));
    dlg.innerHTML = `<div class="pf">
      <aside class="pf-side">
        <img src="${img(p)}" alt="Placeholder photo for ${esc(p.name)}" style="object-position:${p.pos}">
        <blockquote class="pf-quote">“${esc(p.quote)}”</blockquote>
        <details class="prompt"><summary>Image-generation prompt</summary><p>${esc(p.prompt)}</p></details>
        <div class="credit">Placeholder photo: <a href="${c.url}" target="_blank" rel="noopener">${esc(c.title)}</a> by ${esc(c.author)}, ${esc(c.licence)}, via Wikimedia Commons (cropped).</div>
      </aside>
      <section class="pf-main">
        <div class="pf-head">
          <div>
            <h2 id="dlg-title">${esc(p.name)}</h2>
            <p class="pf-tagline">${esc(p.tagline)} · ${p.age} · ${esc(p.where)}</p>
            <div class="tags">${tagsHTML(p, true)}</div>
            ${appears ? `<p class="appears">Appears in: ${appears}</p>` : ""}
          </div>
          <button class="close" aria-label="Close" data-close autofocus>×</button>
        </div>
        <div class="sections">
          <div class="sec"><h3>Background</h3>${list(p.background)}</div>
          <div class="sec"><h3>What ${p.pronoun === "she" ? "she’s" : p.pronoun === "he" ? "he’s" : "they’re"} looking for</h3>${list(p.looking)}</div>
          <div class="sec"><h3>Hopes &amp; dreams</h3>${list(p.hopes)}</div>
          <div class="sec"><h3>Worries &amp; fears</h3>${list(p.worries)}</div>
          <div class="sec wide"><h3>Their data and expertise</h3>${list(p.data)}</div>
          <div class="sec wide"><h3>A day in the life of ${esc(firstName(p))}</h3>${list(p.day)}</div>
        </div>
        <p class="grounded"><strong>Grounded in:</strong> ${esc(p.grounded)}</p>
        <div class="pf-nav">
          <button data-step="-1" ${i <= 0 ? "disabled" : ""}>← Previous</button>
          <button data-step="1" ${i < 0 || i >= order.length - 1 ? "disabled" : ""}>Next →</button>
          ${onBrowserPage ? "" : `<a href="${categoryHref(p.category)}" data-nav>See all ${esc(CATEGORIES[p.category].label.toLowerCase())} personas</a>`}
        </div>
      </section>
    </div>`;
    dlg.dataset.id = id;
    if (!dlg.open) dlg.showModal();
    dlg.querySelector(".pf-main").scrollTop = 0;
  }

  const step = d => {
    const next = order[order.findIndex(x => x.id === dlg.dataset.id) + d];
    if (next) open(next.id);
  };

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

  const hashId = decodeURIComponent(location.hash.slice(1));
  if (byId[hashId]) open(hashId);
})();
