import { z } from 'zod';
import { Id, TimeZone, Timestamp } from './common.js';
import { DeviceScope, DeviceType } from './enums.js';

export const Email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ message: 'Enter a valid email address' }));

/** Minimum length 10 (ROADMAP 1.1); max bounds argon2 work and request size. */
export const Password = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters');

export const DisplayName = z.string().trim().min(1).max(60);

export const RegisterRequest = z.object({
  email: Email,
  password: Password,
  displayName: DisplayName,
  timezone: TimeZone.default('UTC'),
});
export type RegisterRequest = z.infer<typeof RegisterRequest>;

export const LoginRequest = z.object({
  email: Email,
  password: z.string().min(1).max(128),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const TokenRequest = z.object({ token: z.string().min(16).max(256) });

export const ForgotPasswordRequest = z.object({ email: Email });

export const ResetPasswordRequest = z.object({
  token: z.string().min(16).max(256),
  password: Password,
});

export const ChangePasswordRequest = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: Password,
});

export const DeleteAccountRequest = z.object({
  password: z.string().min(1).max(128),
  confirm: z.literal(true),
});

export const User = z.object({
  id: Id,
  email: z.string(),
  displayName: z.string(),
  timezone: z.string(),
  emailVerified: z.boolean(),
  createdAt: Timestamp,
});
export type User = z.infer<typeof User>;

export const UpdateProfileRequest = z
  .object({ displayName: DisplayName, timezone: TimeZone })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export const AuthResponse = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int(),
  user: User,
});
export type AuthResponse = z.infer<typeof AuthResponse>;

export const UserSettings = z.object({
  trackingEnabled: z.boolean(),
  titleCollectionEnabled: z.boolean(),
  widgetEnabled: z.boolean(),
  blockDuringBreaks: z.boolean(),
  activityRetentionDays: z.number().int().min(7).max(365),
});
export type UserSettings = z.infer<typeof UserSettings>;

export const UpdateSettingsRequest = UserSettings.partial().refine(
  (v) => Object.keys(v).length > 0,
  { message: 'Nothing to update' },
);

// --- Devices (pairing) ---

export const PairingCodeResponse = z.object({
  code: z.string(),
  expiresAt: Timestamp,
});

export const PairRequest = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .transform((c) => c.replace(/[\s-]/g, ''))
    .pipe(z.string().length(8)),
  type: DeviceType,
  name: z.string().trim().min(1).max(80),
  version: z.string().max(32).optional(),
});
export type PairRequest = z.infer<typeof PairRequest>;

export const DeviceTokens = z.object({
  deviceId: Id,
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int(),
});
export type DeviceTokens = z.infer<typeof DeviceTokens>;

export const DeviceRefreshRequest = z.object({ refreshToken: z.string().min(16).max(256) });

export const Device = z.object({
  id: Id,
  type: DeviceType,
  name: z.string(),
  version: z.string().nullable(),
  scopes: z.array(DeviceScope),
  lastSeenAt: Timestamp.nullable(),
  createdAt: Timestamp,
  revokedAt: Timestamp.nullable(),
});
export type Device = z.infer<typeof Device>;
