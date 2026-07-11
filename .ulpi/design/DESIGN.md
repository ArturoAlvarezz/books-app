# Books App — Diseño bloqueado

## Design Read
Una biblioteca personal debe sentirse como una mesa de lectura nocturna: serena, íntima y editorial; no como un gestor genérico de archivos.

## Dirección
**Biblioteca nocturna editorial.** La interfaz usa tinta violeta profunda y superficies azules-grisáceas; el modo de lectura pasa a papel cálido. La firma visual es una portada tipográfica con lomo/acento de color derivado de cada obra, en lugar de cuatro gradientes repetidos por formato.

## Principios
- Una acción primaria visible por tarjeta: abrir o continuar leyendo.
- Las acciones secundarias permanecen accesibles, pero no compiten con la lectura.
- El libro es el protagonista; los controles usan escala y contraste moderados.
- No usar emojis como marca principal ni glassmorphism, gradientes decorativos repetidos o tarjetas excesivamente redondeadas.

## Tokens
- Fondo: `#11121a`; superficie: `#191b28`; superficie elevada: `#222538`.
- Tinta/acento: `#a78bfa`; acento fuerte: `#7c5ce0`; texto: `#f4f0ea`; texto tenue: `#b8b8c9`.
- Papel de lectura: `#f3ead8`; tinta de lectura: `#25201c`.
- Radio: 12 px para superficies, 8 px para controles.
- Objetivo táctil mínimo: 44 × 44 px.
- Tipografía UI: sistema sans; lectura: Georgia/serif.

## Accesibilidad
- Todo control tiene nombre accesible y foco visible.
- El progreso identifica libro y porcentaje.
- Estados asíncronos usan regiones vivas.
- Los diálogos contienen foco, Escape y retorno al disparador.
- La cuadrícula baja a una columna cuando no hay espacio para acciones legibles.

## Responsive
- < 380 px: tarjetas de una columna y acciones secundarias en fila propia.
- 380–719 px: cuadrícula fluida de mínimo 155 px.
- >= 720 px: cuadrícula de biblioteca y cabecera de dos líneas cuando corresponda.

## Reglas de consistencia
Todo componente nuevo debe usar estos tokens. El lector puede usar papel cálido; la biblioteca no. No se introducen colores arbitrarios ni elevaciones visuales sin razón funcional.
