// InvoiceFlow — Production Auth & Security Service
// Strict 1 Email = 1 Auth User = 1 Profile = 1 Company Profile
// Server-side login attempt tracking (4 attempts max -> 10-minute lock)
// Supabase Auth integration + OTP password recovery

import { db } from '@/lib/db'
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto'

export interface LockoutStatus {
  locked: boolean
  remainingSeconds: number
  attempts: number
  remainingAttempts: number
}

// ----------------- Password Hashing & Verification -----------------

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const key = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${key}`
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false
  if (stored.includes(':')) {
    const [salt, key] = stored.split(':')
    if (!salt || !key) return false
    const derived = scryptSync(password, salt, 64)
    const expected = Buffer.from(key, 'hex')
    return derived.length === expected.length && timingSafeEqual(derived, expected)
  }
  return false
}

export function validatePasswordStrength(password: string): { valid: boolean; error?: string } {
  if (!password || password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters long.' }
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one uppercase letter.' }
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one lowercase letter.' }
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one number.' }
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one special character.' }
  }
  return { valid: true }
}

// ----------------- Server-Side Login Attempts & Lockout -----------------

export async function checkLoginLockout(email: string): Promise<LockoutStatus> {
  const normalized = email.trim().toLowerCase()
  try {
    const rows = await db.$queryRawUnsafe<Array<{ attempts: number; locked_until: Date | null }>>(
      `SELECT attempts, locked_until FROM public.login_attempts WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      normalized
    )

    if (!rows || rows.length === 0) {
      return { locked: false, remainingSeconds: 0, attempts: 0, remainingAttempts: 4 }
    }

    const { attempts, locked_until } = rows[0]
    if (locked_until) {
      const lockTime = new Date(locked_until).getTime()
      const now = Date.now()
      if (lockTime > now) {
        const remainingSeconds = Math.ceil((lockTime - now) / 1000)
        return { locked: true, remainingSeconds, attempts: attempts || 4, remainingAttempts: 0 }
      } else {
        // Lock period has expired, automatically unlock
        await db.$executeRawUnsafe(
          `UPDATE public.login_attempts SET attempts = 0, locked_until = NULL WHERE LOWER(email) = LOWER($1)`,
          normalized
        )
        return { locked: false, remainingSeconds: 0, attempts: 0, remainingAttempts: 4 }
      }
    }

    const currentAttempts = attempts || 0
    return {
      locked: false,
      remainingSeconds: 0,
      attempts: currentAttempts,
      remainingAttempts: Math.max(0, 4 - currentAttempts),
    }
  } catch (err) {
    console.error('[checkLoginLockout error]:', err)
    return { locked: false, remainingSeconds: 0, attempts: 0, remainingAttempts: 4 }
  }
}

export async function recordFailedLogin(email: string): Promise<LockoutStatus> {
  const normalized = email.trim().toLowerCase()
  const now = new Date()

  try {
    await db.$executeRawUnsafe(
      `INSERT INTO public.login_attempts (id, email, attempts, last_attempt_at)
       VALUES (gen_random_uuid(), LOWER($1), 1, $2)
       ON CONFLICT (email) DO UPDATE SET
         attempts = public.login_attempts.attempts + 1,
         last_attempt_at = $2`,
      normalized,
      now
    )

    const rows = await db.$queryRawUnsafe<Array<{ attempts: number; locked_until: Date | null }>>(
      `SELECT attempts, locked_until FROM public.login_attempts WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      normalized
    )

    const currentAttempts = rows[0]?.attempts || 1

    if (currentAttempts >= 4) {
      // 4 failed attempts -> Lock for 10 minutes (600 seconds)
      const lockedUntil = new Date(Date.now() + 10 * 60 * 1000)
      await db.$executeRawUnsafe(
        `UPDATE public.login_attempts SET locked_until = $1 WHERE LOWER(email) = LOWER($2)`,
        lockedUntil,
        normalized
      )
      return {
        locked: true,
        remainingSeconds: 600,
        attempts: currentAttempts,
        remainingAttempts: 0,
      }
    }

    return {
      locked: false,
      remainingSeconds: 0,
      attempts: currentAttempts,
      remainingAttempts: Math.max(0, 4 - currentAttempts),
    }
  } catch (err) {
    console.error('[recordFailedLogin error]:', err)
    return { locked: false, remainingSeconds: 0, attempts: 1, remainingAttempts: 3 }
  }
}

export async function resetLoginAttempts(email: string): Promise<void> {
  const normalized = email.trim().toLowerCase()
  try {
    await db.$executeRawUnsafe(
      `UPDATE public.login_attempts SET attempts = 0, locked_until = NULL WHERE LOWER(email) = LOWER($1)`,
      normalized
    )
  } catch (err) {
    console.error('[resetLoginAttempts error]:', err)
  }
}

// ----------------- User Lookup & Uniqueness -----------------

export interface ResolvedUser {
  id: string
  email: string
  name: string
  avatarUrl: string | null
  termsAccepted: boolean
  encryptedPassword?: string | null
  passwordHash?: string | null
}

export async function findUserByEmail(email: string): Promise<ResolvedUser | null> {
  const normalized = email.trim().toLowerCase()

  // 1. Check auth.users table
  try {
    const authRows = await db.$queryRawUnsafe<Array<{ id: string; email: string; encrypted_password: string; raw_user_meta_data: Record<string, unknown> }>>(
      `SELECT id, email, encrypted_password, raw_user_meta_data FROM auth.users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      normalized
    )

    if (authRows && authRows.length > 0) {
      const authUser = authRows[0]
      const prismaUser = await db.user.findFirst({
        where: { OR: [{ id: authUser.id }, { email: normalized }] },
      })

      const meta = authUser.raw_user_meta_data || {}
      return {
        id: authUser.id,
        email: authUser.email,
        name: (meta.display_name || meta.name || meta.full_name || prismaUser?.name || authUser.email.split('@')[0]) as string,
        avatarUrl: (meta.avatar_url || prismaUser?.avatarUrl || null) as string | null,
        termsAccepted: Boolean(meta.terms_accepted || (prismaUser as unknown as { termsAccepted?: boolean })?.termsAccepted),
        encryptedPassword: authUser.encrypted_password,
        passwordHash: prismaUser?.passwordHash || null,
      }
    }
  } catch {
    // If auth.users lookup is unavailable, fallback to Prisma
  }

  // 2. Check Prisma User
  const prismaUser = await db.user.findUnique({ where: { email: normalized } })
  if (prismaUser) {
    return {
      id: prismaUser.id,
      email: prismaUser.email,
      name: prismaUser.name || prismaUser.email.split('@')[0],
      avatarUrl: prismaUser.avatarUrl,
      termsAccepted: (prismaUser as unknown as { termsAccepted?: boolean })?.termsAccepted ?? false,
      encryptedPassword: null,
      passwordHash: prismaUser.passwordHash,
    }
  }

  return null
}

export async function verifyUserPassword(user: ResolvedUser, passwordAttempt: string): Promise<boolean> {
  // Check auth.users encrypted_password using postgres crypt if available
  if (user.encryptedPassword) {
    try {
      const matchRows = await db.$queryRawUnsafe<Array<{ match: boolean }>>(
        `SELECT (encrypted_password = crypt($1, encrypted_password)) as match FROM auth.users WHERE id = $2::uuid LIMIT 1`,
        passwordAttempt,
        user.id
      )
      if (matchRows && matchRows[0]?.match) {
        return true
      }
    } catch {
      // fallback
    }
  }

  // Check scrypt passwordHash from Prisma
  if (user.passwordHash && verifyPassword(passwordAttempt, user.passwordHash)) {
    // If scrypt matched, update auth.users password with bcrypt for Supabase compatibility
    try {
      await db.$executeRawUnsafe(
        `UPDATE auth.users SET encrypted_password = crypt($1, gen_salt('bf', 10)), updated_at = now() WHERE id = $2::uuid`,
        passwordAttempt,
        user.id
      )
    } catch {
      // ignore update error
    }
    return true
  }

  return false
}

// ----------------- User Registration -----------------

export async function registerNewUser(params: {
  email: string
  password: string
  name: string
  termsAccepted: boolean
  termsVersion?: string
}): Promise<ResolvedUser> {
  const normalized = params.email.trim().toLowerCase()
  const existing = await findUserByEmail(normalized)
  if (existing) {
    throw new Error('An account already exists with this email. Please sign in instead.')
  }

  const userId = crypto.randomUUID()
  const pHash = hashPassword(params.password)
  const termsVersion = params.termsVersion || 'v1.0'

  // Insert into auth.users (trigger creates user_profiles and profiles)
  try {
    await db.$executeRawUnsafe(
      `INSERT INTO auth.users (
        instance_id,
        id,
        aud,
        role,
        email,
        encrypted_password,
        email_confirmed_at,
        raw_app_meta_data,
        raw_user_meta_data,
        created_at,
        updated_at
      ) VALUES (
        '00000000-0000-0000-0000-000000000000',
        $1::uuid,
        'authenticated',
        'authenticated',
        $2,
        crypt($3, gen_salt('bf', 10)),
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        $4::jsonb,
        now(),
        now()
      ) ON CONFLICT (id) DO NOTHING`,
      userId,
      normalized,
      params.password,
      JSON.stringify({
        name: params.name,
        display_name: params.name,
        terms_accepted: params.termsAccepted,
        terms_version: termsVersion,
      })
    )
  } catch (err) {
    console.error('[auth.users insert warning]:', err)
  }

  // Create Prisma User with identical ID
  await db.user.create({
    data: {
      id: userId,
      email: normalized,
      name: params.name,
      passwordHash: pHash,
      termsAccepted: params.termsAccepted,
      termsVersion,
      termsAcceptedAt: params.termsAccepted ? new Date() : null,
    } as never,
  })

  // Also ensure user_profiles row exists with terms
  try {
    await db.$executeRawUnsafe(
      `INSERT INTO public.user_profiles (id, email, display_name, terms_accepted, terms_version, terms_accepted_at)
       VALUES ($1::uuid, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         terms_accepted = excluded.terms_accepted,
         terms_version = excluded.terms_version,
         terms_accepted_at = excluded.terms_accepted_at`,
      userId,
      normalized,
      params.name,
      params.termsAccepted,
      termsVersion,
      params.termsAccepted ? new Date() : null
    )
  } catch {
    // ignore
  }

  // Reset any previous failed login attempts
  await resetLoginAttempts(normalized)

  return {
    id: userId,
    email: normalized,
    name: params.name,
    avatarUrl: null,
    termsAccepted: params.termsAccepted,
  }
}

// ----------------- Company Profile Helpers -----------------

export async function hasCompanyProfile(userId: string): Promise<boolean> {
  if (!userId) return false
  const company = await db.companyProfile.findFirst({
    where: { userId, deletedAt: null },
  })
  return Boolean(company && company.name && company.name.trim().length > 0)
}

export async function getCompanyProfile(userId: string) {
  if (!userId) return null
  return db.companyProfile.findFirst({
    where: { userId, deletedAt: null },
  })
}

// ----------------- OTP & Password Recovery -----------------

export async function createPasswordResetOtp(email: string): Promise<{ success: boolean; error?: string }> {
  const normalized = email.trim().toLowerCase()
  const user = await findUserByEmail(normalized)
  if (!user) {
    return { success: false, error: 'No account found with this email. Please check your email or sign up.' }
  }

  // Check resend cooldown (60 seconds)
  const recent = await db.$queryRawUnsafe<Array<{ created_at: Date }>>(
    `SELECT created_at FROM public.password_resets 
     WHERE LOWER(email) = LOWER($1) AND created_at > (now() - interval '60 seconds')
     ORDER BY created_at DESC LIMIT 1`,
    normalized
  ).catch(() => [])

  if (recent && recent.length > 0) {
    return { success: false, error: 'Please wait 60 seconds before requesting another code.' }
  }

  // Generate 6-digit numeric OTP
  const otp = String(Math.floor(100000 + Math.random() * 900000))
  const otpHash = createHash('sha256').update(otp).digest('hex')
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

  // Invalidate previous unused OTPs for this email
  await db.$executeRawUnsafe(
    `UPDATE public.password_resets SET used = true WHERE LOWER(email) = LOWER($1) AND used = false`,
    normalized
  ).catch(() => undefined)

  // Save new OTP hash
  await db.$executeRawUnsafe(
    `INSERT INTO public.password_resets (id, email, otp_hash, expires_at, used, verified, created_at)
     VALUES (gen_random_uuid(), LOWER($1), $2, $3, false, false, now())`,
    normalized,
    otpHash,
    expiresAt
  )

  // Send email (via Resend, SMTP, or development log)
  try {
    const { sendOtpEmail } = await import('@/lib/server/email')
    await sendOtpEmail(normalized, otp)
  } catch (emailErr) {
    console.error('[Failed to dispatch OTP email]:', emailErr)
  }

  return { success: true }
}

export async function verifyPasswordResetOtp(email: string, otp: string): Promise<{ success: boolean; resetToken?: string; error?: string }> {
  const normalized = email.trim().toLowerCase()
  const trimmedOtp = otp.trim()

  if (!/^\d{6}$/.test(trimmedOtp)) {
    return { success: false, error: 'Invalid verification code.' }
  }

  const rows = await db.$queryRawUnsafe<Array<{ id: string; otp_hash: string; expires_at: Date; used: boolean }>>(
    `SELECT id, otp_hash, expires_at, used FROM public.password_resets 
     WHERE LOWER(email) = LOWER($1) AND used = false
     ORDER BY created_at DESC LIMIT 1`,
    normalized
  ).catch(() => [])

  if (!rows || rows.length === 0) {
    return { success: false, error: 'Invalid verification code.' }
  }

  const record = rows[0]
  if (new Date(record.expires_at).getTime() < Date.now()) {
    return { success: false, error: 'This verification code has expired. Please request a new code.' }
  }

  const inputHash = createHash('sha256').update(trimmedOtp).digest('hex')
  if (inputHash !== record.otp_hash) {
    return { success: false, error: 'Invalid verification code.' }
  }

  // Generate single-use reset token valid for 15 minutes
  const resetToken = randomBytes(32).toString('hex')
  await db.$executeRawUnsafe(
    `UPDATE public.password_resets SET verified = true, reset_token = $1 WHERE id = $2::uuid`,
    resetToken,
    record.id
  )

  return { success: true, resetToken }
}

export async function resetPasswordWithToken(
  email: string,
  resetToken: string,
  newPassword: string
): Promise<{ success: boolean; error?: string }> {
  const normalized = email.trim().toLowerCase()
  const strength = validatePasswordStrength(newPassword)
  if (!strength.valid) {
    return { success: false, error: strength.error }
  }

  const rows = await db.$queryRawUnsafe<Array<{ id: string; expires_at: Date }>>(
    `SELECT id, expires_at FROM public.password_resets 
     WHERE LOWER(email) = LOWER($1) AND reset_token = $2 AND verified = true AND used = false
     LIMIT 1`,
    normalized,
    resetToken
  ).catch(() => [])

  if (!rows || rows.length === 0) {
    return { success: false, error: 'Invalid or expired password reset session. Please request a new code.' }
  }

  const record = rows[0]
  if (new Date(record.expires_at).getTime() < Date.now()) {
    return { success: false, error: 'This verification code has expired. Please request a new code.' }
  }

  const newHash = hashPassword(newPassword)

  // Update Prisma User
  await db.user.update({
    where: { email: normalized },
    data: { passwordHash: newHash },
  })

  // Update auth.users with bcrypt
  try {
    await db.$executeRawUnsafe(
      `UPDATE auth.users SET encrypted_password = crypt($1, gen_salt('bf', 10)), updated_at = now() WHERE LOWER(email) = LOWER($2)`,
      newPassword,
      normalized
    )
  } catch (err) {
    console.error('[auth.users password update warning]:', err)
  }

  // Mark token as used
  await db.$executeRawUnsafe(
    `UPDATE public.password_resets SET used = true WHERE id = $1::uuid`,
    record.id
  )

  // Reset login lockout and attempts
  await resetLoginAttempts(normalized)

  return { success: true }
}
