declare module 'react-native-background-upload' {
  export type UploadEvent = 'progress' | 'error' | 'completed' | 'cancelled';

  export interface StartUploadArgs {
    url: string;
    path: string;
    method?: 'PUT' | 'POST';
    type?: 'raw' | 'multipart';
    field?: string;
    customUploadId?: string;
    parameters?: Record<string, string>;
    headers?: Record<string, string>;
    notification?: { enabled?: boolean };
  }

  export function startUpload(options: StartUploadArgs): Promise<string>;
  export function cancelUpload(uploadId: string): Promise<boolean>;
  export function getFileInfo(path: string): Promise<Record<string, unknown>>;
  export function addListener(
    eventType: UploadEvent,
    uploadId: string | null,
    listener: (data: Record<string, unknown>) => void
  ): { remove: () => void };

  const _default: {
    startUpload: typeof startUpload;
    cancelUpload: typeof cancelUpload;
    addListener: typeof addListener;
    getFileInfo: typeof getFileInfo;
  };
  export default _default;
}
