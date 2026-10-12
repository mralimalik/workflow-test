import type { Readable } from 'node:stream';

/**
 * Object storage behind files (data model 14 `files`). Implementations: local disk now;
 * S3 / Azure Blob later (native presigned URLs replace the API upload/download routes).
 */
export interface StorageProvider {
  readonly name: 'local' | 's3' | 'azure_blob';
  readonly bucket: string;
  put(objectKey: string, body: Buffer, contentType: string): Promise<void>;
  get(objectKey: string): Promise<Readable>;
  delete(objectKey: string): Promise<void>;
}

export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');
