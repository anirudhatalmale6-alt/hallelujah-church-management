import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerCode from 'pdfjs-dist/build/pdf.worker.min.mjs?raw';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Printer } from 'lucide-react';

// The worker is started from a blob instead of a URL on the server: LiteSpeed
// serves .mjs files as plain text, which browsers refuse to run as a module.
const workerBlob = new Blob([pdfWorkerCode], { type: 'text/javascript' });
pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(workerBlob);

/**
 * Reads a PDF inside the system. Pages are drawn onto a canvas by pdf.js
 * instead of relying on the browser's built-in PDF plugin, which phones and
 * tablets don't have - so the document opens the same way everywhere.
 */
export default function PdfReader({ url, printUrl }) {
  const canvasRef = useRef(null);
  const docRef = useRef(null);
  const renderTaskRef = useRef(null);
  const containerRef = useRef(null);

  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPage(1);

    const task = pdfjsLib.getDocument({ url, withCredentials: false });
    task.promise.then(doc => {
      if (cancelled) { doc.destroy(); return; }
      docRef.current = doc;
      setNumPages(doc.numPages);
      setLoading(false);
    }).catch(err => {
      if (!cancelled) {
        setError(err?.message || 'This PDF could not be opened.');
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      if (renderTaskRef.current) { try { renderTaskRef.current.cancel(); } catch {} }
      if (docRef.current) { try { docRef.current.destroy(); } catch {} docRef.current = null; }
    };
  }, [url]);

  const renderPage = useCallback(async () => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas) return;

    try {
      const pdfPage = await doc.getPage(page);
      const containerWidth = (containerRef.current?.clientWidth || 800) - 24;
      const base = pdfPage.getViewport({ scale: 1 });
      const fitScale = containerWidth / base.width;
      const viewport = pdfPage.getViewport({ scale: fitScale * zoom });

      // Draw at device resolution so text stays sharp on retina screens.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;

      const ctx = canvas.getContext('2d');

      if (renderTaskRef.current) { try { renderTaskRef.current.cancel(); } catch {} }
      renderTaskRef.current = pdfPage.render({
        canvasContext: ctx,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
      });
      await renderTaskRef.current.promise;
    } catch (err) {
      if (err?.name !== 'RenderingCancelledException') {
        setError(err?.message || 'This page could not be displayed.');
      }
    }
  }, [page, zoom]);

  useEffect(() => { if (!loading && !error) renderPage(); }, [loading, error, renderPage]);

  useEffect(() => {
    const onResize = () => { if (!loading && !error) renderPage(); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [loading, error, renderPage]);

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-700" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-center p-8 gap-2">
        <div className="text-gray-700 font-medium">Sorry, this PDF couldn't be opened here.</div>
        <div className="text-sm text-gray-500">{error}</div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex items-center justify-center gap-2 py-2 px-3 bg-white border-b border-gray-200 flex-wrap">
        <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
          className="p-1.5 rounded text-gray-600 hover:bg-gray-100 disabled:opacity-30" title="Previous page">
          <ChevronLeft size={18} />
        </button>
        <span className="text-sm text-gray-600 whitespace-nowrap">
          Page {page} of {numPages}
        </span>
        <button onClick={() => setPage(p => Math.min(numPages, p + 1))} disabled={page >= numPages}
          className="p-1.5 rounded text-gray-600 hover:bg-gray-100 disabled:opacity-30" title="Next page">
          <ChevronRight size={18} />
        </button>

        <span className="w-px h-5 bg-gray-200 mx-1" />

        <button onClick={() => setZoom(z => Math.max(0.5, +(z - 0.25).toFixed(2)))}
          className="p-1.5 rounded text-gray-600 hover:bg-gray-100" title="Zoom out">
          <ZoomOut size={17} />
        </button>
        <span className="text-xs text-gray-500 w-12 text-center">{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom(z => Math.min(3, +(z + 0.25).toFixed(2)))}
          className="p-1.5 rounded text-gray-600 hover:bg-gray-100" title="Zoom in">
          <ZoomIn size={17} />
        </button>

        {printUrl && (
          <>
            <span className="w-px h-5 bg-gray-200 mx-1" />
            <button onClick={() => window.open(printUrl, '_blank')}
              className="p-1.5 rounded text-gray-600 hover:bg-gray-100 flex items-center gap-1 text-sm" title="Open in a new tab to print">
              <Printer size={16} /> <span className="hidden sm:inline">Print</span>
            </button>
          </>
        )}
      </div>

      <div ref={containerRef} className="flex-1 overflow-auto bg-gray-200 p-3 flex justify-center items-start">
        <canvas ref={canvasRef} className="shadow-lg bg-white max-w-full" />
      </div>
    </div>
  );
}
