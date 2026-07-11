import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import { api, apiJson, Book, offlineBookIds, removeOffline, saveOffline } from "../api";
import { formatBytes } from "../lib";

const READ_LABELS: Record<Book["read_state"], string> = {
  unread: "Sin empezar",
  reading: "Leyendo",
  finished: "Terminado",
};

type Filter = "all" | "reading" | "finished" | "favorite";

export default function Library({
  onRead,
  onLogout,
}: {
  onRead: (book: Book) => void;
  onLogout: () => void;
}) {
  const [books, setBooks] = useState<Book[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [format, setFormat] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [uploading, setUploading] = useState(false);
  const [busyOffline, setBusyOffline] = useState<number | null>(null);
  const [offlineIds, setOfflineIds] = useState<Set<number>>(new Set());
  const [online, setOnline] = useState(navigator.onLine);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (query) params.set("query", query);
    if (format) params.set("format", format);
    if (filter === "reading" || filter === "finished") params.set("read", filter);
    if (filter === "favorite") params.set("favorite", "true");
    try {
      setBooks(await api<Book[]>(`/api/books?${params}`));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar la biblioteca");
    }
  }, [query, format, filter]);

  useEffect(() => {
    const timer = window.setTimeout(load, query ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [load, query]);

  useEffect(() => {
    offlineBookIds().then(setOfflineIds).catch(() => {});
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3500);
  };

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError("");
    const body = new FormData();
    body.append("file", file);
    try {
      const book = await api<Book>("/api/books", { method: "POST", body });
      flash(`«${book.title}» añadido a tu biblioteca`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo subir el libro");
    } finally {
      setUploading(false);
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

  const remove = async (book: Book) => {
    if (!window.confirm(`¿Eliminar «${book.title}» definitivamente?`)) return;
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

  return (
    <main>
      <header className="topbar">
        <h1>📚 Mis Libros</h1>
        <span className={online ? "status online" : "status offline"}>
          {online ? "● En línea" : "● Sin conexión"}
        </span>
        <button onClick={onLogout}>Salir</button>
      </header>

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
        <label className={uploading ? "upload busy" : "upload"}>
          {uploading ? "Subiendo…" : "+ Subir libro"}
          <input
            ref={fileInput}
            type="file"
            accept=".epub,.pdf,.cbz,.txt"
            onChange={upload}
            disabled={uploading}
          />
        </label>
      </section>

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
        {books.map((book) => (
          <article className="card" key={book.id}>
            <button className="cover" onClick={() => onRead(book)} aria-label={`Leer ${book.title}`}>
              <span className="format-badge">{book.format}</span>
              {book.favorite && <span className="fav-badge">★</span>}
              {offlineIds.has(book.id) && <span className="offline-badge">✓ offline</span>}
            </button>
            <h2 title={book.title}>{book.title}</h2>
            <p className="authors">{book.authors || "Autor desconocido"}</p>
            <small>
              {formatBytes(book.size_bytes)} · {READ_LABELS[book.read_state]}
              {book.progress.percent > 0 && ` · ${book.progress.percent}%`}
            </small>
            <progress value={book.progress.percent} max="100" />
            <div className="card-actions">
              <button className="primary" onClick={() => onRead(book)}>
                {book.progress.percent > 0 && book.read_state !== "finished" ? "Continuar" : "Leer"}
              </button>
              <button
                onClick={() => toggleOffline(book)}
                disabled={busyOffline === book.id}
                aria-label={offlineIds.has(book.id) ? "Quitar descarga" : "Descargar para leer sin conexión"}
                title={offlineIds.has(book.id) ? "Quitar descarga" : "Descargar para leer sin conexión"}
              >
                {busyOffline === book.id ? "…" : offlineIds.has(book.id) ? "✓" : "↓"}
              </button>
              <button
                onClick={() => toggleFavorite(book)}
                aria-label={book.favorite ? "Quitar de favoritos" : "Añadir a favoritos"}
                title="Favorito"
              >
                {book.favorite ? "★" : "☆"}
              </button>
              <button onClick={() => remove(book)} aria-label={`Eliminar ${book.title}`} title="Eliminar">
                🗑
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
    </main>
  );
}
