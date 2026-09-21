/**
 * Single source of truth for the application version.
 * Displayed in: sidebar footer, status bar, Settings → App & device,
 * onboarding, auth screen, and the PDF footer.
 * Keep in sync with package.json (checked in CI by convention).
 */
export const APP_VERSION = '0.5.0'

export const APP_TAGLINE = 'Local-first · Offline-ready · GST-aware' as const
