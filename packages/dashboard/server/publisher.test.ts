import { describe, expect, it } from 'vitest';
import { isAuthorizedPublisher } from './publisher.js';

describe('isAuthorizedPublisher', () => {
  it('always allows loopback', () => {
    expect(
      isAuthorizedPublisher({
        remote: false,
        allowRemote: false,
        token: undefined,
        expectedToken: undefined,
      })
    ).toBe(true);
  });

  it('rejects a remote publisher unless the split flag and a matching token are set', () => {
    expect(
      isAuthorizedPublisher({
        remote: true,
        allowRemote: false,
        token: 'secret',
        expectedToken: 'secret',
      })
    ).toBe(false);
    expect(
      isAuthorizedPublisher({
        remote: true,
        allowRemote: true,
        token: 'secret',
        expectedToken: undefined,
      })
    ).toBe(false);
    expect(
      isAuthorizedPublisher({
        remote: true,
        allowRemote: true,
        token: 'wrong',
        expectedToken: 'secret',
      })
    ).toBe(false);
    expect(
      isAuthorizedPublisher({
        remote: true,
        allowRemote: true,
        token: 'secret',
        expectedToken: 'secret',
      })
    ).toBe(true);
  });
});
