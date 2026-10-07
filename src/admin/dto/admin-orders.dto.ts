import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';
import { PageQuery } from '../../common/page.query.js';
import { AddressDto, OrderItemDto, PAYMENT_METHODS } from '../../orders/orders.dto.js';

export const ORDER_STATUSES = [
  'awaiting_payment',
  'pending_confirmation',
  'confirmed',
  'processing',
  'shipped',
  'delivered',
  'delivery_failed',
  'returned_to_warehouse',
  'cancelled',
] as const;
export type OrderStatusValue = (typeof ORDER_STATUSES)[number];

export class AdminOrdersQuery extends PageQuery {
  @ApiPropertyOptional({ enum: ORDER_STATUSES }) @IsOptional() @IsIn(ORDER_STATUSES) status?: OrderStatusValue;

  @ApiPropertyOptional({ enum: PAYMENT_METHODS })
  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  paymentMethod?: (typeof PAYMENT_METHODS)[number];

  @ApiPropertyOptional({ description: 'Order number, phone digits or customer name' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  @ApiPropertyOptional({ description: 'Placed at or after (ISO date/time)' }) @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional({ description: 'Placed before (ISO date/time)' }) @IsOptional() @IsISO8601() to?: string;
}

export class TransitionDto {
  @ApiProperty({ enum: ORDER_STATUSES }) @IsIn(ORDER_STATUSES) to!: OrderStatusValue;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class UpdateAdminOrderDto {
  @ApiProperty({ description: 'Internal note, never shown to the customer. Empty string clears it.' })
  @IsString()
  @MaxLength(2000)
  adminNote!: string;
}

export class AdminOrderRowDto {
  @ApiProperty() orderNumber!: string;
  @ApiProperty({ enum: ORDER_STATUSES }) status!: string;
  @ApiProperty({ enum: PAYMENT_METHODS }) paymentMethod!: string;
  @ApiProperty() paymentStatus!: string;
  @ApiProperty() customerName!: string;
  @ApiProperty() phone!: string;
  @ApiProperty() phoneVerified!: boolean;
  @ApiProperty() deliveryZone!: string;
  @ApiProperty() itemCount!: number;
  @ApiProperty({ description: 'poisha' }) total!: number;
  @ApiProperty() placedAt!: string;
}

export class AdminOrderPageDto {
  @ApiProperty({ type: [AdminOrderRowDto] }) items!: AdminOrderRowDto[];
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty() total!: number;
  @ApiProperty() totalPages!: number;
}

export class AdminOrderItemDto extends OrderItemDto {
  @ApiProperty() variantId!: string;
}

export class AdminTimelineEntryDto {
  @ApiProperty({ type: String, nullable: true }) fromStatus!: string | null;
  @ApiProperty() toStatus!: string;
  @ApiProperty({ enum: ['customer', 'admin', 'system', 'courier', 'payment'] }) actorType!: string;
  @ApiProperty({ type: String, nullable: true }) actorName!: string | null;
  @ApiProperty({ type: String, nullable: true }) note!: string | null;
  @ApiProperty() at!: string;
}

export class AdminPaymentDto {
  @ApiProperty() provider!: string;
  @ApiProperty() amount!: number;
  @ApiProperty() status!: string;
  @ApiProperty() createdAt!: string;
}

export class PhoneFlagDto {
  @ApiProperty() phone!: string;
  @ApiProperty() codRefusedCount!: number;
  @ApiProperty() codDeliveredCount!: number;
  @ApiProperty() isBlocked!: boolean;
  @ApiProperty({ type: String, nullable: true }) note!: string | null;
  @ApiProperty({ type: String, nullable: true }) updatedAt!: string | null;
}

export class AdminOrderDetailDto extends AdminOrderRowDto {
  @ApiProperty({ type: String, nullable: true }) email!: string | null;
  @ApiProperty({ type: AddressDto }) shippingAddress!: AddressDto;
  @ApiProperty() deliveryZoneDetail!: { code: string; name: string; etaText: string };
  @ApiProperty({ type: [AdminOrderItemDto] }) items!: AdminOrderItemDto[];
  @ApiProperty() subtotal!: number;
  @ApiProperty() discountTotal!: number;
  @ApiProperty() deliveryFee!: number;
  @ApiProperty({ type: String, nullable: true }) customerNote!: string | null;
  @ApiProperty({ type: String, nullable: true }) adminNote!: string | null;
  @ApiProperty({ type: [AdminTimelineEntryDto], description: 'Oldest first' }) timeline!: AdminTimelineEntryDto[];
  @ApiProperty({ type: [AdminPaymentDto] }) payments!: AdminPaymentDto[];
  @ApiProperty({ type: PhoneFlagDto }) phoneFlag!: PhoneFlagDto;
  @ApiProperty({ enum: ORDER_STATUSES, isArray: true, description: 'Statuses this order can move to now' })
  allowedTransitions!: string[];
}
