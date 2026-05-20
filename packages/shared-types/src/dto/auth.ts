import type { UserRole, UserStatus } from '../enums';

export interface RegisterRequest {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role?: Extract<UserRole, 'BUYER' | 'SELLER'>;
  /** Phase 25: optional referral code captured from `?ref=` at signup. */
  referralCode?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  status: UserStatus;
  sellerId?: string | null;
  sellerStatus?: string | null;
  /** Phase 26: GDPR deletion grace state. Null when no deletion is in flight. */
  deletionStatus?: 'REQUESTED' | 'CANCELLED' | 'COMPLETED' | null;
  deletionScheduledFor?: string | null;
  /** Phase 31: TOTP-based two-factor auth is enabled on this account. */
  twoFactorEnabled?: boolean;
}

export interface AuthResponse {
  accessToken: string;
  expiresIn: number;
  user: AuthUser;
  /**
   * Mobile / non-browser clients receive the refresh token in the body when they
   * pass `X-Client: mobile` or `X-Refresh-In-Body: 1`. Browser clients never see
   * this field — the refresh token lives in an HttpOnly cookie.
   */
  refreshToken?: string;
  /** Phase 31: when 2FA verification used a recovery code instead of the OTP. */
  usedRecoveryCode?: boolean;
}

/**
 * Phase 31: a login attempt against a 2FA-enabled account returns this shape
 * instead of {@link AuthResponse}. Client must call /auth/2fa/verify with the
 * challenge token + user-supplied code to receive real tokens.
 */
export interface MfaChallengeResponse {
  mfaRequired: true;
  challenge: string;
}

export type LoginResponse = AuthResponse | MfaChallengeResponse;

export interface TwoFactorStatus {
  enabled: boolean;
  enrollmentStatus: 'PENDING' | 'ACTIVE' | null;
  activatedAt: string | null;
  lastUsedAt: string | null;
  recoveryCodesRemaining: number;
}

export interface TwoFactorEnrollStart {
  otpauthUrl: string;
  secretBase32: string;
}

export interface TwoFactorRecoveryCodes {
  recoveryCodes: string[];
}
