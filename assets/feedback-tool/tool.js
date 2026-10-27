// Feedback tool: the 💬 button, the entry dialog and the helpers shared by feedback mode and the editor. Nothing in
// this folder knows about this site's content; the site describes itself through a plug-in.
// Every page loads this file (and feedback.css) before its own script, which starts the tool once its content is on
// the page:
//
//   FeedbackTool.init({
//     repository:       "owner/name" of the public GitHub repository that receives feedback as issues
//     root:             optional: URL of the site's home page folder, so pages are recognised whatever their address
//                       (default: the domain's root)
//     feedbackEndpoint: optional: web app that creates issues for anonymous feedback (tools/apps-script/)
//     feedbackBot:      optional: the GitHub account that web app posts as
//     site:             URL of the site plug-in (below)
//     editors, editor:  optional, together: URL of the hashed usernames of contributors (tools/sync-editors.js), and
//                       URL of the site's editor, started for contributors instead of feedback mode. Without them,
//                       everyone gets feedback mode and nothing mentions editing.
//     showOpenFeedback: optional: true adds a button to the feedback bar that shows everyone else's open feedback on
//                       the page (contributors can always see it from the editor)
//     markers:          optional: true shows a 💬 beside every part that can be commented on, for touch screens;
//                       "touch" shows them only on devices whose main pointer is a finger. Markers go in the right
//                       margin, or inside a part's top right corner where there's no margin; the page has the class
//                       fb-with-markers meanwhile, so a site can make room for them
//   })
//
// Plug-ins are loaded when first needed and register themselves with FeedbackTool.register(name, plugin).
// The site plug-in ("site") says what can be commented on:
//   targets           CSS selector for the parts of a page people can comment on
//   keyOf(el)         a permanent key for a target element, stored with the comment
//   elFor(key)        the element for a key on the page as it is now, or null
//   labelFor(key)     a readable name for a key, used in the comment form and in issues
//   pageTitle()       the page's name, used in issue titles
//   ignore            optional: selector for the site's own controls, where no 💬 buttons appear
//   plain(text)       optional: text without the site's markup, for short snippets
//   isOnPage(key)     optional: whether a key belongs to this page even when not shown, e.g. inside a closed dialog
//   typeName(type), fieldName(field)  optional: words used on proposed-edit cards
//   proposedEdits     optional: { list(), cards(item) }: open pull requests, shown next to the parts they change
// The site calls FeedbackTool.refresh() after it redraws part of the page, so comments are put back in place.
// The editor plug-in ("editor") has start(username).
(function () {
  const BASE = new URL(".", document.currentScript.src).href;
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const clone = x => JSON.parse(JSON.stringify(x));
  let config = null, apiBase = null; // apiBase: GitHub API URL of the repository

  // ---------- Plug-ins ----------
  const plugins = {}, loading = {};
  const register = (name, plugin) => { plugins[name] = plugin; };
  // A script that loads but doesn't register (because it threw first) counts as a failure, like one that doesn't
  // load at all; either way the next attempt adds a fresh script element.
  function load(name) {
    if (plugins[name]) return Promise.resolve(plugins[name]);
    if (!loading[name]) loading[name] = new Promise((ok, no) => {
      const sc = document.createElement("script");
      sc.src = name === "feedback" ? BASE + "feedback.js" : config[name];
      const fail = why => { sc.remove(); no(new Error(`${sc.src} ${why}`)); };
      sc.onload = () => plugins[name] ? ok(plugins[name]) : fail(`loaded but did not register "${name}"`);
      sc.onerror = () => fail("could not be loaded");
      document.body.appendChild(sc);
    }).finally(() => { delete loading[name]; });
    return loading[name];
  }
  const loadError = err => { console.error(err); alert("This couldn't be loaded. Please check your connection and try again."); };
  // Feedback mode is made for the site plug-in once both are loaded.
  let feedbackMode = null;
  const feedback = () => feedbackMode ? Promise.resolve(feedbackMode) :
    Promise.all([load("site"), load("feedback")]).then(([site, make]) => feedbackMode || (feedbackMode = make(site)));
  const refresh = () => { if (feedbackMode) feedbackMode.refresh(); };

  // ---------- Shared helpers ----------
  // The payload in an issue's "technical details" block: deflate-raw compressed JSON in base64url.
  async function compress(obj) {
    const json = JSON.stringify(obj);
    const bytes = new Uint8Array(await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
    let bin = ""; bytes.forEach(b => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  async function decompress(b64) {
    const bin = atob(b64.trim().replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    return JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text());
  }
  const plain = s => String(s ?? "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*`]/g, "").replace(/\s+/g, " ").trim();
  const ghJSON = async url => { const r = await fetch(url, { cache: "no-store" }); if (!r.ok) throw new Error(r.status); return r.json(); };
  const issueURL = n => `https://github.com/${config.repository}/issues/${n}`;
  // A link to GitHub's "new issue" page, filled in. Text too long for a link is copied instead, and the link carries
  // `placeholder`, asking the person to paste it.
  function newIssueLink(title, body, placeholder) {
    const base = `https://github.com/${config.repository}/issues/new`;
    let url = `${base}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`, pasted = false;
    if (url.length > 6000) { pasted = true; try { navigator.clipboard.writeText(body); } catch (_) {} url = `${base}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(placeholder)}`; }
    return { url, pasted };
  }
  // ---------- Which page? ----------
  // A page's key is the same at every address of the page: its path relative to the site's home (the root option),
  // without "index.html", ".html" or a trailing slash, e.g. "education/textbooks"; the home page's key is "".
  let siteBase = "/";   // path of the site's home folder
  const relative = p => (p.startsWith(siteBase) ? p.slice(siteBase.length) : p).replace(/^\//, "");
  const pageKey = p => relative(p).replace(/(^|\/)index\.html$/, "$1").replace(/\.html$/, "").replace(/\/$/, "");
  const here = () => pageKey(location.pathname);
  // This page's path relative to the site's home, as written in issues ("education/index.html").
  const pagePath = () => { const p = relative(location.pathname); return !p || p.endsWith("/") ? p + "index.html" : p; };

  // Issues (and the pull requests made from them) name their page in a "Page:" line: its relative path, linked to the
  // page, e.g. "Page: [education/index.html](https://…/education/)".
  const pageLine = () => `Page: [${pagePath()}](${location.origin}${location.pathname})`;
  // The page an issue's or pull request's text names (its last "Page:" line), or null.
  function pageOf(text) {
    const lines = [...String(text || "").matchAll(/^Page: *(?:\[([^\]\n]+)\]\([^)\n]*\)|(\S+)) *$/gm)];
    return lines.length ? lines[lines.length - 1][1] || lines[lines.length - 1][2] : null;
  }
  // Older issues give the page's absolute path on the host they were written on ("Page: /IDEMS-case-studies/education/"
  // on GitHub Pages, "Page: /education/" on a local server). Those also count when they end with this page's key, so
  // they are found on either host. The home page has to match exactly, or a host's folder would count as every page.
  function onThisPage(text) {
    const p = pageOf(text); if (p === null) return false;
    const key = pageKey(p), mine = here();
    return key === mine || (p.startsWith("/") && mine !== "" && key.endsWith("/" + mine));
  }

  // The localStorage key for unsent work on this page, the same at every address of the page:
  // `${prefix}page:${key}${suffix}`. Work saved before used the address instead (`${prefix}/…${suffix}`); it is moved
  // to the new key the first time that is asked for (the entry for this exact address first, then any other).
  function pageStorageKey(prefix, suffix = "") {
    const key = `${prefix}page:${here()}${suffix}`;
    try {
      if (localStorage.getItem(key) === null) {
        const exact = `${prefix}${location.pathname}${suffix}`, old = localStorage.getItem(exact) !== null ? exact :
          Object.keys(localStorage).find(k => k.startsWith(prefix + "/") && k.endsWith(suffix) && pageKey(k.slice(prefix.length, k.length - suffix.length)) === here());
        if (old) { localStorage.setItem(key, localStorage.getItem(old)); localStorage.removeItem(old); }
      }
    } catch (_) {}
    return key;
  }

  // The issue `user` has just created for this page, with a title starting with `prefix` (GitHub's public API; it
  // may take a moment to appear).
  async function findIssue({ user, prefix, since }) {
    for (let i = 0; i < 8; i++) {
      try {
        const list = await ghJSON(`${apiBase}/issues?creator=${encodeURIComponent(user)}&state=open&sort=created&direction=desc&per_page=10`);
        const hit = list.find(x => !x.pull_request && x.title.startsWith(prefix) && !/update to #\d+/.test(x.title)
          && onThisPage(x.body) && Date.parse(x.created_at) > since - 120000);
        if (hit) return hit.number;
      } catch (_) {}
      await new Promise(r => setTimeout(r, 4000));
    }
    return null;
  }

  // ---------- Who is it? ----------
  // Asks for the person's GitHub username and checks whether it is a contributor's, using a list of hashes of the
  // contributors' usernames (so the list can't be read from the site). This is a convenience check: the real check
  // happens when changes are submitted, against the account that creates the GitHub issue. Everyone else, with a
  // GitHub account or anonymously, goes into feedback mode.
  const USER_KEY = "editor-github", ID_KEY = "fb-identity";
  async function loadEditors() {
    try { const r = await fetch(config.editors + "?t=" + Date.now()); return r.ok ? new Set((await r.json()).hashes || []) : null; }
    catch (_) { return null; }
  }
  async function hashName(name) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(name).toLowerCase()));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
  }
  const isEditor = async (set, name) => set.has(await hashName(name));
  const canEdit = () => !!(config.editors && config.editor);
  function gate() {
    return new Promise(async resolve => {
      // Private link to continue anonymous feedback: #fb=<issue>-<key>
      const pl = location.hash.match(/^#fb=(\d+)-([0-9a-f]+)$/);
      if (pl) return resolve({ mode: "feedback", via: "anon", recover: { issue: +pl[1], key: pl[2] } });
      // If the list of contributors can't be loaded, nobody can edit just now, but everyone can still leave feedback.
      const list = canEdit() ? await loadEditors() : new Set(), unchecked = !list, editors = list || new Set();
      let remembered = null, rememberedId = null;
      try { remembered = localStorage.getItem(USER_KEY); rememberedId = JSON.parse(localStorage.getItem(ID_KEY) || "null"); } catch (_) {}
      if (remembered && await isEditor(editors, remembered)) return resolve({ mode: "edit", user: remembered });
      // A contributor who couldn't be checked sees the dialog, which says why editing isn't available.
      if (rememberedId && !(remembered && unchecked) && (rememberedId.via === "github" || config.feedbackEndpoint)) return resolve({ mode: "feedback", ...rememberedId });
      const endpoint = config.feedbackEndpoint;
      const dlg = document.createElement("dialog");
      dlg.className = "fb-dialog fb-gate";
      const ask = (msg = "") => {
        dlg.innerHTML = `<h2>Feedback and comments</h2>
          <p>Comment on any part of this page: a section, a single item or a few selected words.${canEdit() ? " People on the team can also edit the page directly." : ""}</p>${unchecked ? `
          <p class="fb-gate-msg">Editing isn't available just now, because the list of people who can edit couldn't be loaded. You can still leave feedback.</p>` : ""}
          <form method="dialog" class="fb-choice"><h3>With your GitHub account</h3>
            <label class="fb-field">GitHub username<input type="text" name="u" autocomplete="username" spellcheck="false" placeholder="e.g. jane-doe" value="${esc(remembered || (rememberedId && rememberedId.user) || "")}"></label>
            ${msg ? `<p class="fb-gate-msg">${msg}</p>` : ""}
            <p class="fb-explain">Tip: <a href="https://github.com/login" target="_blank" rel="noopener">log in to GitHub</a> in this browser first, so sending is one click. No account? <a href="https://github.com/signup" target="_blank" rel="noopener">Create one for free</a>.</p>
            <div class="fb-buttons"><button type="submit" class="primary">Continue with GitHub</button></div></form>
          <div class="fb-choice"><h3>Without an account</h3>
            ${endpoint ? `<label class="fb-field">Your name <span>(optional)</span><input type="text" name="n" autocomplete="name" placeholder="Leave empty to stay anonymous"></label>
              <div class="fb-buttons"><button type="button" data-g="anon">Continue anonymously</button></div>`
              : `<p class="fb-explain">Anonymous feedback is coming soon. For now, please use a GitHub account.</p>`}</div>
          <p class="fb-explain">Feedback is published on this site's public GitHub repository.</p>
          <div class="fb-buttons"><button type="button" data-g="cancel">Cancel</button></div>`;
        const input = dlg.querySelector("input[name=u]"); input.focus(); input.select();
      };
      const remember = id => { try { localStorage.setItem(ID_KEY, JSON.stringify(id)); } catch (_) {} };
      dlg.addEventListener("click", e => {
        const b = e.target.closest("[data-g]"); if (!b) return;
        if (b.dataset.g === "cancel") { (dlg.close(), dlg.remove()); resolve(null); }
        if (b.dataset.g === "anon") {
          const id = { via: "anon", name: (dlg.querySelector("input[name=n]").value || "").trim().slice(0, 80) };
          remember(id); (dlg.close(), dlg.remove()); resolve({ mode: "feedback", ...id });
        }
      });
      dlg.addEventListener("submit", async e => {
        e.preventDefault();
        const name = dlg.querySelector("input[name=u]").value.trim().replace(/^@/, "");
        if (!name) return ask("Please enter your GitHub username.");
        if (await isEditor(editors, name)) { try { localStorage.setItem(USER_KEY, name); } catch (_) {} (dlg.close(), dlg.remove()); return resolve({ mode: "edit", user: name }); }
        // Catch typos: check that the account exists (GitHub's public API; if it can't be reached, skip this check).
        try {
          const r = await fetch("https://api.github.com/users/" + encodeURIComponent(name));
          if (r.status === 404) return ask(`There's no GitHub account called “${esc(name)}”. Please check the spelling.`);
        } catch (_) {}
        const id = { via: "github", user: name };
        remember(id); (dlg.close(), dlg.remove()); resolve({ mode: "feedback", ...id });
      });
      dlg.addEventListener("cancel", () => resolve(null));
      dlg.addEventListener("close", () => dlg.remove());
      document.body.appendChild(dlg);
      dlg.showModal();
      ask();
    });
  }
  function signOut() { try { localStorage.removeItem(USER_KEY); localStorage.removeItem(ID_KEY); } catch (_) {} location.reload(); }

  // ---------- The button ----------
  let fab = null, starting = false, started = false;
  // If the chosen mode can't be loaded, the button stays, so the person can try again.
  async function open() {
    if (starting || started) return;
    starting = true;
    try {
      const who = await gate();
      if (!who) return;
      const mode = who.mode === "edit" ? await load("editor") : await feedback();
      started = true;
      fab.hidden = true;
      mode.start(who.mode === "edit" ? who.user : who);
    } catch (err) { loadError(err); }
    finally { starting = false; }
  }
  function init(options) {
    config = options;
    apiBase = `https://api.github.com/repos/${config.repository}`;
    siteBase = new URL(".", new URL(config.root || "/", location.href)).pathname;
    fab = document.createElement("button");
    fab.className = "fb-fab";
    fab.type = "button";
    fab.textContent = "💬 Feedback and comments";
    fab.title = canEdit() ? "Comment on this page, or suggest changes if you are on the team" : "Comment on this page";
    fab.addEventListener("click", open);
    document.body.appendChild(fab);
    // Links ending in ?edit (or ?feedback) open it straight away; #fb=<issue>-<key> is a private link to continue
    // anonymous feedback.
    const q = new URLSearchParams(location.search);
    if (q.has("edit") || q.has("feedback") || location.hash.startsWith("#fb=")) fab.click();
  }

  window.FeedbackTool = {
    init, register, feedback, refresh, signOut, loadError,
    get config() { return config; }, get api() { return apiBase; },
    esc, clone, plain, compress, decompress, ghJSON, issueURL, newIssueLink, findIssue, pagePath, pageLine, pageOf, onThisPage, pageStorageKey,
  };
})();
