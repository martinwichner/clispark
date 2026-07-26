import { createProgram } from './program';

createProgram()
  .parseAsync(process.argv)
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
