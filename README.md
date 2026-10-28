# IDEMS case studies

Case studies and personas from IDEMS' work, by category: Parenting, Education and Climate. Education (STACK) has content; Parenting and Climate are placeholders for now.

All content is data: everything you read on the site lives in JSON files in `content/`, and the HTML pages are empty shells that `assets/site.js` fills in. There is no build step. Because pages load their content with `fetch`, preview them through a local web server rather than by opening the files directly, for example `python -m http.server` in the repository folder, then visit http://localhost:8000.

## Structure

| Path | What it is |
|---|---|
| `content/site.json` | Site-wide text: title, status line, notes shown on the home and case-study pages |
| `content/categories.json` | The categories in order: label, colour, page text (lede, notes, sources), persona sets and the case studies in reading order |
| `content/<category>/personas.json` | That category's personas |
| `content/<category>/case-studies/<id>.json` | One case study: title, standfirst, note, stats and sections made of blocks |
| `access/editors.json` | Generated: hashes of the usernames of the repository's direct collaborators, used by the editor's sign-in check |
| `content/references.json` | Every source once, with its fields (authors, year, title, URL…); the site formats them in APA |
| `index.html`, `<category>/index.html`, `<category>/<case>.html` | Page shells: `<body data-page="home|category|case" …>` |
| `assets/site.js` | Renders every page from the JSON: navigation, persona browser and dialog, case studies, citations and reference lists |
| `assets/site.css`, `assets/case.css` | Shared styles; `case.css` adds article typography for case-study pages |
| `images/<persona-id>.jpg` | One photo per persona |
| `assets/feedback-tool/` | The feedback tool, which knows nothing about this site's content: the 💬 button and entry dialog (`tool.js`), feedback mode and the contributors' view of open feedback (`feedback.js`), and their styles (`feedback.css`). `tool.js` describes how a site connects to it |
| `assets/feedback-tool/plugins/` | Plug-ins for other sites that use the tool: `pretext-site.js` for PreTeXt textbooks |
| `assets/site-feedback.js` | This site's plug-in for the feedback tool: which parts of a page can be commented on, what they are called, and how proposed edits map onto the page |
| `assets/editor.js` | The in-page editor for contributors, started by the feedback tool |
| `tools/apply-edit.js` | Applies an edit submitted from the website and opens a pull request |
| `tools/feedback.js` | Labels feedback issues and folds updates into the person's earlier issue |
| `tools/apps-script/` | The Google Apps Script that creates issues for anonymous feedback, with setup instructions |
| `tools/validate.js` | Checks the content for broken links, unknown references, missing photos and duplicate ids; runs on every push and pull request |

### Personas

Each persona has a name-based `id`, a `set` (a sub-context within the category, such as "Open textbooks") and the `cases` it appears in. Profiles follow the agreed format: Background, What they're looking for, Hopes & dreams, Worries & fears, Their data and expertise, A day in the life, a quote and "Grounded in".

### Case studies

A case study is a list of `sections`, each with a `heading` and a list of `blocks`. Every block has a permanent `id`, which never changes when blocks are added, edited or moved. Block types:

| Type | Fields |
|---|---|
| `paragraph` | `text` |
| `subheading` | `text` |
| `quote` | `persona` (the quote comes from the persona), or `text` and `source` |
| `personas` | `ids`: a row of persona cards |
| `list` | `items` |
| `timeline` | `items`: `label` and `text` |
| `table` | `head`, `rows` |
| `box` | `title`, `blocks` |
| `sti` | `intro`, then `social`, `technical` and `innovation`, each a list of `title` and `text` |

The "next case study" links and the reference list are generated automatically.

### Text markup

Text fields can use a small markup:

| Markup | Result |
|---|---|
| `**bold**`, `*italic*`, `` `code` `` | Formatting |
| `[text](https://…)` | External link |
| `[[p:persona-id]]` or `[[p:persona-id\|link text]]` | Link that opens a persona's profile (default text: name and tagline) |
| `[[case:case-id\|link text]]` | Link to a case study |
| `{{ref-key}}` | Citation in the form "Authors, year", linked to the reference list |
| `{{ref-key\|n}}` | Narrative citation in the form "Authors (year)" |

Write the brackets of a citation yourself: `… as reported ({{osang2025}}; {{rao2026}}).` Facts from personal communication are written out in full, for example "(S. Borio, personal communication, October 2026)", and are not added to `references.json`.

### Checking content

Run `node tools/validate.js` before committing. It lists every problem, such as a citation to a reference that does not exist or a link to a persona that has been renamed. The same check runs automatically on GitHub.

### Adding a category's content

1. In `content/categories.json`, remove `comingSoon` from the category and add its `sets`, `caseStudies` and page text.
2. Create `content/<category>/personas.json` and `content/<category>/case-studies/<id>.json`, and add the photos to `images/`.
3. Add a shell page for each case study at `<category>/<id>.html`, copying an Education one and changing `data-category` and `data-case`.

## Feedback and comments from the website

Every page has a **💬 Feedback and comments** button (bottom right; a link ending in `?feedback` or `?edit` opens it straight away). It asks people to continue **with their GitHub account** or **without an account**:

- **Contributors** (the repository's direct collaborators) go into edit mode, described below.
- **Everyone else** goes into feedback mode (`assets/feedback-tool/`). They point at any part of the page (a section, a paragraph, a list, a table, a persona profile field) and click 💬, or select some words and click "Comment on selection". Comments appear under the part they refer to, with the selected words highlighted, and can be edited or deleted at any time.
- **Sending** creates a GitHub issue titled `[feedback] …`, never a pull request. Sending again adds to the same issue: GitHub users go through a pre-filled GitHub page, and the **Handle website feedback** Action (`tools/feedback.js`) copies updates into their earlier issue and closes the update; anonymous feedback goes through a Google Apps Script web app (`tools/apps-script/`, set up following its README, then `feedbackEndpoint` and `feedbackBot` in `content/site.json`), which creates the issue and adds later comments to it.
- **Coming back:** comments are kept in the browser. GitHub users are offered their earlier open feedback on the page; anonymous people get a **private link** (`…#fb=<issue>-<key>`) to continue from any device.
- **Contributors** can click **💬 Feedback & edits** in the edit bar to choose what to see on that page: it lists the open feedback threads and the proposed edits waiting for review (open pull requests from the website), most recent first, with a filter. Only the ones they tick are shown: feedback as comments, proposed edits as cards showing the new text (with the current text underneath), next to the parts of the page they change. Proposed edits are read from the pull request itself, so they include later additions and any changes a reviewer made. Nothing is shown by default.

Each feedback issue holds the person's full, current set of comments (in a compressed block at the end), so the site can show and restore them; the readable part lists what is new, changed or withdrawn. A `Page:` line in each issue and pull request tells the site which page it belongs to.

## Editing from the website

People added directly as collaborators on this repository can suggest changes directly on the site (access through the organisation alone does not count). To give someone access, add them under the repository's **Settings → Collaborators and teams**; the **Read** role is enough. The **Update website editors** Action refreshes `access/editors.json` (SHA-256 hashes of the usernames, so the list can't be read from the site) every 30 minutes; run it from the Actions tab to make a new collaborator able to edit straight away.

1. Click **✎ Edit** (bottom right) on any page, or open a page with `?edit` at the end of its address. The first time, the site asks for the editor's GitHub username and checks that it has access; anyone without access is asked to contact the person named in `editorsContact` (and `editorsEmail`) in `content/site.json`. The username is remembered in that browser.
2. Click text to change it. On case-study pages, the buttons beside each block (including blocks inside boxes) move it, add a paragraph or delete it, and pressing Enter in a paragraph splits it in two. The ＋ and × buttons add or remove timeline entries, table rows and columns, points in the closing section and key figures, and persona rows have a picker to add or remove personas. In a persona's profile, Enter adds a list item and Backspace in an empty item removes it. The introduction and notes on the home and category pages can be edited too. Citations and links show as grey chips that can be moved or deleted but not broken.
3. Click **Review & submit**, check the list of changes, add a note and submit. GitHub opens with everything filled in; click **Create**.
4. The **Apply website edit** Action (`tools/apply-edit.js`) applies the changes to the JSON, runs the validator and opens a pull request. Changes that clash with newer edits are not applied; they are listed in the pull request for a maintainer.
5. A maintainer reviews and merges the pull request, and the site updates.

Unsent changes are kept in the editor's browser until they are submitted. Edits are recorded against permanent block ids with the original text, so suggestions to different paragraphs never interfere with each other. The username typed on the website is only a convenience check: the Action applies an issue only if the GitHub account that created it has access to the repository.

New block types (tables, timelines, boxes) can't be created from the website yet; add those in the JSON.

## Status

Internal draft. Names, details and quotes are fictional composites. The Education personas are grounded in the STACK case studies (stack-assessment.org, 2019–2026), Juma et al. (2022), iJET 17(23), and the other sources listed on the Education page.

**Images:** `images/` holds placeholder photos from Wikimedia Commons (CC BY / CC BY-SA / public domain; credits are listed on the pages). They show real, unrelated people and must be replaced with generated or consented images before publication. Each persona includes an image-generation prompt for this.

**Confidentiality:** Caltech, the US partner, is named only in case study 1 where its published case study is cited; elsewhere it is "the US partner". Source material lives in a local, gitignored `sources/` folder and is never committed.
