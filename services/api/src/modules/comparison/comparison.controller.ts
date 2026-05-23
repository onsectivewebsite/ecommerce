import { Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { ComparisonService } from './comparison.service';

@ApiTags('comparison')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('comparison')
export class ComparisonController {
  constructor(private readonly comparison: ComparisonService) {}

  @Get()
  list(@CurrentUser() u: RequestUser) {
    return this.comparison.list(u.userId);
  }

  @Post(':productId')
  add(@CurrentUser() u: RequestUser, @Param('productId') productId: string) {
    return this.comparison.add(u.userId, productId);
  }

  @Delete(':productId')
  remove(@CurrentUser() u: RequestUser, @Param('productId') productId: string) {
    return this.comparison.remove(u.userId, productId);
  }

  @Delete()
  clear(@CurrentUser() u: RequestUser) {
    return this.comparison.clear(u.userId);
  }
}
