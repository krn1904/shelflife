/**
 * Docket photos in the browser: shrinking them for upload, and the free OCR engine, which
 * reads the photo on the device so the image never leaves it. Browser-only (canvas, workers).
 */

const TARGET_WIDTH = 2400;

/**
 * Enlarge, greyscale and stretch the contrast before OCR. On a real docket photo this took
 * the printed quantities from partly read to all read: phone photos are often too small
 * for Tesseract to separate digits from the table rules beside them.
 */
async function cleanUp(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.max(1, TARGET_WIDTH / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = image.data;
  const grey = new Uint8ClampedArray(px.length / 4);
  for (let i = 0; i < grey.length; i++) grey[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
  // Stretch between the 1st and 99th percentile, so shadows and grey paper stop muting ink.
  const sorted = Uint8ClampedArray.from(grey).sort();
  const lo = sorted[Math.floor(sorted.length * 0.01)];
  const hi = sorted[Math.floor(sorted.length * 0.99)];
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < grey.length; i++) {
    const v = ((grey[i] - lo) * 255) / range;
    px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = v;
  }
  ctx.putImageData(image, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('could not prepare the photo'))), 'image/png'));
}

/** A JPEG small enough for Textract (5 MB) and the upload, big enough to read. */
export async function forUpload(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, TARGET_WIDTH / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('could not prepare the photo'))), 'image/jpeg', 0.88));
}

/** Tesseract reads the photo in the browser: free, and the image never leaves the device. */
export async function readText(file: Blob, onProgress: (p: number) => void): Promise<string[]> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, {
    logger: (m) => { if (m.status === 'recognizing text') onProgress(m.progress); },
  });
  try {
    await worker.setParameters({ preserve_interword_spaces: '1' });
    const { data } = await worker.recognize(await cleanUp(file));
    return data.text.split('\n').map((l) => l.trim()).filter(Boolean);
  } finally {
    await worker.terminate();
  }
}

