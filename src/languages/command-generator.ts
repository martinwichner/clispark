// src/languages/command-generator.ts

export interface ExistingCommandNode {
  path: string;
  displayLabel: string;
  children: ExistingCommandNode[];
}

export type ParameterType = 'string' | 'integer' | 'boolean' | 'enum';

export interface ParameterSpec {
  name: string;
  type: ParameterType;
  required: boolean;
  allowedValues?: string[];
}

export interface CommandSpec {
  pathSegments: string[];
  parameters: ParameterSpec[];
}

export interface GeneratedFiles {
  commandFile: string;
  testFile: string;
}

export interface CommandGenerator {
  listExistingCommands(targetDir: string): Promise<ExistingCommandNode[]>;
  generateCommand(targetDir: string, spec: CommandSpec): Promise<GeneratedFiles>;
}

/** Builds a tree of ExistingCommandNode from a flat list of space-separated command paths. */
export function buildCommandTree(paths: string[]): ExistingCommandNode[] {
  const nodesByPath = new Map<string, ExistingCommandNode>();
  const roots: ExistingCommandNode[] = [];

  function getOrCreateNode(nodePath: string): ExistingCommandNode {
    let node = nodesByPath.get(nodePath);
    if (!node) {
      const segments = nodePath.split(' ');
      node = { path: nodePath, displayLabel: segments.join(' > '), children: [] };
      nodesByPath.set(nodePath, node);
      if (segments.length === 1) {
        roots.push(node);
      } else {
        const parent = getOrCreateNode(segments.slice(0, -1).join(' '));
        parent.children.push(node);
      }
    }
    return node;
  }

  for (const p of paths) {
    getOrCreateNode(p);
  }

  return roots;
}
