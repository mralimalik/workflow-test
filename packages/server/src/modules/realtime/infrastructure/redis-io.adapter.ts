import { once } from 'node:events';

import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-streams-adapter';
import type { Redis, RedisOptions } from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';

const SETTLE_TIMEOUT_MS = 2_000;

/**
 * Socket.IO with the Redis Streams adapter, so emits reach sockets on every api instance and
 * survive brief Redis disconnects. The adapter blocks on XREAD, so it gets its own connection.
 *
 * Shutdown: the adapter (0.3.1) duplicates our connection for its stream reader and its
 * subscriber, and issues SUBSCRIBE without handling rejection. Closing before those
 * connections are ready turns into unhandled "Connection is closed" rejections, so `close`
 * first waits (bounded) for the duplicates to be ready and the subscriptions acknowledged.
 */
export class RedisStreamsIoAdapter extends IoAdapter {
  private readonly redis: Redis;
  private readonly duplicates: Redis[] = [];

  constructor(
    app: INestApplicationContext,
    redis: Redis,
    private readonly prefix: string,
  ) {
    super(app);
    this.redis = redis.duplicate({ connectionName: 'attendra-socketio' });
    const duplicate = this.redis.duplicate.bind(this.redis);
    this.redis.duplicate = (override?: Partial<RedisOptions>) => {
      const client = duplicate(override);
      this.duplicates.push(client);
      return client;
    };
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const adapter = createAdapter(this.redis, {
      streamName: `${this.prefix}:socket.io`,
      channelPrefix: `${this.prefix}:socket.io`,
    });
    return super.createIOServer(port, { ...options, adapter } as ServerOptions);
  }

  override async close(server: Server): Promise<void> {
    await this.settle();
    await super.close(server);
    await this.redis.quit().catch(() => undefined);
  }

  private async settle(): Promise<void> {
    const ready = (client: Redis) =>
      client.status === 'ready' ? Promise.resolve() : once(client, 'ready').then(() => undefined);
    const settled = Promise.all(
      [this.redis, ...this.duplicates].map(async (client) => {
        await ready(client);
        // PING is queued behind SUBSCRIBE, so it resolves once the subscription is acked.
        // (Not on the stream reader: it is blocked in XREAD.)
        if ((client as unknown as { condition?: { subscriber?: unknown } }).condition?.subscriber) {
          await client.ping();
        }
      }),
    );
    await Promise.race([
      settled,
      new Promise((resolve) => setTimeout(resolve, SETTLE_TIMEOUT_MS).unref()),
    ]).catch(() => undefined);
  }
}
