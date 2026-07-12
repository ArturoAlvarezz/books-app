import { ChangeEvent, CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import Dialog from "./Dialog";
import CoverImage from "./CoverImage";
import {
  api,
  apiJson,
  Book,
  offlineBookIds,
  reextractCover,
  removeOffline,
  saveOffline,
  uploadBook,
} from "../api";
import { formatBytes } from "../lib";

const READ_LABELS: Record<Book["read_state"], string> = {
  unread: "Sin empezar",
  reading: "Leyendo",
  finished: "Terminado",
};

const READING_MILESTONES = [
  { count: 1, label: "Primera aventura", icon: "✦" },
  { count: 5, label: "Explorador", icon: "◈" },
  { count: 10, label: "Lector voraz", icon: "✺" },
  { count: 25, label: "Coleccionista", icon: "♛" },
  { count: 50, label: "Leyenda", icon: "✹" },
];

function nextReadingMilestone(completed: number) {
  return (
    READING_MILESTONES.find((milestone) => milestone.count > completed) ?? {
      count: Math.ceil((completed + 1) / 25) * 25,
      label: "Leyenda de la biblioteca",
      icon: "✹",
    }
  );
}

type Filter = "all" | "reading" | "finished" | "favorite";

function coverStyle(title: string): CSSProperties {
  const hue = [...title].reduce((total, char) => (total * 31 + char.charCodeAt(0)) % 360, 0);
  return { "--cover-hue": String(hue) } as CSSProperties;
}

export default function Library({
  onRead,
  onLogout,
}: {
  onRead: (book: Book) => void;
  onLogout: () => void;
}) {
  const [books, setBooks] = useState<Book[]>([]);
  const [catalogBooks, setCatalogBooks] = useState<Book[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [format, setFormat] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [busyOffline, setBusyOffline] = useState<number | null>(null);
  const [busyCover, setBusyCover] = useState<number | null>(null);
  const [offlineIds, setOfflineIds] = useState<Set<number>>(new Set());
  const [online, setOnline] = useState(navigator.onLine);
  const [pendingDelete, setPendingDelete] = useState<Book | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // Bumped when the user re-focuses / re-connects so we can refetch outside the
  // debounced query effect.
  const [refreshTick, setRefreshTick] = useState(0);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (query) params.set("query", query);
    if (format) params.set("format", format);
    if (filter === "reading" || filter === "finished") params.set("read", filter);
    if (filter === "favorite") params.set("favorite", "true");
    try {
      const path = `/api/books?${params}`;
      const listedBooks = api<Book[]>(path);
      // Las estadísticas siempre se calculan sobre la biblioteca completa,
      // aunque la grilla esté filtrada por título, formato o estado.
      const fullCatalog = query || format || filter !== "all" ? api<Book[]>("/api/books") : listedBooks;
      const [nextBooks, nextCatalog] = await Promise.all([listedBooks, fullCatalog]);
      setBooks(nextBooks);
      setCatalogBooks(nextCatalog);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar la biblioteca");
    }
  }, [query, format, filter]);

  useEffect(() => {
    const timer = window.setTimeout(load, query ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [load, query]);

  // Auto-refresh cuando el usuario vuelve a la pestaña o recupera conexión.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        setRefreshTick((tick) => tick + 1);
        offlineBookIds().then(setOfflineIds).catch(() => {});
      }
    };
    const onOnline = () => {
      setOnline(true);
      setRefreshTick((tick) => tick + 1);
    };
    const onOffline = () => setOnline(false);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    // refreshTick fuerza un refetch cuando cambia.
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick]);

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3500);
  };

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadProgress(0);
    setError("");
    try {
      const book = await uploadBook(file, (loaded, total) => {
        setUploadProgress(Math.round((loaded / total) * 100));
      });
      flash(`«${book.title}» añadido a tu biblioteca`);
      // Refresca inmediatamente, sin esperar al debounce.
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo subir el libro");
    } finally {
      setUploading(false);
      setUploadProgress(0);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const toggleFavorite = async (book: Book) => {
    try {
      await apiJson(`/api/books/${book.id}`, "PUT", { favorite: !book.favorite });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar");
    }
  };

  const remove = async () => {
    const book = pendingDelete;
    if (!book) return;
    setPendingDelete(null);
    try {
      await api(`/api/books/${book.id}`, { method: "DELETE" });
      await removeOffline(book.id).catch(() => {});
      flash(`«${book.title}» eliminado`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar");
    }
  };

  const toggleOffline = async (book: Book) => {
    setBusyOffline(book.id);
    try {
      if (offlineIds.has(book.id)) {
        await removeOffline(book.id);
        flash(`«${book.title}» ya no está disponible sin conexión`);
      } else {
        await saveOffline(book.id);
        flash(`«${book.title}» disponible sin conexión`);
      }
      setOfflineIds(await offlineBookIds());
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo descargar");
    } finally {
      setBusyOffline(null);
    }
  };

  const reextract = async (book: Book) => {
    setBusyCover(book.id);
    try {
      const updated = await reextractCover(book.id);
      flash(`Portada de «${updated.title}» extraída`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo re-extraer la portada");
    } finally {
      setBusyCover(null);
    }
  };

  const completedBooks = catalogBooks.filter((book) => book.read_state === "finished").length;
  const readingBooks = catalogBooks.filter((book) => book.read_state === "reading").length;
  const nextGoal = nextReadingMilestone(completedBooks);
  const displayedMilestones =
    nextGoal.count > READING_MILESTONES.at(-1)!.count ? [...READING_MILESTONES, nextGoal] : READING_MILESTONES;
  const booksRemaining = Math.max(0, nextGoal.count - completedBooks);
  const goalProgress = Math.min(100, (completedBooks / nextGoal.count) * 100);

  return (
    <main>
      <header className="topbar">
        <h1>Mis Libros</h1>
        <span className={online ? "status online" : "status offline"}>
          {online ? "● En línea" : "● Sin conexión"}
        </span>
        <button onClick={onLogout}>Salir</button>
      </header>

      <section className="reading-quest" aria-labelledby="reading-quest-title">
        <div className="quest-orb" aria-hidden="true">✦</div>
        <div className="quest-summary">
          <p className="quest-kicker">Tu viaje lector</p>
          <h2 id="reading-quest-title">
            <strong>{completedBooks}</strong> {completedBooks === 1 ? "libro terminado" : "libros terminados"}
          </h2>
          <p>
            {completedBooks === 0
              ? "Toda gran biblioteca empieza con una primera aventura."
              : readingBooks > 0
                ? `${readingBooks} ${readingBooks === 1 ? "historia te espera" : "historias te esperan"} ahora.`
                : "Cada libro terminado merece una nueva aventura."}
          </p>
        </div>

        <div className="quest-goal">
          <div className="goal-heading">
            <span>Próxima meta</span>
            <strong>{nextGoal.icon} {nextGoal.label}</strong>
          </div>
          <div
            className="goal-track"
            role="progressbar"
            aria-label={`Progreso hacia ${nextGoal.label}`}
            aria-valuemin={0}
            aria-valuemax={nextGoal.count}
            aria-valuenow={completedBooks}
          >
            <span className="goal-fill" style={{ width: `${goalProgress}%` }} />
          </div>
          <p>
            {booksRemaining === 1
              ? "Te falta 1 libro para desbloquearla"
              : `Te faltan ${booksRemaining} libros para desbloquearla`}
          </p>
        </div>

        <div className="milestones" aria-label="Metas de lectura">
          {displayedMilestones.map((milestone) => {
            const unlocked = completedBooks >= milestone.count;
            const current = milestone.count === nextGoal.count;
            return (
              <div
                className={`milestone ${unlocked ? "unlocked" : ""} ${current ? "current" : ""}`}
                key={milestone.count}
              >
                <span aria-hidden="true">{milestone.icon}</span>
                <strong>{milestone.count}</strong>
                <small>{milestone.label}</small>
              </div>
            );
          })}
        </div>
      </section>

      <section className="actions">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar por título o autor"
          aria-label="Buscar"
        />
        <select value={format} onChange={(event) => setFormat(event.target.value)} aria-label="Formato">
          <option value="">Todos los formatos</option>
          <option value="EPUB">EPUB</option>
          <option value="PDF">PDF</option>
          <option value="CBZ">CBZ</option>
          <option value="TXT">TXT</option>
        </select>
        <button
          type="button"
          className={uploading ? "upload busy" : "upload"}
          onClick={() => fileInput.current?.click()}
          disabled={uploading}
          aria-busy={uploading}
        >
          {uploading ? `Subiendo… ${uploadProgress}%` : "+ Subir libro"}
        </button>
        <input
          ref={fileInput}
          className="visually-hidden"
          type="file"
          accept=".epub,.pdf,.cbz,.txt"
          onChange={upload}
          disabled={uploading}
          aria-label="Seleccionar libro para subir"
        />
      </section>

      {uploading && (
        <div
          className="upload-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={uploadProgress}
          aria-label="Progreso de subida"
        >
          <div className="upload-progress-bar" style={{ width: `${uploadProgress}%` }} />
        </div>
      )}

      <nav className="filters" aria-label="Filtros">
        {(
          [
            ["all", "Todos"],
            ["reading", "Leyendo"],
            ["finished", "Terminados"],
            ["favorite", "★ Favoritos"],
          ] as [Filter, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            className={filter === value ? "chip active" : "chip"}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </nav>

      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}

      <section className="grid">
        {books.map((book, index) => (
          <article
            className="card"
            key={book.id}
            style={{ "--card-index": String(Math.min(index, 10)) } as CSSProperties}
          >
            <button
              className="cover"
              style={coverStyle(book.title)}
              onClick={() => onRead(book)}
              aria-label={`Leer ${book.title}`}
            >
              {book.has_cover ? <CoverImage bookId={book.id} /> : null}
              <span className="cover-format">{book.format}</span>
              <span className="cover-title">{book.title}</span>
              <span className="cover-spine" aria-hidden="true" />
              {book.favorite && <span className="fav-badge">★</span>}
              {offlineIds.has(book.id) && <span className="offline-badge">✓ offline</span>}
            </button>
            <h2 title={book.title}>{book.title}</h2>
            <p className="authors">{book.authors || "Autor desconocido"}</p>
            <small>
              {formatBytes(book.size_bytes)} · {READ_LABELS[book.read_state]}
              {book.progress.percent > 0 && ` · ${book.progress.percent}%`}
            </small>
            <progress
              value={book.progress.percent}
              max="100"
              aria-label={`Progreso de lectura de ${book.title}: ${book.progress.percent}%`}
            />
            <div className="card-actions">
              <button className="primary" onClick={() => onRead(book)}>
                {book.progress.percent > 0 && book.read_state !== "finished" ? "Continuar" : "Leer"}
              </button>
              {book.format === "EPUB" && !book.has_cover && (
                <button
                  className="icon-btn"
                  onClick={() => reextract(book)}
                  disabled={busyCover === book.id}
                  aria-label="Re-extraer portada"
                  title="Re-extraer portada"
                >
                  {busyCover === book.id ? "…" : "🖼"}
                </button>
              )}
              <button
                className="icon-btn"
                onClick={() => toggleOffline(book)}
                disabled={busyOffline === book.id}
                aria-label={
                  offlineIds.has(book.id)
                    ? "Quitar descarga"
                    : "Descargar para leer sin conexión"
                }
                title={offlineIds.has(book.id) ? "Quitar descarga" : "Descargar para leer sin conexión"}
              >
                {busyOffline === book.id ? "…" : offlineIds.has(book.id) ? "✓" : "↓"}
              </button>
              <button
                className="icon-btn"
                onClick={() => toggleFavorite(book)}
                aria-label={book.favorite ? "Quitar de favoritos" : "Añadir a favoritos"}
                title="Favorito"
              >
                {book.favorite ? "★" : "☆"}
              </button>
              <button
                className="icon-btn danger"
                onClick={() => setPendingDelete(book)}
                aria-label={`Eliminar ${book.title}`}
                title="Eliminar"
              >
                ✕
              </button>
            </div>
          </article>
        ))}
      </section>

      {!books.length && !error && (
        <p className="empty">
          {query || format || filter !== "all"
            ? "Ningún libro coincide con los filtros."
            : "Tu biblioteca está vacía. Sube un EPUB, PDF, CBZ o TXT para empezar."}
        </p>
      )}
      {pendingDelete && (
        <Dialog
          title="Eliminar libro"
          confirmLabel="Eliminar definitivamente"
          danger
          onConfirm={remove}
          onClose={() => setPendingDelete(null)}
        >
          <p>¿Eliminar «{pendingDelete.title}» de la biblioteca y de las descargas offline?</p>
        </Dialog>
      )}
    </main>
  );
}