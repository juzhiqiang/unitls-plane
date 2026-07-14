import { Controller, Get, Res, UnauthorizedException } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { User } from '@utils-plane/db';
import type { Response as ExpressResponse } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccountExportService } from './account-export.service';
import { AccountSummaryDto } from './dto/account.dto';
import { AccountService } from './account.service';

@ApiTags('account')
@Controller('account')
export class AccountController {
  constructor(
    private readonly accountService: AccountService,
    private readonly accountExportService: AccountExportService
  ) {}

  @Get('summary')
  @ApiBearerAuth()
  @ApiOkResponse({ type: AccountSummaryDto })
  async summary(@CurrentUser() currentUser?: User) {
    if (!currentUser) throw new UnauthorizedException();
    return this.accountService.getSummary(currentUser.id);
  }

  @Get('export')
  @ApiBearerAuth()
  @ApiProduces('application/zip')
  @ApiOkResponse({
    description: 'Complete account data export',
    schema: { type: 'string', format: 'binary' },
  })
  async exportAccount(
    @CurrentUser() currentUser: User | undefined,
    @Res() response: ExpressResponse
  ): Promise<void> {
    if (!currentUser) throw new UnauthorizedException();
    const prepared = await this.accountExportService.prepareExport(
      currentUser.id
    );
    response.type('application/zip');
    response.attachment(prepared.filename);
    await this.accountExportService.writeExport(prepared, response);
  }
}
