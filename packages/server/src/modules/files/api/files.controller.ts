import { Controller, Req, Res } from '@nestjs/common';
import { routes, type RouteInput } from '@attendra/contracts';
import type { Request, Response } from 'express';

import { AppError } from '../../../kernel/errors/app-error';
import { ContractParams, ContractRoute } from '../../../kernel/http/contract-route';
import { FilesService, PURPOSE_RULES } from '../application/files.service';

const MAX_UPLOAD_BYTES = Math.max(...Object.values(PURPOSE_RULES).map((r) => r.maxBytes));

async function readBody(req: Request, limit: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length'] ?? '0');
  if (declared > limit) throw new AppError('payload_too_large');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) throw new AppError('payload_too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Signed-URL endpoints of the local storage provider (contracts: routes.files). */
@Controller()
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @ContractRoute(routes.files.upload)
  async upload(
    @ContractParams(routes.files.upload) params: RouteInput<typeof routes.files.upload>['params'],
    @Req() req: Request,
  ) {
    return this.files.receiveUpload(params.token, await readBody(req, MAX_UPLOAD_BYTES));
  }

  @ContractRoute(routes.files.download)
  async download(
    @ContractParams(routes.files.download)
    params: RouteInput<typeof routes.files.download>['params'],
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.files.openDownload(params.token);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Length', String(file.sizeBytes));
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Content-Disposition', 'inline');
    file.stream.pipe(res);
  }
}
