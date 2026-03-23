/**
 * Fallback-Typen, wenn node_modules (react/react-native) von der IDE nicht aufgelöst werden.
 */
declare module 'react' {
  export type ReactNode = unknown;
  export interface ErrorInfo {
    componentStack?: string;
  }
  export class Component<P = object, S = object> {
    props: Readonly<P>;
    state: Readonly<S>;
    setState(state: Partial<S> | ((prevState: S) => Partial<S>)): void;
    render(): ReactNode;
  }
  const React: {
    Component: typeof Component;
    createElement: (type: unknown, props?: object | null, ...children: unknown[]) => unknown;
    memo: <T>(component: T) => T;
  };
  export const memo: <T>(component: T) => T;
  export const startTransition: (scope: () => void) => void;
  export default React;
}

declare module 'react-native' {
  // Typen als any, damit JSX-Elemente und StyleSheet.create funktionieren
  export const View: any;
  export const Text: any;
  export const TextInput: any;
  export type TextInputProps = any;
  export const TouchableOpacity: any;
  export const ActivityIndicator: any;
  export const ScrollView: any;
  export const FlatList: any;
  export const StyleSheet: {
    create<T extends object>(styles: T): T;
    absoluteFill: any;
    absoluteFillObject: any;
  };
}
