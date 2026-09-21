import { useState } from 'react';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Geolocation } from '@capacitor/geolocation';

export function useNativeCamera() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const captureImage = async () => {
    setLoading(true);
    setError('');
    try {
      // 1. First, gently check/request location permission to attach to metadata
      try {
        const p = await Geolocation.checkPermissions();
        if (p.location !== 'granted') {
          await Geolocation.requestPermissions();
        }
      } catch (locErr) {
        console.warn('Geolocation permission not fully granted, proceeding anyway.', locErr);
      }

      // 2. Trigger native camera UI (Prompts user: Take Photo or Choose from Gallery)
      // This automatically asks for Camera permissions natively on Android/iOS.
      const image = await Camera.getPhoto({
        quality: 70,
        allowEditing: false,
        resultType: CameraResultType.Uri,
        source: CameraSource.Prompt, // This shows the native options!
      });

      if (image.webPath) {
        // Convert to standard File object for existing API compatibility
        const response = await fetch(image.webPath);
        const blob = await response.blob();
        
        // Generate a random filename with current timestamp
        const filename = `capture_${Date.now()}.${image.format}`;
        const file = new File([blob], filename, { type: `image/${image.format}` });
        
        return file;
      }
      return null;
    } catch (err) {
      if (err.message && !err.message.includes('User cancelled')) {
        setError(err.message || 'Failed to capture image');
      }
      return null;
    } finally {
      setLoading(false);
    }
  };

  return { captureImage, loading, error };
}
