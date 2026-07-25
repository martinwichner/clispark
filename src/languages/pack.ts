import type { UpdateAdapter } from '../update/adapter';
import type { RegistryChecker } from './registry-checker';
import type { CommandGenerator } from './command-generator';

export interface ScaffoldCommand {
  command: string;
  args: string[];
}

export interface LanguageRegistry extends RegistryChecker {
  /** Shown as the default value / used when the wizard's registry-URL question is skipped. */
  defaultUrl: string;
  /** Wizard prompt label for the custom-registry-URL question, e.g. "Custom npm registry URL". */
  promptLabel: string;
}

/**
 * Isolates everything template/language-specific from the generic wizard,
 * scaffold, and CLI-composition layers: where the template lives, which
 * commands turn a fresh copy into a working project, how project names are
 * validated, how the package registry is queried, how new commands are
 * generated for an already-scaffolded project (via `clispark add`), and (via
 * the existing `UpdateAdapter` from M11 Tier 3) how the update system
 * reads/writes/merges this language's package manifest. One concrete
 * implementation exists today (`packs/node-oclif.ts`); a future non-Node
 * template adds a sibling pack without touching `wizard.ts`, `scaffold.ts`,
 * `update.ts`, `add.ts`, or `manifest.ts`.
 */
export interface LanguagePack {
  readonly id: string;
  readonly displayName: string;
  readonly templateDir: string;
  readonly scaffoldCommands: readonly ScaffoldCommand[];
  validateProjectName(value: string): string | undefined;
  readonly updateAdapter: UpdateAdapter;
  readonly registry: LanguageRegistry;
  readonly commandGenerator: CommandGenerator;
  readonly stripLintTooling: (targetDir: string) => Promise<void>;
  readonly supportsAutocompleteOptIn: boolean;
  readonly stripAutocompleteSupport: (targetDir: string) => Promise<void>;
}
