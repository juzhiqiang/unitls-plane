import { Controller, Get, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response as ExpressResponse } from 'express';
import { Public, SkipSession } from '../../common/decorators/public.decorator';
import { LiveHealthDto, ReadyHealthDto } from './health.dto';
import { HealthService } from './health.service';

@ApiTags('health')
@SkipThrottle()
@SkipSession()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Service liveness summary' })
  @ApiOkResponse({ type: LiveHealthDto })
  check() {
    return this.healthService.live();
  }

  @Public()
  @Get('live')
  @ApiOperation({ summary: 'Service liveness check' })
  @ApiOkResponse({ type: LiveHealthDto })
  live() {
    return this.healthService.live();
  }

  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Dependency readiness check' })
  @ApiOkResponse({ type: ReadyHealthDto })
  @ApiServiceUnavailableResponse({ type: ReadyHealthDto })
  async ready(@Res({ passthrough: true }) response: ExpressResponse) {
    const { httpStatus, ...body } = await this.healthService.ready();
    response.status(httpStatus);
    return body;
  }
}
