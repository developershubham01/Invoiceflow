import { NextResponse } from 'next/server'
import { db as prisma } from '@/lib/db'
import { randomBytes } from 'node:crypto'

export async function POST() {
  try {
    const ticket = randomBytes(24).toString('hex')
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000) // 5 minutes validity

    // Clean up expired tickets occasionally
    await prisma.desktopAuthTicket.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    }).catch(() => undefined)

    await prisma.desktopAuthTicket.create({
      data: {
        ticket,
        expiresAt,
      },
    })

    return NextResponse.json({ ticket })
  } catch (error) {
    console.error('[DesktopAuthTicket] Error creating ticket:', error)
    return NextResponse.json({ error: 'Failed to create auth ticket' }, { status: 500 })
  }
}
