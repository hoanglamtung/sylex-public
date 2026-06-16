import { useState, useCallback } from 'react';
import { Alert } from 'react-native';
import { pickImage, PickedImage, ImageSource } from '../services/imageService';

export function useImageAttachment(
  isPremium: boolean,
  onUpgrade: () => void,
) {
  const [image, setImage] = useState<PickedImage | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const pick = useCallback(
    async (source: ImageSource) => {
      if (!isPremium) {
        Alert.alert(
          'Premium Feature',
          'Image attachment is available for Premium users.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Upgrade', onPress: onUpgrade },
          ],
        );
        return;
      }

      setIsLoading(true);
      try {
        const picked = await pickImage(source);
        if (picked) setImage(picked);
      } catch (err) {
        if (err instanceof Error && err.message === 'IMAGE_TOO_LARGE') {
          Alert.alert('Image Too Large', 'Please choose an image under 1 MB.');
        }
      } finally {
        setIsLoading(false);
      }
    },
    [isPremium, onUpgrade],
  );

  const clear = useCallback(() => setImage(null), []);

  return { image, isLoading, pick, clear };
}
