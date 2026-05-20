export type ImageOutputType = 'image/jpeg' | 'image/webp' | 'image/png';

export async function convertImageFormat(
  file: File,
  toType: ImageOutputType,
  quality = 0.9
): Promise<File> {
  const img = await loadImage(file);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error('Conversion failed'));
        const ext = toType.split('/')[1];
        const newName = file.name.replace(/\.[^.]+$/, `.${ext}`);
        resolve(new File([blob], newName, { type: toType }));
      },
      toType,
      quality
    );
  });
}

function loadImage(file: File): Promise<HTMLImageElement> {
  const img = new Image();
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    img.src = url;
  });
}
