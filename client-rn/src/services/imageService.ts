import {
  launchCamera,
  launchImageLibrary,
  ImagePickerResponse,
} from 'react-native-image-picker';

export type ImageSource = 'camera' | 'gallery';

export interface PickedImage {
  uri: string;
  base64: string;
  mimeType: string;
  sizeBytes: number;
}

const MAX_SIZE_BYTES = 1 * 1024 * 1024; // 1 MB

const PICKER_OPTIONS = {
  mediaType: 'photo' as const,
  quality: 0.7 as const,
  maxWidth: 1280,
  maxHeight: 1280,
  includeBase64: true,
};

export async function pickImage(source: ImageSource): Promise<PickedImage | null> {
  const response: ImagePickerResponse = await (source === 'camera'
    ? launchCamera(PICKER_OPTIONS)
    : launchImageLibrary(PICKER_OPTIONS));

  if (response.didCancel || response.errorCode) {
    return null;
  }

  const asset = response.assets?.[0];
  if (!asset?.base64 || !asset.uri) {
    return null;
  }

  // base64 string length * 0.75 approximates raw byte count
  const sizeBytes = Math.round(asset.base64.length * 0.75);
  if (sizeBytes > MAX_SIZE_BYTES) {
    throw new Error('IMAGE_TOO_LARGE');
  }

  return {
    uri: asset.uri,
    base64: asset.base64,
    mimeType: asset.type ?? 'image/jpeg',
    sizeBytes,
  };
}
