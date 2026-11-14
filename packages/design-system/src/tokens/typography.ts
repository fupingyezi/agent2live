export const typographyTokens = {
  caption: { size: '10.5px', lineHeight: '14px', weight: 400 },
  meta: { size: '11.5px', lineHeight: '16px', weight: 400 },
  bodySm: { size: '12px', lineHeight: '18px', weight: 400 },
  body: { size: '13px', lineHeight: '20px', weight: 400 },
  label: { size: '12px', lineHeight: '18px', weight: 500 },
  titleSm: { size: '14px', lineHeight: '20px', weight: 500 },
  title: { size: '18px', lineHeight: '26px', weight: 500 },
  display: { size: '24px', lineHeight: '32px', weight: 500 }
} as const

export const fontTokens = {
  sans: '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif',
  mono: '"SFMono-Regular", "Cascadia Code", monospace'
} as const
