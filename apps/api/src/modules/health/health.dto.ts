import { ApiProperty } from '@nestjs/swagger';

export class HealthComponentDto {
  @ApiProperty({ enum: ['ok', 'degraded', 'error'] })
  status!: 'ok' | 'degraded' | 'error';

  @ApiProperty({ minimum: 0 })
  durationMs!: number;
}

export class HealthComponentsDto {
  @ApiProperty({ type: HealthComponentDto })
  database!: HealthComponentDto;

  @ApiProperty({ type: HealthComponentDto })
  redis!: HealthComponentDto;

  @ApiProperty({ type: HealthComponentDto })
  minio!: HealthComponentDto;

  @ApiProperty({ type: HealthComponentDto })
  queues!: HealthComponentDto;

  @ApiProperty({ type: HealthComponentDto })
  libreOffice!: HealthComponentDto;
}

export class LiveHealthDto {
  @ApiProperty({ enum: ['ok'] })
  status!: 'ok';

  @ApiProperty({ format: 'date-time' })
  timestamp!: string;

  @ApiProperty({ format: 'date-time' })
  startedAt!: string;

  @ApiProperty({ example: 'dev' })
  release!: string;

  @ApiProperty({ example: 'dev' })
  buildCommit!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  buildTime!: string | null;
}

export class ReadyHealthDto {
  @ApiProperty({ enum: ['ok', 'degraded', 'error'] })
  status!: 'ok' | 'degraded' | 'error';

  @ApiProperty({ format: 'date-time' })
  timestamp!: string;

  @ApiProperty({ type: HealthComponentsDto })
  components!: HealthComponentsDto;
}
