import { useCallback, useEffect, useRef, useState } from "react";
import { api, apiJson, Book, Bookmark, fetchBookFile, saveProgress } from "../api";
import CbzView from "../readers/CbzView";
import EpubView from "../readers/EpubView";
import PdfView from "../readers/PdfView";
import TxtView from "../readers/TxtView";
import { ReaderHandle } from "../readers/types";

const VIEWS = { EPUB: EpubView, PDF: PdfView, CBZ: CbzView, TXT: TxtView };
const SAVE_INTERVAL_MS = 3000;
const MIN_FONT = 10;
const MAX_FONT = 36;

export default function Reader({ book, onBack }: { book: Book; onBack: () => void }) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState("");
  const [percent, setPercent] = useState(book.progress.percent);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [showMarks, setShowMarks] = useState(false);
  const [fontSize, setFontSize] = useState(() => {
    const stored = Number(localStorage.getItem("fontSize"));
    return stored >= MIN_FONT && stored <= MAX_FONT ? stored : 18;
  });
  const [chromeVisible, setChromeVisible] = useState(true);

  const view = useRef<ReaderHandle>(null);
  const position = useRef(book.progress.position);
  const pending = useRef(false);
  const saveTimer = useRef<number | undefined>(undefined);
  const chromeTimer = useRef<number | undefined>(undefined);
  const scrollY = useRef(0);

  useEffect(() => {
    fetchBookFile(book.id).then(setBlob).catch((err) => setError(err.message));
    api<Bookmark[]>(`/api/books/${book.id}/bookmarks`).then(setBookmarks).catch(() => setBookmarks([]));
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

  // Auto-hide de la barra inferior al detectar gesto de scroll hacia abajo;
  // reaparece con scroll hacia arriba.
  useEffect(() => {
    const onScroll = () => {
      const current = window.scrollY;
      const delta = current - scrollY.current;
      if (Math.abs(delta) < 4) return; // ignorar micro-movimientos
      if (delta < 0) {
        setChromeVisible(true);
      } else if (delta > 0 && chromeVisible) {
        setChromeVisible(false);
      }
      scrollY.current = current;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [chromeVisible]);

  // En móvil no hay scroll global (epubjs es un viewport), así que usamos
  // tap en el centro de la pantalla (manejado por cada visor, no aquí).
  // El listener de swipe-up anterior competía con epub.js y nunca disparaba
  // cuando el usuario tocaba dentro del iframe del EPUB. Por eso lo
  // eliminamos: ahora los visores (EpubView, PdfView) son responsables de
  // pedirnos toggle del chrome mediante `onToggleChrome`.

  // En desktop también queremos que la barra se auto-oculte después de un
  // tiempo sin actividad.
  useEffect(() => {
    if (!chromeVisible) return;
    window.clearTimeout(chromeTimer.current);
    chromeTimer.current = window.setTimeout(() => setChromeVisible(false), 4000);
    return () => window.clearTimeout(chromeTimer.current);
  }, [chromeVisible, percent]);

  const handlePosition = (newPosition: string, newPercent: number) => {
    position.current = newPosition;
    setPercent(newPercent);
    pending.current = true;
    // epub.js emite `relocated` también después de `rendition.resize()`.
    // No alterar el chrome aquí: ocultar la barra cambia el alto del lector,
    // dispara ese resize y, si la mostramos de nuevo, crea un bucle visual.
  };

  const changeFontSize = (delta: number) => {
    const size = Math.min(MAX_FONT, Math.max(MIN_FONT, fontSize + delta));
    setFontSize(size);
    localStorage.setItem("fontSize", String(size));
  };

  const jumpToPercent = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(100, next));
      // El visor EpubView expone goTo() con CFI; aquí sólo pedimos por
      // porcentaje porque no tenemos un mapa CFI↔page desde fuera.
      // Para EPUB/TXT intentamos avanzar/retroceder páginas de forma
      // proporcional al delta (heurística: 200 saltos por libro).
      const handle = view.current;
      if (!handle) return;
      const delta = clamped - percent;
      const steps = Math.max(-200, Math.min(200, Math.round(delta * 2)));
      if (steps > 0) for (let i = 0; i < steps; i++) handle.next();
      else if (steps < 0) for (let i = 0; i < -steps; i++) handle.prev();
      // Actualizamos visualmente aunque el visor no haya confirmado aún;
      // el callback onPosition ajustará al real.
      setPercent(clamped);
      pending.current = true;
    },
    [percent]
  );

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

  /**
   * Tap centro = toggle del chrome (mostrar/ocultar la barra inferior).
   *
   * Lo manejamos acá, no en cada visor, para que sea uniforme entre EPUB,
   * PDF, TXT y CBZ. Se activa con `onPointerUp` sobre `.reading`, pero sólo
   * si no hubo swipe (los visores ya consumieron el swipe con stopPropagation,
   * así que cuando este handler corre es porque NO fue swipe).
   */
  const tapStartRef = useRef<{ x: number; y: number; t: number; el: Element } | null>(null);
  const handleReadingPointerDown = (event: React.PointerEvent) => {
    if (!event.isPrimary) return;
    tapStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      t: Date.now(),
      el: event.currentTarget,
    };
  };
  const handleReadingTap = (event: React.PointerEvent) => {
    const start = tapStartRef.current;
    tapStartRef.current = null;
    if (!start) return;
    if (Date.now() - start.t > 350) return; // demasiado largo = no tap
    const dx = Math.abs(event.clientX - start.x);
    const dy = Math.abs(event.clientY - start.y);
    if (dx > 12 || dy > 12) return; // se movió = fue swipe, lo manejó el visor
    // Zona central: 25-75% horizontal, 25-75% vertical.
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    if (x > 0.25 && x < 0.75 && y > 0.25 && y < 0.75) {
      setChromeVisible((v) => !v);
    }
  };

  const View = VIEWS[book.format];
  const trackable = book.format !== "PDF";

  return (
    <main className={`reader ${chromeVisible ? "chrome-visible" : "chrome-hidden"}`}>
      <header className="reader-bar reader-bar-top">
        <button onClick={onBack} aria-label="Volver a la biblioteca">← Biblioteca</button>
        <h1 title={book.title}>{book.title}</h1>
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
        <div className="reading" onPointerDown={handleReadingPointerDown} onPointerUp={handleReadingTap}>
          <View
            ref={view}
            blob={blob}
            initialPosition={book.progress.position}
            fontSize={fontSize}
            onPosition={handlePosition}
            onError={setError}
          />
          <nav className="reader-page-controls" aria-label="Cambiar de página">
            <button
              type="button"
              className="reader-page-button reader-page-button-prev"
              onPointerDown={(event) => event.stopPropagation()}
              onPointerUp={(event) => event.stopPropagation()}
              onClick={() => view.current?.prev()}
              aria-label="Página anterior"
            >
              ‹
            </button>
            <button
              type="button"
              className="reader-page-button reader-page-button-next"
              onPointerDown={(event) => event.stopPropagation()}
              onPointerUp={(event) => event.stopPropagation()}
              onClick={() => view.current?.next()}
              aria-label="Página siguiente"
            >
              ›
            </button>
          </nav>
        </div>
      )}

      <footer className="reader-bar reader-bar-bottom" aria-hidden={!chromeVisible}>
        {trackable && (
          <div className="scrubber">
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(percent)}
              onChange={(event) => jumpToPercent(Number(event.target.value))}
              aria-label="Posición de lectura"
              aria-valuetext={`${Math.round(percent)} por ciento`}
            />
          </div>
        )}
        <div className="reader-tools">
          {trackable && <span className="percent">{Math.round(percent)}%</span>}
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
      </footer>
    </main>
  );
}