export type Progress = { position: string; percent: number };

export type Book = {
  id: number;
  title: string;
  authors: string;
  description: string;
  tags: string[];
  format: "EPUB" | "PDF" | "CBZ" | "TXT";
  filename: string;
  size_bytes: number;
  read_state: "unread" | "reading" | "finished";
  favorite: boolean;
  created_at: string;
  progress: Progress;
};

export type Bookmark = { id: number; position: string; label: string };

export class SessionExpiredError extends Error {
  constructor() {
    super("Tu sesión expiró. Inicia sesión de nuevo.");
  }
}

let onSessionExpired: (() => void) | null = null;

export function setSessionExpiredHandler(handler: () => void) {
  onSessionExpired = handler;
}

export function getToken(): string {
  return localStorage.getItem("token") || "";
}

export function setToken(token: string) {
  if (token) localStorage.setItem("token", token);
  else localStorage.removeItem("token");
}

async function errorDetail(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body.detail === "string") return body.detail;
  } catch {
    /* cuerpo no JSON */
  }
  return `Error ${response.status}`;
}

export async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { Authorization: `Bearer ${getToken()}`, ...options.headers },
  });
  if (response.status === 401) {
    setToken("");
    onSessionExpired?.();
    throw new SessionExpiredError();
  }
  if (!response.ok) throw new Error(await errorDetail(response));
  return response.status === 204 ? (null as T) : response.json();
}

export function apiJson<T = unknown>(path: string, method: string, body: unknown): Promise<T> {
  return api<T>(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function login(username: string, password: string): Promise<string> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) throw new Error(await errorDetail(response));
  const data = await response.json();
  setToken(data.access_token);
  return data.username;
}

export function saveProgress(bookId: number, progress: Progress): Promise<Progress> {
  return apiJson<Progress>(`/api/books/${bookId}/progress`, "POST", progress);
}

/** Descarga el archivo del libro, usando la copia offline si existe. */
export async function fetchBookFile(bookId: number): Promise<Blob> {
  const offline = await offlineBook(bookId);
  const response =
    offline ??
    (await fetch(`/api/books/${bookId}/file`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    }));
  if (!response.ok) throw new Error("No se pudo cargar el archivo del libro");
  return response.blob();
}

export const OFFLINE_CACHE = "books-offline-v1";

export async function saveOffline(bookId: number): Promise<void> {
  const response = await fetch(`/api/books/${bookId}/file`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!response.ok) throw new Error("No se pudo descargar el libro");
  const cache = await caches.open(OFFLINE_CACHE);
  await cache.put(`/offline/books/${bookId}`, response);
}

export async function offlineBook(bookId: number): Promise<Response | undefined> {
  const cache = await caches.open(OFFLINE_CACHE);
  return cache.match(`/offline/books/${bookId}`);
}

export async function removeOffline(bookId: number): Promise<void> {
  const cache = await caches.open(OFFLINE_CACHE);
  await cache.delete(`/offline/books/${bookId}`);
}

export async function clearOfflineBooks(): Promise<void> {
  await caches.delete(OFFLINE_CACHE);
}

export async function offlineBookIds(): Promise<Set<number>> {
  const cache = await caches.open(OFFLINE_CACHE);
  const keys = await cache.keys();
  const ids = new Set<number>();
  for (const request of keys) {
    const match = new URL(request.url).pathname.match(/^\/offline\/books\/(\d+)$/);
    if (match) ids.add(Number(match[1]));
  }
  return ids;
}
