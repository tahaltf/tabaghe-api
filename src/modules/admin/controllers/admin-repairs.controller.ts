import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { AdminRepairsService } from '../services/admin-repairs.service';
import { AdminRepairListQueryDto } from '../dto/admin-query.dto';
import {
  AdminApproveRepairDto,
  AdminRejectRepairDto,
  AdminSetResultDto,
  AdminShipBackDto,
} from '../dto/admin-repair.dto';
import { repairShipVideoMulterOptions } from '../../../common/upload/repair-media-upload.config';

@Controller('admin/repair-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminRepairsController {
  constructor(private readonly service: AdminRepairsService) {}

  @Get()
  list(@Query() query: AdminRepairListQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.service.detail(id);
  }

  @Patch(':id/approve')
  approve(@Param('id') id: string, @Body() dto: AdminApproveRepairDto) {
    return this.service.approve(id, dto);
  }

  @Patch(':id/reject')
  reject(@Param('id') id: string, @Body() dto: AdminRejectRepairDto) {
    return this.service.reject(id, dto);
  }

  @Patch(':id/mark-received')
  markReceived(@Param('id') id: string) {
    return this.service.markReceived(id);
  }

  @Patch(':id/start-inspection')
  startInspection(@Param('id') id: string) {
    return this.service.startInspection(id);
  }

  @Patch(':id/set-result')
  setResult(@Param('id') id: string, @Body() dto: AdminSetResultDto) {
    return this.service.setResult(id, dto);
  }

  @Patch(':id/ready-to-ship')
  readyToShip(@Param('id') id: string) {
    return this.service.markReadyToShip(id);
  }

  @Patch(':id/ship-back')
  @UseInterceptors(FileInterceptor('video', repairShipVideoMulterOptions))
  shipBack(
    @Param('id') id: string,
    @Body() dto: AdminShipBackDto,
    @UploadedFile() video?: Express.Multer.File,
  ) {
    return this.service.shipBack(id, dto, video);
  }

  @Patch(':id/cancel')
  cancel(@Param('id') id: string, @Body('reason') reason?: string) {
    return this.service.cancel(id, reason);
  }
}
