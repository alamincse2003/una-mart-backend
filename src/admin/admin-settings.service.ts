import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { notFound } from '../common/app-error.js';
import { pageOf, skipTake } from '../common/page.query.js';
import { requirePhone } from '../auth/auth.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { emptyFlag } from './admin-orders.service.js';
import { AuditService } from './audit.service.js';
import type { PhoneFlagDto } from './dto/admin-orders.dto.js';
import type {
  AdminStatsDto,
  AdminZoneDto,
  AuditLogQuery,
  AuditPageDto,
  PhoneFlagPageDto,
  PhoneFlagsQuery,
  UpdatePhoneFlagDto,
  UpdateZoneDto,
} from './dto/admin-settings.dto.js';

export const LOW_STOCK_THRESHOLD = 5;
const DHAKA_OFFSET_MS = 6 * 60 * 60_000; // UTC+6, no daylight saving
const DAY_MS = 24 * 60 * 60_000;

/** Midnight in Dhaka for the given instant, as a UTC Date. */
export function startOfDhakaDay(now: Date): Date {
  return new Date(Math.floor((now.getTime() + DHAKA_OFFSET_MS) / DAY_MS) * DAY_MS - DHAKA_OFFSET_MS);
}

const toFlag = (f: { phone: string; codRefusedCount: number; codDeliveredCount: number; isBlocked: boolean; note: string | null; updatedAt: Date }): PhoneFlagDto => ({
  ...f,
  updatedAt: f.updatedAt.toISOString(),
});

@Injectable()
export class AdminSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async stats(now = new Date()): Promise<AdminStatsDto> {
    const since = startOfDhakaDay(now);
    const lowWhere: Prisma.ProductVariantWhereInput = {
      isActive: true,
      stockQty: { lte: LOW_STOCK_THRESHOLD },
      product: { status: 'active' },
    };
    const [ordersToday, revenue, groups, lowStockCount, lowStock] = await Promise.all([
      this.prisma.order.count({ where: { placedAt: { gte: since } } }),
      this.prisma.order.aggregate({
        where: { placedAt: { gte: since }, status: { not: 'cancelled' } },
        _sum: { total: true },
      }),
      this.prisma.order.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.productVariant.count({ where: lowWhere }),
      this.prisma.productVariant.findMany({
        where: lowWhere,
        orderBy: [{ stockQty: 'asc' }, { sku: 'asc' }],
        take: 10,
        include: { product: { select: { id: true, name: true } } },
      }),
    ]);
    const statusCounts = Object.fromEntries(groups.map((g) => [g.status, g._count._all]));
    return {
      ordersToday,
      revenueToday: revenue._sum.total ?? 0,
      pendingConfirmation: statusCounts.pending_confirmation ?? 0,
      statusCounts,
      lowStockCount,
      lowStockThreshold: LOW_STOCK_THRESHOLD,
      lowStock: lowStock.map((v) => ({
        variantId: v.id,
        productId: v.product.id,
        productName: v.product.name,
        sku: v.sku,
        stockQty: v.stockQty,
      })),
    };
  }

  listZones(): Promise<AdminZoneDto[]> {
    return this.prisma.deliveryZone.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, code: true, name: true, fee: true, etaText: true, isActive: true, sortOrder: true },
    });
  }

  async updateZone(code: string, input: UpdateZoneDto, actorId: string): Promise<AdminZoneDto> {
    const before = await this.prisma.deliveryZone.findUnique({ where: { code } });
    if (!before) throw notFound('Delivery zone not found');
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.deliveryZone.update({
        where: { code },
        data: {
          ...(input.name != null ? { name: input.name.trim() } : {}),
          ...(input.fee != null ? { fee: input.fee } : {}),
          ...(input.etaText != null ? { etaText: input.etaText.trim() } : {}),
          ...(input.isActive != null ? { isActive: input.isActive } : {}),
          ...(input.sortOrder != null ? { sortOrder: input.sortOrder } : {}),
        },
      });
      await this.audit.log(tx, actorId, { action: 'zone.update', entityType: 'delivery_zone', entityId: before.id, before, after });
      const { id, code: c, name, fee, etaText, isActive, sortOrder } = after;
      return { id, code: c, name, fee, etaText, isActive, sortOrder };
    });
  }

  async listPhoneFlags(query: PhoneFlagsQuery): Promise<PhoneFlagPageDto> {
    const digits = query.q?.replace(/\D/g, '').replace(/^0/, '');
    const where: Prisma.PhoneFlagWhereInput = {
      ...(digits ? { phone: { contains: digits } } : {}),
      ...(query.blocked === 'true' ? { isBlocked: true } : {}),
    };
    const [total, flags] = await Promise.all([
      this.prisma.phoneFlag.count({ where }),
      this.prisma.phoneFlag.findMany({ where, orderBy: { updatedAt: 'desc' }, ...skipTake(query) }),
    ]);
    return pageOf(flags.map(toFlag), total, query);
  }

  async getPhoneFlag(rawPhone: string): Promise<PhoneFlagDto> {
    const phone = requirePhone(rawPhone);
    const flag = await this.prisma.phoneFlag.findUnique({ where: { phone } });
    return flag ? toFlag(flag) : emptyFlag(phone);
  }

  async updatePhoneFlag(rawPhone: string, input: UpdatePhoneFlagDto, actorId: string): Promise<PhoneFlagDto> {
    const phone = requirePhone(rawPhone);
    const data = {
      ...(input.isBlocked != null ? { isBlocked: input.isBlocked } : {}),
      ...(input.note !== undefined ? { note: input.note?.trim() || null } : {}),
    };
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.phoneFlag.findUnique({ where: { phone } });
      const after = await tx.phoneFlag.upsert({ where: { phone }, create: { phone, ...data }, update: data });
      await this.audit.log(tx, actorId, { action: 'phone_flag.update', entityType: 'phone_flag', entityId: phone, before, after });
      return toFlag(after);
    });
  }

  async auditLog(query: AuditLogQuery): Promise<AuditPageDto> {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { actor: { select: { id: true, name: true, phone: true } } },
        ...skipTake(query),
      }),
    ]);
    return pageOf(
      rows.map((r) => ({
        id: r.id,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        before: r.before,
        after: r.after,
        createdAt: r.createdAt.toISOString(),
        actor: r.actor,
      })),
      total,
      query,
    );
  }
}
