import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { ReaderHandle, ReaderViewProps } from "./types";

/** Usa el visor de PDF del navegador; el progreso interno no es rastreable. */
const PdfView = forwardRef<ReaderHandle, ReaderViewProps>(function PdfView({ blob }, ref) {
  const [url, setUrl] = useState("");

  useImperativeHandle(ref, () => ({
    goTo: () => undefined,
    next: () => undefined,
    prev: () => undefined,
  }));

  useEffect(() => {
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);

  if (!url) return <p className="loading">Abriendo PDF…</p>;
  return <iframe title="PDF" src={url} className="pdf-host" />;
});

export default PdfView;
