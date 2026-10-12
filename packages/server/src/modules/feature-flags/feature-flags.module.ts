import { Global, Module } from '@nestjs/common';

import { FeatureFlagsCacheInvalidator } from './application/feature-flags-cache.handler';
import { FeatureFlagAdmin } from './application/feature-flag-admin.service';
import { FeatureFlags } from './application/feature-flags.service';

@Global()
@Module({
  providers: [FeatureFlags, FeatureFlagAdmin, FeatureFlagsCacheInvalidator],
  exports: [FeatureFlags, FeatureFlagAdmin],
})
export class FeatureFlagsModule {}
