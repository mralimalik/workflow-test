import { files } from './infrastructure/files.schema';

export { FilesModule } from './files.module';
export {
  FilesService,
  PURPOSE_RULES,
  type CreateUploadInput,
  type SignedUrl,
} from './application/files.service';
export type { FilePurpose, FileRow } from './infrastructure/files.schema';

/** For foreign keys from other modules' tables (`.references(fileIdColumn)`); not for queries. */
export const fileIdColumn = () => files.id;
