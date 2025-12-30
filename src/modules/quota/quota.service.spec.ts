import { Test, TestingModule } from '@nestjs/testing';
import { QuotaService } from './quota.service';

describe('QuotaService', () => {
  let service: QuotaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [QuotaService],
    }).compile();

    service = module.get<QuotaService>(QuotaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
