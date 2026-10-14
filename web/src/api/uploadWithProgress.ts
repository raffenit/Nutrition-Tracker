import { ApiError } from './client';

const KIOSK_KEY = 'nutrition_kiosk_token';

export function apiFormUpload<T>(
  path: string,
  formData: FormData,
  onProgress: (loaded: number, total: number) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path);
    xhr.withCredentials = true;
    const token = sessionStorage.getItem(KIOSK_KEY);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total);
    };
    xhr.onload = () => {
      let body: { error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText) as { error?: string };
      } catch {
        reject(new ApiError('Could not read server response'));
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as T);
        return;
      }
      reject(new ApiError(body.error ?? 'Upload failed'));
    };
    xhr.onerror = () => reject(new ApiError('Network error during upload'));
    xhr.onabort = () => reject(new ApiError('Upload cancelled'));
    xhr.send(formData);
  });
}
