import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const clientId =
    process.env.GOOGLE_CLIENT_ID ||
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ||
    ''

  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000'
  const protocol = req.headers.get('x-forwarded-proto') || (host.includes('localhost') ? 'http' : 'https')
  const redirectUri = `${protocol}://${host}/api/auth/google/callback`

  const googleOAuthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  googleOAuthUrl.searchParams.set('client_id', clientId)
  googleOAuthUrl.searchParams.set('redirect_uri', redirectUri)
  googleOAuthUrl.searchParams.set('response_type', 'code')
  googleOAuthUrl.searchParams.set('scope', 'openid email profile')
  googleOAuthUrl.searchParams.set('prompt', 'select_account')

  return NextResponse.redirect(googleOAuthUrl.toString())
}
