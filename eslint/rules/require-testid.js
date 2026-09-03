/**
 * require-testid: interactive elements must carry a literal `testID` so Maestro
 * flows select by id, never by text. A spread (`{...props}`) counts as satisfied
 * because wrappers forward it.
 */
const DEFAULT_ELEMENTS = [
  'Pressable',
  'TouchableOpacity',
  'TouchableHighlight',
  'TouchableWithoutFeedback',
  'Button',
  'TextInput',
  'Switch',
  'Link',
];

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: { description: 'require testID on interactive elements for E2E stability' },
    schema: [
      {
        type: 'object',
        properties: { elements: { type: 'array', items: { type: 'string' } } },
        additionalProperties: false,
      },
    ],
    messages: { missing: '<{{name}}> needs a testID so Maestro can target it.' },
  },
  create(context) {
    const elements = new Set(
      (context.options[0] && context.options[0].elements) || DEFAULT_ELEMENTS,
    );
    return {
      JSXOpeningElement(node) {
        const name =
          node.name.type === 'JSXIdentifier'
            ? node.name.name
            : node.name.type === 'JSXMemberExpression'
              ? node.name.property.name
              : null;
        if (!name || !elements.has(name)) return;
        const ok = node.attributes.some(
          (a) =>
            a.type === 'JSXSpreadAttribute' ||
            (a.type === 'JSXAttribute' && a.name && a.name.name === 'testID'),
        );
        if (!ok) context.report({ node, messageId: 'missing', data: { name } });
      },
    };
  },
};
