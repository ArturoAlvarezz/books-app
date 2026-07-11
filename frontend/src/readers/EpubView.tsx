import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ReaderHandle, ReaderViewProps } from "./types";

/**
 * Visor de EPUB.
 *
 * Fixes aplicados en esta reescritura:
 * 1. epub.js mete `style="height: 450px"` en `.epub-wrap` al inicializarse,
 *    ANTES de que el contenedor flex tenga su tamaño real. Eso causaba el
 *    espacio blanco debajo de la página. Ahora observamos el árbol de
 *    epub.js y forzamos `height:100%` en cada `style` que epub.js aplique.
 * 2. Los swipe handlers anteriores vivían en `document` con capture, lo que
 *    hacía que AMBOS (los nuestros y los internos de epub.js) dispararan.
 *    Ahora viven sobre el host con `stopPropagation()` para que epub.js
 *    no vea los gestos.
 * 3. Threshold bajado a 24px para responder mejor en pantallas pequeñas.
 * 4. Tap centro: lo maneja Reader.tsx directamente (no acá).
 */
const EpubView = forwardRef<ReaderHandle, ReaderViewProps>(function EpubView(
  { blob, initialPosition, fontSize, onPosition, onError },
  ref
) {
  const host = useRef<HTMLDivElement>(null);
  const rendition = useRef<any>(null);
  const bookRef = useRef<any>(null);
  const [loading, setLoading] = useState(true);

  useImperativeHandle(ref, () => ({
    goTo: (position: string) => rendition.current?.display(position),
    next: () => rendition.current?.next(),
    prev: () => rendition.current?.prev(),
  }));

  useEffect(() => {
    let cancelled = false;
    const hostEl = host.current;
    if (!hostEl) return;

    // ---- MutationObserver: mata el height inline que epub.js pone ----
    // epub.js crea un contenedor con style="height: 450px" en el momento
    // del display, congelando el tamaño. Lo sobrescribimos con !important.
    const enforceSize = () => {
      if (!host.current) return;
      // Fuerza 100% en cualquier nodo que epub.js haya creado.
      const c = host.current.querySelector(".epub-container");
      const v = host.current.querySelector(".epub-view");
      const f = host.current.querySelector("iframe");
      for (const el of [c, v, f] as HTMLElement[]) {
        if (!el) continue;
        el.style.setProperty("height", "100%", "important");
        el.style.setProperty("width", "100%", "important");
      }
    };
    const mo = new MutationObserver(() => enforceSize());
    mo.observe(hostEl, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class"],
    });

    // ---- Swipe horizontal SOBRE EL HOST (no document) ----
    // Usamos pointer events para evitar conflictos con mouse/touch. epub.js
    // no debería verlos porque paramos la propagación. Pero como el iframe
    // es contexto aislado, igualmente medimos manualmente.
    let px = 0;
    let py = 0;
    let pt = 0;
    let moved = false;

    const SWIPE_THRESHOLD = 24; // px
    const TAP_MAX = 250; // ms
    const TAP_MAX_MOVE = 10; // px

    let tx = 0;
    let ty = 0;
    let tt = 0;

    const onPointerDown = (e: PointerEvent) => {
      if (!e.isPrimary) return;
      px = e.clientX;
      py = e.clientY;
      pt = Date.now();
      moved = false;
      tx = e.clientX;
      ty = e.clientY;
      tt = Date.now();
    };
    const onPointerMove = (e: PointerEvent) => {
      if (pt === 0) return;
      const dx = e.clientX - px;
      const dy = e.clientY - py;
      if (Math.abs(dx) > TAP_MAX_MOVE || Math.abs(dy) > TAP_MAX_MOVE) {
        moved = true;
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      if (pt === 0) return;
      const elapsed = Date.now() - pt;
      const dx = e.clientX - px;
      const dy = e.clientY - py;
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);
      pt = 0;

      // Swipe horizontal
      if (!moved && elapsed < TAP_MAX) return; // fue un tap, lo maneja Reader
      if (elapsed > 800) return; // drag largo, no swipe
      if (adx < SWIPE_THRESHOLD) return;
      if (ady > adx * 1.6) return; // demasiado vertical

      e.stopPropagation();
      if (dx < -SWIPE_THRESHOLD) rendition.current?.next();
      else if (dx > SWIPE_THRESHOLD) rendition.current?.prev();
    };

    hostEl.addEventListener("pointerdown", onPointerDown);
    hostEl.addEventListener("pointermove", onPointerMove);
    hostEl.addEventListener("pointerup", onPointerUp);
    hostEl.addEventListener("pointercancel", () => (pt = 0));

    const load = async () => {
      try {
        const ePub = (await import("epubjs")).default;
        const buffer = await blob.arrayBuffer();
        if (cancelled || !hostEl) return;
        const book = ePub(buffer);
        bookRef.current = book;
        const r = book.renderTo(hostEl, {
          width: "100%",
          height: "100%",
          flow: "paginated",
          spread: "auto",
          manager: "default",
          snap: false,
        });
        rendition.current = r;
        r.hooks.content.register((contents: any) => {
          contents.window?.document?.documentElement?.style.setProperty(
            "-webkit-touch-callout",
            "none"
          );
          // Evita scroll bounce dentro del iframe
          contents.window?.document?.body?.style.setProperty(
            "overscroll-behavior",
            "none"
          );
        });
        r.on("relocated", (location: any) => {
          const percent = book.locations?.length()
            ? Math.round(
                book.locations.percentageFromCfi(location.start.cfi) * 100
              )
            : Math.round((location.start.percentage || 0) * 100);
          onPosition(location.start.cfi, percent);
        });
        await r.display(initialPosition || undefined);
        if (cancelled) return;
        // Forzar tamaño correcto inmediatamente después del display.
        enforceSize();
        setLoading(false);
        await book.ready;
        if (cancelled) return;
        await book.locations.generate(600);
        enforceSize();
      } catch (err) {
        console.error(err);
        if (!cancelled) onError("No se pudo abrir el EPUB. El archivo podría estar dañado.");
      }
    };

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") rendition.current?.next();
      if (event.key === "ArrowLeft") rendition.current?.prev();
    };
    document.addEventListener("keyup", handleKey);

    load();

    // ResizeObserver: cuando cambia el viewport (rotación, resize),
    // forzamos re-render del libro.
    const ro = new ResizeObserver(() => {
      enforceSize();
      try {
        rendition.current?.resize?.();
      } catch {}
    });
    ro.observe(hostEl);

    return () => {
      cancelled = true;
      mo.disconnect();
      ro.disconnect();
      hostEl.removeEventListener("pointerdown", onPointerDown);
      hostEl.removeEventListener("pointermove", onPointerMove);
      hostEl.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("keyup", handleKey);
      try {
        bookRef.current?.destroy();
      } catch {}
      bookRef.current = null;
      rendition.current = null;
    };
  }, [blob]);

  useEffect(() => {
    rendition.current?.themes.fontSize(`${fontSize}px`);
  }, [fontSize, loading]);

  return (
    <div className="epub-wrap">
      {loading && <p className="loading">Abriendo libro…</p>}
      <div ref={host} className="epub-host" />
    </div>
  );
});

export default EpubView;