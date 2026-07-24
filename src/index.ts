// src/index.ts
export interface PostScaffoldHookContext {
  projectName: string;
  targetDir: string;
  language: string;
  registryUrl?: string;
  publishIntent?: boolean;
}

export type PostScaffoldHook = (context: PostScaffoldHookContext) => void | Promise<void>;
