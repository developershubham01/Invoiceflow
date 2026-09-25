'use client'

import { useState, useEffect, useRef } from 'react'
import { APP_VERSION } from '@/lib/version'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { navigate } from '@/lib/router'
import { useAppStore } from '@/lib/stores/app-store'
import {
  apiLogin,
  apiRegister,
  apiForgotPassword,
  apiVerifyOtp,
  apiResetPassword,
} from '@/lib/sync/client'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Cloud,
  Eye,
  EyeOff,
  KeyRound,
  Landmark,
  Loader2,
  Lock,
  Mail,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  User,
  WifiOff,
} from 'lucide-react'
import { toast } from 'sonner'

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="24" height="24" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
        fill="#EA4335"
      />
    </svg>
  )
}

interface AuthViewProps {
  initialMode?: 'login' | 'register'
}

type AuthMode = 'login' | 'register' | 'forgot-password'
type ForgotStep = 'email' | 'otp' | 'new-password' | 'success'

export function AuthView({ initialMode = 'login' }: AuthViewProps) {
  const store = useAppStore()
  const [authMode, setAuthMode] = useState<AuthMode>(initialMode)
  const [googleBusy, setGoogleBusy] = useState(false)
  const [busy, setBusy] = useState(false)

  // Form fields
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(true)
  const [termsAccepted, setTermsAccepted] = useState(false)

  // Forgot password state
  const [forgotStep, setForgotStep] = useState<ForgotStep>('email')
  const [otpCode, setOtpCode] = useState('')
  const [resetToken, setResetToken] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)

  // Lockout countdown state (server-side enforced 10-minute lock)
  const [lockoutSeconds, setLockoutSeconds] = useState(0)
  const [lockoutMessage, setLockoutMessage] = useState<string | null>(null)

  // Modals for Terms & Privacy
  const [termsModalOpen, setTermsModalOpen] = useState(false)
  const [privacyModalOpen, setPrivacyModalOpen] = useState(false)

  // Error and note messages
  const [errorMsg, setErrorMsg] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    const rawSearch =
      window.location.search ||
      (window.location.hash.includes('?')
        ? window.location.hash.substring(window.location.hash.indexOf('?'))
        : '')
    if (!rawSearch) return null
    const params = new URLSearchParams(rawSearch)
    const err = params.get('error')
    if (err === 'google_oauth_failed') {
      return 'Google Sign-In was cancelled or failed. Please try again or sign in with your email and password.'
    } else if (err === 'google_auth_error') {
      return 'An unexpected error occurred during Google Sign-In. Please sign in with email.'
    } else if (err) {
      return `Authentication note: ${err}`
    }
    return null
  })

  // Lockout countdown timer
  useEffect(() => {
    if (lockoutSeconds <= 0) {
      setLockoutMessage(null)
      return
    }
    const timer = setInterval(() => {
      setLockoutSeconds((prev) => {
        if (prev <= 1) {
          setLockoutMessage(null)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [lockoutSeconds])

  // Resend OTP cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return
    const timer = setInterval(() => {
      setResendCooldown((prev) => (prev <= 1 ? 0 : prev - 1))
    }, 1000)
    return () => clearInterval(timer)
  }, [resendCooldown])

  const formatCountdown = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60)
    const secs = totalSeconds % 60
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }

  const handleGoogleClick = () => {
    setGoogleBusy(true)
    if (typeof window !== 'undefined') {
      window.location.assign('/api/auth/google/login')
    }
  }

  // Handle post-authentication redirection based on server profile status
  const handleAuthSuccess = async (user: { id: string; email: string; name: string | null; avatarUrl?: string | null }, hasCompanyProfile?: boolean) => {
    store.setUser(user)

    if (hasCompanyProfile) {
      toast.success(`Welcome back, ${user.name || user.email}!`)
      navigate('dashboard')
    } else {
      // Check local DB just in case synced previously
      const { getCompanyByUserId } = await import('@/lib/db/repositories')
      const localCompany = await getCompanyByUserId(user.id).catch(() => null)
      if (localCompany && localCompany.name) {
        navigate('dashboard')
      } else {
        toast.info('Please set up your company profile to get started.')
        navigate('company-profile')
      }
    }
  }

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)

    if (lockoutSeconds > 0) {
      setErrorMsg(`Too many failed login attempts. Please try again after ${formatCountdown(lockoutSeconds)}.`)
      return
    }

    if (!email.trim() || !password.trim()) {
      setErrorMsg('Please enter both email and password.')
      return
    }

    if (authMode === 'register') {
      if (!name.trim()) {
        setErrorMsg('Please enter your full name.')
        return
      }
      if (!termsAccepted) {
        setErrorMsg('Please accept the Terms & Conditions and Privacy Policy to continue.')
        return
      }
    }

    setBusy(true)
    try {
      if (authMode === 'register') {
        const res = await apiRegister(name.trim(), email.trim(), password, termsAccepted, 'v1.0')
        await handleAuthSuccess(res.user, res.hasCompanyProfile)
      } else {
        const res = await apiLogin(email.trim(), password)
        await handleAuthSuccess(res.user, res.hasCompanyProfile)
      }
    } catch (err: unknown) {
      const errorObj = err as Error & { status?: number; code?: string; remainingSeconds?: number }
      
      if (errorObj.status === 423 || errorObj.code === 'account_locked') {
        const secs = errorObj.remainingSeconds || 600
        setLockoutSeconds(secs)
        setLockoutMessage('Too many failed login attempts. Please try again after 10 minutes.')
        setErrorMsg(`Too many failed login attempts. Please try again after ${formatCountdown(secs)}.`)
      } else {
        setErrorMsg(errorObj.message || 'Authentication failed. Please check your credentials.')
      }
    } finally {
      setBusy(false)
    }
  }

  // ---------------- Forgot Password Handlers ----------------

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    if (!email.trim() || !email.includes('@')) {
      setErrorMsg('Please enter a valid email address.')
      return
    }

    setBusy(true)
    try {
      await apiForgotPassword(email.trim())
      setForgotStep('otp')
      setResendCooldown(60)
      toast.success('Verification code sent!', { description: 'Please check your email for the 6-digit code.' })
    } catch (err) {
      setErrorMsg((err as Error).message || 'Failed to send verification code.')
    } finally {
      setBusy(false)
    }
  }

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    if (!otpCode || otpCode.length !== 6) {
      setErrorMsg('Please enter the complete 6-digit verification code.')
      return
    }

    setBusy(true)
    try {
      const res = await apiVerifyOtp(email.trim(), otpCode.trim())
      setResetToken(res.resetToken)
      setForgotStep('new-password')
      toast.success('Code verified successfully!')
    } catch (err) {
      setErrorMsg((err as Error).message || 'Invalid verification code.')
    } finally {
      setBusy(false)
    }
  }

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)

    if (newPassword !== confirmPassword) {
      setErrorMsg('Passwords do not match.')
      return
    }

    if (newPassword.length < 8) {
      setErrorMsg('Password must be at least 8 characters long.')
      return
    }

    setBusy(true)
    try {
      await apiResetPassword(email.trim(), resetToken, newPassword, confirmPassword)
      setForgotStep('success')
      toast.success('Password reset successfully!')
      setTimeout(() => {
        setAuthMode('login')
        setForgotStep('email')
        setPassword('')
        setErrorMsg(null)
      }, 2500)
    } catch (err) {
      setErrorMsg((err as Error).message || 'Password reset failed.')
    } finally {
      setBusy(false)
    }
  }

  // Password strength checklist helpers
  const passHasLength = password.length >= 8
  const passHasUpper = /[A-Z]/.test(password)
  const passHasLower = /[a-z]/.test(password)
  const passHasNumber = /[0-9]/.test(password)
  const passHasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(password)

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-emerald-50/60 to-background dark:from-emerald-950/20">
      <div className="mx-auto grid w-full max-w-4xl flex-1 items-center gap-10 px-4 py-10 lg:grid-cols-2">
        {/* Pitch Panel */}
        <div className="hidden lg:block">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow">
              <Landmark className="h-5 w-5" aria-hidden="true" />
            </div>
            <span className="text-lg font-bold">InvoiceFlow</span>
          </div>
          <h2 className="mt-6 text-3xl font-bold tracking-tight">
            Your invoices,<br />everywhere — even offline.
          </h2>
          <ul className="mt-6 space-y-3.5 text-sm text-muted-foreground">
            <li className="flex items-start gap-2.5">
              <WifiOff className="mt-0.5 h-4 w-4 text-emerald-600 shrink-0" aria-hidden="true" />
              <span>Create invoices & quotations without internet — data is stored locally first.</span>
            </li>
            <li className="flex items-start gap-2.5">
              <Cloud className="mt-0.5 h-4 w-4 text-emerald-600 shrink-0" aria-hidden="true" />
              <span>Sign in with Email or Google to link your device and back up your workspace securely.</span>
            </li>
            <li className="flex items-start gap-2.5">
              <ShieldCheck className="mt-0.5 h-4 w-4 text-emerald-600 shrink-0" aria-hidden="true" />
              <span>GST-compliant calculations, 1:1 company identity, and bank-grade security.</span>
            </li>
          </ul>
        </div>

        {/* Auth Form Card */}
        <Card className="py-0 shadow-lg border-emerald-500/10">
          <CardContent className="p-6 sm:p-8">
            {/* Header Titles */}
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                {authMode === 'login' && 'Sign In to InvoiceFlow'}
                {authMode === 'register' && 'Create your Account'}
                {authMode === 'forgot-password' && 'Reset your Password'}
              </h1>
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                {authMode === 'login' && 'Enter your email and password or continue with Google.'}
                {authMode === 'register' && 'Strict 1-account-per-email policy. Create your profile to start.'}
                {authMode === 'forgot-password' && 'Recover your account using a secure 6-digit verification code.'}
              </p>
            </div>

            {/* Lockout Warning Banner */}
            {lockoutSeconds > 0 && (
              <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-xs text-red-600 dark:text-red-400">
                <div className="flex items-center gap-2 font-semibold">
                  <ShieldAlert className="h-4 w-4" />
                  <span>Account Locked (4 Failed Attempts)</span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed">
                  Too many failed login attempts. To protect your account, login is temporarily locked for 10 minutes.
                </p>
                <div className="mt-2.5 flex items-center gap-2 font-mono text-sm font-bold bg-background/80 dark:bg-slate-900/80 px-3 py-1.5 rounded border border-red-500/20 w-fit">
                  <Clock className="h-4 w-4 text-red-500 animate-pulse" />
                  <span>Try again in {formatCountdown(lockoutSeconds)}</span>
                </div>
              </div>
            )}

            {/* General Error Banner */}
            {errorMsg && lockoutSeconds === 0 && (
              <div className="mt-4 rounded-md bg-destructive/10 border border-destructive/20 p-3 text-xs text-destructive font-medium flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span className="leading-tight">{errorMsg}</span>
              </div>
            )}

            {/* ================= MODE: LOGIN / REGISTER ================= */}
            {authMode !== 'forgot-password' && (
              <div className="mt-5 space-y-4">
                {/* Google Sign-In */}
                <Button
                  type="button"
                  variant="outline"
                  className="w-full gap-3 border-slate-300 dark:border-slate-800 bg-background hover:bg-slate-50 dark:hover:bg-slate-900 font-semibold py-5 text-sm shadow-xs transition-all"
                  onClick={handleGoogleClick}
                  disabled={googleBusy || busy || lockoutSeconds > 0}
                >
                  {googleBusy ? (
                    <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                  ) : (
                    <GoogleIcon className="h-5 w-5 shrink-0" />
                  )}
                  <span>Continue with Google</span>
                </Button>

                <div className="relative my-3 flex items-center justify-center">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-muted" />
                  </div>
                  <span className="relative bg-card px-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                    Or with email
                  </span>
                </div>

                {/* Mode Selector Tabs */}
                <div className="flex rounded-lg bg-muted p-1 text-xs">
                  <button
                    type="button"
                    className={`flex-1 rounded-md py-1.5 font-medium transition-colors ${
                      authMode === 'login'
                        ? 'bg-background shadow-xs text-foreground font-semibold'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                    onClick={() => {
                      setAuthMode('login')
                      setErrorMsg(null)
                    }}
                  >
                    Sign In
                  </button>
                  <button
                    type="button"
                    className={`flex-1 rounded-md py-1.5 font-medium transition-colors ${
                      authMode === 'register'
                        ? 'bg-background shadow-xs text-foreground font-semibold'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                    onClick={() => {
                      setAuthMode('register')
                      setErrorMsg(null)
                    }}
                  >
                    Sign Up
                  </button>
                </div>

                {/* Email Form */}
                <form onSubmit={handleEmailAuth} className="space-y-3.5 pt-1">
                  {authMode === 'register' && (
                    <div className="space-y-1">
                      <label className="text-xs font-medium" htmlFor="auth-name">
                        Full Name *
                      </label>
                      <div className="relative">
                        <User className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                        <input
                          id="auth-name"
                          type="text"
                          placeholder="e.g. Rahul Sharma"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          className="w-full rounded-md border bg-background pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                          required
                          disabled={busy || lockoutSeconds > 0}
                        />
                      </div>
                    </div>
                  )}

                  <div className="space-y-1">
                    <label className="text-xs font-medium" htmlFor="auth-email">
                      Email Address *
                    </label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                      <input
                        id="auth-email"
                        type="email"
                        placeholder="name@company.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full rounded-md border bg-background pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                        required
                        disabled={busy || lockoutSeconds > 0}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium" htmlFor="auth-password">
                        Password *
                      </label>
                      {authMode === 'login' && (
                        <button
                          type="button"
                          onClick={() => {
                            setAuthMode('forgot-password')
                            setForgotStep('email')
                            setErrorMsg(null)
                          }}
                          className="text-xs font-medium text-emerald-600 hover:text-emerald-700 hover:underline dark:text-emerald-400"
                        >
                          Forgot Password?
                        </button>
                      )}
                    </div>
                    <div className="relative">
                      <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                      <input
                        id="auth-password"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full rounded-md border bg-background pl-9 pr-10 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40 font-mono"
                        required
                        disabled={busy || lockoutSeconds > 0}
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
                        onClick={() => setShowPassword(!showPassword)}
                        tabIndex={-1}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>

                    {/* Live Password Checklist on Sign Up */}
                    {authMode === 'register' && password.length > 0 && (
                      <div className="mt-2 rounded-md bg-muted/50 p-2.5 text-[11px] space-y-1">
                        <p className="font-semibold text-muted-foreground">Password requirements:</p>
                        <div className="grid grid-cols-2 gap-1 text-muted-foreground">
                          <span className={`flex items-center gap-1.5 ${passHasLength ? 'text-emerald-600 font-medium' : ''}`}>
                            <Check className={`h-3 w-3 ${passHasLength ? 'opacity-100' : 'opacity-30'}`} /> 8+ characters
                          </span>
                          <span className={`flex items-center gap-1.5 ${passHasUpper ? 'text-emerald-600 font-medium' : ''}`}>
                            <Check className={`h-3 w-3 ${passHasUpper ? 'opacity-100' : 'opacity-30'}`} /> 1 uppercase
                          </span>
                          <span className={`flex items-center gap-1.5 ${passHasLower ? 'text-emerald-600 font-medium' : ''}`}>
                            <Check className={`h-3 w-3 ${passHasLower ? 'opacity-100' : 'opacity-30'}`} /> 1 lowercase
                          </span>
                          <span className={`flex items-center gap-1.5 ${passHasNumber ? 'text-emerald-600 font-medium' : ''}`}>
                            <Check className={`h-3 w-3 ${passHasNumber ? 'opacity-100' : 'opacity-30'}`} /> 1 number
                          </span>
                          <span className={`flex items-center gap-1.5 col-span-2 ${passHasSpecial ? 'text-emerald-600 font-medium' : ''}`}>
                            <Check className={`h-3 w-3 ${passHasSpecial ? 'opacity-100' : 'opacity-30'}`} /> 1 special character (!@#$%^&*)
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Remember Me on Login */}
                  {authMode === 'login' && (
                    <div className="flex items-center gap-2 pt-0.5">
                      <Checkbox
                        id="remember-me"
                        checked={rememberMe}
                        onCheckedChange={(c) => setRememberMe(Boolean(c))}
                      />
                      <label htmlFor="remember-me" className="text-xs text-muted-foreground cursor-pointer select-none">
                        Remember this device for 30 days
                      </label>
                    </div>
                  )}

                  {/* Mandatory Terms & Conditions Checkbox on Signup */}
                  {authMode === 'register' && (
                    <div className="flex items-start gap-2 pt-1.5">
                      <Checkbox
                        id="terms-checkbox"
                        checked={termsAccepted}
                        onCheckedChange={(c) => setTermsAccepted(Boolean(c))}
                        className="mt-0.5"
                      />
                      <label htmlFor="terms-checkbox" className="text-xs text-muted-foreground leading-snug cursor-pointer select-none">
                        I agree to the{' '}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault()
                            setTermsModalOpen(true)
                          }}
                          className="font-medium text-emerald-600 hover:text-emerald-700 underline dark:text-emerald-400"
                        >
                          Terms & Conditions
                        </button>{' '}
                        and{' '}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault()
                            setPrivacyModalOpen(true)
                          }}
                          className="font-medium text-emerald-600 hover:text-emerald-700 underline dark:text-emerald-400"
                        >
                          Privacy Policy
                        </button>
                        .
                      </label>
                    </div>
                  )}

                  {/* Primary Submit Button */}
                  <Button
                    type="submit"
                    className="w-full font-semibold bg-primary text-primary-foreground hover:bg-primary/90 mt-2"
                    disabled={busy || googleBusy || lockoutSeconds > 0}
                  >
                    {busy ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : authMode === 'login' ? (
                      'Sign In'
                    ) : (
                      'Create Account'
                    )}
                  </Button>
                </form>

                {/* Footer Switcher */}
                <div className="pt-2 text-center text-xs text-muted-foreground">
                  {authMode === 'login' ? (
                    <p>
                      Don&apos;t have an account?{' '}
                      <button
                        type="button"
                        onClick={() => {
                          setAuthMode('register')
                          setErrorMsg(null)
                        }}
                        className="font-semibold text-emerald-600 hover:underline dark:text-emerald-400"
                      >
                        Sign Up
                      </button>
                    </p>
                  ) : (
                    <p>
                      Already have an account?{' '}
                      <button
                        type="button"
                        onClick={() => {
                          setAuthMode('login')
                          setErrorMsg(null)
                        }}
                        className="font-semibold text-emerald-600 hover:underline dark:text-emerald-400"
                      >
                        Sign In
                      </button>
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* ================= MODE: FORGOT PASSWORD ================= */}
            {authMode === 'forgot-password' && (
              <div className="mt-5 space-y-4">
                {/* Step 1: Request Code */}
                {forgotStep === 'email' && (
                  <form onSubmit={handleSendOtp} className="space-y-4">
                    <div className="space-y-1">
                      <label className="text-xs font-medium" htmlFor="reset-email">
                        Registered Email Address *
                      </label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                        <input
                          id="reset-email"
                          type="email"
                          placeholder="name@company.com"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className="w-full rounded-md border bg-background pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                          required
                          disabled={busy}
                        />
                      </div>
                    </div>

                    <Button type="submit" className="w-full font-semibold" disabled={busy}>
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send Verification Code'}
                    </Button>

                    <Button
                      type="button"
                      variant="ghost"
                      className="w-full text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setAuthMode('login')
                        setErrorMsg(null)
                      }}
                      disabled={busy}
                    >
                      Back to Sign In
                    </Button>
                  </form>
                )}

                {/* Step 2: Verify 6-digit OTP */}
                {forgotStep === 'otp' && (
                  <form onSubmit={handleVerifyOtp} className="space-y-4">
                    <div className="space-y-2 text-center">
                      <p className="text-xs text-muted-foreground">
                        Enter the 6-digit code sent to <strong className="text-foreground">{email}</strong>:
                      </p>
                      <div className="flex justify-center py-2">
                        <InputOTP
                          maxLength={6}
                          value={otpCode}
                          onChange={(val) => setOtpCode(val)}
                        >
                          <InputOTPGroup>
                            <InputOTPSlot index={0} />
                            <InputOTPSlot index={1} />
                            <InputOTPSlot index={2} />
                            <InputOTPSlot index={3} />
                            <InputOTPSlot index={4} />
                            <InputOTPSlot index={5} />
                          </InputOTPGroup>
                        </InputOTP>
                      </div>
                    </div>

                    <Button type="submit" className="w-full font-semibold" disabled={busy || otpCode.length !== 6}>
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Verify Code'}
                    </Button>

                    <div className="flex items-center justify-between text-xs pt-1">
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => setForgotStep('email')}
                        disabled={busy}
                      >
                        Change email
                      </button>
                      <button
                        type="button"
                        className={`font-medium ${
                          resendCooldown > 0
                            ? 'text-muted-foreground cursor-not-allowed'
                            : 'text-emerald-600 hover:underline dark:text-emerald-400'
                        }`}
                        onClick={handleSendOtp}
                        disabled={busy || resendCooldown > 0}
                      >
                        {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
                      </button>
                    </div>
                  </form>
                )}

                {/* Step 3: Set New Password */}
                {forgotStep === 'new-password' && (
                  <form onSubmit={handleResetPassword} className="space-y-3.5">
                    <div className="space-y-1">
                      <label className="text-xs font-medium" htmlFor="reset-new-password">
                        New Password *
                      </label>
                      <div className="relative">
                        <KeyRound className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                        <input
                          id="reset-new-password"
                          type={showNewPassword ? 'text' : 'password'}
                          placeholder="••••••••"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          className="w-full rounded-md border bg-background pl-9 pr-10 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40 font-mono"
                          required
                          disabled={busy}
                        />
                        <button
                          type="button"
                          className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
                          onClick={() => setShowNewPassword(!showNewPassword)}
                          tabIndex={-1}
                        >
                          {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-medium" htmlFor="reset-confirm-password">
                        Confirm New Password *
                      </label>
                      <div className="relative">
                        <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                        <input
                          id="reset-confirm-password"
                          type={showNewPassword ? 'text' : 'password'}
                          placeholder="••••••••"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          className="w-full rounded-md border bg-background pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40 font-mono"
                          required
                          disabled={busy}
                        />
                      </div>
                    </div>

                    <Button type="submit" className="w-full font-semibold" disabled={busy}>
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Set New Password'}
                    </Button>
                  </form>
                )}

                {/* Step 4: Success confirmation */}
                {forgotStep === 'success' && (
                  <div className="py-6 text-center space-y-3">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600">
                      <CheckCircle2 className="h-6 w-6" />
                    </div>
                    <h3 className="text-base font-bold text-foreground">Password Reset Successfully</h3>
                    <p className="text-xs text-muted-foreground">
                      Your password has been updated. Redirecting you to sign in...
                    </p>
                    <Button
                      type="button"
                      className="w-full font-semibold"
                      onClick={() => {
                        setAuthMode('login')
                        setForgotStep('email')
                      }}
                    >
                      Sign In Now
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Terms & Conditions Dialog Modal */}
      <Dialog open={termsModalOpen} onOpenChange={setTermsModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Terms & Conditions</DialogTitle>
            <DialogDescription>Version 1.0 — Effective Date: January 2026</DialogDescription>
          </DialogHeader>
          <div className="max-h-72 overflow-y-auto space-y-3 text-xs text-muted-foreground pr-2 leading-relaxed">
            <p>
              Welcome to <strong>InvoiceFlow</strong>. By accessing or using our application, you agree to be bound by these Terms and Conditions.
            </p>
            <h4 className="font-semibold text-foreground">1. Account & Identity</h4>
            <p>
              Each user is permitted exactly one account per verified email address. You are responsible for maintaining the confidentiality of your login credentials and for all activities that occur under your account.
            </p>
            <h4 className="font-semibold text-foreground">2. Offline & Cloud Synchronization</h4>
            <p>
              InvoiceFlow utilizes local-first IndexedDB storage to support offline operations. Cloud backup and synchronization occur whenever network connectivity is available and you are authenticated.
            </p>
            <h4 className="font-semibold text-foreground">3. GST & Financial Data Accuracy</h4>
            <p>
              You are solely responsible for ensuring the accuracy of GSTIN numbers, tax percentages, customer information, and invoice contents generated through this application.
            </p>
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                setTermsAccepted(true)
                setTermsModalOpen(false)
              }}
            >
              I Understand & Agree
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Privacy Policy Dialog Modal */}
      <Dialog open={privacyModalOpen} onOpenChange={setPrivacyModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Privacy Policy</DialogTitle>
            <DialogDescription>Version 1.0 — Effective Date: January 2026</DialogDescription>
          </DialogHeader>
          <div className="max-h-72 overflow-y-auto space-y-3 text-xs text-muted-foreground pr-2 leading-relaxed">
            <p>
              Your privacy is of critical importance to us. This Privacy Policy outlines how InvoiceFlow collects, uses, and safeguards your business data.
            </p>
            <h4 className="font-semibold text-foreground">1. Data Ownership</h4>
            <p>
              All invoices, customers, products, and company profile data created by you remain your exclusive property. We do not sell or monetize your business transaction records.
            </p>
            <h4 className="font-semibold text-foreground">2. Authentication Security</h4>
            <p>
              Passwords are encrypted using industry-standard hashing algorithms (scrypt/bcrypt). Sensitive tokens and OTP verification codes are never stored in plaintext or exposed to third parties.
            </p>
            <h4 className="font-semibold text-foreground">3. Local Storage Privacy</h4>
            <p>
              Offline business data resides within your browser&apos;s isolated IndexedDB store and is only synchronized to secure cloud endpoints associated with your authenticated identity.
            </p>
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                setTermsAccepted(true)
                setPrivacyModalOpen(false)
              }}
            >
              I Understand & Agree
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <footer className="border-t bg-card/60 px-4 py-3 text-center text-xs text-muted-foreground">
        InvoiceFlow v{APP_VERSION} · Protected by Supabase Auth & Google OAuth
      </footer>
    </div>
  )
}
