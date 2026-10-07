import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './admin/admin.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CartModule } from './cart/cart.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { validateEnv } from './config/env.js';
import { HealthController } from './health/health.controller.js';
import { InventoryModule } from './inventory/inventory.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ShippingModule } from './shipping/shipping.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    // Per-IP rate limits (ARCHITECTURE.md security baseline). In-memory for
    // now; checkout and order lookup have tighter limits on their routes.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 300 }]),
    PrismaModule,
    NotificationsModule,
    AuthModule,
    CatalogModule,
    InventoryModule,
    ShippingModule,
    CartModule,
    OrdersModule,
    AdminModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
