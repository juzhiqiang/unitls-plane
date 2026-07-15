import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import {
  IS_PUBLIC_KEY,
  SKIP_SESSION_KEY,
} from '../../common/decorators/public.decorator';
import { HealthController } from './health.controller';

const API_RESPONSE_METADATA = 'swagger/apiResponse';
const THROTTLER_SKIP_DEFAULT = 'THROTTLER:SKIPdefault';

const liveResult = {
  status: 'ok' as const,
  timestamp: '2026-07-15T08:00:00.000Z',
  startedAt: '2026-07-15T07:00:00.000Z',
  release: 'beta-1',
  buildCommit: 'abc1234',
  buildTime: '2026-07-15T07:30:00.000Z',
};

const healthService = {
  live: vi.fn(() => liveResult),
  ready: vi.fn(),
};

function createController() {
  return new HealthController(healthService as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('HealthController live routes', () => {
  it('returns the live result from the health summary route', () => {
    const result = createController().check();

    expect(result).toBe(liveResult);
    expect(result).not.toHaveProperty('commit');
    expect(healthService.live).toHaveBeenCalledTimes(1);
  });

  it('returns the live result from the explicit live route', () => {
    const result = createController().live();

    expect(result).toBe(liveResult);
    expect(result).not.toHaveProperty('commit');
    expect(healthService.live).toHaveBeenCalledTimes(1);
  });
});

describe('HealthController ready route', () => {
  it('maps readiness to the HTTP status without exposing httpStatus in the body', async () => {
    healthService.ready.mockResolvedValue({
      status: 'error',
      timestamp: '2026-07-15T08:00:00.000Z',
      httpStatus: 503,
      components: {
        database: { status: 'error', durationMs: 5 },
        redis: { status: 'ok', durationMs: 1 },
        minio: { status: 'ok', durationMs: 1 },
        queues: { status: 'ok', durationMs: 2 },
        libreOffice: { status: 'ok', durationMs: 3 },
      },
    });
    const response = { status: vi.fn() };

    const body = await createController().ready(response as never);

    expect(response.status).toHaveBeenCalledWith(503);
    expect(body).toEqual({
      status: 'error',
      timestamp: '2026-07-15T08:00:00.000Z',
      components: {
        database: { status: 'error', durationMs: 5 },
        redis: { status: 'ok', durationMs: 1 },
        minio: { status: 'ok', durationMs: 1 },
        queues: { status: 'ok', durationMs: 2 },
        libreOffice: { status: 'ok', durationMs: 3 },
      },
    });
    expect(body).not.toHaveProperty('httpStatus');
  });
});

describe('HealthController route metadata', () => {
  it('skips throttling and session verification for every health route', () => {
    const reflector = new Reflector();

    expect(Reflect.getMetadata(SKIP_SESSION_KEY, HealthController)).toBe(true);
    for (const method of ['check', 'live', 'ready'] as const) {
      const targets = [HealthController.prototype[method], HealthController];
      expect(
        reflector.getAllAndOverride<boolean>(THROTTLER_SKIP_DEFAULT, targets)
      ).toBe(true);
      expect(
        reflector.getAllAndOverride<boolean>(SKIP_SESSION_KEY, targets)
      ).toBe(true);
    }
  });

  it('keeps summary, live, and ready routes public', () => {
    for (const method of ['check', 'live', 'ready'] as const) {
      expect(
        Reflect.getMetadata(IS_PUBLIC_KEY, HealthController.prototype[method])
      ).toBe(true);
    }
  });

  it('maps the controller and methods to the expected paths', () => {
    expect(Reflect.getMetadata(PATH_METADATA, HealthController)).toBe('health');
    expect(
      Reflect.getMetadata(PATH_METADATA, HealthController.prototype.check)
    ).toBe('/');
    expect(
      Reflect.getMetadata(PATH_METADATA, HealthController.prototype.live)
    ).toBe('live');
    expect(
      Reflect.getMetadata(PATH_METADATA, HealthController.prototype.ready)
    ).toBe('ready');
  });

  it('documents live success and readiness success or unavailability', () => {
    const checkResponses = Reflect.getMetadata(
      API_RESPONSE_METADATA,
      HealthController.prototype.check
    );
    const liveResponses = Reflect.getMetadata(
      API_RESPONSE_METADATA,
      HealthController.prototype.live
    );
    const readyResponses = Reflect.getMetadata(
      API_RESPONSE_METADATA,
      HealthController.prototype.ready
    );

    expect(Object.keys(checkResponses)).toEqual(['200']);
    expect(Object.keys(liveResponses)).toEqual(['200']);
    expect(Object.keys(readyResponses).sort()).toEqual(['200', '503']);
  });
});
