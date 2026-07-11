# Biblioteca y lector — especificación de mejora

## Flujos
1. Login → biblioteca con título, estado de conexión y CTA de subida.
2. Biblioteca vacía → explicación clara y subida accesible.
3. Biblioteca con libros → buscar, filtrar, abrir/continuar y acciones secundarias.
4. Lector → volver, ajustar lectura, añadir marcador y abrir panel de marcadores.
5. Operaciones asíncronas → región viva, acción deshabilitada y error recuperable.

## Componentes
- **Portada tipográfica:** título abreviado, autor y formato; color determinista por título.
- **Tarjeta de libro:** progreso etiquetado, CTA primaria y acciones secundarias con labels.
- **Carga de libro:** botón real que abre input file visualmente oculto pero enfocable.
- **Diálogo:** modal accesible para confirmar borrado o nombrar un marcador, con Escape y foco inicial.
- **Panel de marcadores:** `aside` etiquetado y lista de botones de navegación.

## Criterios de aceptación
- Teclado alcanza carga, acciones, diálogo y marcadores.
- Controles táctiles críticos miden al menos 44 px.
- En 320 px, no hay columnas ni acciones recortadas.
- Los estados de carga se anuncian sin bloquear al lector de pantalla.
- La vista conserva una identidad editorial coherente en biblioteca, login y lector.
