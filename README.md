# IDEMS case studies

Case studies and personas from IDEMS' work, by category: Parenting, Education and Climate. Education (STACK) has content; Parenting and Climate are placeholders for now.

Open `index.html` in a browser. No build step is needed.

## Structure

| Path | What it is |
|---|---|
| `index.html` | Home: the list of categories, then a browser of all personas with filters for category, case study and set |
| `<category>/index.html` | Category page: its case studies, then a browser of its personas |
| `<category>/<case>.html` | Case-study pages |
| `data/catalogue.js` | Categories and case studies (titles, summaries, page names) |
| `data/<category>.js` | One category's personas, plus its persona groups and sets |
| `assets/site.js` | Shared behaviour: navigation, theme, persona browser, persona cards and profile dialog |
| `assets/site.css`, `assets/case.css` | Shared styles; `case.css` adds article typography for case-study pages |
| `images/<persona-id>.jpg` | One photo per persona |

Each persona has a name-based `id` and is tagged with its `category`, the `cases` it appears in, a `set` (a sub-context within the category, such as "Open textbooks"), a `group` (such as "Students") and optional free `tags` (such as "TVET"). Persona profiles follow the agreed format: Background, What they're looking for, Hopes & dreams, Worries & fears, Their data and expertise, A day in the life, a quote and "Grounded in".

### Adding a category's content

1. Add its case studies to `CASES` in `data/catalogue.js`.
2. Create `data/<category>.js` following `data/education.js`, and add its photos to `images/`.
3. Load `data/<category>.js` on `index.html` and on the category page, and replace the "Coming soon" text on the category page with a case list and a persona browser (copy `education/index.html`).
4. Add the case-study pages to the category folder, loading the same scripts as the education case studies.

On case-study pages, `<a class="pcard" data-p="<id>"></a>` renders a persona card, `<cite data-p="<id>"></cite>` renders a persona citation, and any link to `index.html#<id>` opens that persona's profile.

## Status

Internal draft. Names, details and quotes are fictional composites. The Education personas are grounded in the STACK case studies (stack-assessment.org, 2019–2026), Juma et al. (2022), iJET 17(23), and the other sources listed on the Education page.

**Images:** `images/` holds placeholder photos from Wikimedia Commons (CC BY / CC BY-SA / public domain; credits are listed on the pages). They show real, unrelated people and must be replaced with generated or consented images before publication. Each persona includes an image-generation prompt for this.

**Confidentiality:** do not name the US commercial partner in any external version. Source material lives in a local, gitignored `sources/` folder and is never committed.
