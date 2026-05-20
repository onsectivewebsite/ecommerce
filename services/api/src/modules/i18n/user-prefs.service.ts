import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { isSupportedCurrency, isSupportedLocale } from './locale.constants';

export interface UserPreferencesDto {
  locale: string;
  currency: string;
}

@Injectable()
export class UserPrefsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<UserPreferencesDto> {
    const row = await this.prisma.userPreferences.findUnique({ where: { userId } });
    return { locale: row?.locale ?? 'en', currency: row?.currency ?? 'USD' };
  }

  async upsert(userId: string, patch: Partial<UserPreferencesDto>): Promise<UserPreferencesDto> {
    const locale = patch.locale ?? 'en';
    const currency = (patch.currency ?? 'USD').toUpperCase();
    if (patch.locale && !isSupportedLocale(locale)) {
      throw new BadRequestException(`Locale ${locale} is not supported`);
    }
    if (patch.currency && !isSupportedCurrency(currency)) {
      throw new BadRequestException(`Currency ${currency} is not supported`);
    }
    const existing = await this.prisma.userPreferences.findUnique({ where: { userId } });
    const row = await this.prisma.userPreferences.upsert({
      where: { userId },
      create: { userId, locale, currency },
      update: {
        ...(patch.locale ? { locale } : {}),
        ...(patch.currency ? { currency } : {}),
      },
    });
    return { locale: row.locale, currency: row.currency };
  }
}
