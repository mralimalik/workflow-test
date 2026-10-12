import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';

import { Inject, Injectable } from '@nestjs/common';
import { IMAGE_CONTENT_TYPES } from '@attendra/contracts';
import { and, eq } from 'drizzle-orm';
import { fileTypeFromBuffer } from 'file-type';

import { AppConfig } from '../../../kernel/config/app-config';
import type { Actor } from '../../../kernel/context/request-context';
import { Database, type Tx } from '../../../kernel/db/database';
import { AppError, ForbiddenError, NotFoundError } from '../../../kernel/errors/app-error';
import { newId } from '../../../kernel/ids/ids';
import { Clock } from '../../../kernel/time/clock';
import { files, type FilePurpose, type FileRow } from '../infrastructure/files.schema';
import { STORAGE_PROVIDER, type StorageProvider } from '../infrastructure/storage-provider';
import { FileUrlSigner } from './url-signer';

/** Accepted types and size limits per purpose (types verified by magic bytes, not by the client). */
export const PURPOSE_RULES: Record<FilePurpose, { types: readonly string[]; maxBytes: number }> = {
  logo: { types: IMAGE_CONTENT_TYPES, maxBytes: 5 * 1024 * 1024 },
  avatar: { types: IMAGE_CONTENT_TYPES, maxBytes: 5 * 1024 * 1024 },
  service_image: { types: IMAGE_CONTENT_TYPES, maxBytes: 8 * 1024 * 1024 },
  product_image: { types: IMAGE_CONTENT_TYPES, maxBytes: 8 * 1024 * 1024 },
  recording: { types: ['audio/mpeg', 'audio/wav', 'audio/ogg'], maxBytes: 200 * 1024 * 1024 },
  knowledge_document: { types: ['application/pdf'], maxBytes: 25 * 1024 * 1024 },
  export: { types: ['text/csv', 'application/zip'], maxBytes: 100 * 1024 * 1024 },
  attachment: { types: [...IMAGE_CONTENT_TYPES, 'application/pdf'], maxBytes: 10 * 1024 * 1024 },
};

const UPLOAD_TTL_S = 15 * 60;
const DOWNLOAD_TTL_S = 5 * 60;

export interface CreateUploadInput {
  organizationId: string | null;
  ownerType: 'organization' | 'customer' | 'user' | 'platform';
  ownerId: string | null;
  purpose: FilePurpose;
  contentType: string;
  sizeBytes: number;
  originalName?: string;
  uploadedBy: Actor;
}

export interface SignedUrl {
  url: string;
  method: 'PUT' | 'GET';
  expiresAt: string;
}

/**
 * Files (data model 14): signed upload → magic-byte check → stored; downloads only through
 * short-lived signed URLs. Rows are created inside the caller's transaction (tenant or global).
 */
@Injectable()
export class FilesService {
  private readonly signer: FileUrlSigner;
  private readonly apiBase: string;

  constructor(
    config: AppConfig,
    private readonly db: Database,
    private readonly clock: Clock,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {
    this.signer = new FileUrlSigner(config.get('SESSION_SECRET', { infer: true }));
    this.apiBase = config.get('API_PUBLIC_URL', { infer: true }).replace(/\/$/, '');
  }

  /** Registers a pending file and returns where to PUT its bytes. */
  async createUpload(
    tx: Tx,
    input: CreateUploadInput,
  ): Promise<{ fileId: string; upload: SignedUrl }> {
    const rules = PURPOSE_RULES[input.purpose];
    if (!rules.types.includes(input.contentType))
      throw new AppError('unsupported_media_type', {
        detail: `Allowed: ${rules.types.join(', ')}`,
      });
    if (input.sizeBytes <= 0 || input.sizeBytes > rules.maxBytes) {
      throw new AppError('payload_too_large', {
        detail: `Maximum ${rules.maxBytes} bytes for ${input.purpose}`,
      });
    }
    const fileId = newId();
    await tx.insert(files).values({
      id: fileId,
      organizationId: input.organizationId,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      purpose: input.purpose,
      storageProvider: this.storage.name,
      bucket: this.storage.bucket,
      objectKey: `${input.organizationId ?? 'global'}/${input.purpose}/${fileId}`,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      originalName: input.originalName ? sanitizeName(input.originalName) : null,
      uploadedByType: input.uploadedBy.type,
      uploadedById: /^[0-9a-f-]{36}$/i.test(input.uploadedBy.id) ? input.uploadedBy.id : null,
    });
    return { fileId, upload: this.signedUrl(fileId, input.organizationId, 'put', UPLOAD_TTL_S) };
  }

  /** A ready file with this owner and purpose (visible in the caller's transaction), or null. */
  async findOwned(
    tx: Tx,
    fileId: string,
    owner: { ownerType: CreateUploadInput['ownerType']; ownerId: string; purpose: FilePurpose },
  ): Promise<FileRow | null> {
    const [row] = await tx
      .select()
      .from(files)
      .where(
        and(
          eq(files.id, fileId),
          eq(files.ownerType, owner.ownerType),
          eq(files.ownerId, owner.ownerId),
          eq(files.purpose, owner.purpose),
          eq(files.status, 'ready'),
        ),
      );
    return row ?? null;
  }

  /** A short-lived download URL for a ready file. */
  downloadUrl(file: Pick<FileRow, 'id' | 'organizationId' | 'status'>): SignedUrl {
    if (file.status !== 'ready') throw new NotFoundError();
    return this.signedUrl(file.id, file.organizationId, 'get', DOWNLOAD_TTL_S);
  }

  /** Handles the signed PUT: verifies the token, size and real content type, then stores the bytes. */
  async receiveUpload(
    token: string,
    body: Buffer,
  ): Promise<{ id: string; status: 'ready'; contentType: string; sizeBytes: number }> {
    const claims = this.signer.verify(token, 'put', this.clock.now().getTime());
    if (!claims) throw new ForbiddenError('forbidden', 'The upload URL is invalid or expired');
    return this.inScope(claims.o, async (tx) => {
      const [file] = await tx.select().from(files).where(eq(files.id, claims.f)).for('update');
      if (!file) throw new NotFoundError();
      if (file.status !== 'pending')
        throw new AppError('conflict', { detail: 'This upload URL was already used' });
      if (body.length > PURPOSE_RULES[file.purpose].maxBytes || body.length !== file.sizeBytes) {
        throw new AppError('payload_too_large', {
          detail: `Expected exactly ${file.sizeBytes} bytes`,
        });
      }
      const detected = (await fileTypeFromBuffer(body))?.mime;
      if (detected !== file.contentType) {
        throw new AppError('unsupported_media_type', {
          detail: `Content is ${detected ?? 'unknown'}, declared ${file.contentType}`,
        });
      }
      await this.storage.put(file.objectKey, body, file.contentType);
      await tx
        .update(files)
        .set({ status: 'ready', checksumSha256: createHash('sha256').update(body).digest() })
        .where(eq(files.id, file.id));
      return {
        id: file.id,
        status: 'ready' as const,
        contentType: file.contentType,
        sizeBytes: body.length,
      };
    });
  }

  /** Resolves a signed GET into a stream. */
  async openDownload(
    token: string,
  ): Promise<{ stream: Readable; contentType: string; sizeBytes: number }> {
    const claims = this.signer.verify(token, 'get', this.clock.now().getTime());
    if (!claims) throw new ForbiddenError('forbidden', 'The download URL is invalid or expired');
    const file = await this.inScope(claims.o, async (tx) => {
      const [row] = await tx.select().from(files).where(eq(files.id, claims.f));
      return row;
    });
    if (file?.status !== 'ready') throw new NotFoundError();
    return {
      stream: await this.storage.get(file.objectKey),
      contentType: file.contentType,
      sizeBytes: file.sizeBytes,
    };
  }

  private signedUrl(
    fileId: string,
    organizationId: string | null,
    op: 'put' | 'get',
    ttlSeconds: number,
  ): SignedUrl {
    const exp = Math.floor(this.clock.now().getTime() / 1000) + ttlSeconds;
    const token = this.signer.sign({ f: fileId, o: organizationId, op, exp });
    const path = op === 'put' ? `/v1/public/files/uploads/${token}` : `/v1/public/files/${token}`;
    return {
      url: `${this.apiBase}${path}`,
      method: op === 'put' ? 'PUT' : 'GET',
      expiresAt: new Date(exp * 1000).toISOString(),
    };
  }

  private inScope<T>(organizationId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return organizationId
      ? this.db.tenantTx({ organizationId, actor: { type: 'system', id: 'files' } }, fn)
      : this.db.transaction(fn);
  }
}

/** Keeps a display name only: no paths, no control characters, bounded length. */
export function sanitizeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  // eslint-disable-next-line no-control-regex
  return base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').slice(0, 200) || 'file';
}
