import { NextRequest, NextResponse } from 'next/server'
import { db as prisma } from '@/lib/db'
import { findUserByEmail, hasCompanyProfile } from '@/lib/server/auth-service'
import { createSession, hashPassword, rateLimit, clientIp, sessionCookie } from '@/lib/server/auth'

export async function POST(req: NextRequest) {
  const ip = clientIp(req)
  if (!rateLimit(`google-auth:${ip}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many attempts. Try again in a minute.', code: 'rate_limited' }, { status: 429 })
  }

  const body = await req.json().catch(() => ({}))
  const emailInput = body.email ? String(body.email).trim().toLowerCase() : ''
  const nameInput = body.name ? String(body.name).trim() : ''

  const targetEmail = emailInput || body.googleUser?.email || ''
  const targetName = nameInput || body.googleUser?.name || ''

  if (!targetEmail || !targetEmail.includes('@')) {
    return NextResponse.json({ error: 'Invalid Google account email', code: 'invalid_email' }, { status: 400 })
  }

  // 1. Account linking: Find existing user or create a new user account for Google Sign-In
  const user = await findUserByEmail(targetEmail)
  let userId = user?.id

  if (!user) {
    userId = crypto.randomUUID()
    const randomPassword = crypto.randomUUID() + crypto.randomUUID()

    try {
      await prisma.$executeRawUnsafe(
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
          '{"provider":"google","providers":["google"]}'::jsonb,
          $4::jsonb,
          now(),
          now()
        ) ON CONFLICT (id) DO NOTHING`,
        userId,
        targetEmail,
        randomPassword,
        JSON.stringify({
          name: targetName || targetEmail.split('@')[0],
          display_name: targetName || targetEmail.split('@')[0],
          terms_accepted: true,
          terms_version: 'v1.0',
        })
      )
    } catch {
      // ignore
    }

    await prisma.user.create({
      data: {
        id: userId,
        email: targetEmail,
        name: targetName || targetEmail.split('@')[0],
        passwordHash: hashPassword(randomPassword),
        termsAccepted: true,
        termsVersion: 'v1.0',
        termsAcceptedAt: new Date(),
      } as never,
    })
  } else {
    userId = user.id
  }

  // 2. Check if company profile exists
  const hasCompany = await hasCompanyProfile(userId!)

  // 3. Create Session & Set Cookie
  const session = await createSession(userId!)
  const res = NextResponse.json({
    user: {
      id: userId,
      email: targetEmail,
      name: targetName || user?.name || targetEmail.split('@')[0],
      avatarUrl: user?.avatarUrl ?? null,
    },
    hasCompanyProfile: hasCompany,
  })
  res.headers.set('Set-Cookie', sessionCookie(session.token, session.expiresAt))
  return res
}
