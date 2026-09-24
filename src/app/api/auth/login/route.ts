import { NextRequest, NextResponse } from 'next/server'
import { db as prisma } from '@/lib/db'
import { loginSchema } from '@/lib/domain/schemas'
import { createSession, hashPassword, rateLimit, clientIp, sessionCookie, verifyPassword } from '@/lib/server/auth'

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req)
    if (!rateLimit(`login:${ip}`)) {
      return NextResponse.json({ error: 'Too many attempts. Try again in a minute.', code: 'rate_limited' }, { status: 429 })
    }
    const body = await req.json().catch(() => null)
    const parsed = loginSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input', code: 'validation' }, { status: 400 })
    }

    const emailLower = parsed.data.email.toLowerCase()
    let user = await prisma.user.findUnique({ where: { email: emailLower } })

    // Special case: Demo account
    if (emailLower === 'demo@company.com') {
      const demoPass = parsed.data.password || 'Demo@12345'
      if (!user) {
        user = await prisma.user.create({
          data: {
            email: emailLower,
            name: 'Demo Business Owner',
            passwordHash: hashPassword(demoPass),
          },
        })
      } else if (!verifyPassword(demoPass, user.passwordHash)) {
        // Reset password hash to standard demo password if mismatch occurs
        user = await prisma.user.update({
          where: { id: user.id },
          data: { passwordHash: hashPassword(demoPass) },
        })
      }

      // Auto-seed Demo Company Profile if user has none
      const existingCompany = await prisma.companyProfile.findFirst({ where: { userId: user.id } })
      if (!existingCompany) {
        // Find or create workspace for demo user
        let ws = await prisma.workspace.findFirst({ where: { ownerUserId: user.id } })
        if (!ws) {
          const wsById = await prisma.workspace.findUnique({ where: { id: 'demo-workspace-001' } })
          if (wsById) {
            ws = await prisma.workspace.update({
              where: { id: 'demo-workspace-001' },
              data: { ownerUserId: user.id },
            })
          } else {
            ws = await prisma.workspace.create({
              data: {
                id: 'demo-workspace-001',
                name: 'ABWcurious (OPC) Pvt. Ltd.',
                ownerUserId: user.id,
              },
            })
          }
        }

        const compById = await prisma.companyProfile.findUnique({ where: { id: 'demo-company-001' } })
        if (compById) {
          await prisma.companyProfile.update({
            where: { id: 'demo-company-001' },
            data: { userId: user.id, workspaceId: ws.id },
          })
        } else {
          await prisma.companyProfile.create({
            data: {
              id: 'demo-company-001',
              workspaceId: ws.id,
              userId: user.id,
              name: 'ABWcurious (OPC) Pvt. Ltd.',
              businessType: 'Private Limited (OPC)',
              gstin: '27AAACA0000A1Z5',
              pan: 'AAACA0000A',
              email: 'demo@company.com',
              phone: '+91 98765 43210',
              website: 'https://invoiceflow.app',
              addressLine1: 'Plot 42, Tech Park Enclave',
              addressLine2: 'Phase 2, Silicon Zone',
              city: 'Mumbai',
              stateName: 'Maharashtra',
              stateCode: '27',
              pincode: '400001',
              bankName: 'HDFC Bank Ltd.',
              bankAccount: '50200012345678',
              bankIfsc: 'HDFC0001234',
              bankBranch: 'Nariman Point, Mumbai',
              upiVpa: 'abwcurious@hdfcbank',
              authorizedSignatory: 'Shubham Sharma',
              invoicePrefix: 'INV',
              quotationPrefix: 'QT',
            },
          })
        }
      }
    } else {
      // Normal registration lookup: User MUST exist
      if (!user) {
        return NextResponse.json({ error: 'No account found with this email. Please Sign Up first.', code: 'invalid_credentials' }, { status: 401 })
      }
      if (!verifyPassword(parsed.data.password, user.passwordHash)) {
        return NextResponse.json({ error: 'Invalid password. Please try again.', code: 'invalid_credentials' }, { status: 401 })
      }
    }

    const session = await createSession(user.id)
    const u = user as { id: string; email: string; name: string | null; avatarUrl?: string | null }
    const res = NextResponse.json({ user: { id: u.id, email: u.email, name: u.name, avatarUrl: u.avatarUrl ?? null } })
    res.headers.set('Set-Cookie', sessionCookie(session.token, session.expiresAt))
    return res
  } catch (err) {
    console.error('[Login API Error]:', err)
    return NextResponse.json({ error: (err as Error).message || 'An unexpected error occurred during login.', code: 'server_error' }, { status: 500 })
  }
}
