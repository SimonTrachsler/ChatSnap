/** Allow named exports from react-native when resolved with customConditions. */
declare module 'react-native' {
  export const View: any;
  export const Text: any;
  export const TextInput: any;
  export type TextInputProps = any;
  export const TouchableOpacity: any;
  export const ScrollView: any;
  export const FlatList: any;
  export const SectionList: any;
  export const RefreshControl: any;
  export const Image: any;
  export const Modal: any;
  export const Pressable: any;
  export const ActivityIndicator: any;
  export const KeyboardAvoidingView: any;
  export const Keyboard: {
    addListener: (eventType: string, listener: () => void) => { remove: () => void };
  };
  export const PermissionsAndroid: {
    PERMISSIONS: { RECORD_AUDIO: string };
    RESULTS: { GRANTED: string };
    request: (permission: string) => Promise<string>;
  };
  export const Animated: any;
  export const Alert: { alert: (title: string, message?: string, buttons?: Array<{ text: string; style?: string; onPress?: () => void }>) => void };
  export const Platform: { OS: string };
  export const Dimensions: { get: (key: string) => { width: number; height: number } };
  export type ViewStyle = any;
  export type ImageStyle = any;
  export type StyleProp<T> = T | T[] | null | undefined;
  export type GestureResponderEvent = { stopPropagation?: () => void };
  export function useWindowDimensions(): { width: number; height: number };
  export const StyleSheet: {
    create: <T>(styles: T) => T;
    absoluteFill: any;
    absoluteFillObject: any;
  };
}
