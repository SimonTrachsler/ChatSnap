declare module 'expo-image' {
  import type { ImageStyle, StyleProp } from 'react-native';

  export interface ExpoImageProps {
    source: { uri: string } | number;
    style?: StyleProp<ImageStyle>;
    contentFit?: 'cover' | 'contain' | 'fill' | 'none';
    transition?: number;
    placeholder?: string | null;
    [key: string]: unknown;
  }

  export const Image: (props: ExpoImageProps) => any;
  export const ImageBackground: (props: ExpoImageProps & { children?: unknown }) => any;
}
