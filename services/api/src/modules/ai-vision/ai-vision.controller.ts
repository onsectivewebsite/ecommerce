import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { AiVisionService } from './ai-vision.service';
import {
  RegisterModelDto,
  SetModelActiveDto,
  SetThresholdDto,
  SuggestInputDto,
} from './dto';

function actor(u: RequestUser, req: Request) {
  return {
    userId: u.userId,
    ip: req.ip,
    userAgent: req.headers['user-agent'] as string | undefined,
  };
}

@ApiTags('ai-vision-suggest')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SHIPPER')
@Controller('ai/suggest')
export class AiVisionSuggestController {
  constructor(private readonly svc: AiVisionService) {}

  @Post('auth-check')
  async authCheck(@Body() dto: SuggestInputDto) {
    const result = await this.svc.suggestAuthenticity(dto);
    if (dto.inputRefKind === 'refurbUnit') {
      // Cache for buyer-facing trust UI.
      await this.svc.cacheAuthSummary(dto.inputRefId, result);
    }
    return result;
  }

  @Post('grading')
  grading(@Body() dto: SuggestInputDto) {
    return this.svc.suggestGrading(dto);
  }

  @Post('counterfeit')
  counterfeit(@Body() dto: SuggestInputDto) {
    return this.svc.detectCounterfeit(dto);
  }
}

@ApiTags('admin-ai-vision')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/ai-vision')
export class AdminAiVisionController {
  constructor(private readonly svc: AiVisionService) {}

  @Get('models')
  models() {
    return this.svc.listModels();
  }

  @Post('models')
  register(@CurrentUser() u: RequestUser, @Body() dto: RegisterModelDto, @Req() req: Request) {
    return this.svc.registerModel(dto, actor(u, req));
  }

  @Patch('models/:id/active')
  setActive(@Param('id') id: string, @Body() dto: SetModelActiveDto) {
    return this.svc.setModelActive(id, dto.isActive);
  }

  @Patch('models/:id/threshold')
  setThreshold(@Param('id') id: string, @Body() dto: SetThresholdDto) {
    return this.svc.setThreshold(id, dto.thresholdConfidence);
  }

  @Get('watchlist')
  watchlist() {
    return this.svc.listWatchEntries();
  }

  @Delete('watchlist/:serial')
  clearWatch(@Param('serial') serial: string) {
    return this.svc.clearWatchEntry(serial);
  }

  @Get('runs')
  runs(@Query('limit') limit?: string) {
    return this.svc.recentRuns(limit ? Number(limit) : undefined);
  }
}
