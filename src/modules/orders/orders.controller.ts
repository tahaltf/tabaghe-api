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
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { orderShippingVideoMulterOptions } from '../../common/upload/order-shipping-video-upload.config';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { IsVerifiedGuard } from '../auth/guards/is-verified.guard';
import { AuthenticatedUser } from '../../shared/contracts/auth';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrdersCommandService } from './orders-command.service';
import { extractClientRequestMeta } from '../../common/http/client-ip.util';
import { OrdersQueryService } from './orders-query.service';
import {
  InspectionCertificateService,
  InspectionCertificateSide,
  INSPECTION_CERTIFICATE_DOWNLOAD_FILENAME,
} from './inspection-certificate.service';

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
    private readonly inspectionCertificate: InspectionCertificateService,
  ) {}

  @Post()
  @UseGuards(IsVerifiedGuard)
  createOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateOrderDto,
    @Req() req: Request,
  ) {
    return this.commandService.createOrder(
      user.id,
      dto,
      extractClientRequestMeta(req),
    );
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
    @Query('exchangePage') exchangePage?: string,
    @Query('auctionPage') auctionPage?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.queryService.getMyRequests(user.id, {
      exchangePage: exchangePage ? Number(exchangePage) : undefined,
      auctionPage: auctionPage ? Number(auctionPage) : undefined,
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
  @UseInterceptors(FileInterceptor('video', orderShippingVideoMulterOptions))
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
  @UseInterceptors(FileInterceptor('video', orderShippingVideoMulterOptions))
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

  @Patch(':id/exchange-seller-relist-choice')
  setExchangeSellerRelistChoice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: { publish: boolean },
  ) {
    if (typeof body?.publish !== 'boolean') {
      throw new BadRequestException('فیلد publish باید true یا false باشد');
    }
    return this.commandService.setExchangeSellerRelistChoice(
      user.id,
      id,
      body.publish,
    );
  }

  @Patch(':id/dispute')
  @UseInterceptors(FileInterceptor('video', orderShippingVideoMulterOptions))
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

  /**
   * دانلود گواهی کارشناسی PDF برای صاحب کالا.
   * - برای DIRECT/AUCTION: side نادیده گرفته می‌شود.
   * - برای EXCHANGE: side باید LISTING یا OFFER باشد (کالای فروشنده / کالای پیشنهاددهنده).
   */
  @Get(':id/inspection-certificate')
  async downloadInspectionCertificate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Res() res: Response,
    @Query('side') sideRaw?: string,
  ) {
    const allowedSides: InspectionCertificateSide[] = ['LISTING', 'OFFER'];
    const side =
      sideRaw && allowedSides.includes(sideRaw as InspectionCertificateSide)
        ? (sideRaw as InspectionCertificateSide)
        : undefined;

    const { pdf, filename } =
      await this.inspectionCertificate.generateInspectionCertificatePdf({
        orderId: id,
        requesterUserId: user.id,
        side,
      });

    res.setHeader('Content-Type', 'application/pdf');
    const listingIdInName = filename?.match(/ - ([^.]+)\.pdf$/)?.[1];
    const asciiFallback = listingIdInName
      ? `tabaghe-inspection-${listingIdInName}.pdf`
      : 'tabaghe-inspection.pdf';
    const utf8Name = encodeURIComponent(
      filename || INSPECTION_CERTIFICATE_DOWNLOAD_FILENAME,
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiFallback}"; filename*=UTF-8''${utf8Name}`,
    );
    res.setHeader('Content-Length', String(pdf.length));
    res.end(pdf);
  }
}
