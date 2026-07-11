export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(1)} GB`;
}

export function isSupported(format: string): boolean {
  return ["EPUB", "PDF", "CBZ", "TXT"].includes(format.toUpperCase());
}

/** Nombre natural de página para ordenar "page2" antes que "page10". */
export function comparePages(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}
