import { type DynamicModule, Global, Module, type ModuleMetadata, type Type } from '@nestjs/common';

import { BusinessGateway } from './api/business.gateway';
import {
  denyAllAuthenticator,
  denyAllScopes,
  REALTIME_SCOPE_CHECKER,
  SOCKET_AUTHENTICATOR,
  type RealtimeScopeChecker,
  type SocketAuthenticator,
} from './application/ports';
import { RealtimeFanoutProcessor } from './application/realtime-fanout.processor';
import { RealtimePublisher } from './application/realtime-publisher';

/** Publisher side (any process). */
@Global()
@Module({ providers: [RealtimePublisher], exports: [RealtimePublisher] })
export class RealtimePublisherModule {}

export interface RealtimeGatewayOptions {
  /** Modules exporting the implementations below. */
  imports?: ModuleMetadata['imports'];
  authenticator?: Type<SocketAuthenticator>;
  scopeChecker?: Type<RealtimeScopeChecker>;
}

/**
 * Gateway + fanout (api process). Authenticator and scope checker default to deny-all; the
 * composition root passes the auth (A4) and access (A8) implementations.
 */
@Module({})
export class RealtimeGatewayModule {
  static register(options: RealtimeGatewayOptions = {}): DynamicModule {
    return {
      module: RealtimeGatewayModule,
      imports: options.imports ?? [],
      providers: [
        BusinessGateway,
        RealtimeFanoutProcessor,
        options.authenticator
          ? { provide: SOCKET_AUTHENTICATOR, useExisting: options.authenticator }
          : { provide: SOCKET_AUTHENTICATOR, useValue: denyAllAuthenticator },
        options.scopeChecker
          ? { provide: REALTIME_SCOPE_CHECKER, useExisting: options.scopeChecker }
          : { provide: REALTIME_SCOPE_CHECKER, useValue: denyAllScopes },
      ],
    };
  }
}
