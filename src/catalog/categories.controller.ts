import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CatalogService } from './catalog.service.js';
import { CategoryNodeDto } from './dto/catalog.responses.js';

@ApiTags('Catalog')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  @ApiOkResponse({ type: [CategoryNodeDto], description: 'Active categories as a tree' })
  list(): Promise<CategoryNodeDto[]> {
    return this.catalog.getCategoryTree();
  }
}
