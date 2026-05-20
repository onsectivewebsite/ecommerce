import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Product, QnaAuthorRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import { AuditService } from '../audit/audit.service';
import { NotificationFeedService } from '../notification-feed/notification-feed.service';
import type { AdminHideQnaDto, AnswerDto, AskQuestionDto } from './dto';

interface ActorMeta { userId: string; ip?: string; userAgent?: string }

@Injectable()
export class QnaService {
  private readonly logger = new Logger(QnaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly feed: NotificationFeedService,
    private readonly events: EventEmitter2,
  ) {}

  // ---------- buyer ----------

  async ask(userId: string, dto: AskQuestionDto, actor: ActorMeta) {
    const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
    if (!product || product.status !== 'ACTIVE') {
      throw new NotFoundException('Product not found');
    }
    const question = await this.prisma.productQuestion.create({
      data: {
        id: newId(),
        productId: product.id,
        askedByUserId: userId,
        body: dto.body.trim(),
      },
    });
    await this.audit.record({
      actorUserId: actor.userId, action: 'qna.question.ask', entityType: 'ProductQuestion', entityId: question.id,
      after: { productId: product.id }, ip: actor.ip, userAgent: actor.userAgent,
    });
    this.events.emit('qna.question.posted', { questionId: question.id, productId: product.id });
    return question;
  }

  async answer(
    userId: string,
    userRole: string,
    questionId: string,
    dto: AnswerDto,
    actor: ActorMeta,
  ) {
    const question = await this.prisma.productQuestion.findUnique({
      where: { id: questionId },
      include: { product: true },
    });
    if (!question || question.status !== 'VISIBLE') {
      throw new NotFoundException('Question not found');
    }
    const authorRole = await this.resolveAuthorRole(userId, userRole, question.product);
    const answer = await this.prisma.productAnswer.create({
      data: {
        id: newId(),
        questionId,
        answeredByUserId: userId,
        body: dto.body.trim(),
        authorRole,
      },
    });
    await this.recountAnswers(questionId);
    await this.audit.record({
      actorUserId: actor.userId, action: 'qna.answer.post', entityType: 'ProductAnswer', entityId: answer.id,
      after: { questionId, authorRole }, ip: actor.ip, userAgent: actor.userAgent,
    });
    this.events.emit('qna.answer.posted', { answerId: answer.id, questionId, productId: question.productId });

    if (question.askedByUserId !== userId) {
      await this.feed.write({
        userId: question.askedByUserId,
        kind: 'QUESTION_ANSWERED',
        title: 'Your question was answered',
        body: `Someone answered your question about ${question.product.title}.`,
        deepLinkPath: `/p/${question.product.slug}`,
        payload: { questionId, answerId: answer.id, productId: question.productId },
      });
    }
    return answer;
  }

  async toggleHelpful(userId: string, answerId: string) {
    const answer = await this.prisma.productAnswer.findUnique({ where: { id: answerId } });
    if (!answer || answer.status !== 'VISIBLE') throw new NotFoundException('Answer not found');
    if (answer.answeredByUserId === userId) {
      throw new BadRequestException('You cannot mark your own answer as helpful');
    }
    const existing = await this.prisma.answerHelpfulVote.findUnique({
      where: { answerId_userId: { answerId, userId } },
    });
    if (existing) {
      await this.prisma.answerHelpfulVote.delete({ where: { id: existing.id } });
    } else {
      await this.prisma.answerHelpfulVote.create({
        data: { id: newId(), answerId, userId },
      });
    }
    const helpfulCount = await this.recountHelpful(answerId);
    return { answerId, helpful: !existing, helpfulCount };
  }

  async deleteQuestion(userId: string, questionId: string, actor: ActorMeta) {
    const q = await this.prisma.productQuestion.findUnique({ where: { id: questionId } });
    if (!q || q.askedByUserId !== userId) throw new NotFoundException('Question not found');
    if (q.status === 'DELETED_BY_AUTHOR') return q;
    const updated = await this.prisma.productQuestion.update({
      where: { id: questionId },
      data: { status: 'DELETED_BY_AUTHOR' },
    });
    await this.audit.record({
      actorUserId: actor.userId, action: 'qna.question.delete', entityType: 'ProductQuestion', entityId: questionId,
      before: { status: q.status }, after: { status: 'DELETED_BY_AUTHOR' }, ip: actor.ip, userAgent: actor.userAgent,
    });
    return updated;
  }

  async deleteAnswer(userId: string, answerId: string, actor: ActorMeta) {
    const a = await this.prisma.productAnswer.findUnique({ where: { id: answerId } });
    if (!a || a.answeredByUserId !== userId) throw new NotFoundException('Answer not found');
    if (a.status === 'DELETED_BY_AUTHOR') return a;
    const updated = await this.prisma.productAnswer.update({
      where: { id: answerId },
      data: { status: 'DELETED_BY_AUTHOR' },
    });
    await this.recountAnswers(a.questionId);
    await this.audit.record({
      actorUserId: actor.userId, action: 'qna.answer.delete', entityType: 'ProductAnswer', entityId: answerId,
      before: { status: a.status }, after: { status: 'DELETED_BY_AUTHOR' }, ip: actor.ip, userAgent: actor.userAgent,
    });
    return updated;
  }

  async mine(userId: string) {
    const [questions, answers] = await Promise.all([
      this.prisma.productQuestion.findMany({
        where: { askedByUserId: userId },
        orderBy: { createdAt: 'desc' },
        include: { product: { select: { id: true, slug: true, title: true } } },
        take: 200,
      }),
      this.prisma.productAnswer.findMany({
        where: { answeredByUserId: userId },
        orderBy: { createdAt: 'desc' },
        include: { question: { include: { product: { select: { id: true, slug: true, title: true } } } } },
        take: 200,
      }),
    ]);
    return {
      questions: questions.map((q) => ({
        id: q.id, body: q.body, status: q.status, answerCount: q.answerCount,
        product: q.product, createdAt: q.createdAt.toISOString(),
      })),
      answers: answers.map((a) => ({
        id: a.id, body: a.body, status: a.status, authorRole: a.authorRole, helpfulCount: a.helpfulCount,
        question: { id: a.question.id, body: a.question.body, product: a.question.product },
        createdAt: a.createdAt.toISOString(),
      })),
    };
  }

  // ---------- seller ----------

  async listForSeller(sellerUserId: string) {
    const seller = await this.prisma.seller.findUnique({ where: { userId: sellerUserId } });
    if (!seller) return [];
    const questions = await this.prisma.productQuestion.findMany({
      where: { status: 'VISIBLE', product: { sellerId: seller.id } },
      orderBy: [{ answerCount: 'asc' }, { createdAt: 'desc' }],
      include: {
        product: { select: { id: true, slug: true, title: true } },
        askedBy: { select: { firstName: true } },
        answers: {
          where: { status: 'VISIBLE' },
          orderBy: { createdAt: 'asc' },
          include: { answeredBy: { select: { firstName: true } } },
        },
      },
      take: 200,
    });
    return questions.map((q) => this.toApiQuestion(q));
  }

  // ---------- admin ----------

  async adminList(status?: string) {
    const questions = await this.prisma.productQuestion.findMany({
      where: status ? { status: status as never } : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        product: { select: { id: true, slug: true, title: true } },
        askedBy: { select: { firstName: true } },
        answers: {
          orderBy: { createdAt: 'asc' },
          include: { answeredBy: { select: { firstName: true } } },
        },
      },
      take: 200,
    });
    return questions.map((q) => this.toApiQuestion(q, true));
  }

  async adminHideQuestion(questionId: string, dto: AdminHideQnaDto, actor: ActorMeta) {
    const q = await this.prisma.productQuestion.findUnique({ where: { id: questionId } });
    if (!q) throw new NotFoundException('Question not found');
    const updated = await this.prisma.productQuestion.update({
      where: { id: questionId },
      data: { status: 'HIDDEN_BY_ADMIN', hiddenReason: dto.reason },
    });
    await this.audit.record({
      actorUserId: actor.userId, action: 'qna.question.admin_hide', entityType: 'ProductQuestion', entityId: questionId,
      before: { status: q.status }, after: { status: 'HIDDEN_BY_ADMIN', reason: dto.reason },
      ip: actor.ip, userAgent: actor.userAgent,
    });
    return updated;
  }

  async adminUnhideQuestion(questionId: string, actor: ActorMeta) {
    const q = await this.prisma.productQuestion.findUnique({ where: { id: questionId } });
    if (!q) throw new NotFoundException('Question not found');
    const updated = await this.prisma.productQuestion.update({
      where: { id: questionId },
      data: { status: 'VISIBLE', hiddenReason: null },
    });
    await this.audit.record({
      actorUserId: actor.userId, action: 'qna.question.admin_unhide', entityType: 'ProductQuestion', entityId: questionId,
      before: { status: q.status }, after: { status: 'VISIBLE' }, ip: actor.ip, userAgent: actor.userAgent,
    });
    return updated;
  }

  async adminHideAnswer(answerId: string, dto: AdminHideQnaDto, actor: ActorMeta) {
    const a = await this.prisma.productAnswer.findUnique({ where: { id: answerId } });
    if (!a) throw new NotFoundException('Answer not found');
    const updated = await this.prisma.productAnswer.update({
      where: { id: answerId },
      data: { status: 'HIDDEN_BY_ADMIN', hiddenReason: dto.reason },
    });
    await this.recountAnswers(a.questionId);
    await this.audit.record({
      actorUserId: actor.userId, action: 'qna.answer.admin_hide', entityType: 'ProductAnswer', entityId: answerId,
      before: { status: a.status }, after: { status: 'HIDDEN_BY_ADMIN', reason: dto.reason },
      ip: actor.ip, userAgent: actor.userAgent,
    });
    return updated;
  }

  async adminUnhideAnswer(answerId: string, actor: ActorMeta) {
    const a = await this.prisma.productAnswer.findUnique({ where: { id: answerId } });
    if (!a) throw new NotFoundException('Answer not found');
    const updated = await this.prisma.productAnswer.update({
      where: { id: answerId },
      data: { status: 'VISIBLE', hiddenReason: null },
    });
    await this.recountAnswers(a.questionId);
    await this.audit.record({
      actorUserId: actor.userId, action: 'qna.answer.admin_unhide', entityType: 'ProductAnswer', entityId: answerId,
      before: { status: a.status }, after: { status: 'VISIBLE' }, ip: actor.ip, userAgent: actor.userAgent,
    });
    return updated;
  }

  // ---------- public ----------

  async publicListForProduct(productId: string, page = 1, pageSize = 20, viewerUserId?: string) {
    const where = { productId, status: 'VISIBLE' as const };
    const [total, questions] = await Promise.all([
      this.prisma.productQuestion.count({ where }),
      this.prisma.productQuestion.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          askedBy: { select: { firstName: true } },
          answers: {
            where: { status: 'VISIBLE' },
            orderBy: [{ helpfulCount: 'desc' }, { createdAt: 'asc' }],
            include: { answeredBy: { select: { firstName: true } } },
          },
        },
      }),
    ]);

    let votedAnswerIds = new Set<string>();
    if (viewerUserId) {
      const answerIds = questions.flatMap((q) => q.answers.map((a) => a.id));
      if (answerIds.length > 0) {
        const votes = await this.prisma.answerHelpfulVote.findMany({
          where: { userId: viewerUserId, answerId: { in: answerIds } },
          select: { answerId: true },
        });
        votedAnswerIds = new Set(votes.map((v) => v.answerId));
      }
    }

    return {
      total,
      page,
      pageSize,
      items: questions.map((q) => ({
        id: q.id,
        body: q.body,
        askerFirstName: q.askedBy.firstName,
        answerCount: q.answerCount,
        createdAt: q.createdAt.toISOString(),
        answers: q.answers.map((a) => ({
          id: a.id,
          body: a.body,
          authorRole: a.authorRole,
          authorFirstName: a.answeredBy.firstName,
          helpfulCount: a.helpfulCount,
          viewerVoted: votedAnswerIds.has(a.id),
          createdAt: a.createdAt.toISOString(),
        })),
      })),
    };
  }

  // ---------- helpers ----------

  private async resolveAuthorRole(
    userId: string,
    userRole: string,
    product: Product,
  ): Promise<QnaAuthorRole> {
    if (userRole === 'ADMIN') return 'ADMIN';
    const seller = await this.prisma.seller.findUnique({ where: { userId } });
    if (seller && seller.id === product.sellerId) return 'SELLER';
    const owns = await this.prisma.orderItem.findFirst({
      where: { order: { userId, status: 'DELIVERED' }, variant: { productId: product.id } },
      select: { id: true },
    });
    if (owns) return 'VERIFIED_OWNER';
    return 'BUYER';
  }

  private async recountAnswers(questionId: string): Promise<number> {
    const count = await this.prisma.productAnswer.count({
      where: { questionId, status: 'VISIBLE' },
    });
    await this.prisma.productQuestion.update({
      where: { id: questionId },
      data: { answerCount: count },
    });
    return count;
  }

  private async recountHelpful(answerId: string): Promise<number> {
    const count = await this.prisma.answerHelpfulVote.count({ where: { answerId } });
    await this.prisma.productAnswer.update({
      where: { id: answerId },
      data: { helpfulCount: count },
    });
    return count;
  }

  private toApiQuestion(
    q: {
      id: string; body: string; status: string; answerCount: number; createdAt: Date;
      hiddenReason?: string | null;
      product: { id: string; slug: string; title: string };
      askedBy: { firstName: string };
      answers: Array<{
        id: string; body: string; authorRole: string; status: string; helpfulCount: number;
        createdAt: Date; hiddenReason?: string | null;
        answeredBy: { firstName: string };
      }>;
    },
    includeHidden = false,
  ) {
    return {
      id: q.id,
      body: q.body,
      status: q.status,
      hiddenReason: q.hiddenReason ?? null,
      answerCount: q.answerCount,
      askerFirstName: q.askedBy.firstName,
      product: q.product,
      createdAt: q.createdAt.toISOString(),
      answers: q.answers
        .filter((a) => includeHidden || a.status === 'VISIBLE')
        .map((a) => ({
          id: a.id,
          body: a.body,
          authorRole: a.authorRole,
          status: a.status,
          hiddenReason: a.hiddenReason ?? null,
          helpfulCount: a.helpfulCount,
          authorFirstName: a.answeredBy.firstName,
          createdAt: a.createdAt.toISOString(),
        })),
    };
  }
}
