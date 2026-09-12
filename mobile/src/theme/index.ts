import { StyleSheet } from 'react-native';

export const colors = {
  background: '#090B12',
  surface: '#10131D',
  surfaceRaised: '#171B28',
  accent: '#8B7CF6',
  accentSoft: '#26223D',
  positive: '#5DD6C7',
  warning: '#D9A441',
  danger: '#D45B5B',
  text: '#F5F7FB',
  muted: '#8F97AA',
  border: '#262B3A',
  placeholder: '#222838',
};

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 };

export const text = StyleSheet.create({
  display: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '600',
    lineHeight: 34,
  },
  heading: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '600',
    lineHeight: 24,
  },
  body: { color: colors.text, fontSize: 14, lineHeight: 21 },
  meta: { color: colors.muted, fontSize: 12, lineHeight: 17 },
});

export const shadow = {
  shadowColor: '#000',
  shadowOpacity: 0.32,
  shadowOffset: { width: 0, height: -4 },
  shadowRadius: 12,
  elevation: 12,
};
