// src/modules/plans/plans.controller.ts
import { Controller, Get, Post, Param, Req, UseGuards } from '@nestjs/common';
import { PlansService } from './plans.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('plans')
export class PlansController {
    constructor(private readonly plansService: PlansService) {}

    @Get()
    getActivePlans() {
        return this.plansService.getActivePlans();
    }

    @UseGuards(JwtAuthGuard)
    @Post(':id/buy')
    buy(@Req() req, @Param('id') id: string) {
        return this.plansService.buyPlan(req.user.id, id);
    }
}
