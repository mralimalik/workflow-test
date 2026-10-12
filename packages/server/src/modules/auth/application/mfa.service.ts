import { Injectable } from '@nestjs/common';
import { generateSecret, generateURI, verify } from 'otplib';

import { AppConfig } from '../../../kernel/config/app-config';
import { EnvelopeCipher } from '../../../kernel/crypto/envelope';
import { Pepper } from '../../../kernel/crypto/secrets';
import type { Tx } from '../../../kernel/db/database';
import { AppError } from '../../../kernel/errors/app-error';
import { newId } from '../../../kernel/ids/ids';
import { Clock } from '../../../kernel/time/clock';
import { generateRecoveryCodes, normalizeRecoveryCode } from '../domain/recovery-codes';
import { MfaRepository, type MfaSubjectType } from '../infrastructure/mfa.repository';

const ISSUER = 'Attendra';
/** A pending (unconfirmed) TOTP enrolment must be confirmed within this time. */
export const TOTP_ENROLL_TTL_MS = 15 * 60_000;
/** Accept the previous and next 30 s step for clock drift (RFC 6238 §5.2). */
const EPOCH_TOLERANCE_S = 30;
const HASH_BYTES = 32;

/**
 * TOTP (RFC 6238 via otplib) and recovery codes (FR-AUTH-005). TOTP secrets are
 * envelope-encrypted per record; recovery codes are stored only as peppered HMACs, and a
 * used code is removed. A TOTP time step is accepted at most once (replay protection).
 */
@Injectable()
export class MfaService {
  private readonly pepper: Pepper;

  constructor(
    config: AppConfig,
    private readonly repository: MfaRepository,
    private readonly cipher: EnvelopeCipher,
    private readonly clock: Clock,
  ) {
    this.pepper = new Pepper(config.get('SESSION_SECRET', { infer: true }), 'mfa-recovery-code');
  }

  async isEnabled(tx: Tx, subjectType: MfaSubjectType, subjectId: string): Promise<boolean> {
    return (await this.repository.findActive(tx, subjectType, subjectId, 'totp')) !== null;
  }

  /** Starts enrolment: replaces any pending factor and returns the new secret. */
  async enroll(
    tx: Tx,
    subjectType: MfaSubjectType,
    subjectId: string,
    accountLabel: string,
  ): Promise<{ secret: string; otpauthUrl: string; expiresAt: Date }> {
    if (await this.isEnabled(tx, subjectType, subjectId)) throw new AppError('mfa_already_enabled');
    await this.repository.deleteAll(tx, subjectType, subjectId, {
      type: 'totp',
      onlyUnverified: true,
    });
    const secret = generateSecret();
    const id = newId();
    const now = this.clock.now();
    await this.repository.insert(tx, {
      id,
      subjectType,
      subjectId,
      type: 'totp',
      secretCiphertext: this.cipher.encrypt(secret, aad(id)),
      createdAt: now,
    });
    return {
      secret,
      otpauthUrl: generateURI({ issuer: ISSUER, label: accountLabel, secret }),
      expiresAt: new Date(now.getTime() + TOTP_ENROLL_TTL_MS),
    };
  }

  /** Confirms the pending factor with a code and issues fresh recovery codes. */
  async confirm(
    tx: Tx,
    subjectType: MfaSubjectType,
    subjectId: string,
    code: string,
  ): Promise<string[]> {
    if (await this.isEnabled(tx, subjectType, subjectId)) throw new AppError('mfa_already_enabled');
    const pending = await this.repository.findPendingTotp(tx, subjectType, subjectId);
    const now = this.clock.now();
    if (!pending || now.getTime() - pending.createdAt.getTime() > TOTP_ENROLL_TTL_MS) {
      throw new AppError('token_invalid', { detail: 'Start two-factor setup again' });
    }
    const step = await this.matchStep(pending.secretCiphertext, pending.id, code, null);
    if (step === null) throw new AppError('mfa_code_invalid');
    await this.repository.update(tx, pending.id, {
      verifiedAt: now,
      lastUsedStep: step,
      lastUsedAt: now,
    });
    return this.replaceRecoveryCodes(tx, subjectType, subjectId);
  }

  /** Verifies a login code; consumes the time step. */
  async verifyTotp(
    tx: Tx,
    subjectType: MfaSubjectType,
    subjectId: string,
    code: string,
  ): Promise<boolean> {
    const factor = await this.repository.findActive(tx, subjectType, subjectId, 'totp');
    if (!factor) return false;
    const step = await this.matchStep(
      factor.secretCiphertext,
      factor.id,
      code,
      factor.lastUsedStep,
    );
    if (step === null) return false;
    return this.repository.advanceStep(tx, factor.id, step, this.clock.now());
  }

  /** Verifies and burns one recovery code. */
  async useRecoveryCode(
    tx: Tx,
    subjectType: MfaSubjectType,
    subjectId: string,
    input: string,
  ): Promise<boolean> {
    const factor = await this.repository.findActive(tx, subjectType, subjectId, 'recovery_codes', {
      forUpdate: true,
    });
    if (!factor) return false;
    const target = this.pepper.hash(normalizeRecoveryCode(input));
    const hashes = splitHashes(factor.secretCiphertext);
    const index = hashes.findIndex((h) => h.equals(target));
    if (index < 0) return false;
    hashes.splice(index, 1);
    await this.repository.update(tx, factor.id, {
      secretCiphertext: Buffer.concat(hashes),
      lastUsedAt: this.clock.now(),
    });
    return true;
  }

  async disable(tx: Tx, subjectType: MfaSubjectType, subjectId: string): Promise<void> {
    if (!(await this.isEnabled(tx, subjectType, subjectId))) throw new AppError('mfa_not_enabled');
    await this.repository.deleteAll(tx, subjectType, subjectId);
  }

  private async replaceRecoveryCodes(
    tx: Tx,
    subjectType: MfaSubjectType,
    subjectId: string,
  ): Promise<string[]> {
    await this.repository.deleteAll(tx, subjectType, subjectId, { type: 'recovery_codes' });
    const codes = generateRecoveryCodes();
    await this.repository.insert(tx, {
      id: newId(),
      subjectType,
      subjectId,
      type: 'recovery_codes',
      secretCiphertext: Buffer.concat(codes.map((c) => this.pepper.hash(normalizeRecoveryCode(c)))),
      verifiedAt: this.clock.now(),
    });
    return codes;
  }

  /** The matching time step, or null. Steps at or before `afterStep` are refused. */
  private async matchStep(
    ciphertext: Buffer,
    factorId: string,
    code: string,
    afterStep: number | null,
  ): Promise<number | null> {
    const secret = this.cipher.decrypt(ciphertext, aad(factorId)).toString();
    const result = await verify({
      secret,
      token: code,
      epoch: Math.floor(this.clock.now().getTime() / 1000),
      epochTolerance: EPOCH_TOLERANCE_S,
      ...(afterStep !== null ? { afterTimeStep: afterStep } : {}),
    });
    return result.valid && 'timeStep' in result ? result.timeStep : null;
  }
}

const aad = (factorId: string) => `mfa_factors:${factorId}`;

function splitHashes(buffer: Buffer): Buffer[] {
  const out: Buffer[] = [];
  for (let o = 0; o + HASH_BYTES <= buffer.length; o += HASH_BYTES) {
    out.push(buffer.subarray(o, o + HASH_BYTES));
  }
  return out;
}
