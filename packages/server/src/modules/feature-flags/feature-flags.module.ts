import { Global, Module } from '@nestjs/common';

import { FeatureFlagsCacheInvalidator } from './application/feature-flags-cache.handler';
import { FeatureFlags } from './application/feature-flags.service';

@Global()
@Module({ providers: [FeatureFlags, FeatureFlagsCacheInvalidator], exports: [FeatureFlags] })
export class FeatureFlagsModule {}
