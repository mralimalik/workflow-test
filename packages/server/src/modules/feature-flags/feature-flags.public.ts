export { FeatureFlagsModule } from './feature-flags.module';
export { FeatureFlags, FEATURE_FLAGS_CACHE } from './application/feature-flags.service';
export type { FlagContext } from './domain/evaluate';
export { platformFlagsSeed, PLATFORM_FLAGS } from './infrastructure/platform-flags.seed';
export {
  FeatureFlagAdmin,
  type FlagRow,
  type OverrideRow,
} from './application/feature-flag-admin.service';
