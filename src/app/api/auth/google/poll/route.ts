import { NextRequest, NextResponse } from 'next/server'
import { db as prisma } from '@/lib/db'
import { hasCompanyProfile } from '@/lib/server/auth-service'
import { sessionCookie } from '@/lib/server/auth'

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const ticket = url.searchParams.get('ticket')

    if (!ticket) {
      return NextResponse.json({ error: 'Ticket parameter required' }, { status: 400 })
    }

    const record = await prisma.desktopAuthTicket.findUnique({
      where: { ticket },
    })

    if (!record) {
      return NextResponse.json({ error: 'Invalid or expired ticket' }, { status: 404 })
    }

    if (new Date() > record.expiresAt) {
      await prisma.desktopAuthTicket.delete({ where: { id: record.id } }).catch(() => undefined)
      return NextResponse.json({ error: 'Ticket expired' }, { status: 410 })
    }

    if (!record.claimed || !record.token || !record.userId) {
      // Still waiting for user to complete sign-in in their browser
      return NextResponse.json({ claimed: false })
    }

    // Ticket is claimed! Fetch user details
    const user = await prisma.user.findUnique({
      where: { id: record.userId },
      select: { id: true, email: true, name: true, avatarUrl: true },
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const companyExists = await hasCompanyProfile(user.id)

    // Delete ticket now that it is consumed
    await prisma.desktopAuthTicket.delete({ where: { id: record.id } }).catch(() => undefined)

    // Return claimed data and set the session cookie
    const res = NextResponse.json({
      claimed: true,
      token: record.token,
      user,
      hasCompanyProfile: companyExists,
    })

    // 30 days session expiry
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    res.headers.set('Set-Cookie', sessionCookie(record.token, expiresAt))

    return res
  } catch (error) {
    console.error('[DesktopAuthPoll] Error polling ticket:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
