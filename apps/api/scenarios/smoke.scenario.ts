import { defineScenario } from './lib/scenario';

/** Proves the runner end to end against a running API. Replaced by real flows from A1 on. */
export default defineScenario({
  id: 'smoke',
  title: 'Smoke: API is reachable',
  requirements: [],
  async run(ctx) {
    await ctx.request('Unknown route', 'GET', '/v1/does-not-exist', { expectStatus: 404 });
  },
});
