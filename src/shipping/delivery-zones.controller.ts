import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import { DeliveryZonesService } from './delivery-zones.service.js';

export class DeliveryZoneDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'inside_dhaka' }) code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ description: 'poisha; waived when every item has free delivery' }) fee!: number;
  @ApiProperty() etaText!: string;
}

@ApiTags('Delivery')
@Controller('delivery-zones')
export class DeliveryZonesController {
  constructor(private readonly zones: DeliveryZonesService) {}

  @Get()
  @ApiOkResponse({ type: [DeliveryZoneDto] })
  list(): Promise<DeliveryZoneDto[]> {
    return this.zones.listActive();
  }
}
