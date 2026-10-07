import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Response shapes for the catalog endpoints. Documented with Swagger so the
// storefront's typed client can be generated from /docs-json (decision D8).
// All money fields are integer poisha (1 BDT = 100 poisha).

export class CategoryNodeDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty({ type: String, nullable: true }) imageUrl!: string | null;
  @ApiProperty({ type: () => [CategoryNodeDto] }) children!: CategoryNodeDto[];
}

export class CategoryRefDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
}

export class ImageDto {
  @ApiProperty() url!: string;
  @ApiProperty() alt!: string;
}

export class ProductListItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: CategoryRefDto }) category!: CategoryRefDto;
  @ApiProperty({ enum: ['new', 'sale', 'best'], nullable: true }) badge!: 'new' | 'sale' | 'best' | null;
  @ApiProperty() freeDelivery!: boolean;
  @ApiProperty({ example: 4.6 }) ratingAvg!: number;
  @ApiProperty() ratingCount!: number;
  @ApiProperty({ type: ImageDto, nullable: true }) image!: ImageDto | null;
  @ApiProperty({ description: 'The cheapest active variant — what "Add to cart" on a card adds' })
  variantId!: string;
  @ApiProperty({ description: 'Lowest active variant price, poisha' }) price!: number;
  @ApiProperty({ type: Number, nullable: true, description: 'Was-price of that variant, poisha' })
  compareAtPrice!: number | null;
  @ApiProperty() inStock!: boolean;
  @ApiProperty({ description: 'Units in stock across active variants' }) stockQty!: number;
  @ApiProperty() variantCount!: number;
}

export class ProductPageDto {
  @ApiProperty({ type: [ProductListItemDto] }) items!: ProductListItemDto[];
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty() total!: number;
  @ApiProperty() totalPages!: number;
}

export class VariantDto {
  @ApiProperty() id!: string;
  @ApiProperty() sku!: string;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' }, example: { size: 'M' } })
  options!: Record<string, string>;
  @ApiProperty({ description: 'poisha' }) price!: number;
  @ApiProperty({ type: Number, nullable: true, description: 'poisha' }) compareAtPrice!: number | null;
  @ApiProperty() stockQty!: number;
  @ApiProperty() inStock!: boolean;
}

export class VariantImageDto extends ImageDto {
  @ApiProperty({ type: String, nullable: true }) variantId!: string | null;
}

export class ProductDetailDto {
  @ApiProperty() id!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() name!: string;
  @ApiProperty() description!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) brand!: string | null;
  @ApiProperty({ type: CategoryRefDto }) category!: CategoryRefDto;
  @ApiProperty({ type: [CategoryRefDto], description: 'Root first, e.g. Fashion → Men\'s Wear → Summer' })
  categoryPath!: CategoryRefDto[];
  @ApiProperty({ enum: ['new', 'sale', 'best'], nullable: true }) badge!: 'new' | 'sale' | 'best' | null;
  @ApiProperty() freeDelivery!: boolean;
  @ApiProperty() ratingAvg!: number;
  @ApiProperty() ratingCount!: number;
  @ApiProperty({ type: [VariantImageDto] }) images!: VariantImageDto[];
  @ApiProperty({ type: [VariantDto], description: 'Active variants, cheapest first' })
  variants!: VariantDto[];
  @ApiProperty() createdAt!: string;
}
