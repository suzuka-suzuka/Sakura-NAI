import { translateUI } from "@/lib/i18n";
import { toast } from "sonner";

let downloadSequence = 0;

/** Local time is readable in file managers; the suffix distinguishes rapid downloads. */
export function imageDownloadFilename(filename = "image.png", now = new Date()) {
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}-${pad(now.getMilliseconds(), 3)}`;
  const extension = filename.match(/\.(png|jpe?g|webp|gif)$/i)?.[0].toLowerCase() ?? ".png";
  return `sakura_${date}_${time}_${++downloadSequence}${extension}`;
}

/** Keep the original image bytes (including metadata), and supply a Blob download name. */
export function downloadDataUrl(dataUrl: string, filename = "image.png") {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(dataUrl);
  if (!match) throw new Error("Invalid image data URL");
  const bytes = Uint8Array.from(atob(match[2]), char => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: match[1] }));
  const a = document.createElement("a");
  a.href = url;
  a.download = imageDownloadFilename(filename);
  document.body.appendChild(a);
  try { a.click(); }
  finally {
    document.body.removeChild(a);
    // Mobile browsers may consume the URL after the click handler returns.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

/** A browser download failure must never discard a completed generation. */
export function downloadGeneratedImages(images: { dataUrl: string; filename: string }[]) {
  try { for (const image of images) downloadDataUrl(image.dataUrl, image.filename); }
  catch { toast.error(translateUI("Automatic download failed. Download the images manually.")); }
}

/** Copy an image to the clipboard, falling back to copying the data-url text. */
export async function copyImageToClipboard(dataUrl: string) {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    toast.success(translateUI("Image copied to clipboard"));
  } catch {
    try {
      await navigator.clipboard.writeText(dataUrl);
      toast.success(translateUI("Image data copied"));
    } catch {
      toast.error(translateUI("Couldn't copy image"));
    }
  }
}
