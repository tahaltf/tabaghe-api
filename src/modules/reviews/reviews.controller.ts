import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  async createReview(@Req() req: any, @Body() dto: CreateReviewDto) {
    return this.reviewsService.createReview(req.user.sub || req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('my-given-reviews')
  async getMyGivenReviews(@Req() req: any) {
    return this.reviewsService.getMyGivenReviews(req.user.sub || req.user.id);
  }

  // این روت عمومی است تا همه بتوانند نظرات یک پروفایل را قبل از معامله ببینند
  // با صفحه‌بندی تا از scrape جلوگیری بشه.
  @Get('user/:userId')
  async getUserReviews(
    @Param('userId') userId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.reviewsService.getUserReviews(
      userId,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 10,
    );
  }
}