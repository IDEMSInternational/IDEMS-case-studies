// Google Apps Script web app that turns anonymous feedback from the website into GitHub issues.
// Setup: see tools/apps-script/README.md. Script property GITHUB_TOKEN must hold a GitHub token that can create
// issues and comments on the repository below.
//
// Request (POST, JSON text): { title, body, follows?, key?, website }
//   - new feedback: creates an issue labelled "feedback" and returns { issue, key }. The key lets the same person add
//     to that issue later (it is the secret part of their private link); only its hash is stored here.
//   - follows + key: adds the body as a comment on that issue and returns { issue }.
// "website" is a honeypot field that real visitors never fill in.

const REPO = "IDEMSInternational/IDEMS-case-studies";
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

    if (req.follows) {
      const n = Number(req.follows);
      const stored = props.getProperty("key:" + n);
      if (!stored || !req.key || stored !== hash(String(req.key))) return reply({ error: "this private link is not valid" });
      github("post", `/repos/${REPO}/issues/${n}/comments`, { body: req.body });
      return reply({ issue: n });
    }

    const issue = github("post", `/repos/${REPO}/issues`, { title: req.title.slice(0, 200), body: req.body, labels: ["feedback"] });
    const key = Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "").slice(0, 8);
    props.setProperty("key:" + issue.number, hash(key));
    return reply({ issue: issue.number, key: key });
  } catch (err) {
    return reply({ error: "something went wrong" });
  }
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
