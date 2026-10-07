import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { AdminCatalogService } from './admin-catalog.service.js';
import { AdminOrdersService } from './admin-orders.service.js';
import { AdminSettingsService } from './admin-settings.service.js';
import { AdminCatalogController, AdminOrdersController, AdminOverviewController } from './admin.controller.js';
import { AuditService } from './audit.service.js';

@Module({
  imports: [OrdersModule, InventoryModule],
  controllers: [AdminOverviewController, AdminOrdersController, AdminCatalogController],
  providers: [AuditService, AdminOrdersService, AdminCatalogService, AdminSettingsService],
})
export class AdminModule {}
