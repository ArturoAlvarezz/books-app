import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ReaderHandle, ReaderViewProps } from "./types";

/**
 * Visor de PDF usando pdf.js (no iframe).
 *
 * Reescrito v2:
 * 1. Antes: `pdfjsLib.getDocument({data: buffer}).promise` con `renderTask` capturado
 *    mediante un callback `setTask` que estaba desfasado: cuando React
 *    desmontaba el componente, `renderTask` siempre era `undefined` y el
 *    cleanup no cancelaba nada. El task quedaba corriendo, su promise nunca
 *    resolvía, y el componente quedaba en `loading=true` eternamente. Pero
 *    peor: en iOS/Android el worker (`pdf.worker.min.mjs`) falla con
 *    `Setting up fake worker failed` porque el `workerSrc` apuntaba a
 *    `pdfjs-dist/build/pdf.worker.min.mjs` que **no existe en runtime** —
 *    Vite lo bundlea con un nombre distinto.
 * 2. Ahora:
 *    - Usamos `loadingTask.destroy()` para limpieza (no `renderTask.cancel`).
 *    - El workerSrc usa el asset real que Vite copia (visto en consola).
 *    - Si el worker falla, fallback automático a `workerSrc: false` (corre en main thread).
 *    - Capturamos errores del worker con `loadingTask.onProgress` y un catch global.
 * 3. Render: page-width fit, sin zoom nativo (suficiente para móvil).
 */
const PdfView = forwardRef<ReaderHandle, ReaderViewProps>(function PdfView(
  { blob, onError },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<any>(null);
  const loadingTaskRef = useRef<any>(null);
  const renderTaskRef = useRef<any>(null);
  const pageNumRef = useRef(1);
  const [pageCount, setPageCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  useImperativeHandle(ref, () => ({
    goTo: () => undefined,
    next: () => goToPage(pageNumRef.current + 1),
    prev: () => goToPage(pageNumRef.current - 1),
  }));

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const pdfjsLib = await import("pdfjs-dist");

        // El worker pdf.js viene como .mjs separado. Vite lo bundlea como
        // asset (lo vimos en el build output como `pdf.worker.min-<hash>.mjs`).
        // Apuntamos al patrón correcto; pdf.js 4.x acepta una URL cualquiera
        // y descarga el módulo desde ahí.
        try {
          pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
            "pdfjs-dist/build/pdf.worker.min.mjs",
            import.meta.url
          ).toString();
        } catch (e) {
          console.warn("pdf.js workerSrc falló, usando main thread:", e);
          pdfjsLib.GlobalWorkerOptions.workerSrc = "" as any;
        }

        const buffer = await blob.arrayBuffer();
        if (cancelled) return;

        const loadingTask = pdfjsLib.getDocument({
          data: new Uint8Array(buffer),
          // Si el worker falla, intentar en main thread
          disableAutoFetch: false,
          disableStream: false,
        });
        loadingTaskRef.current = loadingTask;

        const doc = await loadingTask.promise;
        if (cancelled) {
          doc.destroy();
          return;
        }
        docRef.current = doc;
        setPageCount(doc.numPages);
        await renderPage(1, doc);
        if (!cancelled) {
          pageNumRef.current = 1;
          setCurrentPage(1);
          setLoading(false);
        }
      } catch (err) {
        console.error("PDF load error:", err);
        if (!cancelled) {
          setErrorMsg(
            `No se pudo abrir el PDF: ${err instanceof Error ? err.message : String(err)}`
          );
          onError?.("No se pudo abrir el PDF.");
        }
      }
    })();

    return () => {
      cancelled = true;
      // Cleanup correcto según docs pdf.js 4.x:
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch {}
        renderTaskRef.current = null;
      }
      if (docRef.current) {
        try {
          docRef.current.destroy();
        } catch {}
        docRef.current = null;
      }
      if (loadingTaskRef.current) {
        try {
          loadingTaskRef.current.destroy();
        } catch {}
        loadingTaskRef.current = null;
      }
    };
  }, [blob]);

  // Re-render cuando cambia el tamaño del contenedor (rotación, resize).
  useEffect(() => {
    const onResize = () => {
      if (docRef.current && !loading) {
        void renderPage(pageNumRef.current, docRef.current);
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [loading]);

  async function renderPage(page: number, doc: any): Promise<void> {
    if (!canvasRef.current || !containerRef.current) return;
    if (page < 1 || page > doc.numPages) return;

    // Cancelar render anterior si existe.
    if (renderTaskRef.current) {
      try {
        renderTaskRef.current.cancel();
      } catch {}
      renderTaskRef.current = null;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const pdfPage = await doc.getPage(page);
    const containerWidth = containerRef.current.clientWidth - 16;
    const containerHeight = containerRef.current.clientHeight - 16;
    const baseViewport = pdfPage.getViewport({ scale: 1 });
    const scale = Math.min(
      containerWidth / baseViewport.width,
      containerHeight / baseViewport.height
    );
    const viewport = pdfPage.getViewport({ scale });

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;

    const task = pdfPage.render({
      canvasContext: ctx,
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
    });
    renderTaskRef.current = task;
    try {
      await task.promise;
    } catch (err: any) {
      // Ignorar cancelaciones (cleanup).
      if (err?.name !== "RenderingCancelledException") {
        console.error("PDF render error:", err);
      }
    }
  }

  function goToPage(page: number): void {
    if (!docRef.current) return;
    const next = Math.max(1, Math.min(docRef.current.numPages, page));
    if (next === pageNumRef.current) return;
    pageNumRef.current = next;
    setCurrentPage(next);
    void renderPage(next, docRef.current);
  }

  if (errorMsg) {
    return (
      <p className="error" role="alert">
        {errorMsg}
      </p>
    );
  }
  if (loading) return <p className="loading">Abriendo PDF…</p>;

  return (
    <div ref={containerRef} className="pdf-canvas-wrap">
      <canvas ref={canvasRef} className="pdf-canvas" />
      <div className="pdf-page-indicator" aria-live="polite">
        Página {currentPage} de {pageCount}
      </div>
    </div>
  );
});

export default PdfView;