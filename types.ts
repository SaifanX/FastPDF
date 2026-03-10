
export interface ProcessingFile {
  id: string;
  file: File;
  previewUrl: string;
  status: 'Ready' | 'Compiling' | 'Completed' | 'OCR_Pending' | 'OCR_Processing' | 'OCR_Done' | 'Error';
  extractedText?: string;
}

export enum AppState {
  IDLE = 'IDLE',
  COMPILING = 'COMPILING',
  OCR_PROCESSING = 'OCR_PROCESSING',
  DONE_WAITING_OCR = 'DONE_WAITING_OCR'
}
