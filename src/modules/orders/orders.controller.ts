import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Request } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { IsVerifiedGuard } from '../auth/guards/is-verified.guard';
import { AuthenticatedUser } from '../../shared/contracts/auth';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrdersCommandService } from './orders-command.service';
import { OrdersQueryService } from './orders-query.service';

const videoUploadConfig = {
  storage: diskStorage({
    destination: './uploads/orders/videos',
    filename: (
      _req: unknown,
      file: Express.Multer.File,
      callback: (error: Error | null, filename: string) => void,
    ) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      callback(null, `video-${uniqueSuffix}${extname(file.originalname)}`);
    },
  }),
  fileFilter: (
    _req: unknown,
    file: Express.Multer.File,
    callback: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    if (
      !file.mimetype.match(
        /\/(mp4|mov|quicktime|x-msvideo|mpeg|webm|3gpp|3gp)$/,
      )
    ) {
      return callback(
        new BadRequestException('فقط فایل‌های ویدیویی مجاز هستند'),
        false,
      );
    }
    callback(null, true);
  },
  limits: { fileSize: 50 * 1024 * 1024 },
};

function readMultipartTextField(req: Request, key: string): string {
  const raw = (req.body as Record<string, unknown> | undefined)?.[key];
  if (typeof raw === 'string') return raw.trim();
  if (raw == null || raw === '') return '';
  return String(raw).trim();
}

@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(
    private readonly commandService: OrdersCommandService,
    private readonly queryService: OrdersQueryService,
  ) {}

  @Post()
  @UseGuards(IsVerifiedGuard)
  createOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateOrderDto,
  ) {
    return this.commandService.createOrder(user.id, dto);
  }

  @Get('my-orders')
  getMyOrders(
    @CurrentUser() user: AuthenticatedUser,
    @Query('type') type?: 'BUY' | 'SELL',
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.queryService.getOrdersByType(
      user.id,
      type === 'SELL' ? 'SELL' : 'BUY',
      {
        page: page ? Number(page) : undefined,
        pageSize: pageSize ? Number(pageSize) : undefined,
      },
    );
  }

  @Get('requests')
  getMyRequests(
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.queryService.getMyRequests(user.id, {
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get(':id')
  getOrderById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.queryService.getOrderById(user.id, id);
  }

  @Patch(':id/shipping')
  @UseInterceptors(FileInterceptor('video', videoUploadConfig))
  updateTrackingCode(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
    @UploadedFile() video?: Express.Multer.File,
  ) {
    const trackingCode = readMultipartTextField(req, 'trackingCode');
    if (!trackingCode) {
      throw new BadRequestException('لطفا کد رهگیری را وارد کنید');
    }
    return this.commandService.updateTrackingCode(
      user.id,
      id,
      trackingCode,
      video?.filename,
    );
  }

  @Patch(':id/return-shipping')
  @UseInterceptors(FileInterceptor('video', videoUploadConfig))
  submitReturnTrackingCode(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
    @UploadedFile() video?: Express.Multer.File,
  ) {
    const trackingCode = readMultipartTextField(req, 'trackingCode');
    if (!trackingCode) {
      throw new BadRequestException('لطفا کد رهگیری را وارد کنید');
    }
    return this.commandService.submitReturnTrackingCode(
      user.id,
      id,
      trackingCode,
      video?.filename,
    );
  }

  @Patch(':id/confirm-return-receipt')
  confirmReturnReceipt(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.commandService.confirmReturnReceipt(user.id, id);
  }

  @Patch(':id/confirm')
  confirmOrderDelivery(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.commandService.confirmOrder(user.id, id);
  }

  @Patch(':id/dispute')
  @UseInterceptors(FileInterceptor('video', videoUploadConfig))
  disputeOrderDelivery(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
    @UploadedFile() video?: Express.Multer.File,
  ) {
    const reason = readMultipartTextField(req, 'reason');
    if (!reason || reason.length < 5) {
      throw new BadRequestException('لطفاً دلیل مغایرت را کامل توضیح دهید.');
    }
    return this.commandService.disputeOrder(
      user.id,
      id,
      reason,
      video?.filename,
    );
  }
}
