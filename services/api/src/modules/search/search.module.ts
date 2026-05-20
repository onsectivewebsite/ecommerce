import { Global, Module } from '@nestjs/common';
import { EsClient } from './es-client';
import { SearchService } from './search.service';
import { SearchIndexer } from './search.indexer';
import { SearchScheduler } from './search.scheduler';
import { SearchController } from './search.controller';

@Global()
@Module({
  controllers: [SearchController],
  providers: [EsClient, SearchService, SearchIndexer, SearchScheduler],
  exports: [SearchService, SearchIndexer],
})
export class SearchModule {}
