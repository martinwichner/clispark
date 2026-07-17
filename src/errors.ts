// src/errors.ts

/** An expected, user-fixable failure (bad input, unmet precondition) — distinct from an unexpected crash. */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserError';
  }
}
