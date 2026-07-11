export type ReaderHandle = {
  /** Salta a una posición guardada (CFI de EPUB, índice de página o fracción). */
  goTo: (position: string) => void;
  /** Avanza una página o unidad de lectura. */
  next: () => void;
  /** Retrocede una página o unidad de lectura. */
  prev: () => void;
};

export type ReaderViewProps = {
  blob: Blob;
  initialPosition: string;
  fontSize: number;
  onPosition: (position: string, percent: number) => void;
  onError: (message: string) => void;
  /** El visor puede pedir que se muestre/oculte la barra del lector. */
  onToggleChrome?: () => void;
};