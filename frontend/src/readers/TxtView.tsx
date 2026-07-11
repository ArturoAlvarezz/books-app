import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ReaderHandle, ReaderViewProps } from "./types";

/** La posición de un TXT es la fracción de desplazamiento (0–1) como texto. */
const TxtView = forwardRef<ReaderHandle, ReaderViewProps>(function TxtView(
  { blob, initialPosition, fontSize, onPosition, onError },
  ref
) {
  const host = useRef<HTMLDivElement>(null);
  const [text, setText] = useState<string | null>(null);

  const scrollToFraction = (fraction: number) => {
    const el = host.current;
    if (!el) return;
    el.scrollTop = fraction * (el.scrollHeight - el.clientHeight);
  };

  useImperativeHandle(ref, () => ({
    goTo: (position: string) => scrollToFraction(Number(position) || 0),
  }));

  useEffect(() => {
    let cancelled = false;
    blob
      .text()
      .then((content) => {
        if (!cancelled) setText(content);
      })
      .catch(() => onError("No se pudo leer el archivo de texto"));
    return () => {
      cancelled = true;
    };
  }, [blob]);

  useEffect(() => {
    if (text !== null) scrollToFraction(Number(initialPosition) || 0);
  }, [text]);

  const handleScroll = () => {
    const el = host.current;
    if (!el) return;
    const scrollable = el.scrollHeight - el.clientHeight;
    const fraction = scrollable > 0 ? el.scrollTop / scrollable : 1;
    onPosition(fraction.toFixed(4), Math.round(fraction * 100));
  };

  if (text === null) return <p className="loading">Abriendo libro…</p>;
  return (
    <div ref={host} className="txt-host" onScroll={handleScroll}>
      <article style={{ fontSize: `${fontSize}px` }}>{text}</article>
    </div>
  );
});

export default TxtView;
