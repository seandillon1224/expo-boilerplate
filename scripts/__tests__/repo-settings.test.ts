/* eslint-disable @typescript-eslint/no-require-imports -- plain-Node script under test; no @types/node */
const {
  DESIRED,
  LABELS,
  SECTIONS,
  collectDrift,
  endpoints,
  main,
  parseArgs,
  resolveReviewer,
} = require('../repo-settings');

const SLUG = 'acme/acme-app';

type Call = { method: string; path: string; body: Record<string, unknown> };
type GhResult = { status: number; stdout: string; stderr: string };

/**
 * A fake `gh`: `responses` maps a request key (`"api <path>"`, `"api --method POST <path>"`,
 * `"auth status"`, `"repo view"`) to a JSON body or a `{ status, stderr }` failure. Every call is
 * recorded so tests can assert what would be written.
 */
function fakeGh(responses: Record<string, unknown>) {
  const calls: { key: string; input?: string }[] = [];
  const gh = (args: string[], opts: { input?: string } = {}): GhResult => {
    let key: string;
    if (args[0] === 'api') {
      // `api [--method M] [-H ...] [--paginate] [--slurp] <path> [--input -]`
      const method = args.includes('--method') ? args[args.indexOf('--method') + 1] : null;
      const rest = args.slice(1);
      let path = '';
      for (let i = 0; i < rest.length; i += 1) {
        if (rest[i] === '--method' || rest[i] === '-H' || rest[i] === '--input') i += 1;
        else if (!rest[i].startsWith('--')) {
          path = rest[i];
          break;
        }
      }
      key = `api ${method ? `--method ${method} ` : ''}${path}`;
    } else {
      key = args.slice(0, 2).join(' ');
    }
    calls.push({ key, input: opts.input });
    const response = responses[key];
    if (response === undefined) {
      return { status: 1, stdout: '', stderr: `fake gh: no response for "${key}"` };
    }
    if (typeof response === 'object' && response !== null && 'status' in (response as object)) {
      const failure = response as { status: number; stderr?: string; body?: unknown };
      return {
        status: failure.status,
        stdout: failure.body === undefined ? '' : JSON.stringify(failure.body),
        stderr: failure.stderr ?? '',
      };
    }
    return { status: 0, stdout: JSON.stringify(response), stderr: '' };
  };
  return { gh, calls };
}

/** Labels as `--paginate --slurp` returns them: one array per page. */
function labelPages(labels: { name: string; color: string; description: string | null }[]) {
  return [labels];
}

const allLabels = LABELS.map((l: { name: string; color: string; description: string }) => ({
  ...l,
}));

describe('DESIRED.labels', () => {
  it('covers every label the automation uses, each with a color and description', () => {
    const names = Object.keys(DESIRED.labels);
    for (const required of [
      ...Array.from({ length: 10 }, (_, i) => `epic:E${i}`),
      'in-progress',
      'needs-human',
      'flaky-flow',
      'deep-dive',
      'e2e',
      'e2e:ios',
      'fingerprint-drift',
      'dependencies',
      // release-please's own names (with the space): .github/workflows/release-please.yml
      'autorelease: pending',
      'autorelease: tagged',
    ]) {
      expect(names).toContain(required);
    }
    for (const [name, { color, description }] of Object.entries(DESIRED.labels) as [
      string,
      { color: string; description: string },
    ][]) {
      expect(color).toMatch(/^[0-9a-f]{6}$/);
      expect(description.length).toBeGreaterThan(0);
      // Our labels have no whitespace at all; release-please's carry one inner space.
      expect(name).not.toMatch(/^\s|\s$/);
      expect(name.includes(' ') ? name.startsWith('autorelease: ') : true).toBe(true);
    }
  });
});

describe('endpoints (labels plan)', () => {
  it('POSTs missing labels, PATCHes drifted ones and skips labels that already match', () => {
    const [first, second, third] = allLabels;
    const { gh } = fakeGh({
      [`api repos/${SLUG}/labels?per_page=100`]: labelPages([
        first, // identical → no call
        { ...second, color: 'FFFFFF' }, // color drift → PATCH
        { ...third, description: null }, // description drift → PATCH
        { name: 'wontfix', color: 'ffffff', description: 'This will not be worked on' }, // unknown → untouched
      ]),
    });
    const calls = endpoints({ gh }, SLUG, ['labels']) as Record<string, Call>;
    const keys = Object.keys(calls);

    expect(keys).not.toContain(`label:${first.name}`);
    expect(keys).not.toContain('label:wontfix');
    expect(calls[`label:${second.name}`]).toEqual({
      method: 'PATCH',
      path: `repos/${SLUG}/labels/${encodeURIComponent(second.name)}`,
      body: { new_name: second.name, color: second.color, description: second.description },
    });
    expect(calls[`label:${third.name}`].method).toBe('PATCH');
    // Everything else is missing → POST with the name in the body.
    const posts = keys.filter((k) => calls[k].method === 'POST');
    expect(posts).toHaveLength(allLabels.length - 3);
    for (const key of posts) {
      expect(calls[key].path).toBe(`repos/${SLUG}/labels`);
      const name = key.slice('label:'.length);
      expect(calls[key].body).toEqual({ name, ...DESIRED.labels[name] });
    }
    // Never a DELETE.
    expect(Object.values(calls).map((c) => c.method)).not.toContain('DELETE');
  });

  it('URL-encodes label names with ":" in the PATCH path', () => {
    const { gh } = fakeGh({
      [`api repos/${SLUG}/labels?per_page=100`]: labelPages([
        { name: 'epic:E0', color: '000000', description: 'old' },
      ]),
    });
    const calls = endpoints({ gh }, SLUG, ['labels']) as Record<string, Call>;
    expect(calls['label:epic:E0'].path).toBe(`repos/${SLUG}/labels/epic%3AE0`);
  });

  it('--only filters the sections and keeps DESIRED order', () => {
    const { gh, calls: recorded } = fakeGh({});
    const protectionOnly = endpoints({ gh }, SLUG, ['protection']) as Record<string, Call>;
    expect(Object.keys(protectionOnly)).toEqual(['protection']);
    expect(protectionOnly.protection.path).toBe(`repos/${SLUG}/branches/main/protection`);

    const repoOnly = endpoints({ gh }, SLUG, ['repo']) as Record<string, Call>;
    expect(Object.keys(repoOnly)).toEqual(['repo']);
    // Neither section touches gh (no reviewer lookups, no label GET).
    expect(recorded).toEqual([]);
  });

  it('resolves environment reviewers to ids and rejects an organization login', () => {
    const { gh } = fakeGh({
      'api users/acme': { id: 42, type: 'User' },
      'api users/acme-org': { id: 7, type: 'Organization' },
      'api orgs/acme-org/teams/release': { id: 99 },
    });
    expect(resolveReviewer({ gh }, { type: 'User', login: 'acme' })).toEqual({
      type: 'User',
      id: 42,
    });
    expect(resolveReviewer({ gh }, { type: 'Team', login: 'acme-org/release' })).toEqual({
      type: 'Team',
      id: 99,
    });
    expect(() => resolveReviewer({ gh }, { type: 'User', login: 'acme-org' })).toThrow(
      /is an organization.*type: 'Team', login: 'acme-org\/<team-slug>'/,
    );
  });
});

describe('collectDrift (check projection)', () => {
  it('reports missing labels and color / description drift only, ignoring unknown labels', () => {
    const [first, second] = allLabels;
    const { gh } = fakeGh({
      [`api repos/${SLUG}/labels?per_page=100`]: labelPages([
        ...allLabels.filter((l: { name: string }) => l.name !== first.name),
        { name: 'bug', color: 'd73a4a', description: "Something isn't working" },
      ]).map((page) =>
        page.map((l) => (l.name === second.name ? { ...l, color: '123456', description: '' } : l)),
      ),
    });
    expect(collectDrift({ gh }, SLUG, ['labels'])).toEqual([
      `labels.${first.name}: missing`,
      `labels.${second.name}.color: want "${second.color}", got "123456"`,
      `labels.${second.name}.description: want ${JSON.stringify(second.description)}, got ""`,
    ]);
  });

  it('is empty when every desired label matches (case-insensitive color)', () => {
    const { gh } = fakeGh({
      [`api repos/${SLUG}/labels?per_page=100`]: labelPages(
        allLabels.map((l: { color: string }) => ({ ...l, color: l.color.toUpperCase() })),
      ),
    });
    expect(collectDrift({ gh }, SLUG, ['labels'])).toEqual([]);
  });

  it('only queries the requested sections', () => {
    const { gh, calls } = fakeGh({
      [`api repos/${SLUG}`]: { ...DESIRED.repo, allow_auto_merge: false },
    });
    expect(collectDrift({ gh }, SLUG, ['repo'])).toEqual([
      'repo.allow_auto_merge: want true, got false',
    ]);
    expect(calls.map((c) => c.key)).toEqual([`api repos/${SLUG}`]);
  });
});

describe('parseArgs', () => {
  it('defaults to a dry run over every section', () => {
    expect(parseArgs([])).toEqual({ mode: '--dry-run', only: SECTIONS });
  });

  it('accepts --only as a comma list, repeated, or with =, in DESIRED order', () => {
    expect(parseArgs(['--check', '--only', 'labels,repo'])).toEqual({
      mode: '--check',
      only: ['repo', 'labels'],
    });
    expect(parseArgs(['--only=labels', '--apply', '--only', 'protection'])).toEqual({
      mode: '--apply',
      only: ['protection', 'labels'],
    });
  });

  it('rejects unknown sections and flags', () => {
    expect(() => parseArgs(['--only', 'teams'])).toThrow(/unknown section teams/);
    expect(() => parseArgs(['--only'])).toThrow(/--only needs a value/);
    expect(() => parseArgs(['--nuke'])).toThrow(/unknown flag --nuke/);
  });
});

describe('main', () => {
  const silent = () => {};

  it('fails with a clear message when gh is not authenticated', () => {
    const { gh } = fakeGh({ 'auth status': { status: 1, stderr: 'You are not logged in' } });
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(main(['--check'], { gh, log: silent })).toBe(2);
    expect(error.mock.calls[0][0]).toMatch(
      /not authenticated.*You are not logged in.*gh auth login/,
    );
    error.mockRestore();
  });

  it('fails when the repo cannot be resolved from origin', () => {
    const { gh } = fakeGh({
      'auth status': {},
      'repo view': { status: 1, stderr: 'none of the git remotes configured' },
    });
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(main([], { gh, log: silent })).toBe(2);
    expect(error.mock.calls[0][0]).toMatch(/could not resolve the repo.*GH_REPO=owner\/name/);
    error.mockRestore();
  });

  it('--check --only labels exits 1 on drift and 0 when in sync', () => {
    const drifted = fakeGh({
      'auth status': {},
      'repo view': { nameWithOwner: SLUG },
      [`api repos/${SLUG}/labels?per_page=100`]: labelPages([]),
    });
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(main(['--check', '--only', 'labels'], { gh: drifted.gh, log: silent })).toBe(1);
    expect(error.mock.calls[0][0]).toContain('labels.epic:E0: missing');
    expect(error.mock.calls[0][0]).toContain('bun run repo:settings:apply');
    error.mockRestore();

    const synced = fakeGh({
      'auth status': {},
      'repo view': { nameWithOwner: SLUG },
      [`api repos/${SLUG}/labels?per_page=100`]: labelPages(allLabels),
    });
    const lines: string[] = [];
    expect(
      main(['--check', '--only=labels'], { gh: synced.gh, log: (l: string) => lines.push(l) }),
    ).toBe(0);
    expect(lines[0]).toContain(`${SLUG} matches desired state (sections: labels)`);
    // Only reads: auth, repo view, the labels GET.
    expect(synced.calls.map((c) => c.key)).toEqual([
      'auth status',
      'repo view',
      `api repos/${SLUG}/labels?per_page=100`,
    ]);
  });

  it('--apply --only labels writes exactly the upserts with the body on stdin', () => {
    const [first] = allLabels;
    const { gh, calls } = fakeGh({
      'auth status': {},
      'repo view': { nameWithOwner: SLUG },
      [`api repos/${SLUG}/labels?per_page=100`]: labelPages(
        allLabels.map((l: { name: string }) =>
          l.name === first.name ? { ...l, description: 'stale' } : l,
        ),
      ),
      [`api --method PATCH repos/${SLUG}/labels/${encodeURIComponent(first.name)}`]: {
        name: first.name,
      },
    });
    const lines: string[] = [];
    expect(main(['--apply', '--only', 'labels'], { gh, log: (l: string) => lines.push(l) })).toBe(
      0,
    );
    const writes = calls.filter((c) => c.key.includes('--method'));
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0].input as string)).toEqual({
      new_name: first.name,
      color: first.color,
      description: first.description,
    });
    expect(lines).toEqual([
      `repo:settings: applied label:${first.name} (PATCH repos/${SLUG}/labels/${encodeURIComponent(first.name)})`,
    ]);
  });
});
