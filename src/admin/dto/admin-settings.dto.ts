import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { PageQuery } from '../../common/page.query.js';
import { PhoneFlagDto } from './admin-orders.dto.js';

export class AdminZoneDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ description: 'poisha' }) fee!: number;
  @ApiProperty() etaText!: string;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() sortOrder!: number;
}

export class UpdateZoneDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 60) name?: string;
  @ApiPropertyOptional({ description: 'poisha' }) @IsOptional() @IsInt() @Min(0) @Max(10_000_00) fee?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 60) etaText?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1000) sortOrder?: number;
}

export class PhoneFlagsQuery extends PageQuery {
  @ApiPropertyOptional({ description: 'Phone digits' }) @IsOptional() @IsString() @MaxLength(20) q?: string;
  @ApiPropertyOptional({ enum: ['true', 'false'], description: 'true = only blocked phones' })
  @IsOptional()
  @IsIn(['true', 'false'])
  blocked?: 'true' | 'false';
}

export class UpdatePhoneFlagDto {
  @ApiPropertyOptional({ description: 'Blocked phones cannot use Cash on Delivery' })
  @IsOptional()
  @IsBoolean()
  isBlocked?: boolean;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsString() @MaxLength(500) note?: string | null;
}

export class PhoneFlagPageDto {
  @ApiProperty({ type: [PhoneFlagDto] }) items!: PhoneFlagDto[];
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty() total!: number;
  @ApiProperty() totalPages!: number;
}

export class AuditLogQuery extends PageQuery {
  @ApiPropertyOptional({ example: 'order' }) @IsOptional() @IsString() @MaxLength(40) entityType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) entityId?: string;
}

export class AuditActorDto {
  @ApiProperty() id!: string;
  @ApiProperty({ type: String, nullable: true }) name!: string | null;
  @ApiProperty() phone!: string;
}

export class AuditEntryDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'order.transition' }) action!: string;
  @ApiProperty() entityType!: string;
  @ApiProperty() entityId!: string;
  @ApiProperty({ nullable: true }) before!: unknown;
  @ApiProperty({ nullable: true }) after!: unknown;
  @ApiProperty() createdAt!: string;
  @ApiProperty({ type: AuditActorDto }) actor!: AuditActorDto;
}

export class AuditPageDto {
  @ApiProperty({ type: [AuditEntryDto] }) items!: AuditEntryDto[];
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty() total!: number;
  @ApiProperty() totalPages!: number;
}

export class LowStockDto {
  @ApiProperty() variantId!: string;
  @ApiProperty() productId!: string;
  @ApiProperty() productName!: string;
  @ApiProperty() sku!: string;
  @ApiProperty() stockQty!: number;
}

export class AdminStatsDto {
  @ApiProperty({ description: 'Orders placed today (Asia/Dhaka)' }) ordersToday!: number;
  @ApiProperty({ description: "Today's order value excluding cancelled, poisha" }) revenueToday!: number;
  @ApiProperty() pendingConfirmation!: number;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } }) statusCounts!: Record<string, number>;
  @ApiProperty({ description: 'Active variants at or below the threshold' }) lowStockCount!: number;
  @ApiProperty() lowStockThreshold!: number;
  @ApiProperty({ type: [LowStockDto], description: 'Lowest first, max 10' }) lowStock!: LowStockDto[];
}
