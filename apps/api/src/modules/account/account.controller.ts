import { Controller, Get, UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { User } from '@utils-plane/db';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccountSummaryDto } from './dto/account.dto';
import { AccountService } from './account.service';

@ApiTags('account')
@Controller('account')
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  @Get('summary')
  @ApiBearerAuth()
  @ApiOkResponse({ type: AccountSummaryDto })
  async summary(@CurrentUser() currentUser?: User) {
    if (!currentUser) throw new UnauthorizedException();
    return this.accountService.getSummary(currentUser.id);
  }
}
