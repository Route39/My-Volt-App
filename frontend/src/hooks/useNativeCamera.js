import { useState } from 'react';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
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

      let image;
      if (Capacitor.getPlatform() === 'web') {
        // Native desktop file browser experience for web
        return new Promise((resolve) => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/*';
          input.onchange = (e) => {
            if (e.target.files && e.target.files.length > 0) {
              resolve(e.target.files[0]);
            } else {
              resolve(null);
            }
            setLoading(false);
          };
          input.oncancel = () => {
            resolve(null);
            setLoading(false);
          };
          input.click();
        });
      } else {
        // Native mobile experience (Camera/Gallery bottom sheet)
        image = await Camera.getPhoto({
          quality: 70,
          allowEditing: false,
          resultType: CameraResultType.Uri,
          source: CameraSource.Prompt, 
        });
      }

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
