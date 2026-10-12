import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { NodeSDK } from '@opentelemetry/sdk-node';

let sdk: NodeSDK | undefined;

/**
 * Starts OpenTelemetry (BACKEND.md §8.2). Call before anything else is imported — each app
 * imports its `instrumentation.ts` first. Exporters are chosen by the standard `OTEL_*`
 * variables; locally `OTEL_TRACES_EXPORTER=none` still creates spans, so trace ids appear
 * in logs without a collector.
 */
export function startTelemetry(serviceName: string): void {
  if (sdk || process.env['OTEL_SDK_DISABLED'] === 'true') return;
  process.env['OTEL_SERVICE_NAME'] ??= serviceName;
  sdk = new NodeSDK({
    instrumentations: [
      getNodeAutoInstrumentations({
        // Noisy, and not useful for us.
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
        '@opentelemetry/instrumentation-net': { enabled: false },
        // We add traceId/spanId to logs ourselves (logger mixin), with our field names.
        '@opentelemetry/instrumentation-pino': { enabled: false },
      }),
    ],
  });
  sdk.start();
}

export async function stopTelemetry(): Promise<void> {
  await sdk?.shutdown();
  sdk = undefined;
}
