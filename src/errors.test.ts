import { describe, it, expect } from 'vitest';
import { UserError } from './errors';

describe('UserError', () => {
  it('is a real Error subclass with the expected name and message', () => {
    const error = new UserError('something the user needs to fix');

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(UserError);
    expect(error.name).toBe('UserError');
    expect(error.message).toBe('something the user needs to fix');
  });
});
