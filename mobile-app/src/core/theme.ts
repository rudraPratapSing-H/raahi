// Color tokens matching the web-app's dark theme (web-app/css/style.css)
// for visual consistency between the two clients.

export const colors = {
  bg: '#0b0f14',
  surface: '#131a22',
  surface2: '#1b2530',
  border: '#26313d',
  text: '#e8edf2',
  textDim: '#93a5b3',
  textFaint: '#5b6b78',
  accent: '#4cc2ff',
  accentDim: '#132734',
  safe: '#3ddc97',
  safeBg: '#0f2a20',
  caution: '#f5b942',
  cautionBg: '#332309',
  danger: '#ff6b60',
  dangerBg: '#341210',
};

export const zoneColor: Record<string, string> = {
  danger: colors.danger,
  caution: colors.caution,
  aware: colors.accent,
  safe: colors.safe,
  unknown: colors.textFaint,
};
