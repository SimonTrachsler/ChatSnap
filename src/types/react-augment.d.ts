/** Named exports for react (when @types/react uses export = React). */
declare module 'react' {
  export type ReactNode = any;
  export type ReactElement = any;
  export const useState: <S>(initial: S | (() => S)) => [S, (s: S | ((p: S) => S)) => void];
  export const useEffect: (effect: () => void | (() => void), deps?: unknown[]) => void;
  export const useCallback: <T extends (...args: any[]) => any>(f: T, deps: readonly unknown[]) => T;
  export const memo: <T>(component: T) => T;
  export const startTransition: (scope: () => void) => void;
  export function useRef<T>(initial: T): { current: T };
  export function useRef<T>(initial: T | null): { current: T | null };
  export type ComponentType<P = unknown> = (props: P) => ReactNode;
  export type ElementRef<T = unknown> = T extends never ? never : unknown;
}
