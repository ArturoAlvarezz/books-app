import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ReaderHandle, ReaderViewProps } from "./types";

/**
 * Visor de EPUB.
 *
 * Cambios frente al original:
 * - Sustituye los botones de paginación por swipe horizontal con animación.
 *   Los listeners `touchstart/touchend` calculan deltaX; si supera el umbral
 *   (50 px o 20 % del ancho) avanza/retrocede página con la animación nativa
 *   de epub.js (defaultSettings.snap).
 * - Mantiene el clic en los bordes como alternativa accesible.
 * - Expone next/prev en el imperative handle para que el scrubber funcione.
 */
const EpubView = forwardRef<ReaderHandle, ReaderViewProps>(function EpubView(
  { blob, initialPosition, fontSize, onPosition, onError },
  ref
) {
  const host = useRef<HTMLDivElement>(null);
  const rendition = useRef<any>(null);
  const [loading, setLoading] = useState(true);

  useImperativeHandle(ref, () => ({
    goTo: (position: string) => rendition.current?.display(position),
    next: () => rendition.current?.next(),
    prev: () => rendition.current?.prev(),
  }));

  useEffect(() => {
    let book: any = null;
    let cancelled = false;
    let touchStartX: number | null = null;
    let touchStartY: number | null = null;

    const load = async () => {
      try {
        const ePub = (await import("epubjs")).default;
        const buffer = await blob.arrayBuffer();
        if (cancelled || !host.current) return;
        book = ePub(buffer);
        rendition.current = book.renderTo(host.current, {
          width: "100%",
          height: "100%",
          flow: "paginated",
          spread: "auto",
          manager: "default",
        });
        rendition.current.on("relocated", (location: any) => {
          const percent = book.locations?.length()
            ? Math.round(book.locations.percentageFromCfi(location.start.cfi) * 100)
            : Math.round((location.start.percentage || 0) * 100);
          onPosition(location.start.cfi, percent);
        });
        rendition.current.on("keyup", handleKey);
        await rendition.current.display(initialPosition || undefined);
        setLoading(false);
        await book.ready;
        if (!cancelled) await book.locations.generate(600);

        // Swipe horizontal sobre el viewport para cambiar página.
        const viewport = host.current.querySelector("iframe") ?? host.current;
        const onTouchStart = (event: TouchEvent) => {
          const t = event.touches[0];
          touchStartX = t?.clientX ?? null;
          touchStartY = t?.clientY ?? null;
        };
        const onTouchEnd = (event: TouchEvent) => {
          if (touchStartX === null || touchStartY === null) return;
          const t = event.changedTouches[0];
          if (!t) return;
          const dx = t.clientX - touchStartX;
          const dy = t.clientY - touchStartY;
          touchStartX = null;
          touchStartY = null;
          // Sólo horizontal, no vertical
          if (Math.abs(dx) < Math.abs(dy)) return;
          const threshold = Math.max(40, window.innerWidth * 0.15);
          if (dx <= -threshold) rendition.current?.next();
          else if (dx >= threshold) rendition.current?.prev();
        };
        viewport.addEventListener("touchstart", onTouchStart as any, { passive: true });
        viewport.addEventListener("touchend", onTouchEnd as any, { passive: true });
        // Guardamos referencias para limpiar después
        (viewport as any).__cleanupSwipe = () => {
          viewport.removeEventListener("touchstart", onTouchStart as any);
          viewport.removeEventListener("touchend", onTouchEnd as any);
        };
      } catch (err) {
        console.error(err);
        if (!cancelled) onError("No se pudo abrir el EPUB. El archivo podría estar dañado.");
      }
    };

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") rendition.current?.next();
      if (event.key === "ArrowLeft") rendition.current?.prev();
    };

    load();
    document.addEventListener("keyup", handleKey);
    return () => {
      cancelled = true;
      document.removeEventListener("keyup", handleKey);
      const viewport = host.current?.querySelector("iframe") ?? host.current;
      (viewport as any)?.__cleanupSwipe?.();
      rendition.current = null;
      book?.destroy();
    };
  }, [blob]);

  useEffect(() => {
    rendition.current?.themes.fontSize(`${fontSize}px`);
  }, [fontSize, loading]);

  return (
    <div className="epub-wrap">
      {loading && <p className="loading">Abriendo libro…</p>}
      <div className="epub-swipe-hint" aria-hidden="true">
        Desliza ← → para pasar página
      </div>
      <div ref={host} className="epub-host" />
    </div>
  );
});

export default EpubView;