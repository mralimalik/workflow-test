import { Writable } from 'node:stream';

/** Discards (or keeps) pino lines in tests. */
export class LogSink extends Writable {
  readonly lines: Record<string, unknown>[] = [];

  override _write(chunk: Buffer, _enc: BufferEncoding, cb: (error?: Error | null) => void): void {
    for (const line of chunk.toString().split('\n'))
      if (line.trim()) this.lines.push(JSON.parse(line) as Record<string, unknown>);
    cb();
  }
}
