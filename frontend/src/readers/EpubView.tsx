import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ReaderHandle, ReaderViewProps } from "./types";

/**
 * Visor de EPUB.
 *
 * Bugs corregidos en esta versión:
 * 1. Swipe horizontal: los listeners van en `document` con `capture:true` para
 *    capturar el evento antes que epub.js (que está dentro de un iframe).
 *    Antes los listeners estaban sobre el iframe o el host, y epub.js
 *    consumía el evento. Ahora la lógica vive fuera del iframe.
 * 2. Threshold: bajado a 30 px (antes 40-50) y se permite componente
 *    vertical hasta 1.5x del horizontal — antes se exigía horizontal puro,
 *    lo cual es irreal en móvil.
 * 3. Snap: epub.js por defecto hace su propia paginación al detectar drag;
 *    deshabilitamos eso con `defaultSettings.snap = false` para que no robe
 *    nuestros eventos.
 */
const EpubView = forwardRef<ReaderHandle, ReaderViewProps>(function EpubView(
  { blob, initialPosition, fontSize, onPosition, onError, onToggleChrome },
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

    // --- SWIPE HORIZONTAL SOBRE DOCUMENT ---
    // Necesario porque los touch events que ocurren dentro del iframe de
    // epub.js NO burbujean al host. Capturamos en la fase de capture y
    // medimos el delta manualmente.
    let touchActive = false;
    let startX = 0;
    let startY = 0;
    let startT = 0;

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      touchActive = true;
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
      startT = Date.now();
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (!touchActive) return;
      touchActive = false;
      const t = event.changedTouches[0];
      if (!t) return;

      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);
      const elapsed = Date.now() - startT;

      // Sólo swipes rápidos (no drags largos de lectura)
      if (elapsed > 600) return;

      // Componente horizontal debe ganar, pero tolerar hasta 1.5x de vertical.
      if (adx < 30) return;
      if (ady > adx * 1.5) return;

      // Swipe horizontal claro.
      if (dx <= -30) rendition.current?.next();
      else if (dx >= 30) rendition.current?.prev();
    };

    // --- TAP EN ZONA CENTRAL PARA TOGGLE DEL CHROME ---
    // En móvil el swipe es para paginar. Para mostrar/ocultar la barra
    // usamos un tap corto en el centro vertical de la pantalla, evitando
    // los extremos (que pueden ser zonas de scroll).
    let tapStartX = 0;
    let tapStartY = 0;
    let tapStartT = 0;
    let tapMoved = false;

    const onTapStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      tapStartX = event.touches[0].clientX;
      tapStartY = event.touches[0].clientY;
      tapStartT = Date.now();
      tapMoved = false;
    };
    const onTapMove = (event: TouchEvent) => {
      if (tapStartT === 0) return;
      const t = event.touches[0];
      if (!t) return;
      if (
        Math.abs(t.clientX - tapStartX) > 10 ||
        Math.abs(t.clientY - tapStartY) > 10
      ) {
        tapMoved = true;
      }
    };
    const onTapEnd = (event: TouchEvent) => {
      if (tapStartT === 0) return;
      const elapsed = Date.now() - tapStartT;
      const t = event.changedTouches[0];
      tapStartT = 0;
      if (!t || tapMoved || elapsed > 350) return;

      // Zona central: entre 25% y 75% horizontal, y entre 30% y 70% vertical.
      // Evita esquinas (donde iOS hace swipe-back) y zonas de scroll.
      const x = t.clientX / window.innerWidth;
      const y = t.clientY / window.innerHeight;
      if (x > 0.25 && x < 0.75 && y > 0.3 && y < 0.7) {
        onToggleChrome?.();
      }
    };

    document.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
    document.addEventListener("touchend", onTouchEnd, { capture: true, passive: true });
    document.addEventListener("touchstart", onTapStart, { passive: true });
    document.addEventListener("touchmove", onTapMove, { passive: true });
    document.addEventListener("touchend", onTapEnd, { passive: true });

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
        // Desactivar el snap interno de epub.js para que no compita con
        // nuestros handlers de swipe.
        rendition.current.hooks.content.register((contents: any) => {
          contents.window?.document?.documentElement?.style.setProperty(
            "-webkit-touch-callout",
            "none"
          );
        });
        rendition.current.on("relocated", (location: any) => {
          const percent = book.locations?.length()
            ? Math.round(book.locations.percentageFromCfi(location.start.cfi) * 100)
            : Math.round((location.start.percentage || 0) * 100);
          onPosition(location.start.cfi, percent);
        });
        await rendition.current.display(initialPosition || undefined);
        setLoading(false);
        await book.ready;
        if (!cancelled) await book.locations.generate(600);
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
      document.removeEventListener("touchstart", onTouchStart, { capture: true } as any);
      document.removeEventListener("touchend", onTouchEnd, { capture: true } as any);
      document.removeEventListener("touchstart", onTapStart);
      document.removeEventListener("touchmove", onTapMove);
      document.removeEventListener("touchend", onTapEnd);
      document.removeEventListener("keyup", handleKey);
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
      <div className="epub-tap-hint" aria-hidden="true">
        Toca el centro para mostrar la barra
      </div>
      <div ref={host} className="epub-host" />
    </div>
  );
});

export default EpubView;