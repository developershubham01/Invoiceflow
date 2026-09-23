import { NextRequest, NextResponse } from 'next/server'
import { db as prisma } from '@/lib/db'
import { loginSchema } from '@/lib/domain/schemas'
import { createSession, hashPassword, rateLimit, clientIp, sessionCookie, verifyPassword } from '@/lib/server/auth'

export async function POST(req: NextRequest) {
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
    if (!user) {
      user = await prisma.user.create({
        data: {
          email: emailLower,
          name: 'Demo Business Owner',
          passwordHash: hashPassword(parsed.data.password || 'Demo@12345'),
        },
      })
    } else if (!verifyPassword(parsed.data.password, user.passwordHash)) {
      return NextResponse.json({ error: 'Invalid password for demo account. Password is Demo@12345', code: 'invalid_credentials' }, { status: 401 })
    }

    // Auto-seed Demo Company Profile if user has none
    const existingCompany = await prisma.companyProfile.findFirst({ where: { userId: user.id } })
    if (!existingCompany) {
      // Find or create workspace for demo user
      let ws = await prisma.workspace.findFirst({ where: { ownerUserId: user.id } })
      if (!ws) {
        ws = await prisma.workspace.create({
          data: {
            id: 'demo-workspace-001',
            name: 'ABWcurious (OPC) Pvt. Ltd.',
            ownerUserId: user.id,
          }
        })
      }
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
        }
      })
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
  const res = NextResponse.json({ user: { id: user.id, email: user.email, name: user.name } })
  res.headers.set('Set-Cookie', sessionCookie(session.token, session.expiresAt))
  return res
}
