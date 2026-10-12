import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-streams-adapter';
import type { Redis } from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';

/**
 * Socket.IO with the Redis Streams adapter, so emits reach sockets on every api instance and
 * survive brief Redis disconnects. The adapter blocks on XREAD, so it gets its own connection.
 */
export class RedisStreamsIoAdapter extends IoAdapter {
  private readonly redis: Redis;

  constructor(
    app: INestApplicationContext,
    redis: Redis,
    private readonly prefix: string,
  ) {
    super(app);
    this.redis = redis.duplicate({ connectionName: 'attendra-socketio' });
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const adapter = createAdapter(this.redis, {
      streamName: `${this.prefix}:socket.io`,
      channelPrefix: `${this.prefix}:socket.io`,
    });
    return super.createIOServer(port, { ...options, adapter } as ServerOptions);
  }

  override async close(server: Server): Promise<void> {
    await super.close(server);
    await this.redis.quit().catch(() => undefined);
  }
}
