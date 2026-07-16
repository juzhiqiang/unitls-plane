import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { getSessionCookieExpirationHeaders } from '@utils-plane/auth';
import type { User } from '@utils-plane/db';
import type {
  Request as ExpressRequest,
  Response as ExpressResponse,
} from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  AccountExportService,
  type PreparedAccountExport,
} from './account-export.service';
import { AccountSummaryDto, DeleteAccountDto } from './dto/account.dto';
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

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiNoContentResponse()
  async deleteAccount(
    @CurrentUser() currentUser: User | undefined,
    @Body() dto: DeleteAccountDto,
    @Req() request: ExpressRequest,
    @Res({ passthrough: true }) response: ExpressResponse
  ): Promise<void> {
    if (!currentUser) throw new UnauthorizedException();
    await this.accountService.deleteAccount(
      currentUser.id,
      dto.confirmationEmail
    );

    const headers = new Headers();
    if (request.headers.cookie) headers.set('cookie', request.headers.cookie);
    const cookies = await getSessionCookieExpirationHeaders(headers);
    if (cookies.length > 0) response.setHeader('set-cookie', cookies);
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
    const abortController = new globalThis.AbortController();
    let prepared: PreparedAccountExport | undefined;
    let writeStarted = false;
    const onClose = () => {
      if (!response.writableFinished)
        abortController.abort(new Error('Account export aborted'));
    };
    response.once('close', onClose);

    try {
      prepared = await this.accountExportService.prepareExport(
        currentUser.id,
        abortController.signal
      );
      abortController.signal.throwIfAborted();
      response.type('application/zip');
      response.attachment(prepared.filename);
      writeStarted = true;
      await this.accountExportService.writeExport(prepared, response);
    } finally {
      response.off('close', onClose);
      if (prepared && !writeStarted)
        await this.accountExportService.disposePreparedExport(prepared);
    }
  }
}
