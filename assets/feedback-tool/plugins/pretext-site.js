// The feedback tool's site plug-in for PreTeXt books (see tool.js for what a site plug-in provides). A site loads it
// with FeedbackTool.init({ ..., site: "<URL of this file>" }).
// People comment on the parts PreTeXt gives a permalink to: paragraphs, list items, figures, tables, exercises and
// their hints and answers, notes, and sections (through their headings). Each part's key, stored with comments:
//   - its svc-id, on a page built with svc's id layer, which gives each part a data-svc-id attribute;
//   - otherwise its id. PreTeXt uses the source's xml:id where there is one, so a comment stays with its part when the
//     text around it changes. Parts without an xml:id get an id from their position, which can shift.
// Proposed edits are shown with a forge plug-in that lists pull requests (svc's forgejo.js).
(function () {
  const T = window.FeedbackTool;
  const SVC = !!document.querySelector("[data-svc-id]");
  const keyAttr = SVC ? "data-svc-id" : "id";
  // A part's permalink sits directly inside it, in its caption (a figure or table), or in its contents (a hint,
  // answer or note that opens). What a cross-reference shows when opened is a copy, in a knowl's contents outside a
  // details element: it's left out, as are any ids inside it.
  const COPY = ":not(details) > .knowl__content *";
  const PART = (SVC ? "[data-svc-id]" : ":is([id]:has(> .autopermalink), figure[id]:has(> figcaption > .autopermalink), details[id]:has(> * > .autopermalink))") + `:not(${COPY})`;
  // A section is commented on through its heading, so its cards go after the heading rather than after the whole
  // section, and pointing at the gap between two of its paragraphs doesn't select the section.
  const HEADING = ":is(.heading, h1, h2, h3, h4, h5, h6)";
  const TARGETS = `${PART}:not(section), section${PART} > ${HEADING}`;
  const nodeOf = el => el.closest(PART);                 // the part a target stands for
  const keyOf = el => nodeOf(el).getAttribute(keyAttr);
  const partFor = key => {
    const el = SVC ? document.querySelector(`[data-svc-id="${CSS.escape(key)}"]`) : document.getElementById(key);
    if (!el || el.matches(PART)) return el;
    // A copy came first (a cross-reference opened above the part): look past it.
    return [...document.querySelectorAll(`[${keyAttr}="${CSS.escape(key)}"]`)].find(x => x.matches(PART)) || null;
  };
  const elFor = key => { const el = partFor(key); return el && el.tagName === "SECTION" ? el.querySelector(`:scope > ${HEADING}`) : el; };

  // Each permalink's data-description names its part: "Table 15.8", "Subsection 15.7.2: Additional comments", or just
  // "Paragraph" for parts without a number.
  const describe = node => {
    const a = [...node.querySelectorAll(":scope > .autopermalink, :scope > * > .autopermalink")]
      .find(x => { const link = x.querySelector("a"); return link && link.getAttribute("href") === `#${node.id}`; });
    return a ? a.dataset.description || "" : "";
  };
  const NAMES = { para: "Paragraph", li: "Item", blockquote: "Quotation", figure: "Figure", table: "Table", remark: "Remark", introduction: "Introduction", conclusion: "Conclusion" };
  const kindOf = node => describe(node).replace(/[\s\d.:].*$/, "") || NAMES[node.classList[0]] || NAMES[node.tagName.toLowerCase()] || node.classList[0] || node.tagName.toLowerCase();
  const cut = (s, n) => s.length > n ? s.slice(0, n - 1) + "…" : s;
  // PreTeXt's number in a description, before any title ("Part 2" in "Paragraphs: Part 2" is a title).
  const numberIn = d => (d.split(":")[0].match(/\d[\d.]*\d|\d/) || [])[0];
  // "Table 15.8" or "Item: Strand"; for a part with neither a number nor a title, the number of what it's in:
  // "Paragraph in 15.1", or "Paragraph in Item 2" where the number is only a list's.
  function labelFor(key) {
    const node = partFor(key); if (!node) return "a part of this page";
    const d = describe(node);
    if (numberIn(d) || d.includes(":")) return cut(d, 70);
    for (let p = node.parentElement && node.parentElement.closest("[id]"); p; p = p.parentElement && p.parentElement.closest("[id]")) {
      const pd = describe(p), n = numberIn(pd);
      if (n) return `${kindOf(node)} in ${n.includes(".") ? n : pd.split(":")[0]}`;
    }
    return `${kindOf(node)} in ${cut(pageTitle(), 50)}`;
  }
  const pageTitle = () => document.title;

  // ---------- Proposed edits ----------
  // Open edit pull requests that change a part of this page, from a forge plug-in that lists them (svc's forgejo.js,
  // from open.json). Each change is a part's new PreTeXt source, under its svc-id.
  async function listEdits() {
    if (!T.forge.pulls) return [];
    const onPage = pr => (pr.edits || []).some(e => elFor(e.svc_id)) || T.onThisPage(pr.body);
    // A pull request may name its repository (repo), when the forge lists them from several: then it is that and its
    // number.
    return (await T.forge.pulls()).filter(onPage).map(pr => ({
      key: `pr-${pr.repo ? `${pr.repo}#` : ""}${pr.number}`, kind: "edit", number: pr.number, repo: pr.repo, url: pr.url, updated: pr.updated,
      title: pr.title.replace(/^\[(?:translation-)?edit\]\s*/, "").replace(/^[^:]*:\s*/, ""), author: `@${pr.user}`,
      cards: (pr.edits || []).map((e, i) => ({ id: `pr${pr.repo ? `${pr.repo}#` : ""}${pr.number}-${i}`, target: e.svc_id, issue: pr.number, url: pr.url, author: `@${pr.user}`,
        change: { field: "source", old: e.old_xml, new: e.new_xml } })),
    }));
  }

  // Also window.PreTeXtFeedbackSite, for svc's pretext-editor.js, which names parts the same way.
  T.register("site", window.PreTeXtFeedbackSite = {
    targets: TARGETS, keyOf, elFor, labelFor, pageTitle,
    ignore: ".autopermalink, .ptx-masthead, .ptx-navbar, .ptx-sidebar, .ptx-page-footer, .ptx-toc, .svc-ed-stack, .svc-ed-float",
    // Source keeps its line breaks on proposed-edit cards; other text loses PreTeXt's tags.
    plain: s => String(s ?? "").trim(),
    fieldName: f => f === "source" ? "New PreTeXt source" : f,
    proposedEdits: { list: listEdits, cards: it => Promise.resolve(it.cards) },
  });
})();
