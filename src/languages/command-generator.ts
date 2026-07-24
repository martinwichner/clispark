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
  /**
   * Optional hook: when present, add-wizard.ts calls this instead of its
   * built-in generic single-name prompt to collect the new command's full
   * path segments. Used by languages whose naming convention doesn't fit a
   * single free-form word (e.g. PowerShell's Verb+Noun cmdlet naming).
   */
  promptCommandIdentity?(pathSegments: string[], existingPaths: Set<string>): Promise<string[]>;
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
