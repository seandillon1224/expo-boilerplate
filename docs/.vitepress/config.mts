// VitePress site over `docs/` (T8.4, #143). Structure, landing page and link audit only: the
// pages are the same markdown GitHub renders. Nothing here names the template: the title comes
// from package.json (which `bun run init` rewrites), the base path and repo links from the
// environment the deploy workflow (.github/workflows/docs.yml) sets, so the site ships as-is
// into projects created from the template. `bun run docs:build` is the link audit: every dead
// relative link fails the build (`ignoreDeadLinks: false`), and CI runs it as the `Docs` job.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
) as { name: string };

/** `acme-mobile` → `Acme Mobile` (same rule the init script uses for its defaults). */
const title = pkg.name
  .split('-')
  .filter(Boolean)
  .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
  .join(' ');

/** `owner/name` of the GitHub repo, set by docs.yml (`github.repository`); unset locally. */
const repo = process.env.DOCS_REPO;

/**
 * `bun run init` deletes docs/template-init.md (it only describes the template); the docs that
 * cite it are left as history. Without the page its sidebar / nav entries go, the landing page's
 * quick start points at the toolchain check, and links to it stop counting as dead.
 */
const hasTemplateInit = existsSync(fileURLToPath(new URL('../template-init.md', import.meta.url)));
const quickStart = hasTemplateInit ? '/template-init' : '/doctor';

/**
 * The Decisions sidebar, built from `docs/adr/` so a new ADR needs no edit here (#171): every
 * `NNNN-*.md` except the `0000-template.md` copy-me file, in number order, labelled with the
 * file's H1 verbatim (the same string `docs/adr/README.md`'s index carries). A file without an
 * H1 fails the build rather than shipping a blank sidebar entry.
 */
const adrDir = fileURLToPath(new URL('../adr', import.meta.url));
const adrItems = readdirSync(adrDir)
  .filter((file) => /^\d{4}-.+\.md$/.test(file) && !file.startsWith('0000-'))
  .sort()
  .map((file) => {
    const h1 = readFileSync(`${adrDir}/${file}`, 'utf8').match(/^# (.+)$/m);
    if (!h1) throw new Error(`docs/adr/${file}: no "# " heading to build the sidebar entry from`);
    return { text: h1[1].trim(), link: `/adr/${file.replace(/\.md$/, '')}` };
  });

export default withMermaid(
  defineConfig({
    title,
    description:
      'Delivery pipeline, testing layers, performance tooling and conventions of this Expo app.',
    // `/<repo-name>/` on GitHub Pages (docs.yml); `/` for `bun run docs:dev` / `docs:preview`.
    base: process.env.DOCS_BASE ?? '/',
    lastUpdated: true,
    cleanUrls: true,
    // The build is the link audit: a dead relative link fails it. The two exceptions are not
    // links to pages: the Atlas dev-server URL (VitePress treats localhost as internal) and the
    // `NNNN-title` placeholder in the ADR template.
    ignoreDeadLinks: [
      /^https?:\/\/localhost/,
      /NNNN-title$/,
      ...(hasTemplateInit ? [] : [/(^|\/)template-init(\.md)?(#|$)/]),
    ],
    transformPageData(pageData) {
      if (pageData.relativePath === 'index.md') {
        pageData.frontmatter.hero.actions[0].link = quickStart;
      }
    },
    // `docs/adr/README.md` is what every doc links to; VitePress only treats `index.md` as the
    // folder index, so serve the README at `/adr/`.
    rewrites: { 'adr/README.md': 'adr/index.md' },
    markdown: {
      // Inline code is literal, like fenced blocks already are: the docs quote workflow
      // expressions such as `${{ workflow.url }}`, which Vue would otherwise interpolate (the
      // page then renders empty). Only text outside code needs escaping.
      config(md) {
        const codeInline = md.renderer.rules.code_inline!;
        md.renderer.rules.code_inline = (tokens, idx, options, env, self) => {
          tokens[idx].attrSet('v-pre', '');
          return codeInline(tokens, idx, options, env, self);
        };
      },
    },
    themeConfig: {
      outline: [2, 3],
      search: { provider: 'local' },
      ...(repo
        ? {
            socialLinks: [{ icon: 'github', link: `https://github.com/${repo}` }],
            editLink: {
              pattern: `https://github.com/${repo}/edit/main/docs/:path`,
              text: 'Edit this page on GitHub',
            },
          }
        : {}),
      nav: [
        { text: 'Start here', link: quickStart },
        { text: 'Pipeline', link: '/ci-overview' },
        { text: 'Performance', link: '/performance' },
        { text: 'Decisions', link: '/adr/' },
      ],
      sidebar: [
        {
          text: 'Start here',
          items: [
            { text: 'Overview', link: '/' },
            ...(hasTemplateInit ? [{ text: 'Template init', link: '/template-init' }] : []),
            { text: 'Toolchain check', link: '/doctor' },
            { text: 'Conventions', link: '/conventions' },
          ],
        },
        {
          text: 'Pipeline',
          items: [
            { text: 'CI overview', link: '/ci-overview' },
            { text: 'JS gate: required checks', link: '/js-gate' },
            { text: 'Native E2E (iOS / Android)', link: '/native-e2e' },
            { text: 'Release ladder', link: '/release-ladder' },
            { text: 'Environments and secrets', link: '/environments-and-secrets' },
            { text: 'Build sharing', link: '/build-sharing' },
            { text: 'Installing the staging app', link: '/install-staging-app' },
            { text: 'Getting the staging app on your iPhone', link: '/device-onboarding' },
          ],
        },
        {
          text: 'Performance',
          items: [
            { text: 'Which layer answers what', link: '/performance' },
            { text: 'Render-perf tests (Reassure)', link: '/perf-tests' },
            { text: 'Expo Atlas', link: '/atlas' },
            { text: 'Rozenite DevTools', link: '/rozenite' },
            { text: 'EAS Observe and the TTI check', link: '/observe' },
          ],
        },
        {
          text: 'Testing',
          items: [{ text: 'Testing', link: '/testing' }],
        },
        {
          text: 'Decisions',
          items: [{ text: 'Architecture decision records', link: '/adr/' }, ...adrItems],
        },
      ],
    },
  }),
);
