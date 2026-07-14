import { describe, expect, it, vi } from 'bun:test';
import { ArgumentsHost, HttpException } from '@nestjs/common';
import { AllExceptionsFilter } from './http-exception.filter';

function createHttpHost(options?: {
  headersSent?: boolean;
  destroyed?: boolean;
}) {
  const jsonCalls: unknown[] = [];
  let statusCode: number | undefined;
  const destroy = vi.fn();

  const response = {
    headersSent: options?.headersSent ?? false,
    destroyed: options?.destroyed ?? false,
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(body: unknown) {
      jsonCalls.push(body);
      return this;
    },
    destroy,
  };

  const host = {
    switchToHttp() {
      return {
        getResponse: () => response,
        getRequest: () => ({ url: '/test' }),
      };
    },
  } as unknown as ArgumentsHost;

  return { host, jsonCalls, destroy, getStatusCode: () => statusCode };
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

  it('does not write another response after the stream was destroyed', () => {
    const filter = new AllExceptionsFilter();
    const { host, jsonCalls, destroy, getStatusCode } = createHttpHost({
      destroyed: true,
    });

    filter.catch(new Error('stream failed'), host);

    expect(getStatusCode()).toBeUndefined();
    expect(jsonCalls).toHaveLength(0);
    expect(destroy).not.toHaveBeenCalled();
  });

  it('destroys a headers-sent stream instead of writing error JSON', () => {
    const filter = new AllExceptionsFilter();
    const { host, jsonCalls, destroy, getStatusCode } = createHttpHost({
      headersSent: true,
    });

    filter.catch(new Error('source stream failed'), host);

    expect(getStatusCode()).toBeUndefined();
    expect(jsonCalls).toHaveLength(0);
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
