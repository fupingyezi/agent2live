export const colorTokens = {
  appBg: '#F8FAF9',
  surface: '#FFFFFF',
  surfaceSubtle: '#F8FAF9',
  surfaceSelected: '#EFFAF7',
  accent: '#3FB0A0',
  accentStrong: '#2E9183',
  accentSoft: '#EAF7F4',
  text: '#252A32',
  textSecondary: '#3C434E',
  textMuted: '#A8AEB8',
  border: '#E7ECEA',
  borderStrong: '#E2E6E5',
  warningBg: '#FDF5E9',
  warning: '#B07C33',
  danger: '#A85468',
  dangerBorder: '#EFD8D3',
  focus: '#3FB0A0',
  onAccent: '#FFFFFF',
  overlay: 'rgba(37, 42, 50, 0.45)',
  petGradient: 'linear-gradient(135deg, #EBF6F2 0%, #F0F5FA 27.5%, #FCF0F5 50%)'
} as const

export type ColorToken = keyof typeof colorTokens
