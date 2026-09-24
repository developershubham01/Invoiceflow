import { NextRequest, NextResponse } from 'next/server'
import { db as prisma } from '@/lib/db'
import { createSession, sessionCookie } from '@/lib/server/auth'
import crypto from 'node:crypto'

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

        // 1. Exchange code for Google Access Token
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
          email = userData.email ? String(userData.email).toLowerCase() : ''
          name = userData.name ? String(userData.name) : ''
          avatarUrl = userData.picture ? String(userData.picture) : ''
        } else {
          console.error('[Google OAuth Token Failure Response]', { status: tokenRes.status, tokenData })
        }
      } catch (err) {
        console.error('[Google OAuth Token Error]', err)
      }
    }

    // Require valid email from Google OAuth exchange
    if (!email || !email.includes('@')) {
      console.warn('[Google OAuth] No valid email returned from Google token exchange. Redirecting to login.')
      return NextResponse.redirect(`${baseUrl}/#/login?error=google_oauth_failed`)
    }

    // 3. Find or Create User in DB
    let user = await prisma.user.findUnique({ where: { email } })
    if (!user) {
      const randomPass = crypto.randomBytes(32).toString('hex')
      const passwordHash = crypto.scryptSync(randomPass, 'google-oauth-salt', 64).toString('hex')

      user = await prisma.user.create({
        data: {
          email,
          name: name || email.split('@')[0],
          avatarUrl: avatarUrl || null,
          passwordHash,
        } as never,
      })
    } else {
      const existingAvatar = (user as { avatarUrl?: string | null }).avatarUrl
      if ((name && user.name !== name) || (avatarUrl && existingAvatar !== avatarUrl)) {
        // Update existing user with latest Google profile info if updated
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            name: name || user.name,
            avatarUrl: avatarUrl || existingAvatar,
          } as never,
        })
      }
    }

    // 4. Check if user has an existing company profile
    const existingCompany = await prisma.companyProfile.findFirst({ where: { userId: user.id } })
    const targetRoute = (existingCompany && existingCompany.name) ? '/#/dashboard' : '/#/company-profile'

    // 5. Create Session and Set Cookie
    const session = await createSession(user.id)
    const res = NextResponse.redirect(`${baseUrl}${targetRoute}`)
    res.headers.set('Set-Cookie', sessionCookie(session.token, session.expiresAt))
    return res
  } catch (err) {
    console.error('[Google Callback Fatal Error]', err)
    return NextResponse.redirect(`${baseUrl}/#/login`)
  }
}
