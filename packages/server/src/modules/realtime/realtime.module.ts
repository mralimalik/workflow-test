import { Global, Module } from '@nestjs/common';

import { BusinessGateway } from './api/business.gateway';
import {
  denyAllAuthenticator,
  denyAllScopes,
  REALTIME_SCOPE_CHECKER,
  SOCKET_AUTHENTICATOR,
} from './application/ports';
import { RealtimeFanoutProcessor } from './application/realtime-fanout.processor';
import { RealtimePublisher } from './application/realtime-publisher';

/** Publisher side (any process). */
@Global()
@Module({ providers: [RealtimePublisher], exports: [RealtimePublisher] })
export class RealtimePublisherModule {}

/**
 * Gateway + fanout (api process). Authenticator and scope checker default to deny-all; the
 * auth (A4) and access (A8) modules override them.
 */
@Module({
  providers: [
    BusinessGateway,
    RealtimeFanoutProcessor,
    { provide: SOCKET_AUTHENTICATOR, useValue: denyAllAuthenticator },
    { provide: REALTIME_SCOPE_CHECKER, useValue: denyAllScopes },
  ],
})
export class RealtimeGatewayModule {}
