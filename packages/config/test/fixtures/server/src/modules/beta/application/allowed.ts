// Allowed: own module, another module's public file, the kernel.
import { now } from '../../../kernel/clock';
import { alphaService } from '../../alpha/alpha.public';
export const ok = { now, alphaService };
