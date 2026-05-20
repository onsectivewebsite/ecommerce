import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { BrandsService } from './brands.service';
import {
  AttachSellerDto,
  AuthorizeSellerDto,
  CreateBrandDto,
  CreateCollectionDto,
  SetCollectionProductsDto,
  UpdateBrandDto,
  UpdateStorefrontDto,
} from './dto';

function actor(u: RequestUser, req: Request) {
  return {
    userId: u.userId,
    ip: req.ip,
    userAgent: req.headers['user-agent'] as string | undefined,
  };
}

@ApiTags('brands')
@Controller('brands')
export class BrandsPublicController {
  constructor(private readonly svc: BrandsService) {}

  @Get()
  list() {
    return this.svc.listPublic();
  }

  @Get(':slug')
  one(@Param('slug') slug: string) {
    return this.svc.getBySlug(slug);
  }

  /** Phase 17: public storefront read. 404 when not published. */
  @Get(':slug/storefront')
  async storefront(@Param('slug') slug: string) {
    const data = await this.svc.storefront(slug);
    if (!data) throw new NotFoundException('Storefront not available');
    return data;
  }
}

@ApiTags('admin-brands')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/brands')
export class AdminBrandsController {
  constructor(private readonly svc: BrandsService) {}

  @Get()
  list() {
    return this.svc.list();
  }

  @Post()
  create(@CurrentUser() u: RequestUser, @Body() dto: CreateBrandDto, @Req() req: Request) {
    return this.svc.create(dto, actor(u, req));
  }

  @Patch(':id')
  update(
    @CurrentUser() u: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateBrandDto,
    @Req() req: Request,
  ) {
    return this.svc.update(id, dto, actor(u, req));
  }

  @Get(':id/authorizations')
  listForBrand(@Param('id') brandId: string) {
    return this.svc.listAuthorizations(brandId);
  }

  @Post('authorizations')
  authorize(
    @CurrentUser() u: RequestUser,
    @Body() dto: AuthorizeSellerDto,
    @Req() req: Request,
  ) {
    return this.svc.authorize(dto, actor(u, req));
  }

  @Delete('authorizations/:authId')
  revoke(@CurrentUser() u: RequestUser, @Param('authId') id: string, @Req() req: Request) {
    return this.svc.revokeAuthorization(id, actor(u, req));
  }

  // ---- Phase 17 storefront editor ----

  @Patch(':id/storefront')
  updateStorefront(
    @CurrentUser() u: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateStorefrontDto,
    @Req() req: Request,
  ) {
    return this.svc.updateStorefront(id, dto, actor(u, req));
  }

  @Post(':id/attach-seller')
  attachSeller(
    @CurrentUser() u: RequestUser,
    @Param('id') id: string,
    @Body() dto: AttachSellerDto,
    @Req() req: Request,
  ) {
    return this.svc.attachSeller(id, dto, actor(u, req));
  }

  @Get(':id/collections')
  collections(@Param('id') brandId: string) {
    return this.svc.listCollections(brandId);
  }

  @Post(':id/collections')
  createCollection(
    @CurrentUser() u: RequestUser,
    @Param('id') brandId: string,
    @Body() dto: CreateCollectionDto,
    @Req() req: Request,
  ) {
    return this.svc.createCollection(brandId, dto, actor(u, req));
  }

  @Patch('collections/:collectionId/products')
  setCollectionProducts(
    @CurrentUser() u: RequestUser,
    @Param('collectionId') collectionId: string,
    @Body() dto: SetCollectionProductsDto,
    @Req() req: Request,
  ) {
    return this.svc.setCollectionProducts(collectionId, dto.productIds, actor(u, req));
  }

  @Delete('collections/:collectionId')
  deleteCollection(
    @CurrentUser() u: RequestUser,
    @Param('collectionId') collectionId: string,
    @Req() req: Request,
  ) {
    return this.svc.deleteCollection(collectionId, actor(u, req));
  }
}

@ApiTags('seller-brands')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SELLER')
@Controller('seller/brand-authorizations')
export class SellerBrandAuthorizationsController {
  constructor(
    private readonly svc: BrandsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async mine(@CurrentUser() u: RequestUser) {
    const seller = await this.prisma.seller.findUnique({ where: { userId: u.userId } });
    if (!seller) throw new NotFoundException('No seller profile');
    return this.svc.listAuthorizations(undefined, seller.id);
  }
}
