import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export const PAYMENT_METHODS = ['cod', 'bkash', 'nagad', 'card'] as const;

export class AddressDto {
  @ApiProperty({ example: 'House 12, Road 5' })
  @IsString()
  @Length(5, 200)
  line1!: string;

  @ApiPropertyOptional({ example: 'Dhanmondi' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  area?: string;

  @ApiProperty({ example: 'Dhaka' })
  @IsString()
  @Length(2, 60)
  city!: string;
}

// POST /v1/orders. Items come from the session cart and are re-priced on
// the server — the client never sends prices.
export class CreateOrderDto {
  @ApiProperty() @IsString() @Length(2, 80) customerName!: string;

  @ApiProperty({ example: '01712345678', description: 'Bangladeshi mobile number' })
  @IsString()
  @MaxLength(20)
  phone!: string;

  @ApiPropertyOptional() @IsOptional() @IsEmail() @MaxLength(120) email?: string;

  @ApiProperty({ type: AddressDto })
  @IsDefined() // ValidateNested alone lets a missing object through
  @IsObject()
  @ValidateNested()
  @Type(() => AddressDto)
  address!: AddressDto;

  @ApiProperty({ example: 'inside_dhaka', description: 'Delivery zone code from GET /v1/delivery-zones' })
  @IsString()
  @MaxLength(40)
  deliveryZone!: string;

  @ApiProperty({ enum: PAYMENT_METHODS, description: 'Only cod is available right now' })
  @IsIn(PAYMENT_METHODS)
  paymentMethod!: (typeof PAYMENT_METHODS)[number];

  @ApiPropertyOptional({ description: 'Landmark, preferred time, etc.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({
    example: '123456',
    description:
      'Checkout OTP (POST /v1/auth/otp/request purpose=checkout). Needed when the API answers 428 OTP_REQUIRED; not needed when logged in with the same phone.',
  })
  @IsOptional()
  @Matches(/^\d{6}$/, { message: 'otpCode must be 6 digits' })
  otpCode?: string;
}

export class OrderLookupQuery {
  @ApiPropertyOptional({
    example: '01712345678',
    description: 'The phone the order was placed with. Not needed for your own orders when logged in.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;
}

export class MyOrdersQuery {
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize = 10;
}

// ---------------------------------------------------------------------------
// Responses (money in poisha)
// ---------------------------------------------------------------------------

export class OrderItemDto {
  @ApiProperty() productName!: string;
  @ApiProperty() variantLabel!: string;
  @ApiProperty() sku!: string;
  @ApiProperty({ type: String, nullable: true }) imageUrl!: string | null;
  @ApiProperty() unitPrice!: number;
  @ApiProperty() quantity!: number;
  @ApiProperty() lineTotal!: number;
}

export class TimelineEntryDto {
  @ApiProperty() status!: string;
  @ApiProperty() at!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) note!: string | null;
}

export class CustomerOrderDto {
  @ApiProperty({ example: 'UM-10231' }) orderNumber!: string;
  @ApiProperty({
    enum: [
      'awaiting_payment',
      'pending_confirmation',
      'confirmed',
      'processing',
      'shipped',
      'delivered',
      'delivery_failed',
      'returned_to_warehouse',
      'cancelled',
    ],
  })
  status!: string;
  @ApiProperty({ enum: PAYMENT_METHODS }) paymentMethod!: string;
  @ApiProperty({ enum: ['unpaid', 'pending', 'paid', 'partially_refunded', 'refunded'] }) paymentStatus!: string;
  @ApiProperty() placedAt!: string;
  @ApiProperty() customerName!: string;
  @ApiProperty() phone!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) email!: string | null;
  @ApiProperty({ type: AddressDto }) shippingAddress!: AddressDto;
  @ApiProperty() deliveryZone!: { code: string; name: string; etaText: string };
  @ApiProperty({ type: [OrderItemDto] }) items!: OrderItemDto[];
  @ApiProperty() subtotal!: number;
  @ApiProperty() discountTotal!: number;
  @ApiProperty() deliveryFee!: number;
  @ApiProperty() total!: number;
  @ApiProperty({ type: [TimelineEntryDto], description: 'Oldest first' }) timeline!: TimelineEntryDto[];
  @ApiProperty({ description: 'Whether the customer can still cancel' }) cancellable!: boolean;
}

export class OrderSummaryDto {
  @ApiProperty({ example: 'UM-10231' }) orderNumber!: string;
  @ApiProperty() status!: string;
  @ApiProperty() paymentStatus!: string;
  @ApiProperty() placedAt!: string;
  @ApiProperty() itemCount!: number;
  @ApiProperty() total!: number;
  @ApiProperty({ type: String, nullable: true, description: 'First item image' }) imageUrl!: string | null;
}

export class OrderSummaryPageDto {
  @ApiProperty({ type: [OrderSummaryDto] }) items!: OrderSummaryDto[];
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty() total!: number;
  @ApiProperty() totalPages!: number;
}
