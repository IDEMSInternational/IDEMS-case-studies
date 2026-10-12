// Categories and case studies. Load first; the category files (data/<category>.js) add their groups, sets and personas.
const CATEGORIES = {
  parenting: { label: "Parenting", color: "var(--c-parenting)" },
  education: { label: "Education", color: "var(--c-education)" },
  climate: { label: "Climate", color: "var(--c-climate)" },
};

// Case studies, in reading order within each category. `page` is relative to the category folder.
const CASES = {
  "africa-to-contracts": {
    category: "education", page: "africa-to-contracts.html", short: "Africa to contracts",
    title: "From STACK in Africa to commercial contracts",
    summary: "A small pilot in Kenya in 2019 that grew into a pan-African community and a paid assessment service for universities in the US and Italy.",
  },
  textbooks: {
    category: "education", page: "textbooks.html", short: "STACK and textbooks",
    title: "STACK and textbooks: assessment that travels with the book",
    summary: "STACK questions inside open, interactive PreTeXt textbooks, from Ethiopian universities and Kenyan secondary schools to tablets in Ghana.",
  },
  "ai-authoring": {
    category: "education", page: "ai-authoring.html", short: "AI authoring",
    title: "Product development: AI agents for writing STACK questions",
    summary: "How IDEMS went from a personal chatbot to a multi-agent system that plans, writes and checks questions with a human author.",
  },
};

// Persona groups (role types) and sets (sub-contexts within a category), filled in by the category files.
const GROUPS = {};
const SETS = {};
const PERSONAS = [];
