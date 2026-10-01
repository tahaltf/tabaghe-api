import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTokenGuard, WordPressRequest } from '../guards/api-token.guard';
import { WordPressConnectionService } from '../services/connection.service';
import { WordPressProductIngestService } from '../services/product-ingest.service';
import { WordPressCategoriesService } from '../services/wordpress-categories.service';
import { WordPressSellerContextService } from '../services/wordpress-seller-context.service';
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
    private readonly sellerContextService: WordPressSellerContextService,
  ) {}

  @Get('categories')
  listCategories(@Query('search') search?: string) {
    return this.categoriesService.listForPlugin(search);
  }

  @Get('seller-context')
  getSellerContext(@Req() req: WordPressRequest) {
    return this.sellerContextService.getSellerContext(req.wpUser!.id);
  }

  @Get('fee-rate')
  getFeeRate(
    @Req() req: WordPressRequest,
    @Query('categoryId') categoryId?: string,
  ) {
    return this.sellerContextService.getFeeRate(req.wpUser!.id, categoryId);
  }

  @Post('ping')
  ping(@Req() req: WordPressRequest, @Body() dto: WordPressPingDto) {
    return this.connectionService.ping(req.wpUser!.id, dto);
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
