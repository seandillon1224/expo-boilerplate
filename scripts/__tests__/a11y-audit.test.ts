/* eslint-disable @typescript-eslint/no-require-imports -- plain-Node script under test; no @types/node */
const {
  SCREENS,
  auditScreen,
  extractInteractiveIds,
  flattenNodes,
  labelOf,
  parseHierarchy,
  renderTable,
} = require('../a11y-audit');
const fs = require('node:fs');
const path = require('node:path');

type Element = { id: string; label: string; hint: string; problems: string[] };

const attrs = (overrides: Record<string, string>) => ({
  accessibilityText: '',
  title: '',
  value: '',
  text: '',
  hintText: '',
  'resource-id': '',
  bounds: '[0,0][10,10]',
  enabled: 'true',
  focused: 'false',
  selected: 'false',
  checked: 'false',
  ...overrides,
});
const node = (a: Record<string, string>, children: unknown[] = []) => ({
  attributes: attrs(a),
  children,
});

describe('extractInteractiveIds', () => {
  const source = `
    <View testID="home-screen">
      <Link href="/fetch" testID="home-fetch-link" onPress={() => go()}>{t('x')}</Link>
      <Pressable testID={'quoted-expr'} onPress={() => setOpen((o) => !o)} />
      <TouchableOpacity
        testID='single'
        style={{ padding: 4 }}
      >
        <Text>hi</Text>
      </TouchableOpacity>
      <Pressable testID={retryTestID} onPress={onRetry} />
      <NativeTabs.Trigger name="(home)" testID="tab-home" />
      <Native.Pressable testID="member-expr" />
      <Button {...props} />
      <TextInput {...rest} testID="input" />
      <Switch value={on} onValueChange={(v) => set(v)} testID={\`row-\${id}\`} />
    </View>`;

  it('collects literal testIDs, skipping containers and elements outside the set', () => {
    const { literal } = extractInteractiveIds(source);
    expect(literal).toEqual(['home-fetch-link', 'quoted-expr', 'single', 'member-expr', 'input']);
  });

  it('lists dynamic testIDs and spread-only elements as unaudited', () => {
    const { dynamic } = extractInteractiveIds(source);
    expect(dynamic).toEqual([
      { element: 'Pressable', expression: 'testID={retryTestID}' },
      { element: 'Button', expression: '{...spread}' },
      { element: 'Switch', expression: 'testID={`row-${id}`}' },
    ]);
  });

  it('does not confuse an arrow function or a string with the end of the tag', () => {
    const { literal } = extractInteractiveIds(
      `<Pressable onPress={() => x > 1} label=">" testID="after-gt" />`,
    );
    expect(literal).toEqual(['after-gt']);
  });
});

describe('parseHierarchy', () => {
  const tree = { attributes: attrs({ 'resource-id': 'root' }), children: [] };

  it('parses plain JSON', () => {
    expect(parseHierarchy(JSON.stringify(tree, null, 2))).toEqual(tree);
  });

  it('skips non-JSON preamble lines', () => {
    const text = `WARNING: A restricted method in java.lang.System has been called\nUsing device 1234\n${JSON.stringify(tree)}\n`;
    expect(parseHierarchy(text)).toEqual(tree);
  });

  it('throws when there is no JSON at all', () => {
    expect(() => parseHierarchy('no device connected')).toThrow(/no JSON object/);
  });

  it('flattens the nested attributes in document order', () => {
    const nested = node({ 'resource-id': 'a' }, [
      node({ 'resource-id': 'b' }, [node({ 'resource-id': 'c' })]),
      node({ 'resource-id': 'd' }),
    ]);
    expect(flattenNodes(nested).map((n: { 'resource-id': string }) => n['resource-id'])).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });
});

describe('labelOf', () => {
  it('prefers accessibilityText, then text, then title, trimmed', () => {
    expect(labelOf(attrs({ accessibilityText: ' Open ', text: 'x', title: 'y' }))).toBe('Open');
    expect(labelOf(attrs({ text: ' Fetch ' }))).toBe('Fetch');
    expect(labelOf(attrs({ title: 'Title' }))).toBe('Title');
    expect(labelOf(attrs({ accessibilityText: '   ' }))).toBe('');
  });
});

describe('auditScreen', () => {
  const interactive = new Set([
    'home-fetch-link',
    'settings-sentry-test',
    'updates-check',
    'updates-apply',
  ]);

  it('passes a screen where every interactive element has a unique, real label', () => {
    const tree = node({ 'resource-id': 'home-screen' }, [
      node({ 'resource-id': 'home-fetch-link', accessibilityText: 'Fetch example' }),
      node({
        'resource-id': 'settings-sentry-test',
        text: 'Send test error',
        hintText: 'Sends nothing',
      }),
      node({ 'resource-id': 'not-interactive', accessibilityText: '' }),
    ]);
    const { elements, violations } = auditScreen(tree, interactive);
    expect(violations).toBe(0);
    expect(elements).toEqual([
      { id: 'home-fetch-link', label: 'Fetch example', hint: '', problems: [] },
      { id: 'settings-sentry-test', label: 'Send test error', hint: 'Sends nothing', problems: [] },
    ]);
  });

  it('flags an empty label, a leaked testID and duplicate labels', () => {
    const tree = node({ 'resource-id': 'updates-screen' }, [
      node({ 'resource-id': 'home-fetch-link' }),
      node({ 'resource-id': 'settings-sentry-test', accessibilityText: 'settings-sentry-test' }),
      node({ 'resource-id': 'updates-check', accessibilityText: 'Update' }),
      node({ 'resource-id': 'updates-apply', accessibilityText: 'Update' }),
    ]);
    const { elements, violations } = auditScreen(tree, interactive);
    expect(violations).toBe(4);
    const problems = Object.fromEntries(elements.map((e: Element) => [e.id, e.problems]));
    expect(problems['home-fetch-link']).toEqual([
      'empty label: the screen reader has nothing to announce',
    ]);
    expect(problems['settings-sentry-test']).toEqual(['label is the raw testID']);
    expect(problems['updates-check']).toEqual(['duplicate label, also on updates-apply']);
    expect(problems['updates-apply']).toEqual(['duplicate label, also on updates-check']);
  });

  it('merges nodes sharing a resource-id and takes the first non-empty label', () => {
    const tree = node({ 'resource-id': 'updates-check' }, [
      node({ 'resource-id': 'updates-check', accessibilityText: 'Check for updates' }),
    ]);
    const { elements, violations } = auditScreen(tree, interactive);
    expect(violations).toBe(0);
    expect(elements).toEqual([
      { id: 'updates-check', label: 'Check for updates', hint: '', problems: [] },
    ]);
  });

  it('ignores interactive ids that are not on this screen', () => {
    expect(auditScreen(node({ 'resource-id': 'settings-screen' }), interactive)).toEqual({
      elements: [],
      violations: 0,
    });
  });
});

describe('manifest and output', () => {
  it('points every screen at an existing landing subflow', () => {
    for (const { screen, flow } of SCREENS) {
      const file = path.join(process.cwd(), flow);
      expect(fs.existsSync(file)).toBe(true);
      const yaml = fs.readFileSync(file, 'utf8');
      expect(yaml).toMatch(/^appId: \$\{MAESTRO_APP_ID\}$/m);
      expect(yaml).toContain(`id: ${screen}-screen`);
    }
  });

  it('renders one table row per element and a placeholder row for a failed screen', () => {
    const table = renderTable({
      screens: [
        {
          screen: 'home',
          status: 'ok',
          elements: [{ id: 'home-fetch-link', label: 'Fetch', hint: '', problems: [] }],
        },
        { screen: 'fetch', status: 'nav-failed', error: 'nav flow exited 1', elements: [] },
      ],
    });
    expect(table.split('\n')).toEqual([
      'screen  status      id               label  problems',
      'home    ok          home-fetch-link  Fetch',
      'fetch   nav-failed  —                —      nav flow exited 1',
    ]);
  });
});
