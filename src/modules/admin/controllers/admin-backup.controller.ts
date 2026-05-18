import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';
import { RawResponse } from '../../../common/decorators/raw-response.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UpdateBackupConfigDto } from '../dto/admin-backup.dto';
import { AdminBackupService } from '../services/admin-backup.service';
import type { AuthenticatedUser } from '../../../shared/contracts/auth';

@Controller('admin/backup')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.GODADMIN)
export class AdminBackupController {
  constructor(private readonly backup: AdminBackupService) {}

  @Get('config')
  getConfig() {
    return this.backup.getConfig();
  }

  @Patch('config')
  updateConfig(
    @Body() dto: UpdateBackupConfigDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.backup.updateConfig(dto, req.user.id);
  }

  @Get('files')
  listFiles() {
    return this.backup.listFiles();
  }

  @Get('jobs')
  async listJobs() {
    const full = await this.backup.getConfig();
    const { hostScriptPath, ...cfg } = full;
    void hostScriptPath;
    return this.backup.getServerJobs(cfg);
  }

  @Post('run')
  runNow() {
    return this.backup.runBackup('manual');
  }

  @Get('files/download/:fileName')
  @RawResponse()
  async download(@Param('fileName') fileName: string) {
    const {
      stream,
      size,
      fileName: safeName,
    } = await this.backup.getDownloadPayload(fileName);
    return new StreamableFile(stream, {
      type: 'application/octet-stream',
      disposition: `attachment; filename="${safeName}"`,
      length: size,
    });
  }

  @Delete('files/:fileName')
  deleteFile(@Param('fileName') fileName: string) {
    return this.backup.deleteFile(fileName);
  }
}
