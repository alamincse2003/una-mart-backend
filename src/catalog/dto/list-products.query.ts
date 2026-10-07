import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const PRODUCT_SORTS = ['featured', 'newest', 'price-asc', 'price-desc', 'rating'] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

const toBoolean = ({ value }: { value: unknown }) =>
  value === 'true' || value === true ? true : value === 'false' || value === false ? false : value;

const toList = ({ value }: { value: unknown }) =>
  typeof value === 'string'
    ? value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
    : value;

// GET /products query string (SYSTEM_DESIGN.md → API surface → Catalog).
export class ListProductsQuery {
  @ApiPropertyOptional({
    description: 'Category slug, or several comma-separated (any of them); includes all subcategories',
    type: String,
  })
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  category?: string[];

  @ApiPropertyOptional({ description: 'Search text; every word must match name, description or category' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ description: 'Comma-separated product ids', type: String })
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  ids?: string[];

  @ApiPropertyOptional({ description: 'Minimum price in poisha' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  price_min?: number;

  @ApiPropertyOptional({ description: 'Maximum price in poisha' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  price_max?: number;

  @ApiPropertyOptional({ description: 'Minimum average rating, 0–5' })
  @IsOptional()
  @Type(() => Number)
  @Min(0)
  @Max(5)
  rating_min?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  in_stock?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  on_sale?: boolean;

  @ApiPropertyOptional({ enum: PRODUCT_SORTS, default: 'featured' })
  @IsOptional()
  @IsIn(PRODUCT_SORTS)
  sort: ProductSort = 'featured';

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 24, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 24;
}
