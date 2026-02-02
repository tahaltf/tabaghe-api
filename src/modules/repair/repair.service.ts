import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RepairRequestStatus } from '@prisma/client';
import {CreateRepairDto} from "./create-repair.dto";
import {SelectDeliveryTimeDto} from "./select-delivery-time.dto";


@Injectable()
export class RepairService {
    constructor(private readonly prisma: PrismaService) {}

    // -----------------------------------
    // Create repair request
    // -----------------------------------
    async create(userId: string, dto: CreateRepairDto) {
        const trackingCode = `REP-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

        return this.prisma.repairRequest.create({
            data: {
                userId,
                trackingCode,
                deviceType: dto.deviceType,
                brand: dto.brand,
                model: dto.model,
                description: dto.description,
                images: dto.images,
                status: RepairRequestStatus.PENDING_REVIEW,
            },
        });
    }

    // -----------------------------------
    // User: list my repairs
    // -----------------------------------
    async getMyRepairs(userId: string) {
        return this.prisma.repairRequest.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
        });
    }

    // -----------------------------------
    // User: select delivery time
    // -----------------------------------
    async selectDeliveryTime(
        userId: string,
        repairId: string,
        dto: SelectDeliveryTimeDto,
    ) {
        const repair = await this.prisma.repairRequest.findUnique({
            where: { id: repairId },
        });

        if (!repair) throw new NotFoundException();
        if (repair.userId !== userId) throw new ForbiddenException();

        if (repair.status !== RepairRequestStatus.APPROVED) {
            throw new BadRequestException('Repair not approved yet');
        }

        return this.prisma.repairRequest.update({
            where: { id: repairId },
            data: {
                selectedDeliveryTime: new Date(dto.selectedDeliveryTime),
                status: RepairRequestStatus.DELIVERY_TIME_SELECTED,
            },
        });
    }
}
