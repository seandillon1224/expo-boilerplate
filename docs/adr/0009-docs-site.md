# ADR-0009: A VitePress docs site on GitHub Pages

- **Status:** Accepted (supersedes the "no docs site" clause of decision 14 in
  [ADR-0001](0001-locked-architecture-decisions.md))
- **Date:** 2026-09-14
- **Issue:** #143 (T8.4 docs site; decided with the owner 2026-09-13, recorded here in #171)

## Context

[ADR-0001](0001-locked-architecture-decisions.md) decision 14 fixed the docs as "README +
`docs/*.md`, no docs site": one page per concern, read on GitHub, nothing to build. `docs/` then
grew past twenty pages that cross-link each other by relative path and anchor (`js-gate.md`,
`release-ladder.md`, `native-e2e.md`, the ADR folder …), and two problems showed up that plain
markdown files cannot answer. There was no search across them and no entry point that ordered them,
so a reader had to know the filename first. And nothing checked the links: a renamed page or a
moved section left dead relative links that GitHub renders as ordinary text, which is how the docs
drifted between PRs. Both are properties of the corpus, not of any one page, so they needed a build
step over `docs/` — which decision 14 had ruled out before `docs/` existed.

## Decision

The same markdown files are also a **VitePress site over `docs/`**, and `bun run docs:build` is the
link audit.

1. **Generator = VitePress** (`docs/.vitepress/config.mts`, `bun run docs:dev` / `docs:build` /
   `docs:preview`), chosen because it reads the existing `docs/` tree in place: relative `.md`
   links and anchors are rewritten for the site, so every link keeps working on GitHub too. Local
   search, dark mode and mermaid (`vitepress-plugin-mermaid`) come with it; the prose is unchanged.
2. **The build is the link audit.** `ignoreDeadLinks: false` makes any dead relative link fail
   `bun run docs:build`, and the `Docs` job in `.github/workflows/ci.yml` runs it on every PR as a
   required check. The narrow exception list in the config (the Atlas `localhost` URL, the
   `NNNN-title` placeholder in the ADR template, `template-init.md` once init removed it) is the
   only way past it.
3. **Publishing = GitHub Pages from `main`.** `.github/workflows/docs.yml` builds and deploys on
   push to `main` for paths that can change the site; `pages: write` is granted to the `deploy` job
   only, never to the job that runs repo code. Pages → Source: "GitHub Actions" is set by
   `bun run repo:settings:apply --only pages`.
4. **Nothing in the site names the template.** The title is derived from `package.json` `name`
   (which `bun run init` rewrites), the base path and repo links from the environment `docs.yml`
   sets (`DOCS_BASE`, `DOCS_REPO`). So the site ships as-is into a project created from the
   template and `bun run init` has no rewrite rule for it.
5. **Structure is config, not front matter.** The landing page is `docs/index.md`; the sidebar
   groups (Start here / Pipeline / Performance / Testing / Decisions) are listed in the config, and
   the Decisions group is generated from the files in `docs/adr/` so a new ADR needs no config edit
   (#171).

## Consequences

- Decision 14 of [ADR-0001](0001-locked-architecture-decisions.md) keeps everything else it says;
  only "no docs site" is replaced. "One page per concern under `docs/`, read on GitHub" still holds
  — the site is a second rendering of the same files, never a second copy of the content.
- Links are now enforced. A renamed page or a moved anchor turns the `Docs` check red on the PR
  instead of rotting silently, and links must stay relative with the `.md` extension to satisfy
  both renderings ([Conventions → Docs](../conventions.md)).
- Two markdown quirks are now load-bearing: `{{ }}` and bare `<tag>`-looking text outside code
  spans are parsed by Vue / HTML, and a `README.md` inside a `docs/` subfolder needs a `rewrites`
  entry (`adr/README.md` → `/adr/`) to be the folder index.
- The template carries VitePress as a devDependency and two more CI surfaces (the `Docs` job and
  `docs.yml`); a generated project inherits both and gets its own Pages site for free, at the cost
  of a repo setting it must enable.
- `docs/index.md`'s quick-start action and the sidebar adapt to `bun run init` having deleted
  `docs/template-init.md`, so the generated project's site has no dead entry.

### Rejected

- **Keeping "no docs site"** — accepts no search, no ordered entry point, and no link checking on a
  corpus this size; the drift this ADR reconciles is the evidence.
- **A separate `website/` with duplicated prose** — two copies to keep in sync, and the GitHub
  rendering (what an agent and a PR reviewer read) becomes the stale one.
- **Docusaurus / Nextra** — heavier, and both want their own docs tree and front matter; VitePress
  reads `docs/` as it already is.
- **A link checker without a site** (lychee, markdown-link-check) — solves the audit but not the
  search or the entry point, and would be a second tool to keep aligned with the docs.
