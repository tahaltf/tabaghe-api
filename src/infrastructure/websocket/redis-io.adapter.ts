import { INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import type { ServerOptions } from 'socket.io';

export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor: ReturnType<typeof createAdapter> | null = null;

  constructor(app: INestApplicationContext) {
    super(app);
  }

  connectToRedis(url: string): void {
    const pubClient = new Redis(url, { maxRetriesPerRequest: 2 });
    const subClient = pubClient.duplicate();
    pubClient.on('error', (err) =>
      this.logger.warn(`Redis pub error: ${err.message}`),
    );
    subClient.on('error', (err) =>
      this.logger.warn(`Redis sub error: ${err.message}`),
    );
    this.adapterConstructor = createAdapter(pubClient, subClient);
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
