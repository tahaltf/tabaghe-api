// src/modules/listing/listing.controller.ts
import {
    Body,
    Controller,
    Delete,
    Param,
    Patch, Post,
    Req,
    UseGuards,
} from '@nestjs/common';

import { ListingService } from './listing.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';

import { UserRole } from '@prisma/client';

import { RejectListingDto } from './dto/reject-listing.dto';
import { DeleteListingDto } from './dto/delete-listing.dto';
import {CreateListingDto} from "./dto/create-listing.dto";
import {UpdateListingDto} from "./dto/update-listing.dto";
@Controller('listings')
export class ListingController {
    constructor(private readonly listingService: ListingService) {}

    @UseGuards(JwtAuthGuard)
    @Post()
    create(@Req() req: any, @Body() dto: CreateListingDto) {
        return this.listingService.create(req.user.id, dto);
    }
    @UseGuards(JwtAuthGuard)
    @Patch(':id')
    update(
        @Req() req: any,
        @Param('id') id: string,
        @Body() dto: UpdateListingDto,
    ) {
        return this.listingService.update(req.user.id, id, dto);
    }
    @UseGuards(JwtAuthGuard)
    @Delete(':id')
    delete(
        @Req() req: any,
        @Param('id') id: string,
        @Body() dto: DeleteListingDto,
    ) {
        return this.listingService.delete(req.user.id, id, dto);
    }
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.ADMIN)
    @Patch(':id/approve')
    approve(@Param('id') id: string, @Req() req: any) {
        return this.listingService.approve(id, req.user.role);
    }

    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.ADMIN)
    @Patch(':id/reject')
    reject(
        @Param('id') id: string,
        @Body() dto: RejectListingDto,
        @Req() req: any,
    ) {
        return this.listingService.reject(
            id,
            req.user.role,
            dto.rejectionReason,
        );
    }
}
