
import React, { useState, useRef, useEffect } from 'react';
import { ProcessingFile, AppState } from './types';
import { generateImagePDF } from './services/pdfService';
import { performOCR } from './services/geminiService';

const OCR_CONCURRENCY = 2; // Keep it low for stability

export default function App() {
  const [files, setFiles] = useState<ProcessingFile[]>([]);
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [progress, setProgress] = useState(0);
  const [filename, setFilename] = useState('My_Document');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      // Don't intercept if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      const items = e.clipboardData?.items;
      if (!items) return;

      const pastedFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const blob = items[i].getAsFile();
          if (blob) {
            const file = new File([blob], `pasted-image-${Date.now()}-${i}.png`, { type: blob.type });
            pastedFiles.push(file);
          }
        }
      }

      if (pastedFiles.length > 0) {
        addFiles(pastedFiles);
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => {
      window.removeEventListener('paste', handlePaste);
      files.forEach(f => URL.revokeObjectURL(f.previewUrl));
    };
  }, [files]);

  const addFiles = (newFilesList: File[]) => {
    const newProcessingFiles: ProcessingFile[] = newFilesList.map((file: File) => ({
      id: Math.random().toString(36).substr(2, 9),
      file,
      previewUrl: URL.createObjectURL(file),
      status: 'Ready'
    }));

    setFiles(prev => [...prev, ...newProcessingFiles]);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []) as File[];
    if (selectedFiles.length === 0) return;
    addFiles(selectedFiles);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeFile = (id: string) => {
    setFiles(prev => {
      const file = prev.find(f => f.id === id);
      if (file) URL.revokeObjectURL(file.previewUrl);
      return prev.filter(f => f.id !== id);
    });
  };

  const downloadBlob = (blob: Blob, suffix: string = '') => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const cleanName = filename.replace(/\.pdf$/i, '').trim() || 'My_Document';
    a.download = `${cleanName}${suffix}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const compileFastPDF = async () => {
    if (files.length === 0) return;
    setAppState(AppState.COMPILING);
    setProgress(0);

    try {
      const pdfBlob = await generateImagePDF(files, (p) => setProgress(p), false);
      downloadBlob(pdfBlob);
      
      setFiles(prev => prev.map(f => ({ ...f, status: 'Completed' })));
      setAppState(AppState.DONE_WAITING_OCR);
    } catch (err) {
      console.error(err);
      alert("Conversion failed.");
      setAppState(AppState.IDLE);
    } finally {
      setProgress(0);
    }
  };

  const fileToBase64Raw = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = reject;
    });
  };

  const startAIOCR = async () => {
    setAppState(AppState.OCR_PROCESSING);
    setProgress(0);

    const pending = [...files];
    let completedCount = 0;
    const total = pending.length;

    // Use workers to process images through Gemini
    const workers = Array(Math.min(OCR_CONCURRENCY, total)).fill(null).map(async () => {
      while (pending.length > 0) {
        const item = pending.shift()!;
        setFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: 'OCR_Processing' } : f));
        
        try {
          const base64 = await fileToBase64Raw(item.file);
          const text = await performOCR(base64, item.file.type);
          setFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: 'OCR_Done', extractedText: text } : f));
        } catch (e) {
          console.error(e);
          setFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: 'Error' } : f));
        } finally {
          completedCount++;
          setProgress((completedCount / total) * 100);
        }
      }
    });

    await Promise.all(workers);

    // After all OCR is done, compile the searchable PDF
    setAppState(AppState.COMPILING);
    setProgress(0);
    try {
      const searchableBlob = await generateImagePDF(files, (p) => setProgress(p), true);
      downloadBlob(searchableBlob, '_Searchable');
      setAppState(AppState.IDLE);
    } catch (err) {
      alert("Searchable PDF compilation failed.");
      setAppState(AppState.IDLE);
    }
  };

  const clearAll = () => {
    if (confirm("Clear all pages?")) {
      files.forEach(f => URL.revokeObjectURL(f.previewUrl));
      setFiles([]);
      setAppState(AppState.IDLE);
    }
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] flex flex-col font-sans">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40 px-6 py-4 flex items-center justify-between shadow-sm backdrop-blur-md bg-white/80">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-100 ring-2 ring-indigo-50">
            <i className="fas fa-bolt text-lg"></i>
          </div>
          <div className="hidden sm:block">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">FastPDF</h1>
            <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest">Instant Image-to-PDF</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4 flex-1 justify-end">
          {files.length > 0 && appState === AppState.IDLE && (
            <>
              <div className="relative hidden md:flex items-center">
                <i className="fas fa-edit absolute left-3 text-slate-300 text-xs"></i>
                <input 
                  type="text" 
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                  placeholder="Document Name"
                  className="pl-8 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all w-48 lg:w-64"
                />
                <span className="ml-1 text-slate-400 font-bold text-xs">.pdf</span>
              </div>
              <button onClick={clearAll} className="text-slate-400 hover:text-rose-500 font-bold text-xs uppercase px-2">Clear</button>
              <button 
                onClick={startAIOCR}
                className="bg-indigo-50 hover:bg-indigo-100 text-indigo-600 px-6 py-2.5 rounded-xl font-bold text-sm shadow-sm active:scale-95 flex items-center gap-2 border border-indigo-200"
              >
                <i className="fas fa-magic"></i>
                Create with OCR
              </button>
              <button 
                onClick={compileFastPDF}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-xl font-bold text-sm shadow-xl shadow-indigo-100 active:scale-95 flex items-center gap-2"
              >
                <i className="fas fa-file-pdf"></i>
                Create Fast PDF ({files.length})
              </button>
            </>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 flex-grow w-full">
        {/* State Banners */}
        {appState === AppState.DONE_WAITING_OCR && (
          <div className="mb-8 bg-emerald-50 border border-emerald-100 p-8 rounded-3xl shadow-xl shadow-emerald-50/50 flex flex-col md:flex-row items-center justify-between gap-6 animate-in slide-in-from-bottom-4">
            <div>
              <h3 className="text-xl font-black text-emerald-900 mb-2">Fast PDF Ready! ⚡️</h3>
              <p className="text-emerald-700 font-medium">Your document is downloaded. Want to make it searchable with AI OCR?</p>
            </div>
            <div className="flex gap-3">
              <button 
                onClick={() => setAppState(AppState.IDLE)}
                className="px-6 py-3 rounded-xl bg-white text-emerald-700 font-bold border border-emerald-200 hover:bg-emerald-100 transition-all"
              >
                No Thanks, Done
              </button>
              <button 
                onClick={startAIOCR}
                className="px-8 py-3 rounded-xl bg-indigo-600 text-white font-black shadow-lg shadow-indigo-200 hover:bg-indigo-700 active:scale-95 transition-all flex items-center gap-2"
              >
                <i className="fas fa-magic"></i>
                Start Optional OCR
              </button>
            </div>
          </div>
        )}

        {(appState === AppState.COMPILING || appState === AppState.OCR_PROCESSING) && (
          <div className="mb-8 bg-white p-8 rounded-2xl border border-indigo-100 shadow-xl shadow-indigo-50/50">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-indigo-600 animate-ping"></div>
                <span className="text-sm font-bold text-slate-800 uppercase tracking-wider">
                  {appState === AppState.OCR_PROCESSING ? 'AI Reading Document...' : 'Compiling PDF...'}
                </span>
              </div>
              <span className="text-lg font-black text-indigo-600">{Math.round(progress)}%</span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-4 overflow-hidden p-1">
              <div className="bg-indigo-600 h-full transition-all duration-500 rounded-full shadow-inner" style={{ width: `${progress}%` }}></div>
            </div>
          </div>
        )}

        {files.length === 0 ? (
          <div className="flex flex-col items-center justify-center min-h-[70vh] text-center max-w-xl mx-auto">
            <div className="w-24 h-24 bg-white shadow-2xl shadow-indigo-50 text-indigo-500 rounded-[2rem] flex items-center justify-center mb-10 transform -rotate-3">
              <i className="fas fa-layer-group text-4xl"></i>
            </div>
            <h2 className="text-4xl font-black text-slate-900 mb-4 tracking-tight">Rapid Document Creation</h2>
            <p className="text-slate-500 mb-12 text-lg font-medium">Paste images directly or upload files. Fast local conversion first.</p>
            
            <div className="w-full space-y-6">
              <label className="group relative bg-white border-2 border-dashed border-slate-200 hover:border-indigo-400 p-12 rounded-[2.5rem] cursor-pointer transition-all hover:bg-indigo-50/30 w-full shadow-sm hover:shadow-xl flex flex-col items-center">
                <input type="file" multiple accept="image/*" className="hidden" onChange={handleFileChange} ref={fileInputRef} />
                <div className="flex flex-col items-center gap-6">
                  <div className="w-20 h-20 bg-indigo-600 text-white rounded-full flex items-center justify-center shadow-2xl shadow-indigo-200 group-hover:scale-110 transition-all duration-300">
                    <i className="fas fa-plus text-2xl"></i>
                  </div>
                  <div>
                    <span className="text-xl font-bold text-slate-800 block mb-1">Select Screenshots</span>
                    <span className="text-sm text-slate-400 font-medium uppercase tracking-widest">Supports PNG, JPG, JPEG</span>
                  </div>
                </div>
              </label>

              <div className="relative">
                <div className="absolute inset-0 flex items-center" aria-hidden="true">
                  <div className="w-full border-t border-slate-200"></div>
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-4 bg-[#f8fafc] text-slate-400 font-bold uppercase tracking-widest text-[10px]">Or Paste Here</span>
                </div>
              </div>

              <textarea
                placeholder="Click here and press Ctrl+V to paste a screenshot..."
                className="w-full h-32 p-6 bg-white border-2 border-slate-200 rounded-[2rem] text-sm font-medium text-slate-600 focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all resize-none shadow-sm text-center flex items-center justify-center"
                onPaste={(e) => {
                  const items = e.clipboardData?.items;
                  if (!items) return;
                  const pastedFiles: File[] = [];
                  for (let i = 0; i < items.length; i++) {
                    if (items[i].type.indexOf('image') !== -1) {
                      const blob = items[i].getAsFile();
                      if (blob) {
                        const file = new File([blob], `pasted-image-${Date.now()}-${i}.png`, { type: blob.type });
                        pastedFiles.push(file);
                      }
                    }
                  }
                  if (pastedFiles.length > 0) {
                    addFiles(pastedFiles);
                    (e.target as HTMLTextAreaElement).value = '';
                  }
                }}
              />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6 animate-in fade-in">
            {files.map((file, index) => (
              <div key={file.id} className="group relative aspect-[3/4] bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-2xl transition-all hover:-translate-y-1">
                <img src={file.previewUrl} alt={`Page ${index + 1}`} className="w-full h-full object-cover" />
                <div className="absolute top-3 left-3 flex items-center gap-2">
                  <div className="bg-slate-900/80 backdrop-blur-md text-white text-[10px] font-black px-2.5 py-1 rounded-lg shadow-xl">{index + 1}</div>
                  {file.status === 'OCR_Done' && <div className="bg-emerald-500 text-white text-[9px] font-black px-2 py-1 rounded-lg shadow-lg">OCR OK</div>}
                  {file.status === 'OCR_Processing' && <div className="bg-indigo-500 text-white text-[9px] font-black px-2 py-1 rounded-lg shadow-lg animate-pulse">READING...</div>}
                </div>
                {appState === AppState.IDLE && (
                  <button onClick={() => removeFile(file.id)} className="absolute top-3 right-3 w-8 h-8 bg-white text-slate-400 hover:bg-rose-500 hover:text-white rounded-xl opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center shadow-xl">
                    <i className="fas fa-times text-xs"></i>
                  </button>
                )}
              </div>
            ))}
            {appState === AppState.IDLE && (
              <div className="flex flex-col gap-4">
                <label className="aspect-[3/4] border-4 border-dashed border-slate-200 rounded-2xl flex flex-col items-center justify-center gap-4 cursor-pointer hover:border-indigo-400 hover:bg-white transition-all text-slate-300 hover:text-indigo-600 bg-slate-50/50">
                  <input type="file" multiple accept="image/*" className="hidden" onChange={handleFileChange} />
                  <div className="w-14 h-14 bg-white rounded-2xl shadow-sm flex items-center justify-center group-hover:scale-110 transition-all">
                    <i className="fas fa-plus text-xl"></i>
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-tighter">Add More</span>
                </label>
                
                <textarea
                  placeholder="Paste..."
                  className="aspect-[3/4] p-4 bg-white border-2 border-slate-200 rounded-2xl text-[10px] font-bold text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all resize-none shadow-sm text-center flex items-center justify-center uppercase tracking-widest"
                  onPaste={(e) => {
                    const items = e.clipboardData?.items;
                    if (!items) return;
                    const pastedFiles: File[] = [];
                    for (let i = 0; i < items.length; i++) {
                      if (items[i].type.indexOf('image') !== -1) {
                        const blob = items[i].getAsFile();
                        if (blob) {
                          const file = new File([blob], `pasted-image-${Date.now()}-${i}.png`, { type: blob.type });
                          pastedFiles.push(file);
                        }
                      }
                    }
                    if (pastedFiles.length > 0) {
                      addFiles(pastedFiles);
                      (e.target as HTMLTextAreaElement).value = '';
                    }
                  }}
                />
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="p-8 text-center border-t border-slate-100 mt-auto bg-white">
        <p className="text-[10px] text-slate-300 font-bold uppercase tracking-[0.2em]">Optimized for Speed & Optional AI Enhancement</p>
      </footer>
    </div>
  );
}
