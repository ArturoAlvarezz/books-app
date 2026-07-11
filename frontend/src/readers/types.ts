export type ReaderHandle = {
  /** Salta a una posición guardada (CFI de EPUB, índice de página o fracción). */
  goTo: (position: string) => void;
};

export type ReaderViewProps = {
  blob: Blob;
  initialPosition: string;
  fontSize: number;
  onPosition: (position: string, percent: number) => void;
  onError: (message: string) => void;
};
