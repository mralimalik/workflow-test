import { allRoutes, toExpressPath, type RouteDefinition } from '@attendra/contracts';
import { PATH_METADATA } from '@nestjs/common/constants.js';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { CONTRACT_ROUTE } from '@attendra/server/kernel/http/contract-route';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from './support/test-app';

/**
 * Registry ↔ mounted routes conformance (ADR-0014): every handler is a contract route,
 * and every contract route is mounted exactly once.
 */
describe('contract conformance', () => {
  let t: TestApp;
  const mounted: { handler: string; route: RouteDefinition | undefined }[] = [];

  beforeAll(async () => {
    t = await createTestApp();
    const discovery = t.app.get(DiscoveryService);
    const scanner = t.app.get(MetadataScanner);
    for (const wrapper of discovery.getControllers()) {
      const instance = wrapper.instance as Record<string, unknown> | undefined;
      if (!instance) continue;
      const prototype = Object.getPrototypeOf(instance) as object;
      for (const name of scanner.getAllMethodNames(prototype)) {
        const method = (prototype as Record<string, unknown>)[name] as object;
        if (Reflect.getMetadata(PATH_METADATA, method) === undefined) continue;
        mounted.push({
          handler: `${wrapper.name}.${name}`,
          route: Reflect.getMetadata(CONTRACT_ROUTE, method) as RouteDefinition | undefined,
        });
      }
    }
  });
  afterAll(async () => {
    await t.close();
  });

  it('every mounted handler is declared with @ContractRoute', () => {
    expect(mounted.filter((m) => !m.route).map((m) => m.handler)).toEqual([]);
  });

  it('every registry route is mounted exactly once', () => {
    const counts = new Map<string, number>();
    for (const m of mounted) if (m.route) counts.set(m.route.id, (counts.get(m.route.id) ?? 0) + 1);
    const problems = allRoutes
      .filter((r) => counts.get(r.id) !== 1)
      .map(
        (r) => `${r.id} (${r.method} ${toExpressPath(r.path)}) mounted ${counts.get(r.id) ?? 0}×`,
      );
    expect(problems).toEqual([]);
  });
});
