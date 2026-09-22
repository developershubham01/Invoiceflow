// InvoiceFlow — document template catalog (CANON §13)
// Pure data, shared by the PDF renderer (lib/pdf/render.ts), the zod schema and the
// Settings gallery. Each template pairs a header LAYOUT with a THEME, so switching
// template changes both the page geometry and the color identity of the document.

export type RGB = [number, number, number]

export type TemplateLayout = 'band' | 'block' | 'sidebar' | 'centered' | 'corner' | 'split' | 'minimal' | 'stack'

export type TableHeadStyle = 'light' | 'accent' | 'rule'
export type TotalStyle = 'fill' | 'outline' | 'dark'

export interface DocTheme {
  /** primary brand accent — title, rules, section labels */
  accent: RGB
  /** darker companion for filled header blocks / text on light backgrounds */
  accentDark: RGB
  /** soft tint used for table header fill (headStyle 'light') */
  headFill: RGB
  /** grand-total bar */
  totalFill: RGB
  /** text color on top of totalFill */
  totalText: RGB
  /** secondary text (addresses, captions) */
  muted: RGB
  /** hairline borders */
  line: RGB
  /** zebra row tint */
  zebra: RGB
}

export interface DocTemplate {
  id: string
  name: string
  description: string
  layout: TemplateLayout
  tableHead: TableHeadStyle
  totals: TotalStyle
  /** serif (Times) display type for formal documents */
  serif?: boolean
  theme: DocTheme
  /** hex colors powering the Settings gallery thumbnails */
  swatch: { accent: string; accentDark: string; totalFill: string; paper: string }
}

const S = {
  slate: [51, 65, 85] as RGB,
  slateMuted: [100, 116, 110] as RGB,
  line: [226, 232, 230] as RGB,
  zebra: [252, 253, 252] as RGB,
}

export const DOC_TEMPLATES: DocTemplate[] = [
  {
    id: 'classic-emerald',
    name: 'Classic Emerald',
    description: 'The InvoiceFlow standard — slim accent band, light table, emerald total bar.',
    layout: 'band',
    tableHead: 'light',
    totals: 'fill',
    theme: {
      accent: [5, 122, 85], // emerald-600
      accentDark: [4, 108, 78],
      headFill: [241, 245, 243],
      totalFill: [5, 122, 85],
      totalText: [255, 255, 255],
      muted: S.slateMuted,
      line: S.line,
      zebra: S.zebra,
    },
    swatch: { accent: '#057a55', accentDark: '#046c4e', totalFill: '#057a55', paper: '#f1f5f3' },
  },
  {
    id: 'midnight-slate',
    name: 'Midnight Slate',
    description: 'Full-width dark header block with white type and an amber grand total.',
    layout: 'block',
    tableHead: 'light',
    totals: 'fill',
    theme: {
      accent: [255, 191, 36], // amber-400 accents on the dark block
      accentDark: [30, 41, 59], // slate-800 block
      headFill: [241, 245, 249],
      totalFill: [245, 158, 11], // amber-500
      totalText: [69, 26, 3],
      muted: [148, 163, 184],
      line: S.line,
      zebra: [250, 250, 252],
    },
    swatch: { accent: '#ffbf24', accentDark: '#1e293b', totalFill: '#f59e0b', paper: '#f1f5f9' },
  },
  {
    id: 'royal-violet',
    name: 'Royal Violet',
    description: 'Corner brand block with a violet rule and bold violet totals.',
    layout: 'corner',
    tableHead: 'accent',
    totals: 'fill',
    theme: {
      accent: [109, 40, 217], // violet-700
      accentDark: [91, 33, 182],
      headFill: [237, 233, 254],
      totalFill: [109, 40, 217],
      totalText: [255, 255, 255],
      muted: [124, 116, 150],
      line: [233, 229, 242],
      zebra: [251, 250, 253],
    },
    swatch: { accent: '#6d28d9', accentDark: '#5b21b6', totalFill: '#6d28d9', paper: '#ede9fe' },
  },
  {
    id: 'sunset-orange',
    name: 'Sunset Orange',
    description: 'Vertical accent sidebar down the page with outlined orange totals.',
    layout: 'sidebar',
    tableHead: 'light',
    totals: 'outline',
    theme: {
      accent: [234, 88, 12], // orange-600
      accentDark: [194, 65, 12],
      headFill: [255, 243, 234],
      totalFill: [234, 88, 12],
      totalText: [255, 247, 237],
      muted: [154, 128, 116],
      line: [247, 231, 220],
      zebra: [255, 252, 250],
    },
    swatch: { accent: '#ea580c', accentDark: '#c2410c', totalFill: '#ea580c', paper: '#fff3ea' },
  },
  {
    id: 'ocean-teal',
    name: 'Ocean Teal',
    description: 'Centered letterhead with teal rules and a teal-tinted table header.',
    layout: 'centered',
    tableHead: 'accent',
    totals: 'fill',
    theme: {
      accent: [15, 118, 110], // teal-700
      accentDark: [17, 94, 89],
      headFill: [204, 237, 234],
      totalFill: [15, 118, 110],
      totalText: [240, 253, 250],
      muted: [96, 125, 122],
      line: [214, 236, 233],
      zebra: [249, 252, 251],
    },
    swatch: { accent: '#0f766e', accentDark: '#115e59', totalFill: '#0f766e', paper: '#cceedd' },
  },
  {
    id: 'crimson-formal',
    name: 'Crimson Formal',
    description: 'Two-tone letterhead split, ruled table and a deep crimson total panel.',
    layout: 'split',
    tableHead: 'rule',
    totals: 'dark',
    serif: true,
    theme: {
      accent: [190, 18, 60], // rose-700
      accentDark: [136, 19, 55], // rose-900
      headFill: [255, 235, 238],
      totalFill: [136, 19, 55],
      totalText: [255, 241, 242],
      muted: [150, 110, 118],
      line: [244, 218, 224],
      zebra: [253, 249, 250],
    },
    swatch: { accent: '#be123c', accentDark: '#881337', totalFill: '#881337', paper: '#ffebee' },
  },
  {
    id: 'mono-minimal',
    name: 'Mono Minimal',
    description: 'Ink-friendly monochrome — heavy top rule, no fills, outlined total.',
    layout: 'minimal',
    tableHead: 'rule',
    totals: 'outline',
    theme: {
      accent: [24, 24, 27], // zinc-900
      accentDark: [9, 9, 11],
      headFill: [255, 255, 255],
      totalFill: [24, 24, 27],
      totalText: [255, 255, 255],
      muted: [113, 113, 122],
      line: [212, 212, 216],
      zebra: [255, 255, 255],
    },
    swatch: { accent: '#18181b', accentDark: '#09090b', totalFill: '#18181b', paper: '#ffffff' },
  },
  {
    id: 'saffron-gold',
    name: 'Saffron Gold',
    description: 'Festive saffron banner with dark-roast brown type — great for festivals.',
    layout: 'stack',
    tableHead: 'light',
    totals: 'fill',
    theme: {
      accent: [217, 119, 6], // amber-600
      accentDark: [69, 41, 8], // dark roast brown
      headFill: [254, 243, 199],
      totalFill: [180, 83, 9], // amber-700
      totalText: [255, 251, 235],
      muted: [146, 116, 82],
      line: [245, 229, 191],
      zebra: [255, 254, 250],
    },
    swatch: { accent: '#d97706', accentDark: '#452908', totalFill: '#b45309', paper: '#fef3c7' },
  },
]

export const DEFAULT_TEMPLATE_ID = 'classic-emerald'

export const DOC_TEMPLATE_IDS = DOC_TEMPLATES.map((t) => t.id) as [string, ...string[]]

export function getDocTemplate(id: string | null | undefined): DocTemplate {
  return DOC_TEMPLATES.find((t) => t.id === id) ?? DOC_TEMPLATES[0]
}

/** Per-kind template selection stored on the company profile. */
export type TemplateKind = 'invoice' | 'quotation'
