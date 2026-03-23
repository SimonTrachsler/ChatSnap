declare module 'expo-camera' {
  export type CameraFacing = 'back' | 'front';

  export interface CameraPicture {
    uri: string;
  }

  export interface CameraViewProps {
    ref?: unknown;
    style?: unknown;
    facing?: CameraFacing;
    zoom?: number;
    mode?: 'picture';
    onCameraReady?: () => void;
  }

  export const CameraView: (props: CameraViewProps) => any;

  export type CameraPermission = {
    granted: boolean;
  } | null;

  export const useCameraPermissions: () => [
    CameraPermission,
    () => Promise<unknown>,
    () => Promise<unknown>,
  ];
}
