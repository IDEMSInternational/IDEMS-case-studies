// Handles a feedback issue ("[feedback] …") when it is opened. Run by .github/workflows/feedback.yml.
// - Labels it "feedback".
// - If it is an update to earlier feedback by the same person ("follows" in its data) and that issue is still open,
//   copies it into the earlier issue as a comment and closes this one, so each person's feedback stays in one place.
// Issues are never turned into pull requests. The issue content is untrusted: it is only parsed, never executed.
const fs = require("fs");
const zlib = require("zlib");
const { execFileSync } = require("child_process");

const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
const issue = event.issue;
const repo = process.env.GITHUB_REPOSITORY;
const DRY = !!process.env.DRY_RUN;
const gh = (args, input) => DRY ? (console.log("gh", args.join(" "), input ? `\n${input}` : ""), "") : execFileSync("gh", args, { encoding: "utf8", input });

let payload = null;
const m = (issue.body || "").match(/```feedback-v1\s*\n([\s\S]*?)\n```/);
if (m) { try { payload = JSON.parse(zlib.inflateRawSync(Buffer.from(m[1].trim(), "base64url")).toString("utf8")); } catch (_) {} }

gh(["label", "create", "feedback", "--repo", repo, "--color", "FBCA04", "--description", "Feedback from the website", "--force"]);

const follows = payload && Number.isInteger(payload.follows) ? payload.follows : null;
if (follows) {
  let target = null;
  try { target = DRY ? JSON.parse(process.env.DRY_TARGET || "null") : JSON.parse(gh(["api", `repos/${repo}/issues/${follows}`])); } catch (_) {}
  const sameAuthor = target && target.user && target.user.login.toLowerCase() === issue.user.login.toLowerCase();
  if (target && target.state === "open" && /^\[feedback\]/.test(target.title) && sameAuthor) {
    gh(["issue", "comment", String(follows), "--repo", repo, "--body-file", "-"], `${issue.body}\n\n<sub>Sent as #${issue.number}.</sub>`);
    gh(["issue", "comment", String(issue.number), "--repo", repo, "--body-file", "-"], `✅ Added to #${follows}, so all of this feedback stays in one place. Closing this one.`);
    gh(["issue", "close", String(issue.number), "--repo", repo]);
    console.log(`Added #${issue.number} to #${follows}`);
    process.exit(0);
  }
}

gh(["issue", "edit", String(issue.number), "--repo", repo, "--add-label", "feedback"]);
gh(["issue", "comment", String(issue.number), "--repo", repo, "--body-file", "-"],
  `Thank you for your feedback! The team will look at it, and it stays open here until they have.${follows ? `\n\n_This couldn't be added to #${follows} (it may have been closed), so it starts new feedback._` : ""}\n\nTo add more, use the 💬 Feedback and comments button on the page again: it will be added here.`);
console.log(`Labelled #${issue.number}`);
