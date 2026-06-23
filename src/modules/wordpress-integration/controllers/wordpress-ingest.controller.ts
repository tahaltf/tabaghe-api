import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTokenGuard, WordPressRequest } from '../guards/api-token.guard';
import { WordPressConnectionService } from '../services/connection.service';
import { WordPressProductIngestService } from '../services/product-ingest.service';
import { WordPressCategoriesService } from '../services/wordpress-categories.service';
import { WordPressPingDto } from '../dto/wordpress-ping.dto';
import {
  WordPressProductBulkDto,
  WordPressProductDto,
} from '../dto/wordpress-product.dto';

@Controller('integrations/wordpress')
@UseGuards(ApiTokenGuard)
export class WordPressIngestController {
  constructor(
    private readonly connectionService: WordPressConnectionService,
    private readonly ingestService: WordPressProductIngestService,
    private readonly categoriesService: WordPressCategoriesService,
  ) {}

  @Get('categories')
  listCategories() {
    return this.categoriesService.listForPlugin();
  }

  @Post('ping')
  ping(@Req() req: WordPressRequest, @Body() dto: WordPressPingDto) {
    return this.connectionService.ping(req.wpUser!.id, dto).then(() => ({
      ok: true,
    }));
  }

  @Post('products')
  ingestProduct(
    @Req() req: WordPressRequest,
    @Body() dto: WordPressProductDto,
  ) {
    return this.ingestService.ingestOne(req.wpUser!.id, dto);
  }

  @Post('products/bulk')
  ingestBulk(
    @Req() req: WordPressRequest,
    @Body() dto: WordPressProductBulkDto,
  ) {
    return this.ingestService.ingestBulk(req.wpUser!.id, dto.products);
  }
}
