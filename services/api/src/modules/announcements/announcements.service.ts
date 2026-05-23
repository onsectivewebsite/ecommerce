import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import type { CreateAnnouncementDto, UpdateAnnouncementDto } from './dto';

@Injectable()
export class AnnouncementsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Public — the single banner to show right now (most-recently-started). */
  async currentActive() {
    const now = new Date();
    const ann = await this.prisma.announcement.findFirst({
      where: {
        isActive: true,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gte: now } }],
      },
      orderBy: { startsAt: 'desc' },
    });
    return ann ? this.toApi(ann) : null;
  }

  async myDismissals(userId: string): Promise<string[]> {
    const rows = await this.prisma.announcementDismissal.findMany({
      where: { userId },
      select: { announcementId: true },
    });
    return rows.map((r) => r.announcementId);
  }

  async dismiss(userId: string, announcementId: string) {
    const ann = await this.prisma.announcement.findUnique({ where: { id: announcementId } });
    if (!ann) throw new NotFoundException('Announcement not found');
    await this.prisma.announcementDismissal.upsert({
      where: { userId_announcementId: { userId, announcementId } },
      create: { id: newId(), userId, announcementId },
      update: {},
    });
    return { ok: true };
  }

  // ---------- admin ----------

  async adminList() {
    const rows = await this.prisma.announcement.findMany({ orderBy: { startsAt: 'desc' }, take: 200 });
    return rows.map((a) => this.toApi(a, true));
  }

  async create(dto: CreateAnnouncementDto) {
    const row = await this.prisma.announcement.create({
      data: {
        id: newId(),
        title: dto.title.trim(),
        message: dto.message.trim(),
        level: dto.level ?? 'INFO',
        linkUrl: dto.linkUrl ?? null,
        linkLabel: dto.linkLabel ?? null,
        startsAt: new Date(dto.startsAt),
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
        isActive: dto.isActive ?? true,
      },
    });
    return this.toApi(row, true);
  }

  async update(id: string, dto: UpdateAnnouncementDto) {
    const exists = await this.prisma.announcement.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Announcement not found');
    const row = await this.prisma.announcement.update({
      where: { id },
      data: {
        title: dto.title?.trim() ?? undefined,
        message: dto.message?.trim() ?? undefined,
        level: dto.level ?? undefined,
        linkUrl: dto.linkUrl ?? undefined,
        linkLabel: dto.linkLabel ?? undefined,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
        isActive: dto.isActive ?? undefined,
      },
    });
    return this.toApi(row, true);
  }

  async remove(id: string) {
    const exists = await this.prisma.announcement.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Announcement not found');
    await this.prisma.announcement.delete({ where: { id } });
    return { ok: true };
  }

  // ---------- helpers ----------

  private toApi(
    a: {
      id: string; title: string; message: string; level: string;
      linkUrl: string | null; linkLabel: string | null;
      startsAt: Date; endsAt: Date | null; isActive: boolean;
      createdAt: Date; updatedAt: Date;
    },
    includeAdmin = false,
  ) {
    return {
      id: a.id,
      title: a.title,
      message: a.message,
      level: a.level,
      linkUrl: a.linkUrl,
      linkLabel: a.linkLabel,
      startsAt: a.startsAt.toISOString(),
      endsAt: a.endsAt?.toISOString() ?? null,
      ...(includeAdmin ? {
        isActive: a.isActive,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
      } : {}),
    };
  }
}
