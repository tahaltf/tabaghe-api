import { Global, Module } from '@nestjs/common';
import { CategoryTreeCacheService } from '../../common/category/category-tree-cache.service';
import { RedisService } from './redis.service';
import { TtlCacheService } from './ttl-cache.service';

@Global()
@Module({
  providers: [RedisService, TtlCacheService, CategoryTreeCacheService],
  exports: [RedisService, TtlCacheService, CategoryTreeCacheService],
})
export class RedisModule {}
