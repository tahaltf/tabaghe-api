import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../shared/contracts/auth';
import { RepairService } from './repair.service';
import { Throttle } from '@nestjs/throttler';
import {
  ConfirmReturnDeliveryDto,
  ConfirmRepairResultDto,
  RepairPayDto,
  SelectRepairSlotDto,
  ShipRepairDto,
  SubmitRepairDto,
} from './dto/repair.dto';
import {
  repairMediaMulterOptions,
  repairShipVideoMulterOptions,
} from '../../common/upload/repair-media-upload.config';

type RepairFiles = {
  images?: Express.Multer.File[];
  videos?: Express.Multer.File[];
};

@Controller('repairs')
@UseGuards(JwtAuthGuard)
export class RepairController {
  constructor(private readonly service: RepairService) {}

  // -------------------- User-facing repair endpoints --------------------

  @Post()
  @Throttle({ default: { limit: 5, ttl: 10 * 60_000 } })
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'images', maxCount: 6 },
        { name: 'videos', maxCount: 2 },
      ],
      repairMediaMulterOptions,
    ),
  )
  submit(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SubmitRepairDto,
    @UploadedFiles() files: RepairFiles = {},
  ) {
    return this.service.submit(user.id, dto, files.images ?? [], files.videos ?? []);
  }

  @Get('me')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  getMy(
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.listMine(user.id, {
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get(':id')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  getDetail(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.detail(user.id, id);
  }

  @Patch(':id')
  @Throttle({ default: { limit: 10, ttl: 10 * 60_000 } })
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'images', maxCount: 6 },
        { name: 'videos', maxCount: 2 },
      ],
      repairMediaMulterOptions,
    ),
  )
  edit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SubmitRepairDto,
    @UploadedFiles() files: RepairFiles = {},
  ) {
    return this.service.edit(user.id, id, dto, files.images ?? [], files.videos ?? []);
  }

  @Patch(':id/select-slot')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  selectSlot(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SelectRepairSlotDto,
  ) {
    return this.service.selectSlot(user.id, id, dto);
  }

  @Patch(':id/ship')
  @Throttle({ default: { limit: 5, ttl: 10 * 60_000 } })
  @UseInterceptors(FileInterceptor('video', repairShipVideoMulterOptions))
  markShipped(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ShipRepairDto,
    @UploadedFile() video?: Express.Multer.File,
  ) {
    return this.service.markShippedByUser(user.id, id, dto, video);
  }

  @Patch(':id/respond-result')
  @Throttle({ default: { limit: 10, ttl: 10 * 60_000 } })
  respondResult(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ConfirmRepairResultDto,
  ) {
    return this.service.respondToResult(user.id, id, dto);
  }

  @Patch(':id/pay')
  @Throttle({ default: { limit: 5, ttl: 10 * 60_000 } })
  pay(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RepairPayDto,
  ) {
    return this.service.payForRepair(user.id, id, dto);
  }

  @Patch(':id/confirm-return')
  @Throttle({ default: { limit: 10, ttl: 10 * 60_000 } })
  confirmReturn(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ConfirmReturnDeliveryDto,
  ) {
    return this.service.confirmReturnDelivery(user.id, id, dto);
  }

  @Delete(':id')
  @Throttle({ default: { limit: 10, ttl: 10 * 60_000 } })
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query('reason') reason?: string,
  ) {
    return this.service.cancelByUser(user.id, id, reason);
  }
}
