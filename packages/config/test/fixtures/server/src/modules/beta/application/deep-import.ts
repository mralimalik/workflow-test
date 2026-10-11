// Violation: deep import into another module's infrastructure.
import { alphaRepository } from '../../alpha/infrastructure/alpha.repository';
export const deep = alphaRepository;
