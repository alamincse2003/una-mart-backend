import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AdminOnly, CurrentUser } from '../auth/auth.decorators.js';
import { SESSION_COOKIE, type AuthUser } from '../auth/session.js';
import { AdminCatalogService } from './admin-catalog.service.js';
import { AdminOrdersService } from './admin-orders.service.js';
import { AdminSettingsService } from './admin-settings.service.js';
import {
  AdminCategoryDto,
  AdminProductDto,
  AdminProductPageDto,
  AdminProductsQuery,
  CreateCategoryDto,
  CreateProductDto,
  StockAdjustDto,
  StockAdjustResultDto,
  UpdateCategoryDto,
  UpdateProductDto,
  UpdateVariantDto,
  VariantInputDto,
} from './dto/admin-catalog.dto.js';
import {
  AdminOrderDetailDto,
  AdminOrderPageDto,
  AdminOrdersQuery,
  PhoneFlagDto,
  TransitionDto,
  UpdateAdminOrderDto,
} from './dto/admin-orders.dto.js';
import {
  AdminStatsDto,
  AdminZoneDto,
  AuditLogQuery,
  AuditPageDto,
  PhoneFlagPageDto,
  PhoneFlagsQuery,
  UpdatePhoneFlagDto,
  UpdateZoneDto,
} from './dto/admin-settings.dto.js';

// Admin API (SYSTEM_DESIGN.md → API surface → Admin). Every route needs an
// admin session (password + OTP); every write lands in the audit log.

@ApiTags('Admin')
@ApiCookieAuth(SESSION_COOKIE)
@AdminOnly()
@Controller('admin')
export class AdminOverviewController {
  constructor(private readonly settings: AdminSettingsService) {}

  @Get('stats')
  @ApiOkResponse({ type: AdminStatsDto })
  stats(): Promise<AdminStatsDto> {
    return this.settings.stats();
  }

  @Get('audit-log')
  @ApiOkResponse({ type: AuditPageDto })
  auditLog(@Query() query: AuditLogQuery): Promise<AuditPageDto> {
    return this.settings.auditLog(query);
  }

  @Get('delivery-zones')
  @ApiOkResponse({ type: [AdminZoneDto] })
  zones(): Promise<AdminZoneDto[]> {
    return this.settings.listZones();
  }

  @Patch('delivery-zones/:code')
  @ApiOkResponse({ type: AdminZoneDto })
  updateZone(
    @Param('code') code: string,
    @Body() body: UpdateZoneDto,
    @CurrentUser() user: AuthUser,
  ): Promise<AdminZoneDto> {
    return this.settings.updateZone(code, body, user.id);
  }

  @Get('phone-flags')
  @ApiOkResponse({ type: PhoneFlagPageDto })
  phoneFlags(@Query() query: PhoneFlagsQuery): Promise<PhoneFlagPageDto> {
    return this.settings.listPhoneFlags(query);
  }

  @Get('phone-flags/:phone')
  @ApiOkResponse({ type: PhoneFlagDto })
  phoneFlag(@Param('phone') phone: string): Promise<PhoneFlagDto> {
    return this.settings.getPhoneFlag(phone);
  }

  @Patch('phone-flags/:phone')
  @ApiOkResponse({ type: PhoneFlagDto })
  updatePhoneFlag(
    @Param('phone') phone: string,
    @Body() body: UpdatePhoneFlagDto,
    @CurrentUser() user: AuthUser,
  ): Promise<PhoneFlagDto> {
    return this.settings.updatePhoneFlag(phone, body, user.id);
  }
}

@ApiTags('Admin · Orders')
@ApiCookieAuth(SESSION_COOKIE)
@AdminOnly()
@Controller('admin/orders')
export class AdminOrdersController {
  constructor(private readonly orders: AdminOrdersService) {}

  @Get()
  @ApiOkResponse({ type: AdminOrderPageDto })
  list(@Query() query: AdminOrdersQuery): Promise<AdminOrderPageDto> {
    return this.orders.list(query);
  }

  @Get(':number')
  @ApiOkResponse({ type: AdminOrderDetailDto })
  detail(@Param('number') orderNumber: string): Promise<AdminOrderDetailDto> {
    return this.orders.detail(orderNumber);
  }

  /** Move along the lifecycle (confirm, pack, ship, deliver, cancel…). */
  @Post(':number/transition')
  @HttpCode(200)
  @ApiOkResponse({ type: AdminOrderDetailDto })
  transition(
    @Param('number') orderNumber: string,
    @Body() body: TransitionDto,
    @CurrentUser() user: AuthUser,
  ): Promise<AdminOrderDetailDto> {
    return this.orders.transition(orderNumber, body, user.id);
  }

  @Patch(':number')
  @ApiOkResponse({ type: AdminOrderDetailDto })
  update(
    @Param('number') orderNumber: string,
    @Body() body: UpdateAdminOrderDto,
    @CurrentUser() user: AuthUser,
  ): Promise<AdminOrderDetailDto> {
    return this.orders.updateNote(orderNumber, body.adminNote, user.id);
  }
}

@ApiTags('Admin · Catalog')
@ApiCookieAuth(SESSION_COOKIE)
@AdminOnly()
@Controller('admin')
export class AdminCatalogController {
  constructor(private readonly catalog: AdminCatalogService) {}

  @Get('products')
  @ApiOkResponse({ type: AdminProductPageDto })
  products(@Query() query: AdminProductsQuery): Promise<AdminProductPageDto> {
    return this.catalog.listProducts(query);
  }

  @Post('products')
  @ApiOkResponse({ type: AdminProductDto })
  createProduct(@Body() body: CreateProductDto, @CurrentUser() user: AuthUser): Promise<AdminProductDto> {
    return this.catalog.createProduct(body, user.id);
  }

  @Get('products/:id')
  @ApiOkResponse({ type: AdminProductDto })
  product(@Param('id', ParseUUIDPipe) id: string): Promise<AdminProductDto> {
    return this.catalog.getProduct(id);
  }

  @Patch('products/:id')
  @ApiOkResponse({ type: AdminProductDto })
  updateProduct(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateProductDto,
    @CurrentUser() user: AuthUser,
  ): Promise<AdminProductDto> {
    return this.catalog.updateProduct(id, body, user.id);
  }

  @Post('products/:id/variants')
  @ApiOkResponse({ type: AdminProductDto })
  createVariant(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: VariantInputDto,
    @CurrentUser() user: AuthUser,
  ): Promise<AdminProductDto> {
    return this.catalog.createVariant(id, body, user.id);
  }

  /** Price, SKU, options, active flag. Stock changes go through /stock. */
  @Patch('variants/:id')
  @ApiOkResponse({ type: AdminProductDto })
  updateVariant(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateVariantDto,
    @CurrentUser() user: AuthUser,
  ): Promise<AdminProductDto> {
    return this.catalog.updateVariant(id, body, user.id);
  }

  @Post('variants/:id/stock')
  @HttpCode(200)
  @ApiOkResponse({ type: StockAdjustResultDto })
  adjustStock(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: StockAdjustDto,
    @CurrentUser() user: AuthUser,
  ): Promise<StockAdjustResultDto> {
    return this.catalog.adjustStock(id, body, user.id);
  }

  @Get('categories')
  @ApiOkResponse({ type: [AdminCategoryDto] })
  categories(): Promise<AdminCategoryDto[]> {
    return this.catalog.listCategories();
  }

  @Post('categories')
  @ApiOkResponse({ type: AdminCategoryDto })
  createCategory(@Body() body: CreateCategoryDto, @CurrentUser() user: AuthUser): Promise<AdminCategoryDto> {
    return this.catalog.createCategory(body, user.id);
  }

  @Patch('categories/:id')
  @ApiOkResponse({ type: AdminCategoryDto })
  updateCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateCategoryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<AdminCategoryDto> {
    return this.catalog.updateCategory(id, body, user.id);
  }
}
