/* eslint-disable @typescript-eslint/no-require-imports -- plain-Node script under test; no @types/node */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  TEMPLATE,
  applyRules,
  buildManifest,
  deriveDefaults,
  diffLines,
  parseArgs,
  plan,
  scanLeftovers,
  steps,
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
    expect(parseArgs(['--slug', 'a', '--name=B', '--yes', '--dry-run'])).toEqual({
      slug: 'a',
      name: 'B',
      yes: true,
      'dry-run': true,
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

  it('runs the toolchain check first, then rewrite + scan, so later tickets can append to `steps`', () => {
    expect(steps.map((s: { id: string }) => s.id)).toEqual(['doctor', 'rewrite', 'scan']);
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

  it('CLI --dry-run --yes exits 0 and writes nothing', () => {
    const before = fs.readFileSync(path.join(ROOT, 'app.config.ts'), 'utf8');
    // --skip-doctor keeps this hermetic: the toolchain check shells out to real binaries
    // (`bun run eas whoami` needs the network); scripts/__tests__/doctor.test.ts covers it.
    const result = spawnSync(
      process.execPath,
      ['scripts/init.js', '--dry-run', '--skip-doctor', ...HEADLESS_FLAGS],
      {
        cwd: ROOT,
        encoding: 'utf8',
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('[dry run] Initialising Acme Mobile (acme-mobile)');
    expect(result.stdout).not.toContain('Toolchain check');
    expect(result.stdout).toContain('Would rewrite:');
    expect(result.stdout).toContain("+   bundleId: 'com.acme.mobile',");
    expect(fs.readFileSync(path.join(ROOT, 'app.config.ts'), 'utf8')).toBe(before);
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
