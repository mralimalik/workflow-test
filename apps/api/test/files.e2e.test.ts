import { FilesService } from '@attendra/server/modules/files/files.public';
import { Database } from '@attendra/server/kernel/db/database';
import { newId } from '@attendra/server/kernel/ids/ids';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from './support/test-app';

// Smallest valid PNG (1×1 transparent).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const user = { type: 'user', id: newId() } as const;

describe('files: signed uploads and downloads (data model 14)', () => {
  let t: TestApp;
  let files: FilesService;
  let db: Database;

  beforeAll(async () => {
    t = await createTestApp();
    files = t.app.get(FilesService);
    db = t.app.get(Database);
  });
  afterAll(async () => {
    await t.close();
  });

  const pathOf = (url: string) => new URL(url).pathname;

  async function newUpload(
    organizationId: string | null,
    sizeBytes = PNG.length,
    contentType = 'image/png',
  ) {
    const scope = { organizationId: organizationId ?? newId(), actor: user };
    const create = (tx: Parameters<Parameters<Database['transaction']>[0]>[0]) =>
      files.createUpload(tx, {
        organizationId,
        ownerType: organizationId ? 'organization' : 'user',
        ownerId: user.id,
        purpose: 'logo',
        contentType,
        sizeBytes,
        originalName: '../../etc/logo.png',
        uploadedBy: user,
      });
    return organizationId ? db.tenantTx(scope, create) : db.transaction(create);
  }

  it('uploads through a signed URL after verifying real content, then downloads it', async () => {
    const orgId = newId();
    const { fileId, upload } = await newUpload(orgId);
    expect(upload.method).toBe('PUT');

    const put = await request(t.server)
      .put(pathOf(upload.url))
      .set('Content-Type', 'image/png')
      .send(PNG);
    expect(put.status).toBe(200);
    expect(put.body).toEqual({
      id: fileId,
      status: 'ready',
      contentType: 'image/png',
      sizeBytes: PNG.length,
    });

    const row = await db.tenantTx({ organizationId: orgId, actor: user }, (tx) =>
      tx.execute<{ status: string; original_name: string }>(
        sql`select status, original_name from files where id = ${fileId}`,
      ),
    );
    expect(row.rows[0]).toEqual({ status: 'ready', original_name: 'logo.png' });

    const download = files.downloadUrl({ id: fileId, organizationId: orgId, status: 'ready' });
    const get = await request(t.server)
      .get(pathOf(download.url))
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => {
          chunks.push(c);
        });
        res.on('end', () => {
          cb(null, Buffer.concat(chunks));
        });
      });
    expect(get.status).toBe(200);
    expect(get.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(get.body as Buffer, PNG)).toBe(0);

    const reuse = await request(t.server)
      .put(pathOf(upload.url))
      .set('Content-Type', 'image/png')
      .send(PNG);
    expect(reuse.status).toBe(409);
  });

  it('rejects content whose real type differs from the declared one', async () => {
    const fake = Buffer.from('<?php echo "not an image"; ?>');
    const { upload } = await newUpload(null, fake.length);
    const res = await request(t.server)
      .put(pathOf(upload.url))
      .set('Content-Type', 'image/png')
      .send(fake);
    expect(res.status).toBe(415);
    expect(res.body.code).toBe('unsupported_media_type');
  });

  it('rejects a size different from the declared one, and disallowed types up front', async () => {
    const { upload } = await newUpload(null, PNG.length + 10);
    const res = await request(t.server)
      .put(pathOf(upload.url))
      .set('Content-Type', 'image/png')
      .send(PNG);
    expect(res.status).toBe(413);
    await expect(newUpload(null, 10, 'image/svg+xml')).rejects.toMatchObject({
      code: 'unsupported_media_type',
    });
  });

  it('rejects tampered and wrong-operation tokens', async () => {
    const { upload } = await newUpload(null);
    const token = pathOf(upload.url).split('/').pop()!;
    const [payload, mac] = token.split('.');
    const forged = `${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload!, 'base64url').toString()), exp: 9_999_999_999 })).toString('base64url')}.${mac!}`;
    expect(
      (await request(t.server).put(`/v1/public/files/uploads/${forged}`).send(PNG)).status,
    ).toBe(403);
    // An upload token cannot be used to download.
    expect((await request(t.server).get(`/v1/public/files/${token}`)).status).toBe(403);
  });

  it('tenant file rows are invisible to other tenants', async () => {
    const orgId = newId();
    const { fileId } = await newUpload(orgId);
    const other = await db.tenantTx({ organizationId: newId(), actor: user }, (tx) =>
      tx.execute(sql`select id from files where id = ${fileId}`),
    );
    expect(other.rows).toEqual([]);
    const global = await db.transaction((tx) =>
      tx.execute(sql`select id from files where id = ${fileId}`),
    );
    expect(global.rows).toEqual([]);
  });
});
