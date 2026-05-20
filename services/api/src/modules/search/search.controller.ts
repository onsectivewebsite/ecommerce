import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SearchService } from './search.service';
import { SearchIndexer } from './search.indexer';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';

@ApiTags('search')
@Controller('search')
export class SearchController {
  constructor(
    private readonly search: SearchService,
    private readonly indexer: SearchIndexer,
  ) {}

  /** Public — used by buyer-web and the mobile search screen. */
  @Get()
  query(
    @Query('query') query?: string,
    @Query('category') category?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.search.search({
      query,
      category,
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 24,
    });
  }

  /** Admin trigger — forces a watermark-driven sync without waiting for the scheduler. */
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('reindex')
  reindex() {
    return this.indexer.incrementalSync();
  }
}
