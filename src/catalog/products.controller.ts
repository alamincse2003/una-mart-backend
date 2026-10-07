import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CatalogService } from './catalog.service.js';
import { ProductDetailDto, ProductPageDto } from './dto/catalog.responses.js';
import { ListProductsQuery } from './dto/list-products.query.js';

@ApiTags('Catalog')
@Controller('products')
export class ProductsController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  @ApiOkResponse({ type: ProductPageDto })
  list(@Query() query: ListProductsQuery): Promise<ProductPageDto> {
    return this.catalog.listProducts(query);
  }

  @Get(':slug')
  @ApiOkResponse({ type: ProductDetailDto })
  @ApiNotFoundResponse({ description: 'No active product with this slug' })
  detail(@Param('slug') slug: string): Promise<ProductDetailDto> {
    return this.catalog.getProduct(slug);
  }
}
