// Google Apps Script web app that turns anonymous feedback from the website into GitHub issues.
// Setup: see tools/apps-script/README.md. Script property GITHUB_TOKEN must hold a GitHub token that can create
// issues and comments on the repositories it serves, which are:
//   - GITHUB_REPOSITORIES: "owner/name" of each, comma-separated, for a site whose feedback goes to several (the
//     tool's topics option, e.g. a translated book's content and its translation);
//   - otherwise GITHUB_REPOSITORY ("owner/name"), or DEFAULT_REPO below.
// Use one deployment per site.
//
// Request (POST, JSON text): { repository?, title, body, follows?, key?, website }
//   - repository: "owner/name", one of those above. Without it, the request is for the only one, and refused if there
//     are several.
//   - new feedback: creates an issue labelled "feedback" and returns { issue, key }. The key lets the same person add
//     to that issue later (it is the secret part of their private link); only its hash is stored here.
//   - follows + key: adds the body as a comment on that issue and returns { issue }.
// Keys are stored per repository ("key:<owner/name>:<issue>"), so a key only works on the issue it was made for, even
// if GITHUB_REPOSITORY changes. Keys stored before that ("key:<issue>") were all made for DEFAULT_REPO.
// "website" is a honeypot field that real visitors never fill in.

const DEFAULT_REPO = "IDEMSInternational/IDEMS-case-studies";
const MAX_BODY = 60000;
const MAX_PER_10_MIN = 30;

function doPost(e) {
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    if (req.website) return reply({ issue: 0 });                       // bot filled in the honeypot: pretend success
    if (typeof req.title !== "string" || typeof req.body !== "string" || !req.title.startsWith("[feedback]")) return reply({ error: "invalid request" });
    if (req.body.length > MAX_BODY) return reply({ error: "feedback too long" });
    if (!withinRateLimit()) return reply({ error: "too many submissions just now, please try again in a few minutes" });
    const props = PropertiesService.getScriptProperties();
    const repo = chooseRepository(req.repository, repositories(props));
    if (!repo) return reply({ error: "this site can't send feedback to that repository" });
    const keyName = n => `key:${repo}:${n}`;

    if (req.follows) {
      const n = Number(req.follows);
      const stored = props.getProperty(keyName(n)) || (repo === DEFAULT_REPO ? props.getProperty("key:" + n) : null);
      if (!stored || !req.key || stored !== hash(String(req.key))) return reply({ error: "this private link is not valid" });
      github("post", `/repos/${repo}/issues/${n}/comments`, { body: req.body });
      return reply({ issue: n });
    }

    const issue = github("post", `/repos/${repo}/issues`, { title: req.title.slice(0, 200), body: req.body, labels: ["feedback"] });
    const key = Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "").slice(0, 8);
    props.setProperty(keyName(issue.number), hash(key));
    return reply({ issue: issue.number, key: key });
  } catch (err) {
    return reply({ error: "something went wrong" });
  }
}

// The repositories this web app may open issues on, as they were written.
function repositories(props) {
  const list = props.getProperty("GITHUB_REPOSITORIES") || props.getProperty("GITHUB_REPOSITORY") || DEFAULT_REPO;
  return list.split(",").map(s => s.trim()).filter(Boolean);
}

// The allowed repository a request names (compared without regard to case), or the only one when it names none;
// otherwise null.
function chooseRepository(asked, allowed) {
  if (asked === undefined || asked === null || asked === "") return allowed.length === 1 ? allowed[0] : null;
  if (typeof asked !== "string") return null;
  return allowed.find(r => r.toLowerCase() === asked.trim().toLowerCase()) || null;
}

function github(method, path, payload) {
  const token = PropertiesService.getScriptProperties().getProperty("GITHUB_TOKEN");
  const res = UrlFetchApp.fetch("https://api.github.com" + path, {
    method: method,
    contentType: "application/json",
    headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json" },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 300) throw new Error("GitHub " + res.getResponseCode() + ": " + res.getContentText());
  return JSON.parse(res.getContentText());
}

function withinRateLimit() {
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get("count") || 0);
  if (n >= MAX_PER_10_MIN) return false;
  cache.put("count", String(n + 1), 600);
  return true;
}

function hash(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s).map(b => ((b + 256) % 256).toString(16).padStart(2, "0")).join("");
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
