import {
    Body,
    Controller,
    Get,
    Param,
    Post,
    Req,
    UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RepairService } from './repair.service';
import {CreateRepairDto} from "./create-repair.dto";
import {SelectDeliveryTimeDto} from "./select-delivery-time.dto";


@Controller('repairs')
export class RepairController {
    constructor(private readonly service: RepairService) {}

    @UseGuards(JwtAuthGuard)
    @Post()
    create(@Req() req, @Body() dto: CreateRepairDto) {
        return this.service.create(req.user.id, dto);
    }

    @UseGuards(JwtAuthGuard)
    @Get('me')
    getMy(@Req() req) {
        return this.service.getMyRepairs(req.user.id);
    }

    @UseGuards(JwtAuthGuard)
    @Post(':id/select-time')
    selectTime(
        @Req() req,
        @Param('id') id: string,
        @Body() dto: SelectDeliveryTimeDto,
    ) {
        return this.service.selectDeliveryTime(req.user.id, id, dto);
    }
}
