# Anonymous feedback: Google Apps Script setup

Anonymous visitors can't create GitHub issues themselves, so the website sends their feedback to a small Google Apps Script web app, which creates the issue on their behalf. It runs on Google's servers for free; there is nothing to host or maintain. Setting it up takes about 10 minutes and needs no GitHub admin rights.

Until it is set up, the "Without an account" option on the site says that anonymous feedback is coming soon.

## 1. Choose the GitHub account the issues will come from

Anonymous issues will show as opened by this account. A separate free account (for example `idems-feedback-bot`) keeps them apart from your own activity, but your own account works too.

## 2. Create a GitHub token for that account

Signed in as that account on GitHub: **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.

- **Resource owner:** IDEMSInternational. Note: the IDEMSInternational organisation holds fine-grained tokens for admin approval (they show as "Pending" and the script fails with "something went wrong"). Without an admin, use a **Tokens (classic)** token with only the `public_repo` scope instead, which public repositories accept straight away (that is what is set up now).
- **Repository access:** only the repository that receives the feedback (`IDEMS-case-studies` for this site).
- **Permissions:** Issues: **Read and write**.
- **Expiration:** pick a date and put a reminder in your calendar to renew it.

Copy the token; you'll paste it in step 4.

## 3. Create the script

1. Go to [script.google.com](https://script.google.com) and click **New project**. Name it, for example, "IDEMS case studies feedback".
2. Replace the contents of `Code.gs` with the contents of [`Code.gs`](Code.gs) from this folder, and save.

## 4. Store the token

In the script editor: **Project Settings** (gear icon) → **Script properties** → **Add script property**.

- Property: `GITHUB_TOKEN`
- Value: the token from step 2

For a repository other than this one, also add `GITHUB_REPOSITORY` with its `owner/name`, and check that the token from step 2 can write issues there. Each repository needs its own deployment: private links only work on the repository they were made for, so pointing an existing deployment at another repository breaks the links people already have.

## 5. Deploy it as a web app

1. **Deploy → New deployment**, choose type **Web app**.
2. **Execute as:** Me. **Who has access:** Anyone.
3. Click **Deploy**, authorise when asked (Google warns that the app is unverified, because it's your own script: choose *Advanced → Go to … (unsafe)*), and copy the **Web app URL**.

## 6. Connect the website

In `content/site.json` set:

- `feedbackEndpoint` to the Web app URL from step 5
- `feedbackBot` to the GitHub username from step 1 (the site uses it to recognise comments written on behalf of anonymous visitors)

Commit the change (or ask Claude to). The "Continue anonymously" option appears on the site straight away.

## Updating the script later

After changing `Code.gs`, use **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy**. The URL stays the same. Until then, the web app keeps running the previous version.

## How it protects against misuse

- Each anonymous thread has a secret key, which is part of the visitor's private link. Only the hash of the key is stored in the script, under the repository and issue number, and adding to a thread requires the key.
- A hidden "honeypot" field catches simple bots, and the script accepts at most 30 submissions every 10 minutes.
- The token can only touch issues on the one repository it is set up for.
