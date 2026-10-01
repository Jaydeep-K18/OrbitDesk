import { createHash, randomBytes } from 'node:crypto';
import {
  SignJWT,
  exportJWK,
  generateKeyPair,
  importJWK,
  jwtVerify,
  type CryptoKey,
  type JWK,
  type KeyObject,
} from 'jose';
import type { Clock } from '@focusguard/domain';
import type { TokenAudience } from '@focusguard/contracts';

type Key = CryptoKey | KeyObject | Uint8Array;

export interface AccessClaims {
  sub: string;
  aud: TokenAudience;
  /** Session family id (web) or device id (extension/collector). */
  sid: string;
  scope: string[];
}

const ISSUER = 'focusguard';

/** Signs and verifies short-lived EdDSA access tokens (ADR-004). */
export class TokenService {
  private constructor(
    private readonly privateKey: Key,
    private readonly publicKey: Key,
    private readonly kid: string,
    private readonly ttlSec: number,
    private readonly clock: Clock,
  ) {}

  static async create(opts: {
    privateJwk?: string;
    kid: string;
    ttlSec: number;
    clock: Clock;
  }): Promise<TokenService> {
    if (opts.privateJwk) {
      const jwk = JSON.parse(opts.privateJwk) as JWK;
      const privateKey = await importJWK(jwk, 'EdDSA');
      const { d: _d, ...publicJwk } = jwk;
      const publicKey = await importJWK(publicJwk, 'EdDSA');
      return new TokenService(privateKey, publicKey, opts.kid, opts.ttlSec, opts.clock);
    }
    // Development/test: ephemeral key. Access tokens die on restart; refresh tokens survive.
    const { privateKey, publicKey } = await generateKeyPair('EdDSA', { extractable: true });
    return new TokenService(privateKey, publicKey, opts.kid, opts.ttlSec, opts.clock);
  }

  /** Helper for ops: prints a new private JWK to put in JWT_PRIVATE_JWK. */
  static async generatePrivateJwk(): Promise<string> {
    const { privateKey } = await generateKeyPair('EdDSA', { extractable: true });
    return JSON.stringify(await exportJWK(privateKey));
  }

  get accessTtlSec(): number {
    return this.ttlSec;
  }

  async sign(claims: AccessClaims): Promise<string> {
    const nowSec = Math.floor(this.clock.now().getTime() / 1000);
    return new SignJWT({ sid: claims.sid, scope: claims.scope.join(' ') })
      .setProtectedHeader({ alg: 'EdDSA', kid: this.kid })
      .setIssuer(ISSUER)
      .setSubject(claims.sub)
      .setAudience(claims.aud)
      .setIssuedAt(nowSec)
      .setExpirationTime(nowSec + this.ttlSec)
      .sign(this.privateKey);
  }

  /** Verifies signature, issuer, audience and expiry. Throws on any failure. */
  async verify(token: string, audiences: TokenAudience[]): Promise<AccessClaims> {
    const { payload, protectedHeader } = await jwtVerify(token, this.publicKey, {
      issuer: ISSUER,
      audience: audiences,
      algorithms: ['EdDSA'],
      currentDate: this.clock.now(),
    });
    if (protectedHeader.kid !== this.kid) throw new Error('unknown key id');
    const aud = Array.isArray(payload.aud) ? payload.aud[0] : payload.aud;
    if (!payload.sub || typeof payload.sid !== 'string' || !aud) throw new Error('malformed token');
    return {
      sub: payload.sub,
      aud: aud as TokenAudience,
      sid: payload.sid,
      scope: typeof payload.scope === 'string' && payload.scope ? payload.scope.split(' ') : [],
    };
  }
}

/** 256-bit opaque token, URL-safe. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Tokens are stored only as SHA-256 hashes. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 8-char pairing code without ambiguous characters (no I/O/0/1). */
export function pairingCode(): string {
  const bytes = randomBytes(8);
  return Array.from(bytes, (b) => PAIRING_ALPHABET[b % PAIRING_ALPHABET.length]).join('');
}
