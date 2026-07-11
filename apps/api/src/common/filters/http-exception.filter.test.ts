import { describe, expect, it } from 'bun:test';
import { ArgumentsHost, HttpException } from '@nestjs/common';
import { AllExceptionsFilter } from './http-exception.filter';

function createHttpHost() {
  const jsonCalls: unknown[] = [];
  let statusCode: number | undefined;

  const response = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(body: unknown) {
      jsonCalls.push(body);
      return this;
    },
  };

  const host = {
    switchToHttp() {
      return {
        getResponse: () => response,
        getRequest: () => ({ url: '/test' }),
      };
    },
  } as unknown as ArgumentsHost;

  return { host, jsonCalls, getStatusCode: () => statusCode };
}

describe('AllExceptionsFilter', () => {
  it('handles HttpException responses that are null without throwing', () => {
    const filter = new AllExceptionsFilter();
    const { host, jsonCalls, getStatusCode } = createHttpHost();

    filter.catch(new HttpException(null, 400), host);

    expect(getStatusCode()).toBe(400);
    expect(jsonCalls).toHaveLength(1);
    expect(jsonCalls[0]).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      path: '/test',
    });
  });
});
