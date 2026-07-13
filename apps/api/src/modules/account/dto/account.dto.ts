import { ApiProperty } from '@nestjs/swagger';
import { TaskResponseDto } from '../../tasks/dto/tasks.dto';

export class AccountRecentFileDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty()
  filename!: string;

  @ApiProperty()
  originalSize!: number;

  @ApiProperty()
  mimeType!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

export class AccountSummaryDto {
  @ApiProperty()
  activeTaskCount!: number;

  @ApiProperty()
  failedTaskCount!: number;

  @ApiProperty()
  activeFileCount!: number;

  @ApiProperty()
  activeFileBytes!: number;

  @ApiProperty({ type: () => [TaskResponseDto] })
  recentTasks!: TaskResponseDto[];

  @ApiProperty({ type: () => [AccountRecentFileDto] })
  recentFiles!: AccountRecentFileDto[];
}
