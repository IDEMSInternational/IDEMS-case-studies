// Persona cards and profile dialog for the case-study pages. Needs personas-data.js loaded first.
(function () {
  const byId = Object.fromEntries(PERSONAS.map(p => [p.id, p]));
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const list = items => `<ul>${items.map(i => `<li>${esc(i)}</li>`).join("")}</ul>`;
  const firstName = p => p.name.replace(/^(Dr|Prof|Mr|Mrs|Ms)\.\s*/, "").split(" ")[0];

  // Fill persona cards and quote citations.
  document.querySelectorAll("a.pcard[data-p]").forEach(a => {
    const p = byId[a.dataset.p]; if (!p) return;
    a.href = "index.html#" + p.id;
    a.style.setProperty("--c", GROUPS[p.group].color);
    a.innerHTML = `<img src="images/${p.id}.jpg" alt="" style="object-position:${p.pos}"><span><b>${esc(p.name)}</b><i>${esc(p.tagline)} · ${esc(p.where)}</i></span>`;
  });
  document.querySelectorAll("cite[data-p]").forEach(c => {
    const p = byId[c.dataset.p]; if (!p) return;
    c.innerHTML = `<a href="index.html#${p.id}">${esc(p.name)}, ${esc(p.tagline)}</a> (fictional persona)`;
  });

  // Personas in order of first appearance on this page, for previous/next.
  const order = [];
  document.querySelectorAll('a[href^="index.html#p"]').forEach(a => {
    const id = a.getAttribute("href").split("#")[1];
    if (byId[id] && !order.includes(id)) order.push(id);
  });

  const dlg = document.createElement("dialog");
  dlg.id = "persona-dlg";
  dlg.setAttribute("aria-labelledby", "dlg-title");
  document.body.appendChild(dlg);

  function tags(p) {
    let t = `<span class="tag" style="--c:${GROUPS[p.group].color}">${GROUPS[p.group].label}</span>`;
    t += `<span class="tag" style="--c:var(--muted)">${CONTEXTS[p.context]}</span>`;
    if (p.tvet) t += `<span class="tag" style="--c:var(--muted)">TVET</span>`;
    return t;
  }

  function open(id) {
    const p = byId[id], c = CREDITS[id], i = order.indexOf(id);
    dlg.style.setProperty("--c", GROUPS[p.group].color);
    dlg.innerHTML = `<div class="pf">
      <aside class="pf-side">
        <img src="images/${p.id}.jpg" alt="Placeholder photo for ${esc(p.name)}" style="object-position:${p.pos}">
        <blockquote class="pf-quote">“${esc(p.quote)}”</blockquote>
        <div class="credit">Placeholder photo: <a href="${c[2]}" target="_blank" rel="noopener">${esc(c[0])}</a> by ${esc(c[1])}, ${lic(c)}, via Wikimedia Commons (cropped).</div>
      </aside>
      <section class="pf-main">
        <div class="pf-head">
          <div>
            <h2 id="dlg-title">${esc(p.name)}</h2>
            <p class="pf-tagline">${esc(p.tagline)} · ${p.age} · ${esc(p.where)}</p>
            <div class="tags">${tags(p)}</div>
          </div>
          <button class="close" aria-label="Close" data-close autofocus>×</button>
        </div>
        <div class="sections">
          <div class="sec"><h3>Background</h3>${list(p.background)}</div>
          <div class="sec"><h3>What ${FEMALE.has(p.id) ? "she’s" : "he’s"} looking for</h3>${list(p.looking)}</div>
          <div class="sec"><h3>Hopes &amp; dreams</h3>${list(p.hopes)}</div>
          <div class="sec"><h3>Worries &amp; fears</h3>${list(p.worries)}</div>
          <div class="sec wide"><h3>A day in the life of ${esc(firstName(p))}</h3>${list(p.day)}</div>
        </div>
        <p class="grounded"><strong>Grounded in:</strong> ${esc(p.grounded)}</p>
        <div class="pf-nav">
          <button data-step="-1" ${i <= 0 ? "disabled" : ""}>← Previous</button>
          <button data-step="1" ${i >= order.length - 1 ? "disabled" : ""}>Next →</button>
          <a href="index.html#${p.id}">See all personas</a>
        </div>
      </section>
    </div>`;
    dlg.dataset.id = id;
    if (!dlg.open) dlg.showModal();
    dlg.querySelector(".pf-main").scrollTop = 0;
  }

  const step = d => {
    const next = order[order.indexOf(dlg.dataset.id) + d];
    if (next) open(next);
  };

  document.addEventListener("click", e => {
    const a = e.target.closest('a[href^="index.html#p"]');
    if (!a || dlg.contains(a)) return;
    const id = a.getAttribute("href").split("#")[1];
    if (!byId[id] || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    open(id);
  });
  dlg.addEventListener("click", e => {
    if (e.target === dlg || e.target.closest("[data-close]")) return dlg.close();
    const b = e.target.closest("[data-step]");
    if (b && !b.disabled) step(Number(b.dataset.step));
  });
  document.addEventListener("keydown", e => {
    if (!dlg.open) return;
    if (e.key === "ArrowRight") step(1);
    if (e.key === "ArrowLeft") step(-1);
  });

  if (byId[location.hash.slice(1)]) open(location.hash.slice(1));
  try { const t = localStorage.getItem("persona-theme"); if (t) document.documentElement.dataset.theme = t; } catch (_) {}
})();
