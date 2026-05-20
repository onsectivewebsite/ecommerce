import { Global, Module } from '@nestjs/common';
import { AiVisionService } from './ai-vision.service';
import { HeuristicVisionProvider } from './providers/heuristic.provider';
import { RemoteVisionProvider } from './providers/remote.provider';
import {
  AdminAiVisionController,
  AiVisionSuggestController,
} from './ai-vision.controller';

@Global()
@Module({
  controllers: [AiVisionSuggestController, AdminAiVisionController],
  providers: [AiVisionService, HeuristicVisionProvider, RemoteVisionProvider],
  exports: [AiVisionService],
})
export class AiVisionModule {}
