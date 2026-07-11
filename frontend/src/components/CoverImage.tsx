import { useEffect, useState } from "react";
import { getToken } from "../api";

type Props = {
  bookId: number;
  alt?: string;
  className?: string;
};

/**
 * Carga la portada de un libro como blob URL.
 *
 * Como <img src> no permite enviar Authorization, hacemos fetch autenticado
 * y creamos un Object URL en el cliente. Liberamos el blob al desmontar.
 *
 * Mientras carga, renderiza un skeleton para evitar el flash de portada
 * editorial antes de que llegue la imagen real.
 */
export default function CoverImage({ bookId, alt = "", className }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;
    (async () => {
      try {
        const response = await fetch(`/api/books/${bookId}/cover`, {
          headers: { Authorization: `Bearer ${getToken()}` },
        });
        if (!response.ok) {
          if (!cancelled) setFailed(true);
          return;
        }
        const blob = await response.blob();
        createdUrl = URL.createObjectURL(blob);
        if (!cancelled) setSrc(createdUrl);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [bookId]);

  if (failed) return null;
  if (loading) {
    return (
      <div
        className={className ? `${className} cover-img-skeleton` : "cover-img-skeleton"}
        aria-hidden="true"
      />
    );
  }
  if (!src) return null;
  return (
    <img
      className={className ?? "cover-img"}
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}