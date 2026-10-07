import { Module } from '@nestjs/common';
import { DeliveryZonesController } from './delivery-zones.controller.js';
import { DeliveryZonesService } from './delivery-zones.service.js';

@Module({
  controllers: [DeliveryZonesController],
  providers: [DeliveryZonesService],
  exports: [DeliveryZonesService],
})
export class ShippingModule {}
