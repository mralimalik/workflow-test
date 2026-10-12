import { Writable } from 'node:stream';

/** A pino destination that keeps parsed log lines in memory for assertions. */
export class LogCapture extends Writable {
  readonly lines: Record<string, unknown>[] = [];

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    for (const line of chunk.toString().split('\n')) {
      if (line.trim()) this.lines.push(JSON.parse(line) as Record<string, unknown>);
    }
    callback();
  }

  clear(): void {
    this.lines.length = 0;
  }
}
