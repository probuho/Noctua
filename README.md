# Noctua - Ebook Reader

_Noctua_ es el nombre latino de la lechuza de Minerva, símbolo de la sabiduría.

Lector de libros electrónicos open source y multiplataforma (Windows, Linux,
macOS, iOS y Android) construido con [Tauri 2](https://tauri.app) (Rust +
TypeScript).

Estado: **en desarrollo**. Biblioteca local de EPUB y PDF con:

- añadir archivos o carpetas completas (también arrastrando y soltando);
- vistas Todos, Leídos recientemente, Favoritos, Leídos, Sin categoría, por formato,
  categorías propias y Papelera (los archivos nunca se borran del disco);
- búsqueda, orden (recientes, título, autor, progreso, fecha), selección múltiple
  y menú contextual;
- propiedades editables (título, autor, descripción, portada) y «Continuar leyendo»;
- notas y resaltados en 5 colores con significado editable (Importante, Idea,
  Definición, Duda, Cita) en EPUB y PDF, búsqueda en Google, Wikipedia o el traductor;
- diario de lectura por libro, con entradas vinculadas a la posición;
- «Notas y diario»: todas las notas y entradas de todos los libros en un solo lugar,
  con búsqueda, filtros y exportación agrupada por libro;
- exportación de notas y diario a HTML o Markdown.

Y un lector con:

- índice, búsqueda (texto o número de página), marcadores y «volver» tras un salto;
- vista de una página, dos páginas o continua; barra de progreso, ir a página,
  ajustar a página/ancho y zoom (PDF);
- temas claro, sepia, oscuro y sepia nocturno, atenuación, fuente, tamaño,
  interlineado y alineación (EPUB);
- pantalla completa, paso automático de página y atajos de teclado (`?` los muestra).

## Requisitos

- Node.js 20+ y npm
- Rust estable (`rustup`)
- Requisitos de Tauri por plataforma: <https://tauri.app/start/prerequisites/>
- iOS: un Mac con Xcode (obligatorio para compilar y firmar)

```bash
git clone --recurse-submodules <repo>
npm install
npm run tauri dev
```

Si clonaste sin `--recurse-submodules`: `git submodule update --init`.

## Arquitectura

```
src-tauri/            Backend (Rust)
  src/formats.rs      Detección de formato (extensión + firma mágica)
  src/library.rs      Biblioteca en SQLite (libros, metadatos, progreso)
  src/commands.rs     Comandos IPC expuestos al frontend
src/                  Frontend (TypeScript, sin framework)
  formats/types.ts    Contrato FormatPlugin / ReaderSession
  formats/registry.ts Registro de plugins
  formats/epub.ts     Plugin EPUB (foliate-js)
  formats/pdf.ts      Plugin PDF (PDF.js)
  ui/                 Vistas de biblioteca y lector
  vendor/foliate-js   Submódulo git (MIT)
dev/                  Página de pruebas de plugins y libros de ejemplo
```

Reparto de responsabilidades:

- **El backend** solo decide *qué* formato es un archivo, guarda la biblioteca
  y entrega los bytes del libro (`open_book`). No interpreta formatos.
- **Los plugins del frontend** interpretan y renderizan. Cada uno implementa
  `FormatPlugin` (`extractMetadata`, `open`) y devuelve una `ReaderSession`
  (`next`, `prev`, `goTo`, `toc`, `applySettings`, `onRelocate`, `destroy`).
- La posición de lectura es un texto opaco que define cada plugin (CFI en
  EPUB, número de página en PDF), así la biblioteca no depende del formato.

Los archivos originales nunca se modifican ni se borran: quitar un libro solo
lo elimina de la biblioteca.

### Añadir un formato nuevo

1. Añade una entrada en `FORMATS` dentro de `src-tauri/src/formats.rs`
   (id, nombre, extensiones y comprobación de firma).
2. Crea `src/formats/<id>.ts` que implemente `FormatPlugin` con el mismo `id`.
3. Regístralo en `src/formats/index.ts`.
4. Añade un archivo de ejemplo en `scripts/make_fixtures.py` y pruébalo en
   `dev/harness.html`.

foliate-js ya soporta MOBI, AZW3, FB2, FBZ y CBZ, así que esos formatos se
pueden añadir reutilizando `epub.ts` con otras extensiones.

## Desarrollo

El plan de pruebas manual está en [docs/PLAN-DE-PRUEBAS.md](docs/PLAN-DE-PRUEBAS.md).

```bash
npm run build                      # tsc + vite build
cd src-tauri && cargo test         # tests del backend
python scripts/make_fixtures.py    # genera dev/fixtures/sample.{epub,pdf}
npm run dev                        # luego abre /dev/harness.html?book=sample.epub
```

`dev/harness.html` prueba los plugins en un navegador normal, sin backend.

## Seguridad

foliate-js renderiza el contenido del libro en iframes con
`allow-scripts allow-same-origin`. Para que un libro malicioso no pueda
ejecutar código ni llegar al IPC de Tauri, la CSP de
`src-tauri/tauri.conf.json` limita `script-src` a `'self'`, lo que bloquea los
scripts en línea y los de `blob:` del contenido. No relajes esa directiva sin
otra medida que la sustituya.

## Fuera de alcance

- Eliminar DRM (Adobe ADEPT, Kindle KFX, etc.).
- Reutilizar código, recursos o textos de lectores propietarios. Este proyecto
  se diseña en sala limpia a partir de especificaciones públicas.

## Licencias de terceros

| Componente | Licencia |
|---|---|
| [foliate-js](https://github.com/johnfactotum/foliate-js) | MIT |
| [PDF.js](https://github.com/mozilla/pdf.js) | Apache-2.0 |
| [Tauri](https://tauri.app) | MIT / Apache-2.0 |
| [Lucide](https://lucide.dev) (iconos) | ISC |
| [rusqlite](https://github.com/rusqlite/rusqlite) / SQLite | MIT / dominio público |
