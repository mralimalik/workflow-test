// Imported first by main.ts so OpenTelemetry patches modules before they load.
import { startTelemetry } from '@attendra/server/kernel/telemetry/telemetry';

startTelemetry('attendra-worker');
