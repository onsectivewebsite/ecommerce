import { Module } from '@nestjs/common';
import { QnaService } from './qna.service';
import { AdminQnaController, QnaController, SellerQnaController } from './qna.controller';

@Module({
  controllers: [QnaController, SellerQnaController, AdminQnaController],
  providers: [QnaService],
  exports: [QnaService],
})
export class QnaModule {}
