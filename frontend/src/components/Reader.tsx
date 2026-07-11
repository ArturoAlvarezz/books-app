import { useEffect, useRef, useState } from "react";
import { api, apiJson, Book, Bookmark, fetchBookFile, saveProgress } from "../api";
import CbzView from "../readers/CbzView";
import EpubView from "../readers/EpubView";
import PdfView from "../readers/PdfView";
import TxtView from "../readers/TxtView";
import { ReaderHandle } from "../readers/types";

const VIEWS = { EPUB: EpubView, PDF: PdfView, CBZ: CbzView, TXT: TxtView };
const SAVE_INTERVAL_MS = 3000;

export default function Reader({ book, onBack }: { book: Book; onBack: () => void }) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState("");
  const [percent, setPercent] = useState(book.progress.percent);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [showMarks, setShowMarks] = useState(false);
  const [fontSize, setFontSize] = useState(() => Number(localStorage.getItem("fontSize")) || 18);

  const view = useRef<ReaderHandle>(null);
  const position = useRef(book.progress.position);
  const pending = useRef(false);
  const saveTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    fetchBookFile(book.id)
      .then(setBlob)
      .catch((err) => setError(err.message));
    api<Bookmark[]>(`/api/books/${book.id}/bookmarks`)
      .then(setBookmarks)
      .catch(() => setBookmarks([]));
  }, [book.id]);

  // Guarda el progreso como máximo cada pocos segundos y al salir.
  const percentRef = useRef(percent);
  percentRef.current = percent;
  useEffect(() => {
    saveTimer.current = window.setInterval(() => {
      if (!pending.current) return;
      pending.current = false;
      saveProgress(book.id, { position: position.current, percent: percentRef.current }).catch(() => {
        pending.current = true;
      });
    }, SAVE_INTERVAL_MS);
    return () => {
      window.clearInterval(saveTimer.current);
      if (pending.current) {
        saveProgress(book.id, { position: position.current, percent: percentRef.current }).catch(() => {});
      }
    };
  }, [book.id]);

  const handlePosition = (newPosition: string, newPercent: number) => {
    position.current = newPosition;
    setPercent(newPercent);
    pending.current = true;
  };

  const changeFontSize = (delta: number) => {
    const size = Math.min(28, Math.max(14, fontSize + delta));
    setFontSize(size);
    localStorage.setItem("fontSize", String(size));
  };

  const addBookmark = async () => {
    const label = window.prompt("Nombre del marcador:", `${percent}%`);
    if (label === null) return;
    try {
      const mark = await apiJson<Bookmark>(`/api/books/${book.id}/bookmarks`, "POST", {
        position: position.current,
        label: label || `${percent}%`,
      });
      setBookmarks((prev) => [...prev, mark]);
      setShowMarks(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el marcador");
    }
  };

  const removeBookmark = async (id: number) => {
    try {
      await api(`/api/books/${book.id}/bookmarks/${id}`, { method: "DELETE" });
      setBookmarks((prev) => prev.filter((mark) => mark.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo borrar el marcador");
    }
  };

  const View = VIEWS[book.format];
  const trackable = book.format !== "PDF";

  return (
    <main className="reader">
      <header className="reader-bar">
        <button onClick={onBack} aria-label="Volver a la biblioteca">← Biblioteca</button>
        <h1 title={book.title}>{book.title}</h1>
        <div className="reader-tools">
          {trackable && <span className="percent">{percent}%</span>}
          {(book.format === "EPUB" || book.format === "TXT") && (
            <>
              <button onClick={() => changeFontSize(-2)} aria-label="Reducir letra">A−</button>
              <button onClick={() => changeFontSize(2)} aria-label="Agrandar letra">A+</button>
            </>
          )}
          {trackable && (
            <>
              <button onClick={addBookmark}>+ Marcador</button>
              <button onClick={() => setShowMarks((v) => !v)} aria-expanded={showMarks}>
                Marcadores ({bookmarks.length})
              </button>
            </>
          )}
        </div>
      </header>

      {showMarks && (
        <aside className="bookmarks" aria-label="Marcadores del libro">
          {bookmarks.length === 0 && <p>No hay marcadores todavía.</p>}
          {bookmarks.map((mark) => (
            <span key={mark.id} className="bookmark-chip">
              <button onClick={() => view.current?.goTo(mark.position)}>{mark.label}</button>
              <button aria-label={`Borrar marcador ${mark.label}`} onClick={() => removeBookmark(mark.id)}>
                ×
              </button>
            </span>
          ))}
        </aside>
      )}

      {error && <p className="error" role="alert">{error}</p>}
      {!blob && !error && <p className="loading" role="status" aria-live="polite">Descargando libro…</p>}
      {blob && (
        <div className="reading">
          <View
            ref={view}
            blob={blob}
            initialPosition={book.progress.position}
            fontSize={fontSize}
            onPosition={handlePosition}
            onError={setError}
          />
        </div>
      )}
    </main>
  );
}
