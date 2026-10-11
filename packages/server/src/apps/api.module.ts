import { Module } from '@nestjs/common';

/**
 * Composition root for the `api` process (HTTP, webhooks, WebSocket gateway).
 * Feature modules are registered here as they are built (BACKEND.md §2–3).
 */
@Module({})
export class ApiModule {}
