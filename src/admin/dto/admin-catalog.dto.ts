import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  NotEquals,
  ValidateNested,
} from 'class-validator';
import { PageQuery } from '../../common/page.query.js';
import { CategoryRefDto } from '../../catalog/dto/catalog.responses.js';

export const PRODUCT_STATUSES = ['draft', 'active', 'archived'] as const;
export const PRODUCT_BADGES = ['new', 'sale', 'best'] as const;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SKU = /^[A-Z0-9][A-Z0-9-]{1,59}$/;
const MAX_PRICE = 100_000_000; // ৳1,000,000 in poisha

// Image URLs/paths for now; Cloudinary signed uploads come later.
const IMAGE_PATH = /^(https:\/\/|\/)[^\s]{1,500}$/;

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export class AdminProductsQuery extends PageQuery {
  @ApiPropertyOptional({ description: 'Name or SKU' }) @IsOptional() @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional({ enum: PRODUCT_STATUSES }) @IsOptional() @IsIn(PRODUCT_STATUSES) status?: string;
  @ApiPropertyOptional({ description: 'Category id (this category only)' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;
}

export class VariantInputDto {
  @ApiProperty({ example: 'UM-LINEN-SHIRT-M', description: 'Uppercase letters, digits, dashes' })
  @Matches(SKU, { message: 'sku must be 2-60 uppercase letters, digits or dashes' })
  sku!: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: { type: 'string' }, example: { size: 'M' } })
  @IsOptional()
  @IsObject()
  options?: Record<string, string>;

  @ApiProperty({ description: 'poisha' }) @IsInt() @Min(1) @Max(MAX_PRICE) price!: number;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Was-price in poisha; must be above price' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_PRICE)
  compareAtPrice?: number | null;

  @ApiPropertyOptional({ description: 'Opening stock (recorded as a restock)', default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  stockQty?: number;
}

export class CreateProductDto {
  @ApiProperty() @IsString() @Length(2, 150) name!: string;

  @ApiPropertyOptional({ description: 'Defaults to a slug of the name' })
  @IsOptional()
  @Matches(SLUG, { message: 'slug must be lowercase words joined by dashes' })
  @MaxLength(150)
  slug?: string;

  @ApiProperty() @IsString() @Length(1, 10_000) description!: string;
  @ApiProperty() @IsUUID() categoryId!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsString() @MaxLength(80) brand?: string | null;

  @ApiPropertyOptional({ enum: PRODUCT_STATUSES, default: 'draft' })
  @IsOptional()
  @IsIn(PRODUCT_STATUSES)
  status?: (typeof PRODUCT_STATUSES)[number];

  @ApiPropertyOptional({ enum: PRODUCT_BADGES, nullable: true })
  @IsOptional()
  @IsIn(PRODUCT_BADGES)
  badge?: (typeof PRODUCT_BADGES)[number] | null;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() freeDelivery?: boolean;

  @ApiPropertyOptional({ type: [String], description: 'Image URLs (https://…) or site paths (/images/…), in order' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @Matches(IMAGE_PATH, { each: true, message: 'each image must be an https:// URL or a /path' })
  images?: string[];

  @ApiProperty({ type: VariantInputDto, description: 'The first variant (every product needs one)' })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => VariantInputDto)
  variant!: VariantInputDto;
}

export class UpdateProductDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 150) name?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(SLUG, { message: 'slug must be lowercase words joined by dashes' })
  @MaxLength(150)
  slug?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 10_000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsString() @MaxLength(80) brand?: string | null;
  @ApiPropertyOptional({ enum: PRODUCT_STATUSES })
  @IsOptional()
  @IsIn(PRODUCT_STATUSES)
  status?: (typeof PRODUCT_STATUSES)[number];
  @ApiPropertyOptional({ enum: PRODUCT_BADGES, nullable: true })
  @IsOptional()
  @IsIn(PRODUCT_BADGES)
  badge?: (typeof PRODUCT_BADGES)[number] | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() freeDelivery?: boolean;
  @ApiPropertyOptional({ type: [String], description: 'Replaces the whole image list' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @Matches(IMAGE_PATH, { each: true, message: 'each image must be an https:// URL or a /path' })
  images?: string[];
}

export class UpdateVariantDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(SKU, { message: 'sku must be 2-60 uppercase letters, digits or dashes' })
  sku?: string;
  @ApiPropertyOptional({ type: 'object', additionalProperties: { type: 'string' } })
  @IsOptional()
  @IsObject()
  options?: Record<string, string>;
  @ApiPropertyOptional({ description: 'poisha' }) @IsOptional() @IsInt() @Min(1) @Max(MAX_PRICE) price?: number;
  @ApiPropertyOptional({ type: Number, nullable: true, description: 'poisha; null removes the discount' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_PRICE)
  compareAtPrice?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class StockAdjustDto {
  @ApiProperty({ example: 10, description: 'Units to add (positive) or remove (negative)' })
  @IsInt()
  @NotEquals(0)
  @Min(-100_000)
  @Max(100_000)
  delta!: number;

  @ApiProperty({ enum: ['restock', 'adjustment'], description: 'restock = new goods in; adjustment = count fix, damage, loss' })
  @IsIn(['restock', 'adjustment'])
  reason!: 'restock' | 'adjustment';

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class CreateCategoryDto {
  @ApiProperty() @IsString() @Length(2, 80) name!: string;
  @ApiProperty() @Matches(SLUG, { message: 'slug must be lowercase words joined by dashes' }) @MaxLength(100) slug!: string;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'null = top level' })
  @IsOptional()
  @IsUUID()
  parentId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @Matches(IMAGE_PATH, { message: 'imageUrl must be an https:// URL or a /path' })
  imageUrl?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateCategoryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 80) name?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(SLUG, { message: 'slug must be lowercase words joined by dashes' })
  @MaxLength(100)
  slug?: string;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Move under another category; null = top level' })
  @IsOptional()
  @IsUUID()
  parentId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @Matches(IMAGE_PATH, { message: 'imageUrl must be an https:// URL or a /path' })
  imageUrl?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

// ---------------------------------------------------------------------------
// Responses (money in poisha)
// ---------------------------------------------------------------------------

export class AdminVariantDto {
  @ApiProperty() id!: string;
  @ApiProperty() sku!: string;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } }) options!: Record<string, string>;
  @ApiProperty() price!: number;
  @ApiProperty({ type: Number, nullable: true }) compareAtPrice!: number | null;
  @ApiProperty() stockQty!: number;
  @ApiProperty() isActive!: boolean;
}

export class AdminImageDto {
  @ApiProperty() id!: string;
  @ApiProperty() url!: string;
  @ApiProperty() alt!: string;
  @ApiProperty() sortOrder!: number;
}

export class AdminProductRowDto {
  @ApiProperty() id!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: PRODUCT_STATUSES }) status!: string;
  @ApiProperty({ enum: PRODUCT_BADGES, nullable: true }) badge!: string | null;
  @ApiProperty({ type: CategoryRefDto }) category!: CategoryRefDto;
  @ApiProperty({ type: Number, nullable: true, description: 'Cheapest active variant' }) price!: number | null;
  @ApiProperty({ type: Number, nullable: true }) compareAtPrice!: number | null;
  @ApiProperty({ description: 'Sum over active variants' }) stockTotal!: number;
  @ApiProperty() variantCount!: number;
  @ApiProperty({ type: String, nullable: true }) imageUrl!: string | null;
  @ApiProperty() updatedAt!: string;
}

export class AdminProductPageDto {
  @ApiProperty({ type: [AdminProductRowDto] }) items!: AdminProductRowDto[];
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty() total!: number;
  @ApiProperty() totalPages!: number;
}

export class AdminProductDto {
  @ApiProperty() id!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() name!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ type: String, nullable: true }) brand!: string | null;
  @ApiProperty({ enum: PRODUCT_STATUSES }) status!: string;
  @ApiProperty({ enum: PRODUCT_BADGES, nullable: true }) badge!: string | null;
  @ApiProperty() freeDelivery!: boolean;
  @ApiProperty({ type: CategoryRefDto }) category!: CategoryRefDto;
  @ApiProperty({ type: [AdminImageDto] }) images!: AdminImageDto[];
  @ApiProperty({ type: [AdminVariantDto], description: 'All variants, including inactive' }) variants!: AdminVariantDto[];
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}

export class StockAdjustResultDto {
  @ApiProperty() variantId!: string;
  @ApiProperty() stockQty!: number;
}

export class AdminCategoryDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty({ type: String, nullable: true }) parentId!: string | null;
  @ApiProperty() sortOrder!: number;
  @ApiProperty({ type: String, nullable: true }) imageUrl!: string | null;
  @ApiProperty() isActive!: boolean;
  @ApiProperty({ description: 'Products directly in this category' }) productCount!: number;
}
