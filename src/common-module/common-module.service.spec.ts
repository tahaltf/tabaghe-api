import { Test, TestingModule } from '@nestjs/testing';
import { CommonModuleService } from './common-module.service';

describe('CommonModuleService', () => {
  let service: CommonModuleService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CommonModuleService],
    }).compile();

    service = module.get<CommonModuleService>(CommonModuleService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
