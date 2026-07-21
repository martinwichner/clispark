// src/add-wizard.ts
import { intro, outro, select, text, confirm, isCancel, cancel, log } from '@clack/prompts';
import type {
  CommandGenerator,
  CommandSpec,
  ExistingCommandNode,
  ParameterSpec,
  ParameterType,
} from './languages/command-generator';

export interface AddWizardDeps {
  commandGenerator: CommandGenerator;
}

function exitIfCancelled(value: unknown): void {
  if (isCancel(value)) {
    cancel('Operation cancelled.');
    process.exit(1);
  }
}

const NEW_TOP_LEVEL = '__new_top_level__';
const HERE = '__here__';

function flattenForMenu(nodes: ExistingCommandNode[]): { value: string; label: string }[] {
  const result: { value: string; label: string }[] = [];
  for (const node of nodes) {
    result.push({ value: node.path, label: node.displayLabel });
    result.push(...flattenForMenu(node.children));
  }
  return result;
}

function findNode(nodes: ExistingCommandNode[], targetPath: string): ExistingCommandNode | undefined {
  for (const node of nodes) {
    if (node.path === targetPath) return node;
    const found = findNode(node.children, targetPath);
    if (found) return found;
  }
  return undefined;
}

async function selectWithinNode(node: ExistingCommandNode): Promise<string[]> {
  if (node.children.length === 0) {
    return node.path.split(' ');
  }

  const options = [
    { value: HERE, label: `Direct subcommand of "${node.path}"` },
    ...node.children.map((child) => ({ value: child.path, label: `Under "${child.path}"` })),
  ];
  const choice = await select({ message: `Where under "${node.path}"?`, options });
  exitIfCancelled(choice);

  if (choice === HERE) {
    return node.path.split(' ');
  }
  const childNode = node.children.find((c) => c.path === choice)!;
  return selectWithinNode(childNode);
}

async function selectPath(existing: ExistingCommandNode[]): Promise<string[]> {
  const options = [{ value: NEW_TOP_LEVEL, label: 'New top-level command' }, ...flattenForMenu(existing)];
  const choice = await select({ message: 'Where should the new command go?', options });
  exitIfCancelled(choice);

  if (choice === NEW_TOP_LEVEL) {
    return [];
  }

  const node = findNode(existing, choice as string)!;
  return selectWithinNode(node);
}

function flattenPaths(nodes: ExistingCommandNode[]): string[] {
  return nodes.flatMap((node) => [node.path, ...flattenPaths(node.children)]);
}

async function collectParameters(): Promise<ParameterSpec[]> {
  const parameters: ParameterSpec[] = [];
  let hasOptional = false;

  for (;;) {
    const addMore = await confirm({
      message: parameters.length === 0 ? 'Add a parameter?' : 'Add another parameter?',
    });
    exitIfCancelled(addMore);
    if (!addMore) break;

    const nameValue = await text({
      message: 'Parameter name',
      validate: (value) => {
        if (!/^[a-z][a-zA-Z0-9]*$/.test(value)) return 'Use a single word starting with a lowercase letter.';
        if (parameters.some((p) => p.name === value)) return 'A parameter with this name already exists.';
        return undefined;
      },
    });
    exitIfCancelled(nameValue);
    const name = nameValue as string;

    const typeValue = await select({
      message: 'Parameter type',
      options: [
        { value: 'string', label: 'String' },
        { value: 'integer', label: 'Integer' },
        { value: 'boolean', label: 'Boolean' },
        { value: 'enum', label: 'String with allowed values' },
      ],
    });
    exitIfCancelled(typeValue);
    const type = typeValue as ParameterType;

    let required = false;
    if (type !== 'boolean') {
      const options = hasOptional
        ? [{ value: false, label: 'Optional' }]
        : [
            { value: true, label: 'Required' },
            { value: false, label: 'Optional' },
          ];
      const requiredValue = await select({ message: 'Required or optional?', options });
      exitIfCancelled(requiredValue);
      required = requiredValue as boolean;
    }
    if (!required) hasOptional = true;

    let allowedValues: string[] | undefined;
    if (type === 'enum') {
      const valuesInput = await text({
        message: 'Allowed values (comma-separated)',
        validate: (value) => {
          const values = value
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean);
          if (values.length < 2) return 'Enter at least two comma-separated values.';
          for (const v of values) {
            if (!/^[A-Za-z0-9_-]+$/.test(v)) {
              return `Invalid value "${v}": use only letters, numbers, hyphens, and underscores.`;
            }
          }
          return undefined;
        },
      });
      exitIfCancelled(valuesInput);
      allowedValues = (valuesInput as string)
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
    }

    parameters.push({ name, type, required, allowedValues });
  }

  return parameters;
}

export async function runAddWizard(targetDir: string, deps: AddWizardDeps): Promise<void> {
  intro('clispark add — add a new command');

  const existing = await deps.commandGenerator.listExistingCommands(targetDir);
  const pathSegments = await selectPath(existing);
  const existingPaths = new Set(flattenPaths(existing));

  const nameValue = await text({
    message: 'Command name',
    validate: (value) => {
      if (!/^[a-z][a-zA-Z0-9]*$/.test(value)) return 'Use a single word starting with a lowercase letter.';
      const fullPath = [...pathSegments, value].join(' ');
      if (existingPaths.has(fullPath)) return `"${fullPath}" already exists.`;
      return undefined;
    },
  });
  exitIfCancelled(nameValue);
  const fullPathSegments = [...pathSegments, nameValue as string];

  const parameters = await collectParameters();

  log.info(`About to create "${fullPathSegments.join(' ')}" with ${parameters.length} parameter(s).`);
  const proceed = await confirm({ message: 'Proceed?' });
  exitIfCancelled(proceed);
  if (!proceed) {
    cancel('Cancelled.');
    process.exit(1);
  }

  const spec: CommandSpec = { pathSegments: fullPathSegments, parameters };
  const result = await deps.commandGenerator.generateCommand(targetDir, spec);

  outro(`Created ${result.commandFile} and ${result.testFile}.`);
}
