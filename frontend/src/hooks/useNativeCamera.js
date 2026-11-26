import { useState } from 'react';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { toast } from 'sonner';

// Convert a data URL (data:image/jpeg;base64,....) into a File without using fetch()
function dataUrlToFile(dataUrl, filename) {
  const [head, b64] = dataUrl.split(',');
  const mime = (head.match(/:(.*?);/) || [])[1] || 'image/jpeg';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], filename, { type: mime });
}

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

      if (Capacitor.getPlatform() === 'web') {
        // File browser experience for web
        return await new Promise((resolve) => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/*';
          input.onchange = (e) => {
            resolve(e.target.files && e.target.files.length > 0 ? e.target.files[0] : null);
            setLoading(false);
          };
          input.oncancel = () => {
            resolve(null);
            setLoading(false);
          };
          input.click();
        });
      }

      // Native mobile experience (Camera / Photo Library chooser)
      const image = await Camera.getPhoto({
        quality: 70,
        width: 1600,
        allowEditing: false,
        saveToGallery: false,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Prompt,
      });

      if (image && image.dataUrl) {
        const ext = image.format || 'jpeg';
        return dataUrlToFile(image.dataUrl, `capture_${Date.now()}.${ext}`);
      }
      return null;
    } catch (err) {
      const msg = (err && err.message) || '';
      if (msg && !/cancel/i.test(msg)) {
        setError(msg);
        toast.error(`Could not add the photo: ${msg}`);
      }
      return null;
    } finally {
      setLoading(false);
    }
  };

  return { captureImage, loading, error };
}