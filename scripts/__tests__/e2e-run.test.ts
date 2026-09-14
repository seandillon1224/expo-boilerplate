/* eslint-disable @typescript-eslint/no-require-imports -- plain-Node script under test; no @types/node */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pickSimulator, selectedFlows } = require('../e2e-run');

// --- selectedFlows ----------------------------------------------------------------------------

/**
 * The selection has to agree with the `--include-tags` / `--exclude-tags` pair the script hands
 * Maestro, or the "N flow(s) tagged x" notice lies and — worse — a run with nothing selected exits
 * 0 by claiming there is nothing to run. Tags are read from the YAML header only.
 */
const FLOWS: Record<string, string> = {
  'fetch.yaml':
    'name: native/fetch\ntags: [ios, android]\n---\n- runFlow: ../subflows/launch.yaml\n',
  'ios-only.yaml': 'name: native/ios-only\ntags: [ios]\n---\n- launchApp\n',
  'android-only.yml': 'name: native/android-only\ntags: [android]\n---\n- launchApp\n',
  'flaky.yaml':
    '# quarantined, see docs/native-e2e.md\nname: flaky\ntags: [ios, android, quarantine]\n---\n- launchApp\n',
  'web-only.yaml': 'name: web/smoke\ntags: [web]\n---\n- launchApp\n',
  'untagged.yaml': 'name: no-tags\n---\n- launchApp\n',
  // A `tags:` line in the *body* must not count: only the header (before the first `---`) does.
  'body-tags.yaml': 'name: body\n---\n- runFlow:\n    file: x.yaml\ntags: [ios]\n',
  'notes.md': 'not a flow',
  'config.json': '{}',
};

let flowsDir: string;

beforeAll(() => {
  flowsDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-run-')), 'flows');
  fs.mkdirSync(flowsDir, { recursive: true });
  for (const [file, contents] of Object.entries(FLOWS)) {
    fs.writeFileSync(path.join(flowsDir, file), contents);
  }
});

describe('selectedFlows', () => {
  it('selects the platform tag and excludes quarantine, like the gate', () => {
    expect(selectedFlows('ios', false, flowsDir).sort()).toEqual(['fetch.yaml', 'ios-only.yaml']);
    expect(selectedFlows('android', false, flowsDir).sort()).toEqual([
      'android-only.yml',
      'fetch.yaml',
    ]);
  });

  it('selects only quarantined flows for --quarantine-only, whatever the platform', () => {
    expect(selectedFlows('ios', true, flowsDir)).toEqual(['flaky.yaml']);
    expect(selectedFlows('android', true, flowsDir)).toEqual(['flaky.yaml']);
  });

  it('ignores non-yaml files, untagged flows and web-only flows', () => {
    const all = [
      ...selectedFlows('ios', false, flowsDir),
      ...selectedFlows('android', false, flowsDir),
    ];
    expect(all).not.toContain('notes.md');
    expect(all).not.toContain('config.json');
    expect(all).not.toContain('untagged.yaml');
    expect(all).not.toContain('web-only.yaml');
  });

  it('reads tags from the header only, not from the flow body', () => {
    expect(selectedFlows('ios', false, flowsDir)).not.toContain('body-tags.yaml');
  });

  it('returns an empty list when the flows directory does not exist', () => {
    expect(selectedFlows('ios', false, path.join(flowsDir, 'nope'))).toEqual([]);
  });

  it('matches the checked-in .maestro/flows (native entries are tagged for both platforms)', () => {
    const real = path.join(process.cwd(), '.maestro', 'flows');
    const ios = selectedFlows('ios', false, real);
    expect(ios.length).toBeGreaterThan(0);
    expect(selectedFlows('android', false, real).sort()).toEqual(ios.sort());
  });
});

// --- pickSimulator ----------------------------------------------------------------------------

type Sim = { udid: string; name: string; state: string; isAvailable: boolean };

const sim = (name: string, udid: string, state = 'Shutdown', isAvailable = true): Sim => ({
  udid,
  name,
  state,
  isAvailable,
});

const RUNTIME = (major: number, minor: number) =>
  `com.apple.CoreSimulator.SimRuntime.iOS-${major}-${minor}`;

/** A stand-in for `runJson` that returns a canned `xcrun simctl list -j devices available`. */
const listing = (devices: Record<string, Sim[]>) => jest.fn().mockReturnValue({ devices });

describe('pickSimulator', () => {
  const devices = {
    [RUNTIME(18, 4)]: [sim('iPhone 16 Pro', 'old-16-pro'), sim('iPhone 16', 'old-16')],
    [RUNTIME(26, 0)]: [
      sim('iPhone 17', 'new-17'),
      sim('iPhone 17 Pro', 'new-17-pro'),
      sim('iPad Pro 13-inch', 'ipad'),
      sim('iPhone 18 Pro', 'unavailable', 'Shutdown', false),
    ],
    [RUNTIME(26, 2)]: [sim('iPhone 17', 'newest-17')],
  };

  it('queries xcrun for the available device list', () => {
    const list = listing(devices);
    pickSimulator('/usr/bin/xcrun', undefined, list);
    expect(list).toHaveBeenCalledWith('e2e:run', '/usr/bin/xcrun', [
      'simctl',
      'list',
      '-j',
      'devices',
      'available',
    ]);
  });

  it('picks the newest runtime, then the highest model, Pro over non-Pro', () => {
    expect(pickSimulator('xcrun', undefined, listing(devices)).udid).toBe('newest-17');
    const withoutNewest = { ...devices, [RUNTIME(26, 2)]: [] };
    expect(pickSimulator('xcrun', undefined, listing(withoutNewest)).udid).toBe('new-17-pro');
  });

  it('prefers an already-booted simulator over the newest one', () => {
    const booted = {
      ...devices,
      [RUNTIME(18, 4)]: [sim('iPhone 16', 'old-16', 'Booted')],
    };
    expect(pickSimulator('xcrun', undefined, listing(booted)).udid).toBe('old-16');
  });

  it('ignores iPads and unavailable devices', () => {
    const onlyOthers = {
      [RUNTIME(26, 0)]: [
        sim('iPad Pro 13-inch', 'ipad', 'Booted'),
        sim('Apple Watch Series 10', 'watch'),
      ],
    };
    expect(() => pickSimulator('xcrun', undefined, listing(onlyOthers))).toThrow(
      /no iPhone simulator available/,
    );
    const onlyUnavailable = {
      [RUNTIME(26, 0)]: [sim('iPhone 17', 'nope', 'Shutdown', false)],
    };
    expect(() => pickSimulator('xcrun', undefined, listing(onlyUnavailable))).toThrow(
      /no iPhone simulator available/,
    );
  });

  it('honours --device by udid or by name', () => {
    expect(pickSimulator('xcrun', 'old-16', listing(devices)).name).toBe('iPhone 16');
    expect(pickSimulator('xcrun', 'iPhone 16 Pro', listing(devices)).udid).toBe('old-16-pro');
  });

  it('fails when --device names something that is not an available iPhone', () => {
    expect(() => pickSimulator('xcrun', 'iPad Pro 13-inch', listing(devices))).toThrow(
      /simulator `iPad Pro 13-inch` is not an available iPhone/,
    );
    expect(() => pickSimulator('xcrun', 'unavailable', listing(devices))).toThrow(
      /is not an available iPhone/,
    );
  });

  it('carries the runtime through so the caller can print it', () => {
    const chosen = pickSimulator('xcrun', undefined, listing(devices));
    expect(chosen.runtime).toBe(RUNTIME(26, 2));
    expect(chosen.version).toEqual([26, 2]);
  });
});
