import { INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import type { ServerOptions } from 'socket.io';
import {
  createRedisConnectionOptions,
  parseRedisUrl,
} from '../cache/redis-options.util';

export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor: ReturnType<typeof createAdapter> | null = null;
  private pubClient: Redis | null = null;
  private subClient: Redis | null = null;

  constructor(app: INestApplicationContext) {
    super(app);
  }

  connectToRedis(url: string): void {
    const validated = parseRedisUrl(url);
    if (!validated) {
      throw new Error('RedisIoAdapter requires a valid REDIS_URL');
    }

    const options = createRedisConnectionOptions();
    this.pubClient = new Redis(validated, options);
    this.subClient = this.pubClient.duplicate();

    this.pubClient.on('error', (err) =>
      this.logger.warn(`Redis pub error: ${err.message}`),
    );
    this.subClient.on('error', (err) =>
      this.logger.warn(`Redis sub error: ${err.message}`),
    );

    this.adapterConstructor = createAdapter(this.pubClient, this.subClient);
    this.logger.log('Socket.io Redis adapter enabled');
  }

  override createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, options);
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }
}
