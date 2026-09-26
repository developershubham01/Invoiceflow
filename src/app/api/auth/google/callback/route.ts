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
      return NextResponse.redirect(`${baseUrl}/login?error=google_oauth_failed`)
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
    const targetRoute = companyExists ? '/dashboard' : '/company-profile'

    // 5. Create Session & Set Cookie
    const session = await createSession(userId!)

    const ticket = url.searchParams.get('state')
    if (ticket) {
      await prisma.desktopAuthTicket.updateMany({
        where: { ticket, expiresAt: { gt: new Date() } },
        data: {
          claimed: true,
          token: session.token,
          userId: userId!,
        },
      }).catch((e) => console.warn('[Google OAuth] Could not update desktop ticket:', e))

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Signed In — InvoiceFlow</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f8fafc;
      color: #0f172a;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 16px;
    }
    .card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      padding: 32px 24px;
      max-width: 420px;
      width: 100%;
      text-align: center;
      box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
    }
    .icon {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: #ecfdf5;
      color: #059669;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 28px;
      margin: 0 auto 16px;
    }
    h1 { font-size: 20px; font-weight: 700; margin: 0 0 8px; }
    p { font-size: 14px; color: #64748b; margin: 0 0 24px; line-height: 1.5; }
    .btn {
      display: inline-block;
      background: #059669;
      color: #ffffff;
      text-decoration: none;
      padding: 10px 20px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      transition: background 0.2s;
    }
    .btn:hover { background: #047857; }
    .note { margin-top: 16px; font-size: 12px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✓</div>
    <h1>Signed in successfully!</h1>
    <p>You have signed in to InvoiceFlow. You may now close this browser tab and return to the InvoiceFlow desktop app.</p>
    <a href="invoiceflow://auth/callback?token=${session.token}" class="btn">Open InvoiceFlow App</a>
    <p class="note">If the app did not open automatically, click the button above.</p>
  </div>
  <script>
    try {
      window.location.href = "invoiceflow://auth/callback?token=${session.token}";
    } catch (e) {}
    setTimeout(function() {
      try { window.close(); } catch(e) {}
    }, 2000);
  </script>
</body>
</html>`

      const res = new NextResponse(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Set-Cookie': sessionCookie(session.token, session.expiresAt),
        },
      })
      return res
    }

    const res = NextResponse.redirect(`${baseUrl}${targetRoute}`)
    res.headers.set('Set-Cookie', sessionCookie(session.token, session.expiresAt))
    return res
  } catch (err) {
    console.error('[Google Callback Error]:', err instanceof Error ? err.message : err)
    return NextResponse.redirect(`${baseUrl}/login?error=google_auth_error`)
  }
}
