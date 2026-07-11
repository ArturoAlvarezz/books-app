import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ReaderHandle, ReaderViewProps } from "./types";

/**
 * Visor de PDF usando pdf.js (no iframe).
 *
 * Bugs corregidos en esta versión:
 * 1. Antes usábamos `<iframe src={blob_url}>`. En iOS Safari y varios
 *    navegadores móviles, los blobs PDF dentro de iframes se renderizan
 *    fuera del sandbox, mostrando un botón "Abrir" del visor nativo en
 *    lugar del PDF inline. En Android Chrome el iframe puede quedar en
 *    blanco si el sandbox no permite application/pdf.
 * 2. Ahora usamos pdf.js (Mozilla) para renderizar página por página en
 *    un `<canvas>`. Da control total del swipe, zoom y scroll, y funciona
 *    en todos los navegadores móviles.
 *
 * Limitaciones conocidas:
 * - No trackeamos progreso (trackable = false en Reader.tsx); el scrubber
 *   no aparece para PDFs. Si lo necesitás, podemos guardar `page` en el
 *   backend más adelante.
 */
const PdfView = forwardRef<ReaderHandle, ReaderViewProps>(function PdfView(
  { blob, onError, onToggleChrome },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<any>(null);
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

  // Cargar PDF.js y renderizar la primera página.
  useEffect(() => {
    let cancelled = false;
    let renderTask: any = null;

    (async () => {
      try {
        const pdfjsLib = await import("pdfjs-dist");
        // El worker de pdf.js viene como archivo .mjs separado. Lo servimos
        // desde el mismo directorio de assets de Vite (lo importa el propio
        // paquete). Si en el futuro falla el worker, podemos pasar `false`
        // para que corra en el hilo principal.
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url
        ).toString();

        const buffer = await blob.arrayBuffer();
        if (cancelled) return;
        const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
        if (cancelled) {
          doc.destroy();
          return;
        }
        docRef.current = doc;
        setPageCount(doc.numPages);
        await renderPage(1, doc, renderTaskRef => {
          renderTask = renderTaskRef;
        });
        if (!cancelled) {
          pageNumRef.current = 1;
          setCurrentPage(1);
          setLoading(false);
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setErrorMsg("No se pudo abrir el PDF. El archivo podría estar dañado.");
          onError?.("No se pudo abrir el PDF.");
        }
      }
    })();

    return () => {
      cancelled = true;
      if (renderTask) renderTask.cancel();
      docRef.current?.destroy();
      docRef.current = null;
    };
  }, [blob]);

  // Re-render cuando cambia el tamaño del contenedor (rotación, resize).
  useEffect(() => {
    const onResize = () => {
      if (docRef.current) {
        renderPage(pageNumRef.current, docRef.current, () => {});
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Swipe horizontal sobre el contenedor para paginar.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let startX = 0;
    let startY = 0;
    let startT = 0;
    let active = false;
    let moved = false;

    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
      startT = Date.now();
      active = true;
      moved = false;
    };
    const onMove = (event: TouchEvent) => {
      if (!active) return;
      const t = event.touches[0];
      if (!t) return;
      if (
        Math.abs(t.clientX - startX) > 10 ||
        Math.abs(t.clientY - startY) > 10
      ) {
        moved = true;
      }
    };
    const onEnd = (event: TouchEvent) => {
      if (!active) return;
      active = false;
      const t = event.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);
      const elapsed = Date.now() - startT;

      // Tap centro = toggle chrome
      if (!moved && elapsed < 350) {
        const x = t.clientX / window.innerWidth;
        const y = t.clientY / window.innerHeight;
        if (x > 0.25 && x < 0.75 && y > 0.3 && y < 0.7) {
          onToggleChrome?.();
        }
        return;
      }

      // Swipe horizontal
      if (elapsed > 600) return;
      if (adx < 30) return;
      if (ady > adx * 1.5) return;
      if (dx <= -30) goToPage(pageNumRef.current + 1);
      else if (dx >= 30) goToPage(pageNumRef.current - 1);
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: true });
    el.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
    };
  }, [onToggleChrome]);

  async function renderPage(
    page: number,
    doc: any,
    setTask: (task: any) => void
  ): Promise<void> {
    if (!canvasRef.current || !containerRef.current) return;
    if (page < 1 || page > doc.numPages) return;
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
    canvas.width = viewport.width * dpr;
    canvas.height = viewport.height * dpr;
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;

    const task = pdfPage.render({
      canvasContext: ctx,
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
    });
    setTask(task);
    await task.promise;
  }

  function goToPage(page: number): void {
    if (!docRef.current) return;
    const next = Math.max(1, Math.min(docRef.current.numPages, page));
    if (next === pageNumRef.current) return;
    pageNumRef.current = next;
    setCurrentPage(next);
    void renderPage(next, docRef.current, () => {});
  }

  if (errorMsg) return <p className="error" role="alert">{errorMsg}</p>;
  if (loading) return <p className="loading">Abriendo PDF…</p>;

  return (
    <div ref={containerRef} className="pdf-canvas-wrap">
      <canvas ref={canvasRef} className="pdf-canvas" />
      <div className="pdf-page-indicator" aria-live="polite">
        Página {currentPage} de {pageCount}
      </div>
      <div className="pdf-tap-hint" aria-hidden="true">
        Desliza ← → para cambiar página
      </div>
    </div>
  );
});

export default PdfView;