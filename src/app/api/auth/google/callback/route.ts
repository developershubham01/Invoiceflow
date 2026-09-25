import { NextRequest, NextResponse } from 'next/server'
import { db as prisma } from '@/lib/db'
import { findUserByEmail, hasCompanyProfile } from '@/lib/server/auth-service'
import { createSession, hashPassword, sessionCookie } from '@/lib/server/auth'

export async function GET(req: NextRequest) {
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000'
  const protocol = req.headers.get('x-forwarded-proto') || (host.includes('localhost') ? 'http' : 'https')
  const baseUrl = `${protocol}://${host}`
  const redirectUri = `${baseUrl}/api/auth/google/callback`

  try {
    const url = new URL(req.url)
    const code = url.searchParams.get('code')

    let email = ''
    let name = ''
    let avatarUrl = ''

    if (code) {
      try {
        const clientId =
          process.env.GOOGLE_CLIENT_ID ||
          process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ||
          ''
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET || ''

        // 1. Exchange authorization code for Google Access Token
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
          }),
        })

        const tokenData = await tokenRes.json()

        if (tokenData.access_token) {
          // 2. Fetch User Profile from Google API
          const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` },
          })
          const userData = await userRes.json()
          email = userData.email ? String(userData.email).toLowerCase().trim() : ''
          name = userData.name ? String(userData.name).trim() : ''
          avatarUrl = userData.picture ? String(userData.picture) : ''
        } else {
          console.error('[Google OAuth] Token exchange failed:', tokenRes.status, tokenData)
        }
      } catch (err) {
        console.error('[Google OAuth] Token exchange error:', err instanceof Error ? err.message : err)
      }
    }

    // Require valid email from Google OAuth exchange
    if (!email || !email.includes('@')) {
      return NextResponse.redirect(`${baseUrl}/#/login?error=google_oauth_failed`)
    }

    // 3. Resolve existing account or create new user (Account Linking & Uniqueness)
    let user = await findUserByEmail(email)
    let userId = user?.id

    if (!user) {
      // New Google User: Create exactly ONE Supabase Auth user & Prisma user with same ID
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
          email,
          randomPassword,
          JSON.stringify({
            name: name || email.split('@')[0],
            display_name: name || email.split('@')[0],
            avatar_url: avatarUrl || null,
            terms_accepted: true,
            terms_version: 'v1.0',
          })
        )
      } catch (authErr) {
        console.warn('[Google auth.users insert warning]:', authErr)
      }

      await prisma.user.create({
        data: {
          id: userId,
          email,
          name: name || email.split('@')[0],
          avatarUrl: avatarUrl || null,
          passwordHash: hashPassword(randomPassword),
          termsAccepted: true,
          termsVersion: 'v1.0',
          termsAcceptedAt: new Date(),
        } as never,
      })
    } else {
      // Existing User: Resolve the same user ID (DO NOT create duplicate user or duplicate profile)
      userId = user.id
      if ((name && user.name !== name) || (avatarUrl && user.avatarUrl !== avatarUrl)) {
        await prisma.user.update({
          where: { id: userId },
          data: {
            name: name || user.name,
            avatarUrl: avatarUrl || user.avatarUrl,
          } as never,
        }).catch(() => undefined)
      }
    }

    // 4. Check if user already has a company profile
    // DO NOT create a company profile here!
    const companyExists = await hasCompanyProfile(userId!)
    const targetRoute = companyExists ? '/#/dashboard' : '/#/company-profile'

    // 5. Create Session & Set Cookie
    const session = await createSession(userId!)
    const res = NextResponse.redirect(`${baseUrl}${targetRoute}`)
    res.headers.set('Set-Cookie', sessionCookie(session.token, session.expiresAt))
    return res
  } catch (err) {
    console.error('[Google Callback Error]:', err instanceof Error ? err.message : err)
    return NextResponse.redirect(`${baseUrl}/#/login?error=google_auth_error`)
  }
}
