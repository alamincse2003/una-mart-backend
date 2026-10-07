import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsUUID, Max, Min } from 'class-validator';

export const MAX_LINE_QUANTITY = 50;

export class AddCartItemDto {
  @ApiProperty() @IsUUID() variantId!: string;
  @ApiProperty({ minimum: 1, maximum: MAX_LINE_QUANTITY })
  @IsInt()
  @Min(1)
  @Max(MAX_LINE_QUANTITY)
  quantity!: number;
}

export class UpdateCartItemDto {
  @ApiProperty({ minimum: 1, maximum: MAX_LINE_QUANTITY })
  @IsInt()
  @Min(1)
  @Max(MAX_LINE_QUANTITY)
  quantity!: number;
}

export class CartLineDto {
  @ApiProperty() id!: string;
  @ApiProperty() variantId!: string;
  @ApiProperty() productId!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ example: 'M / Navy', description: 'Empty for simple products' }) variantLabel!: string;
  @ApiProperty({ type: String, nullable: true }) imageUrl!: string | null;
  @ApiProperty({ description: 'poisha' }) unitPrice!: number;
  @ApiProperty({ type: Number, nullable: true, description: 'poisha' }) compareAtPrice!: number | null;
  @ApiProperty() quantity!: number;
  @ApiProperty({ description: 'poisha' }) lineTotal!: number;
  @ApiProperty() stockQty!: number;
  @ApiProperty() freeDelivery!: boolean;
  @ApiProperty({
    enum: ['unavailable', 'insufficient_stock'],
    nullable: true,
    description: 'Set when the line can\'t be ordered as-is; such lines are excluded from subtotal',
  })
  issue!: 'unavailable' | 'insufficient_stock' | null;
}

export class CartDto {
  @ApiProperty({ type: [CartLineDto] }) items!: CartLineDto[];
  @ApiProperty() itemCount!: number;
  @ApiProperty({ description: 'poisha, orderable lines only' }) subtotal!: number;
}
