import { Test, TestingModule } from '@nestjs/testing';
import { OrdersController } from './orders.controller';
import { OrdersCommandService } from './orders-command.service';
import { OrdersQueryService } from './orders-query.service';
import { InspectionCertificateService } from './inspection-certificate.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { IsVerifiedGuard } from '../auth/guards/is-verified.guard';

describe('OrdersController', () => {
  let controller: OrdersController;

  const commandMock = {
    createOrder: jest.fn(),
    updateTrackingCode: jest.fn(),
    confirmOrder: jest.fn(),
    disputeOrder: jest.fn(),
  };

  const queryMock = {
    getOrdersByType: jest.fn(),
    getMyRequests: jest.fn(),
    getOrderById: jest.fn(),
  };

  const inspectionCertificateMock = {
    generateInspectionCertificatePdf: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrdersController],
      providers: [
        { provide: OrdersCommandService, useValue: commandMock },
        { provide: OrdersQueryService, useValue: queryMock },
        {
          provide: InspectionCertificateService,
          useValue: inspectionCertificateMock,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(IsVerifiedGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<OrdersController>(OrdersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
