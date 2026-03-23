export const colors = {
  bg: '#07101d',
  bgDeep: '#040b14',
  bgElevated: '#0b1728',
  bgCard: 'rgba(10,18,32,0.84)',
  bgCardAlt: 'rgba(13,24,40,0.78)',
  bgCardBorder: 'rgba(148,163,184,0.16)',
  glassEdge: 'rgba(255,255,255,0.08)',
  surface: 'rgba(8,15,26,0.94)',
  surfaceRaised: 'rgba(12,22,37,0.98)',
  accent: '#ff8a5b',
  accentStrong: '#ff6b3d',
  accentSecondary: '#7dd3fc',
  success: '#5eead4',
  error: '#fb7185',
  textPrimary: '#f8fafc',
  textSecondary: '#d8e2ee',
  textMuted: '#8da1b7',
  bubbleSent: '#ff7b47',
  bubbleReceived: 'rgba(148,163,184,0.14)',
  tabBar: 'rgba(6,16,29,0.96)',
  tabActive: '#ff8a5b',
  tabInactive: '#6d8298',
  inputBg: 'rgba(8,15,26,0.78)',
  inputBorder: 'rgba(148,163,184,0.18)',
  inputBorderFocus: 'rgba(125,211,252,0.55)',
  divider: 'rgba(148,163,184,0.12)',
  overlay: 'rgba(4,9,17,0.76)',
  glowWarm: 'rgba(255,138,91,0.18)',
  glowCool: 'rgba(125,211,252,0.16)',
  onAccent: '#08111d',
};

export const radius = { xs: 10, sm: 14, md: 20, lg: 28, xl: 36, pill: 999 };

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 40 };

export const shadows = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.18,
    shadowRadius: 28,
    elevation: 8,
  },
  floating: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 22 },
    shadowOpacity: 0.26,
    shadowRadius: 32,
    elevation: 12,
  },
};

export const typography = {
  hero: { fontSize: 34, fontWeight: '800' as const, color: colors.textPrimary, letterSpacing: -0.8 },
  title: { fontSize: 26, fontWeight: '800' as const, color: colors.textPrimary, letterSpacing: -0.4 },
  subtitle: { fontSize: 18, fontWeight: '700' as const, color: colors.textPrimary },
  body: { fontSize: 15, color: colors.textSecondary, lineHeight: 22 },
  meta: { fontSize: 13, color: colors.textMuted },
  badge: { fontSize: 11, fontWeight: '800' as const, color: colors.onAccent },
};
