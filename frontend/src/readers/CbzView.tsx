import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { comparePages } from "../lib";
import { ReaderHandle, ReaderViewProps } from "./types";

/** La posición de un CBZ es el índice (base 0) de la página visible. */
const CbzView = forwardRef<ReaderHandle, ReaderViewProps>(function CbzView(
  { blob, initialPosition, onPosition, onError },
  ref
) {
  const host = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<string[]>([]);
  const [current, setCurrent] = useState(0);

  const goToPage = (index: number) => {
    host.current?.children[index]?.scrollIntoView({ block: "start" });
  };

  const next = () => goToPage(Math.min(pages.length - 1, current + 1));
  const prev = () => goToPage(Math.max(0, current - 1));

  useImperativeHandle(ref, () => ({
    goTo: (position: string) => goToPage(Number(position) || 0),
    next,
    prev,
  }));

  useEffect(() => {
    let cancelled = false;
    let urls: string[] = [];

    const load = async () => {
      try {
        const JSZip = (await import("jszip")).default;
        const zip = await JSZip.loadAsync(blob);
        const names = Object.keys(zip.files)
          .filter((name) => /\.(jpe?g|png|webp|gif)$/i.test(name) && !zip.files[name].dir)
          .sort(comparePages);
        if (!names.length) throw new Error("CBZ sin imágenes");
        const blobs = await Promise.all(names.map((name) => zip.file(name)!.async("blob")));
        if (cancelled) return;
        urls = blobs.map((page) => URL.createObjectURL(page));
        setPages(urls);
      } catch (err) {
        console.error(err);
        if (!cancelled) onError("No se pudo abrir el cómic. El archivo podría estar dañado.");
      }
    };

    load();
    return () => {
      cancelled = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [blob]);

  useEffect(() => {
    if (pages.length) {
      const start = Math.min(Number(initialPosition) || 0, pages.length - 1);
      if (start > 0) goToPage(start);
    }
  }, [pages.length]);

  const handleScroll = () => {
    const el = host.current;
    if (!el || !pages.length) return;
    const middle = el.scrollTop + el.clientHeight / 2;
    let index = 0;
    for (let i = 0; i < el.children.length; i++) {
      const child = el.children[i] as HTMLElement;
      if (child.offsetTop <= middle) index = i;
    }
    setCurrent(index);
    onPosition(String(index), Math.round(((index + 1) / pages.length) * 100));
  };

  if (!pages.length) return <p className="loading">Abriendo cómic…</p>;
  return (
    <>
      <div ref={host} className="cbz-host" onScroll={handleScroll}>
        {pages.map((url, index) => (
          <img key={url} src={url} alt={`Página ${index + 1}`} loading="lazy" className="comic-page" />
        ))}
      </div>
      <p className="page-indicator">
        Página {current + 1} de {pages.length}
      </p>
    </>
  );
});

export default CbzView;
