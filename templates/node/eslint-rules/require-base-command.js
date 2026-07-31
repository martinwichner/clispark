// templates/node/eslint-rules/require-base-command.js
import { ESLintUtils } from '@typescript-eslint/utils';

const createRule = ESLintUtils.RuleCreator(() => 'https://github.com/martinwichner/clispark');

function extendsBaseCommandChain(classType, checker) {
  const visited = new Set();
  function walk(type) {
    const symbol = type.getSymbol();
    if (symbol?.getName() === 'BaseCommand') return true;
    const key = symbol?.getName() ?? type.toString();
    if (visited.has(key)) return false;
    visited.add(key);
    const baseTypes = checker.getBaseTypes(type) ?? [];
    return baseTypes.some((base) => walk(base));
  }
  return walk(classType);
}

export default createRule({
  name: 'require-base-command',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Every discovered command class must (transitively) extend BaseCommand, or it silently loses shared logging/error-handling.',
    },
    messages: {
      mustExtendBaseCommand:
        'Command classes in src/commands/** must extend BaseCommand (directly or via an intermediate base class), not {{actual}}.',
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    const services = ESLintUtils.getParserServices(context);
    const checker = services.program.getTypeChecker();

    return {
      'ExportDefaultDeclaration > ClassDeclaration'(node) {
        const classType = services.getTypeAtLocation(node);
        if (!extendsBaseCommandChain(classType, checker)) {
          const actual = node.superClass ? context.sourceCode.getText(node.superClass) : 'nothing';
          context.report({ node, messageId: 'mustExtendBaseCommand', data: { actual } });
        }
      },
    };
  },
});
