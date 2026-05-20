import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import type { CreateAddressDto } from './dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async listAddresses(userId: string) {
    return this.prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async createAddress(userId: string, dto: CreateAddressDto) {
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
      }
      return tx.address.create({
        data: {
          id: newId(),
          userId,
          fullName: dto.fullName,
          line1: dto.line1,
          line2: dto.line2,
          city: dto.city,
          region: dto.region,
          postalCode: dto.postalCode,
          country: dto.country,
          phone: dto.phone,
          isDefault: dto.isDefault ?? false,
        },
      });
    });
  }

  async getAddressOrThrow(userId: string, addressId: string) {
    const addr = await this.prisma.address.findFirst({ where: { id: addressId, userId } });
    if (!addr) throw new NotFoundException('Address not found');
    return addr;
  }
}
