// Explicit MIME types avoid unwanted transcoding in WebKit's image/* handling.
export const IMAGE_FILE_ACCEPT = "image/png,image/webp,image/jpeg,image/gif,image/bmp,image/avif,image/heic,image/heif,image/*";
export const isImageFile = (file: File) => file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|avif|heic|heif)$/i.test(file.name);

let removePrevious: (() => void) | undefined;

/** Keep the input mounted throughout the native picker, including iCloud file downloads. */
export function pickImageFile(onFile: (file: File) => void, original = false) {
  removePrevious?.();
  const input = document.createElement("input");
  input.type = "file";
  const appleMobile = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  // public.data includes image files without offering the Photos conversion path on iOS.
  input.accept = original && appleMobile ? "application/octet-stream" : IMAGE_FILE_ACCEPT;
  input.tabIndex = -1;
  input.setAttribute("aria-hidden", "true");
  input.style.cssText = "position:fixed;bottom:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none";
  const cleanup = () => {
    input.remove();
    if (removePrevious === cleanup) removePrevious = undefined;
  };
  removePrevious = cleanup;
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    cleanup();
    if (file) onFile(file);
  }, { once: true });
  input.addEventListener("cancel", cleanup, { once: true });
  document.body.appendChild(input);
  try { input.click(); } catch (error) { cleanup(); throw error; }
}
