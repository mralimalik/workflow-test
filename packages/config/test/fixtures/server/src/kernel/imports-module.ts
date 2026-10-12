// Violation: the kernel must not depend on modules.
import { alphaService } from '../modules/alpha/alpha.public';
export const bad = alphaService;
