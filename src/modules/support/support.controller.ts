import { Controller, Get, Post, Body, Param, Req, UseGuards } from '@nestjs/common';
import { SupportService } from './support.service';
import { CreateTicketDto, SendMessageDto } from './dto/create-ticket.dto'; // مطمئن شوید اینها اکسپورت شده‌اند
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'; // مسیر گارد خود را چک کنید

@Controller('support')
@UseGuards(JwtAuthGuard) // تمام متدهای این بخش نیاز به لاگین دارند
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  // دریافت تمام تیکت‌های من
  @Get('tickets')
  async getMyTickets(@Req() req) {
    return this.supportService.getMyTickets(req.user.id);
  }

  // دریافت جزئیات یک تیکت خاص (همراه پیام‌ها)
  @Get('tickets/:id')
  async getTicketDetails(@Param('id') id: string, @Req() req) {
    return this.supportService.getTicketDetails(id, req.user.id);
  }

  // ثبت تیکت جدید
  @Post('tickets')
  async createTicket(@Req() req, @Body() dto: CreateTicketDto) {
    return this.supportService.createTicket(req.user.id, dto);
  }

  // ارسال پیام جدید روی تیکت موجود
  @Post('tickets/:id/messages')
  async sendMessage(
    @Param('id') id: string,
    @Req() req,
    @Body() dto: SendMessageDto,
  ) {
    // شما باید این متد را در سرویس خود اضافه کنید (در مرحله ۲ توضیح داده‌ام)
    return this.supportService.sendMessage(id, req.user.id, dto.message);
  }
}