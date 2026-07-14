import { afterEach, beforeEach, expect, it, vi } from 'bun:test';
import { auth } from '@utils-plane/auth';
import { AccountController } from './account.controller';

const accountService = {
  getSummary: vi.fn(),
  deleteAccount: vi.fn(),
};
const exportService = {
  prepareExport: vi.fn(),
  writeExport: vi.fn(),
};

function createController() {
  return new AccountController(accountService as never, exportService as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  accountService.deleteAccount.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

it('expires Better-Auth token, cache, and chunk cookies in the delete response', async () => {
  const response = { setHeader: vi.fn() };
  const request = {
    headers: {
      cookie: [
        'better-auth.session_token=invalid-token',
        'better-auth.session_data.0=part-zero',
        'better-auth.session_data.1=part-one',
      ].join('; '),
    },
  };

  await createController().deleteAccount(
    { id: 'user-1' } as never,
    { confirmationEmail: 'owner@example.com' },
    request as never,
    response as never
  );

  expect(accountService.deleteAccount).toHaveBeenCalledWith(
    'user-1',
    'owner@example.com'
  );
  expect(response.setHeader).toHaveBeenCalledTimes(1);
  const [header, cookies] = response.setHeader.mock.calls[0] as [
    string,
    string[],
  ];
  expect(header).toBe('set-cookie');
  for (const name of [
    'better-auth.session_token',
    'better-auth.session_data',
    'better-auth.session_data.0',
    'better-auth.session_data.1',
  ]) {
    expect(cookies.some(cookie => cookie.startsWith(`${name}=`))).toBe(true);
  }
  expect(cookies.every(cookie => cookie.includes('Max-Age=0'))).toBe(true);
});

it('does not turn completed account deletion into a failure when sign-out fails', async () => {
  vi.spyOn(auth.api, 'signOut').mockRejectedValue(
    new Error('session cleanup unavailable')
  );
  const response = { setHeader: vi.fn() };

  await expect(
    createController().deleteAccount(
      { id: 'user-1' } as never,
      { confirmationEmail: 'owner@example.com' },
      { headers: {} } as never,
      response as never
    )
  ).resolves.toBeUndefined();

  expect(accountService.deleteAccount).toHaveBeenCalledTimes(1);
  expect(response.setHeader).not.toHaveBeenCalled();
});
