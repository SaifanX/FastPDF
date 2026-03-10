
import { jsPDF } from "jspdf";
import { ProcessingFile } from "../types";

const compressImage = (file: File, quality: number = 0.75): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject('Canvas context not available');

        const MAX_DIM = 1800;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_DIM) {
            height *= MAX_DIM / width;
            width = MAX_DIM;
          }
        } else {
          if (height > MAX_DIM) {
            width *= MAX_DIM / height;
            height = MAX_DIM;
          }
        }

        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
};

export const generateImagePDF = async (
  files: ProcessingFile[],
  onProgress: (progress: number) => void,
  includeText: boolean = false
): Promise<Blob> => {
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4',
    compress: true
  });

  const total = files.length;
  const a4Width = pdf.internal.pageSize.getWidth();
  const a4Height = pdf.internal.pageSize.getHeight();

  for (let i = 0; i < total; i++) {
    const item = files[i];
    if (i > 0) pdf.addPage();

    try {
      const compressedDataUrl = await compressImage(item.file);
      const imgProps = pdf.getImageProperties(compressedDataUrl);
      
      const ratio = Math.min(a4Width / imgProps.width, a4Height / imgProps.height);
      const finalWidth = imgProps.width * ratio;
      const finalHeight = imgProps.height * ratio;
      const x = (a4Width - finalWidth) / 2;
      const y = (a4Height - finalHeight) / 2;

      // Add text layer if requested and available
      if (includeText && item.extractedText) {
        pdf.setFontSize(1);
        pdf.setTextColor(255, 255, 255); // Invisible white text layer
        const splitText = pdf.splitTextToSize(item.extractedText, a4Width - 40);
        pdf.text(splitText, 20, 20);
      }

      pdf.addImage(compressedDataUrl, 'JPEG', x, y, finalWidth, finalHeight, undefined, 'FAST');
    } catch (e) {
      console.error("Error adding image to PDF:", e);
    }

    onProgress(((i + 1) / total) * 100);
  }

  return pdf.output('blob');
};
