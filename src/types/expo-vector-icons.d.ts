declare module '@expo/vector-icons' {
  export const Ionicons: ((props: {
    name: string;
    size?: number;
    color?: string;
    style?: unknown;
    [key: string]: unknown;
  }) => any) & {
    glyphMap: Record<string, number>;
  };
}
