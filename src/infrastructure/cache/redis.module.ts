import { Global, Module } from '@nestjs/common';
import { CategoryTreeCacheService } from '../../common/category/category-tree-cache.service';
import { UserActionRateLimitService } from '../../common/services/user-action-rate-limit.service';
import { RedisService } from './redis.service';
import { TtlCacheService } from './ttl-cache.service';

@Global()
@Module({
  providers: [
    RedisService,
    TtlCacheService,
    CategoryTreeCacheService,
    UserActionRateLimitService,
  ],
  exports: [
    RedisService,
    TtlCacheService,
    CategoryTreeCacheService,
    UserActionRateLimitService,
  ],
})
export class RedisModule {}
