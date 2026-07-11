import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ReaderHandle, ReaderViewProps } from "./types";

const EpubView = forwardRef<ReaderHandle, ReaderViewProps>(function EpubView(
  { blob, initialPosition, fontSize, onPosition, onError },
  ref
) {
  const host = useRef<HTMLDivElement>(null);
  const rendition = useRef<any>(null);
  const [loading, setLoading] = useState(true);

  useImperativeHandle(ref, () => ({
    goTo: (position: string) => rendition.current?.display(position),
  }));

  useEffect(() => {
    let book: any = null;
    let cancelled = false;

    const load = async () => {
      try {
        const ePub = (await import("epubjs")).default;
        // epub.js no acepta Blob directamente: hay que darle un ArrayBuffer.
        const buffer = await blob.arrayBuffer();
        if (cancelled || !host.current) return;
        book = ePub(buffer);
        rendition.current = book.renderTo(host.current, {
          width: "100%",
          height: "100%",
          flow: "paginated",
          spread: "auto",
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
      <button className="page-nav prev" aria-label="Página anterior" onClick={() => rendition.current?.prev()}>
        ‹
      </button>
      <div ref={host} className="epub-host" />
      <button className="page-nav next" aria-label="Página siguiente" onClick={() => rendition.current?.next()}>
        ›
      </button>
    </div>
  );
});

export default EpubView;
