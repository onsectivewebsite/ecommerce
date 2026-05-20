import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import { ExpoPushClient, type ExpoPushMessage } from './expo-push.client';

export interface RegisterDeviceInput {
  userId: string;
  expoPushToken: string;
  platform: 'IOS' | 'ANDROID' | 'WEB';
  deviceModel?: string;
  appVersion?: string;
  locale?: string;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Routed to the mobile linking handler (e.g. { screen: 'Order', orderId: '...' }). */
  data?: Record<string, unknown>;
  categoryId?: string;
  channelId?: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly expo: ExpoPushClient,
  ) {}

  async registerDevice(input: RegisterDeviceInput) {
    if (!input.expoPushToken.startsWith('ExponentPushToken[') && !input.expoPushToken.startsWith('ExpoPushToken[')) {
      throw new BadRequestException('Invalid Expo push token format');
    }
    // Upsert by token so re-registers (app reinstall / token rotation) replace the prior row.
    const existing = await this.prisma.pushDevice.findUnique({
      where: { expoPushToken: input.expoPushToken },
    });
    if (existing) {
      return this.prisma.pushDevice.update({
        where: { id: existing.id },
        data: {
          userId: input.userId,
          platform: input.platform,
          status: 'ACTIVE',
          deviceModel: input.deviceModel ?? existing.deviceModel,
          appVersion: input.appVersion ?? existing.appVersion,
          locale: input.locale ?? existing.locale,
          lastSeenAt: new Date(),
        },
      });
    }
    return this.prisma.pushDevice.create({
      data: {
        id: newId(),
        userId: input.userId,
        expoPushToken: input.expoPushToken,
        platform: input.platform,
        status: 'ACTIVE',
        deviceModel: input.deviceModel ?? null,
        appVersion: input.appVersion ?? null,
        locale: input.locale ?? null,
      },
    });
  }

  async listForUser(userId: string) {
    return this.prisma.pushDevice.findMany({
      where: { userId },
      orderBy: { lastSeenAt: 'desc' },
    });
  }

  async unregister(userId: string, deviceId: string) {
    await this.prisma.pushDevice.updateMany({
      where: { id: deviceId, userId },
      data: { status: 'REVOKED' },
    });
    return { ok: true };
  }

  async sendToUser(userId: string, payload: PushPayload): Promise<{ sent: number; pruned: number }> {
    // Phase 11: per-category push opt-out check.
    if (payload.categoryId) {
      const pref = await this.prisma.notificationPreference.findUnique({ where: { userId } });
      const prefs = (pref?.prefs ?? {}) as Record<string, { push?: boolean }>;
      const catPref = prefs[payload.categoryId];
      if (catPref && catPref.push === false) return { sent: 0, pruned: 0 };
    }
    const devices = await this.prisma.pushDevice.findMany({
      where: { userId, status: 'ACTIVE' },
    });
    if (devices.length === 0) return { sent: 0, pruned: 0 };

    const messages: ExpoPushMessage[] = devices.map((d) => ({
      to: d.expoPushToken,
      title: payload.title,
      body: payload.body,
      data: payload.data,
      sound: 'default',
      priority: 'high',
      channelId: payload.channelId ?? defaultChannelFor(payload.categoryId),
      categoryId: payload.categoryId,
    }));

    const tickets = await this.expo.send(messages);
    let pruned = 0;
    for (let i = 0; i < tickets.length; i++) {
      const t = tickets[i];
      if (t.status !== 'ok') {
        const err = t.details?.error ?? t.message ?? '';
        // Expo returns DeviceNotRegistered when the user uninstalled or revoked perms.
        if (/DeviceNotRegistered|InvalidCredentials|MismatchSenderId/.test(err)) {
          await this.prisma.pushDevice.update({
            where: { id: devices[i].id },
            data: { status: 'INACTIVE' },
          });
          pruned++;
        } else {
          this.logger.warn(`Push ticket error for device ${devices[i].id}: ${err}`);
        }
      } else {
        await this.prisma.pushDevice.update({
          where: { id: devices[i].id },
          data: { lastSeenAt: new Date() },
        }).catch(() => undefined);
      }
    }
    return { sent: tickets.filter((t) => t.status === 'ok').length, pruned };
  }
}

function defaultChannelFor(categoryId?: string): string {
  if (!categoryId) return 'default';
  if (categoryId.startsWith('shipment_')) return 'shipping';
  if (categoryId.startsWith('payout_')) return 'payouts';
  return 'orders';
}
