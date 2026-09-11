/* eslint-disable @typescript-eslint/no-require-imports -- plain-Node script under test; no @types/node */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  LEDGER_LEGEND,
  LEDGER_PATH,
  LEDGER_RULE,
  PLAN_DECISIONS_HEADING,
  REMOVAL,
  TEMPLATE,
  applyRules,
  buildChangelog,
  buildLedger,
  buildManifest,
  buildPlanStub,
  deriveDefaults,
  diffLines,
  initialCommitMessage,
  parseArgs,
  plan,
  planRemoval,
  scanLeftovers,
  steps,
  uncommittedChanges,
  validateIdentity,
} = require('../init');

// Jest runs from the repo root (rootDir).
const ROOT = process.cwd();

const ACME = {
  name: 'Acme Mobile',
  slug: 'acme-mobile',
  scheme: 'acme',
  bundleId: 'com.acme.mobile',
  package: 'com.acme.mobile_android',
  easProjectId: '11111111-2222-4333-8444-555555555555',
  owner: 'acme-team',
  githubRepo: 'acme-inc/acme-mobile',
};

const HEADLESS_FLAGS = [
  '--yes',
  '--name',
  ACME.name,
  '--slug',
  ACME.slug,
  '--scheme',
  ACME.scheme,
  '--bundle-id',
  ACME.bundleId,
  '--package',
  ACME.package,
  '--eas-project-id',
  ACME.easProjectId,
  '--owner',
  ACME.owner,
  '--github-repo',
  ACME.githubRepo,
];

type Rule = {
  id: string;
  find: string | RegExp;
  replace: string | ((m: string[]) => string);
  min: number;
};
type Entry = { file: string; rules: Rule[] };

function rulesFor(file: string, identity = ACME): Rule[] {
  const entry = (buildManifest(identity) as Entry[]).find((e) => e.file === file);
  if (!entry) throw new Error(`no manifest entry for ${file}`);
  return entry.rules;
}

describe('applyRules (fixture strings)', () => {
  it('rewrites the BASE block and EAS_PROJECT_ID in app.config.ts by structure, not value', () => {
    const fixture = [
      'const BASE = {',
      "  name: 'Whatever Name',",
      "  slug: 'whatever',",
      "  scheme: 'whatever',",
      "  bundleId: 'com.x.whatever',",
      "  androidPackage: 'com.x.whatever',",
      '} as const;',
      '// `@seandillon1224/expo-boilerplate`',
      "const EAS_PROJECT_ID: string = 'old';",
    ].join('\n');
    const { content, counts } = applyRules(fixture, rulesFor('app.config.ts'));
    expect(content).toContain("  name: 'Acme Mobile',");
    expect(content).toContain("  slug: 'acme-mobile',");
    expect(content).toContain("  scheme: 'acme',");
    expect(content).toContain("  bundleId: 'com.acme.mobile',");
    expect(content).toContain("  androidPackage: 'com.acme.mobile_android',");
    expect(content).toContain(`const EAS_PROJECT_ID: string = '${ACME.easProjectId}';`);
    expect(content).toContain('`@acme-team/acme-mobile`');
    expect(counts.every((c: { count: number }) => c.count === 1)).toBe(true);
  });

  it('writes an empty EAS_PROJECT_ID when none is given', () => {
    const { content } = applyRules(
      "const EAS_PROJECT_ID: string = 'x';",
      rulesFor('app.config.ts', { ...ACME, easProjectId: '' }),
    );
    expect(content).toBe("const EAS_PROJECT_ID: string = '';");
  });

  it('maps MAESTRO_APP_ID to the bundle id on the iOS job and the package on the Android job', () => {
    const fixture = [
      '    env:',
      '      MAESTRO_APP_ID: com.seandillon.expoboilerplate.dev',
      '    params:',
      '      build_id: ${{ needs.repack_ios.outputs.build_id || needs.build_ios.outputs.build_id }}',
      '    env:',
      '      MAESTRO_APP_ID: com.seandillon.expoboilerplate.dev',
      '    params:',
      '      build_id: ${{ needs.repack_android.outputs.build_id }}',
    ].join('\n');
    const { content } = applyRules(fixture, rulesFor('.eas/workflows/e2e-quarantine.yml'));
    const ids = [...content.matchAll(/MAESTRO_APP_ID: (\S+)/g)].map((m) => m[1]);
    expect(ids).toEqual(['com.acme.mobile.dev', 'com.acme.mobile_android.dev']);
  });

  it('splits the credentials table between Android package and iOS bundle id', () => {
    const fixture = [
      '| Android  | `staging` | `com.seandillon.expoboilerplate.staging` | k |',
      '| Android  | `uat` | `com.seandillon.expoboilerplate.uat` | k |',
      '| Android  | `production` | `com.seandillon.expoboilerplate` | k |',
      '| Android  | `production` (submit) | `com.seandillon.expoboilerplate` | k |',
      '| Android  | `development` | `com.seandillon.expoboilerplate.dev` | k |',
      '| iOS      | `staging` | `com.seandillon.expoboilerplate.staging` | p |',
      '1. **Create the app** with package',
      '   `com.seandillon.expoboilerplate`, Play App Signing enabled.',
      'the team that owns `com.seandillon.expoboilerplate*`',
      'The EAS project id (`885fa7d0-…`) lives once',
      '--dev-domain expo-boilerplate --alias staging',
      'https://expo.dev/accounts/seandillon1224/projects/expo-boilerplate/credentials',
    ].join('\n');
    const rules = rulesFor('docs/environments-and-secrets.md').map((r) =>
      // The real doc has more iOS rows than the fixture; only the counts differ.
      r.id.startsWith('bundle id') ? { ...r, min: 1 } : r,
    );
    const { content } = applyRules(fixture, rules);
    expect(content).toContain('| Android  | `staging` | `com.acme.mobile_android.staging` | k |');
    expect(content).toContain('| Android  | `production` | `com.acme.mobile_android` | k |');
    expect(content).toContain('| iOS      | `staging` | `com.acme.mobile.staging` | p |');
    expect(content).toContain('   `com.acme.mobile_android`, Play App Signing enabled.');
    expect(content).toContain('the team that owns `com.acme.mobile*`');
    expect(content).toContain('(`11111111-…`)');
    expect(content).toContain('--dev-domain acme-mobile --alias staging');
    expect(content).toContain(
      'https://expo.dev/accounts/acme-team/projects/acme-mobile/credentials',
    );
    expect(content).not.toContain('seandillon');
  });

  it('rewrites README title and badges, package.json name and the reviewer logins', () => {
    const readme = applyRules(
      '# Expo Boilerplate\n\n[![CI](https://github.com/seandillon1224/expo-boilerplate/actions/workflows/ci.yml/badge.svg)](https://github.com/seandillon1224/expo-boilerplate/actions/workflows/ci.yml)\n\n## Docs',
      rulesFor('README.md'),
    ).content;
    expect(readme.startsWith('# Acme Mobile\n')).toBe(true);
    expect(readme).toContain('github.com/acme-inc/acme-mobile/actions');
    expect(readme).toContain('## Docs');

    const pkg = applyRules(
      '{\n  "name": "expo-boilerplate",\n  "main": "x"\n}',
      rulesFor('package.json'),
    );
    expect(pkg.content).toContain('"name": "acme-mobile",');

    const settings = applyRules(
      "reviewers: [{ type: 'User', login: 'seandillon1224' }],\nx\nreviewers: [{ type: 'User', login: 'seandillon1224' }],",
      rulesFor('scripts/repo-settings.js'),
    );
    expect(settings.content).not.toContain('seandillon1224');
    expect(settings.content.match(/login: 'acme-inc'/g)).toHaveLength(2);
  });

  it('does not treat `$` in a new value as a regex group reference', () => {
    const { content } = applyRules(
      "  name: 'Old',",
      rulesFor('app.config.ts', { ...ACME, name: 'Cash $1 App' }).filter(
        (r) => r.id === 'BASE.name',
      ),
    );
    expect(content).toBe("  name: 'Cash $1 App',");
  });

  it('reports how many times each rule matched', () => {
    const { counts } = applyRules('nothing here', rulesFor('.maestro/config.yaml'));
    expect(counts).toEqual([{ id: 'MAESTRO_APP_ID example', count: 0, min: 1 }]);
  });
});

describe('plan', () => {
  it('fails loudly when a pattern is missing, listing every miss', () => {
    const read = (file: string) => (file === 'package.json' ? '{}' : null);
    expect(() => plan(ACME, read)).toThrow(/package\.json: "name" matched 0×/);
    expect(() => plan(ACME, read)).toThrow(/app\.config\.ts: file not found/);
  });
});

describe('validateIdentity / deriveDefaults / parseArgs', () => {
  it('accepts a valid identity and one with an empty EAS project id', () => {
    expect(validateIdentity(ACME)).toEqual({});
    expect(validateIdentity({ ...ACME, easProjectId: '' })).toEqual({});
  });

  it('rejects bad slugs, ids and repos', () => {
    const errors = validateIdentity({
      ...ACME,
      slug: 'Acme App',
      bundleId: 'noreverse',
      package: 'com.1acme.app',
      scheme: 'Acme',
      easProjectId: 'not-a-uuid',
      githubRepo: 'acme',
    });
    expect(Object.keys(errors).sort()).toEqual([
      'bundleId',
      'easProjectId',
      'githubRepo',
      'package',
      'scheme',
      'slug',
    ]);
  });

  it('derives defaults from the folder name', () => {
    expect(deriveDefaults('My Cool_App', 'Jane Doe')).toEqual({
      name: 'My Cool App',
      slug: 'my-cool-app',
      scheme: 'mycoolapp',
      owner: 'janedoe',
      bundleId: 'com.janedoe.mycoolapp',
      package: 'com.janedoe.mycoolapp',
    });
  });

  it('reads flags in both forms and rejects unknown ones', () => {
    expect(
      parseArgs(['--slug', 'a', '--name=B', '--yes', '--dry-run', '--fresh-git', '--keep-init']),
    ).toEqual({
      slug: 'a',
      name: 'B',
      yes: true,
      'dry-run': true,
      'fresh-git': true,
      'keep-init': true,
    });
    expect(() => parseArgs(['--bogus'])).toThrow(/unknown argument/);
    expect(() => parseArgs(['--slug'])).toThrow(/needs a value/);
  });
});

describe('diffLines / scanLeftovers', () => {
  it('prints only changed lines', () => {
    expect(diffLines('a\nb\nc', 'a\nB\nc')).toEqual(['@@ 2', '- b', '+ B']);
  });

  it('reports leftover template identifiers outside KEEP', () => {
    const hits = scanLeftovers({
      'docs/x.md': 'see com.seandillon.expoboilerplate.dev\nfine',
      'docs/performance.md': 'seandillon1224/expo-boilerplate',
      '.claude/execution-queue.md': 'expo-boilerplate',
    });
    expect(hits).toEqual([
      {
        file: 'docs/x.md',
        line: 1,
        token: TEMPLATE.bundleId,
        text: 'see com.seandillon.expoboilerplate.dev',
      },
    ]);
  });

  it('orders the steps: rewrites, ledger / plan / changelog, self-delete, fresh git, repo settings last', () => {
    expect(steps.map((s: { id: string }) => s.id)).toEqual([
      'doctor',
      'rewrite',
      'scan',
      'ledger',
      'plan',
      'changelog',
      'self-delete',
      'fresh-git',
      'repo-settings',
    ]);
  });

  it('opts steps out through their flags', () => {
    const on = (id: string, args: Record<string, boolean>) => {
      const step = steps.find((s: { id: string }) => s.id === id);
      return step.when ? step.when({ args }) : true;
    };
    expect(on('plan', {})).toBe(true);
    expect(on('plan', { 'keep-plan': true })).toBe(false);
    expect(on('self-delete', {})).toBe(true);
    expect(on('self-delete', { 'keep-init': true })).toBe(false);
    expect(on('fresh-git', {})).toBe(false);
    expect(on('fresh-git', { 'fresh-git': true })).toBe(true);
    expect(on('repo-settings', {})).toBe(false);
    expect(on('repo-settings', { 'apply-repo-settings': true })).toBe(true);
    expect(on('ledger', {})).toBe(true);
    expect(on('changelog', {})).toBe(true);
  });
});

describe('reset templates', () => {
  it('builds an empty ledger with the same legend and rule, pointing at the new repo', () => {
    const ledger = buildLedger(ACME, '2026-01-02');
    expect(ledger.startsWith('# Execution Queue — acme-mobile\n')).toBe(true);
    expect(ledger).toContain('Tracker: GitHub Issues in `acme-inc/acme-mobile`. Plan: `PLAN.md`.');
    expect(ledger).toContain(`\n${LEDGER_LEGEND}\n`);
    expect(ledger).toContain(`\n${LEDGER_RULE}\n`);
    expect(ledger).toContain('## OPEN QUEUE (dependency order)');
    expect(ledger).toContain('## RUN LOG');
    expect(ledger).toContain('- 2026-01-02 — Initialised from seandillon1224/expo-boilerplate');
    expect(ledger).not.toMatch(/^- \[[ x~MBDS]\]/m);
    expect(ledger).not.toMatch(/^### E\d/m);
  });

  it('stubs PLAN.md with the inherited decisions and a link upstream', () => {
    const template = [
      '# Plan',
      '',
      '## Goal',
      '',
      'template goal',
      '',
      '## Locked decisions',
      '',
      '| # | Area | Decision |',
      '| 1 | CI | GitHub Actions |',
      '',
      '## Epics and tickets',
      '',
      '- **T7.1** init',
    ].join('\n');
    const stub = buildPlanStub(ACME, template);
    expect(stub.startsWith('# Plan — Acme Mobile\n')).toBe(true);
    expect(stub).toContain('https://github.com/seandillon1224/expo-boilerplate/blob/main/PLAN.md');
    expect(stub).toContain(
      '## Locked decisions (inherited)\n\n| # | Area | Decision |\n| 1 | CI | GitHub Actions |\n',
    );
    expect(stub).not.toContain('template goal');
    expect(stub).not.toContain('T7.1');
    expect(() => buildPlanStub(ACME, '# Plan\n\n## Goal\n')).toThrow(/Locked decisions/);
  });

  it('builds a fresh changelog header and a lowercase initial-commit subject', () => {
    expect(buildChangelog(ACME)).toBe(
      '# Changelog\n\nAll notable changes to Acme Mobile are documented here.\n',
    );
    expect(initialCommitMessage(ACME)).toBe('chore: initialize acme-mobile from expo-boilerplate');
  });
});

describe('planRemoval (fixture strings)', () => {
  it('drops exactly the init lines and keeps the doctor ones', () => {
    const read = (file: string) =>
      ({
        'scripts/init.js': '',
        'scripts/__tests__/init.test.ts': '',
        'docs/template-init.md': '',
        'scripts/template-e2e.js': '',
        'package.json':
          '{\n  "scripts": {\n    "init": "node scripts/init.js",\n    "doctor": "node scripts/doctor.js",\n    "template:e2e": "node scripts/template-e2e.js",\n  }\n}',
        'README.md':
          'bun run doctor # check\nbun run init   # new app (docs/template-init.md)\nbun run ios\n\n- [Template init](docs/template-init.md) — x.\n- [JS gate](docs/js-gate.md) — y.\n',
        'CLAUDE.md':
          '- `bun run doctor` — toolchain check. Also the first `init` step (`--skip-doctor`). Expected versions: x\n- `bun run init` — rebrand.\n- `bun run template:e2e` — e2e.\n- `bun run ios`\n- GitHub Actions = JS gate only (lint, Maestro web, template init).\n',
        'docs/doctor.md':
          'exact install command. It is also the first `init`\nstep (`--skip-doctor` to skip). No network access.\n',
        '.github/workflows/ci.yml':
          "jobs:\n  lint:\n    name: Lint\n\n  template-init:\n    # comment\n    name: Template init\n    steps:\n      - run: bun run template:e2e\n        env:\n          EXPO_TOKEN: ''\n",
        'scripts/repo-settings.js':
          "const REQUIRED_CHECKS = [\n  'Maestro web',\n  'Template init',\n  'PR title',\n];\n",
        'docs/js-gate.md':
          '| `Maestro web`   | `CI` / `maestro-web`   | x |\n| `Template init` | `CI` / `template-init` | y |\n| `Perf (Reassure)` | `CI` / `perf` | z |\n\n`Template init` is the slowest job and\nspans two lines.\n\nNext paragraph.\n\n| Fingerprint drift | a | b |\n| Template init     | `bun run template:e2e` | c |\n| PR title          | d | e |\n',
      })[file] ?? null;
    const after = Object.fromEntries(
      planRemoval(read).map((c: { file: string; after: string }) => [c.file, c.after]),
    );
    expect(after['package.json']).toBe(
      '{\n  "scripts": {\n    "doctor": "node scripts/doctor.js",\n  }\n}',
    );
    expect(after['README.md']).toBe(
      'bun run doctor # check\nbun run ios\n\n- [JS gate](docs/js-gate.md) — y.\n',
    );
    expect(after['CLAUDE.md']).toBe(
      '- `bun run doctor` — toolchain check. Expected versions: x\n- `bun run ios`\n- GitHub Actions = JS gate only (lint, Maestro web).\n',
    );
    expect(after['docs/doctor.md']).toBe('exact install command. No network access.\n');
    expect(after['.github/workflows/ci.yml']).toBe('jobs:\n  lint:\n    name: Lint\n');
    expect(after['scripts/repo-settings.js']).toBe(
      "const REQUIRED_CHECKS = [\n  'Maestro web',\n  'PR title',\n];\n",
    );
    expect(after['docs/js-gate.md']).toBe(
      '| `Maestro web`   | `CI` / `maestro-web`   | x |\n| `Perf (Reassure)` | `CI` / `perf` | z |\n\nNext paragraph.\n\n| Fingerprint drift | a | b |\n| PR title          | d | e |\n',
    );
  });

  it('fails loudly when a file or line is missing', () => {
    const read = (file: string) => (file === 'package.json' ? '{}' : null);
    expect(() => planRemoval(read)).toThrow(/scripts\/init\.js: file not found/);
    expect(() => planRemoval(read)).toThrow(/package\.json: "init script" matched 0×/);
    expect(() => planRemoval(read)).toThrow(/README\.md: file not found/);
  });

  it('never removes the doctor script, its test or doc', () => {
    expect(REMOVAL.files).not.toContain('scripts/doctor.js');
    expect(REMOVAL.files).not.toContain('scripts/__tests__/doctor.test.ts');
    expect(REMOVAL.files).not.toContain('docs/doctor.md');
  });
});

// Drift guard: every manifest pattern must still match the real files. Only meaningful while
// this checkout is the template itself — after `bun run init` the identifiers are gone by design.
const isTemplate =
  JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).name === TEMPLATE.slug;
const describeTemplate = isTemplate ? describe : describe.skip;

describeTemplate('drift guard (real repo files, dry run)', () => {
  const read = (file: string) => {
    const abs = path.join(ROOT, file);
    return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
  };

  it('every manifest pattern matches the checked-in files', () => {
    const changes = plan(ACME, read);
    for (const change of changes) {
      expect(change.after).not.toBe(change.before);
      expect(change.after.split('\n')).toHaveLength(change.before.split('\n').length);
    }
  });

  it('leaves no template identifier behind in the files it rewrites', () => {
    for (const change of plan(ACME, read)) {
      const hits = scanLeftovers({ [change.file]: change.after });
      expect({ file: change.file, hits }).toEqual({ file: change.file, hits: [] });
    }
  });

  it('every self-delete manifest entry matches the checked-in files', () => {
    for (const change of planRemoval(read)) {
      expect(change.after).not.toBe(change.before);
      expect(change.after).not.toMatch(
        /bun run init|template-init|scripts\/init\.js|template:e2e|'Template init'|`Template init`|template init\)/,
      );
    }
    for (const file of REMOVAL.files) expect(read(file)).not.toBeNull();
  });

  it("the reset ledger keeps the live ledger's legend and rule, and PLAN.md has the decisions", () => {
    const live = read(LEDGER_PATH) as string;
    expect(live).toContain(`\n${LEDGER_LEGEND}\n`);
    expect(live).toContain(`\n${LEDGER_RULE}\n`);
    expect(live).toContain('## OPEN QUEUE (dependency order)');
    expect(live).toContain('## RUN LOG');
    const stub = buildPlanStub(ACME, read('PLAN.md') as string);
    expect(stub).toContain(`${PLAN_DECISIONS_HEADING} (inherited)\n\n| #`);
    expect(stub).not.toContain('## Epics and tickets');
  });

  it('CLI --dry-run --yes exits 0 and writes nothing', () => {
    const before = fs.readFileSync(path.join(ROOT, 'app.config.ts'), 'utf8');
    const ledgerBefore = fs.readFileSync(path.join(ROOT, LEDGER_PATH), 'utf8');
    // --skip-doctor keeps this hermetic: the toolchain check shells out to real binaries
    // (`bun run eas whoami` needs the network); scripts/__tests__/doctor.test.ts covers it.
    const result = spawnSync(
      process.execPath,
      ['scripts/init.js', '--dry-run', '--skip-doctor', '--fresh-git', ...HEADLESS_FLAGS],
      {
        cwd: ROOT,
        encoding: 'utf8',
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('[dry run] Initialising Acme Mobile (acme-mobile)');
    expect(result.stdout).not.toContain('▶ Toolchain check');
    expect(result.stdout).toContain('Would rewrite:');
    expect(result.stdout).toContain("+   bundleId: 'com.acme.mobile',");
    expect(result.stdout).toContain(`Would reset ${LEDGER_PATH}`);
    expect(result.stdout).toContain('Would replace PLAN.md');
    expect(result.stdout).toContain('No CHANGELOG.md, skipped.');
    expect(result.stdout).toContain('Would remove scripts/init.js');
    expect(result.stdout).toContain('Would rm -rf .git');
    // Opt-in, so not run here; the closing hint points at the manual command instead.
    expect(result.stdout).not.toContain('▶ Apply GitHub repo settings');
    expect(result.stdout).toContain('Then push to GitHub, then run: bun run repo:settings:apply');
    expect(result.stdout).toContain('Would do:');
    expect(fs.readFileSync(path.join(ROOT, 'app.config.ts'), 'utf8')).toBe(before);
    expect(fs.readFileSync(path.join(ROOT, LEDGER_PATH), 'utf8')).toBe(ledgerBefore);
    expect(fs.existsSync(path.join(ROOT, 'scripts/init.js'))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, '.git'))).toBe(true);
  });

  it('CLI rejects invalid flags without touching files', () => {
    const result = spawnSync(
      process.execPath,
      ['scripts/init.js', '--yes', '--slug', 'Bad Slug', '--eas-project-id', 'nope'],
      { cwd: ROOT, encoding: 'utf8' },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--slug ("Bad Slug")');
    expect(result.stderr).toContain('--eas-project-id ("nope")');
  });
});

/**
 * Headless init on a copy of the tracked files (node_modules symlinked so `bunx prettier` and
 * `bunx lefthook` resolve locally). `--fresh-git` needs a history to replace, so the copy is a
 * real git repo with one commit; git identity comes from the environment below.
 */
describeTemplate('integration (headless init on a temp copy)', () => {
  const GIT_ENV = {
    ...process.env,
    GIT_AUTHOR_NAME: 'init test',
    GIT_AUTHOR_EMAIL: 'init@test.invalid',
    GIT_COMMITTER_NAME: 'init test',
    GIT_COMMITTER_EMAIL: 'init@test.invalid',
    GIT_CONFIG_GLOBAL: '/dev/null',
  };
  const gitIn = (cwd: string, args: string[]) =>
    spawnSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV });
  const exists = (dir: string, file: string) => fs.existsSync(path.join(dir, file));
  const readIn = (dir: string, file: string) => fs.readFileSync(path.join(dir, file), 'utf8');
  const dirs: string[] = [];

  function copyRepo(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'init-'));
    dirs.push(dir);
    const files = spawnSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
      .stdout.split('\0')
      .filter(Boolean);
    for (const file of files) {
      const src = path.join(ROOT, file);
      if (!fs.existsSync(src)) continue;
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      fs.copyFileSync(src, path.join(dir, file));
    }
    fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'));
    expect(gitIn(dir, ['init', '-q', '-b', 'main']).status).toBe(0);
    // The symlink is not matched by `node_modules/` in .gitignore (that only matches directories).
    fs.writeFileSync(path.join(dir, '.git/info/exclude'), 'node_modules\n');
    expect(gitIn(dir, ['add', '-A']).status).toBe(0);
    expect(gitIn(dir, ['commit', '-q', '-m', 'chore: template snapshot']).status).toBe(0);
    return dir;
  }

  function runInit(dir: string, extra: string[]) {
    return spawnSync(
      process.execPath,
      ['scripts/init.js', '--skip-doctor', '--eas-project-id=', ...extra, ...HEADLESS_FLAGS],
      { cwd: dir, encoding: 'utf8', env: GIT_ENV },
    );
  }

  afterAll(() => {
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('self-deletes, resets the ledger and stubs PLAN.md; without --fresh-git it prints the commit command', () => {
    const dir = copyRepo();
    const result = runInit(dir, []);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);

    for (const file of REMOVAL.files) expect(exists(dir, file)).toBe(false);
    expect(exists(dir, 'scripts/doctor.js')).toBe(true);
    expect(readIn(dir, '.github/workflows/ci.yml')).not.toMatch(/template-init|Template init/);
    expect(readIn(dir, 'scripts/repo-settings.js')).not.toContain("'Template init'");
    expect(readIn(dir, 'docs/js-gate.md')).not.toMatch(/Template init|template:e2e/);
    expect(exists(dir, 'scripts/__tests__/doctor.test.ts')).toBe(true);
    expect(exists(dir, 'docs/doctor.md')).toBe(true);

    const pkg = JSON.parse(readIn(dir, 'package.json'));
    expect(pkg.name).toBe('acme-mobile');
    expect(pkg.scripts.init).toBeUndefined();
    expect(pkg.scripts['template:e2e']).toBeUndefined();
    expect(pkg.scripts.doctor).toBe('node scripts/doctor.js');
    expect(readIn(dir, 'README.md')).not.toMatch(/bun run init|template-init/);
    expect(readIn(dir, 'CLAUDE.md')).not.toMatch(
      /bun run init|template-init|Also the first `init` step/,
    );
    expect(readIn(dir, 'docs/doctor.md')).not.toContain('first `init`');

    const ledger = readIn(dir, LEDGER_PATH);
    expect(ledger).toContain('Tracker: GitHub Issues in `acme-inc/acme-mobile`');
    expect(ledger).not.toMatch(/^- \[x\]/m);
    expect(exists(dir, '.claude/skills/ship-next/SKILL.md')).toBe(true);
    expect(exists(dir, '.claude/settings.json')).toBe(true);
    expect(readIn(dir, 'PLAN.md')).toContain('# Plan — Acme Mobile');
    expect(exists(dir, 'CHANGELOG.md')).toBe(false);

    // History untouched, everything above is uncommitted, and the hint names the commit.
    expect(gitIn(dir, ['rev-list', '--count', 'HEAD']).stdout.trim()).toBe('1');
    expect(gitIn(dir, ['status', '--porcelain']).stdout).toMatch(/^ D scripts\/init\.js$/m);
    expect(result.stdout).toContain(
      'then commit: git add -A && git commit -m "chore: initialize acme-mobile from expo-boilerplate"',
    );
  }, 60_000);

  it('--keep-init --keep-plan leaves the script, its doc and PLAN.md alone', () => {
    const dir = copyRepo();
    const result = runInit(dir, ['--keep-init', '--keep-plan']);
    expect(result.status).toBe(0);
    for (const file of REMOVAL.files) expect(exists(dir, file)).toBe(true);
    expect(JSON.parse(readIn(dir, 'package.json')).scripts.init).toBe('node scripts/init.js');
    expect(readIn(dir, 'PLAN.md')).toBe(readIn(ROOT, 'PLAN.md'));
    expect(readIn(dir, LEDGER_PATH)).toContain('acme-inc/acme-mobile');
  }, 60_000);

  it('--fresh-git replaces the history with one commit of the final tree, and refuses a dirty tree', () => {
    const dir = copyRepo();
    fs.writeFileSync(path.join(dir, 'WIP.md'), 'not committed\n');
    const refused = runInit(dir, ['--fresh-git']);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('--fresh-git refused');
    expect(refused.stderr).toContain('?? WIP.md');
    expect(exists(dir, 'scripts/init.js')).toBe(true); // nothing was written
    fs.rmSync(path.join(dir, 'WIP.md'));

    const result = runInit(dir, ['--fresh-git']);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(gitIn(dir, ['rev-list', '--count', 'HEAD']).stdout.trim()).toBe('1');
    expect(gitIn(dir, ['log', '-1', '--format=%s']).stdout.trim()).toBe(
      'chore: initialize acme-mobile from expo-boilerplate',
    );
    expect(gitIn(dir, ['branch', '--show-current']).stdout.trim()).toBe('main');
    expect(gitIn(dir, ['status', '--porcelain']).stdout).toBe('');
    expect(gitIn(dir, ['ls-files', 'scripts/init.js']).stdout).toBe('');
    expect(gitIn(dir, ['ls-files', 'scripts/doctor.js']).stdout.trim()).toBe('scripts/doctor.js');
    expect(exists(dir, '.git/hooks/pre-commit')).toBe(true);
    expect(result.stdout).toContain(
      'git remote add origin git@github.com:acme-inc/acme-mobile.git',
    );
  }, 60_000);

  it('uncommittedChanges reports null outside a checkout', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'init-nogit-'));
    dirs.push(dir);
    expect(uncommittedChanges(dir)).toBeNull();
  });
});
