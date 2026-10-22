/** True when the OS/browser usually honors `capture="environment"` (rear camera on phones/tablets). */
export function supportsNativeLabelCamera(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  if (/Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return true;
  // iPad (including iPadOS reporting as Mac)
  if (/iPad/i.test(ua)) return true;
  if (navigator.maxTouchPoints > 1 && /Macintosh/i.test(ua)) return true;
  return false;
}
