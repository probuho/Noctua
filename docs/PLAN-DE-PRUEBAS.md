# Plan de pruebas manual

Guía para comprobar a mano todo lo que hace la aplicación. Cada prueba indica
los pasos y el resultado esperado; marca la casilla cuando pase. Si algo no
coincide, apunta el identificador (por ejemplo `B7`) al reportarlo.

Cubre: biblioteca, lector, EPUB, PDF, marcadores, búsqueda, notas y
resaltados, ajustes, atajos y persistencia.

---

## 0. Preparación

### 0.1 Arrancar la aplicación

```bash
npm install
npm run tauri dev
```

La primera compilación de Rust tarda varios minutos; las siguientes, segundos.

### 0.2 Libros para probar

Ten a mano una carpeta con estos archivos (cuantos más tipos, mejor):

| Archivo | Para qué sirve | Dónde conseguirlo |
|---|---|---|
| `dev/fixtures/sample.epub` y `sample.pdf` | Libros mínimos del proyecto | Ya están en el repositorio (`python scripts/make_fixtures.py` los regenera) |
| Un EPUB real con portada e índice | Portada, índice, capítulos | Project Gutenberg o Standard Ebooks (dominio público) |
| Un EPUB con enlaces a webs | Aviso de enlace externo | La mayoría de libros de Standard Ebooks |
| Un PDF de texto con índice (marcadores) | Índice y búsqueda en PDF | Cualquier manual técnico en PDF |
| Un PDF escaneado (imágenes) | Decodificadores de imagen | Un documento escaneado propio |
| Un PDF protegido con contraseña | Comportamiento ante error | Créalo con cualquier herramienta de PDF |
| Un archivo `.docx` o `.txt` | Formato no soportado | Cualquiera |
| Una carpeta con subcarpetas y libros dentro | Añadir carpeta | Organiza los anteriores |

### 0.3 Empezar de cero (opcional)

La biblioteca se guarda en `%APPDATA%\org.noctua.ebookreader\library.db`
(Windows), `~/.local/share/org.noctua.ebookreader/` (Linux) o
`~/Library/Application Support/org.noctua.ebookreader/` (macOS). Cierra la
app y borra ese archivo para empezar con la biblioteca vacía. Tus libros no se
tocan.

---

## Prueba rápida (10 minutos)

Para comprobar que nada importante se ha roto tras un cambio:

- [ ] **R1** Añadir un EPUB y un PDF → aparecen con título y portada.
- [ ] **R2** Abrir el EPUB, pasar 3 páginas con `→`, volver a la biblioteca → la barra de progreso de la tarjeta avanza.
- [ ] **R3** Reabrir el EPUB → continúa en la misma página.
- [ ] **R4** Seleccionar texto, elegir un color → queda resaltado y aparece en el panel **Notas**.
- [ ] **R5** Abrir el PDF, ir a la página 2 con el campo de página → muestra la página 2.
- [ ] **R6** Cambiar el tema a oscuro en **Aa** → cambia la app y el libro.
- [ ] **R7** Mover un libro a la papelera y restaurarlo.
- [ ] **R8** Cerrar la app y volver a abrirla → todo sigue igual (progreso, notas, papelera).

---

## A. Biblioteca

### Añadir libros

- [ ] **A1** Pulsar **Añadir libros** y elegir un EPUB y un PDF.
  *Esperado:* aparecen dos tarjetas; el mensaje dice «2 libro(s) añadido(s)». En unos segundos se rellenan título, autor y portada.
- [ ] **A2** Añadir otra vez el mismo archivo.
  *Esperado:* no se duplica; el mensaje indica que ya estaba en la biblioteca.
- [ ] **A3** Arrastrar un `.docx` o `.txt` a la ventana.
  *Esperado:* no se añade; el mensaje lo señala como formato no soportado.
- [ ] **A4** Pulsar **Añadir carpeta** y elegir la carpeta con subcarpetas.
  *Esperado:* se añaden todos los EPUB/PDF de dentro, también los de las subcarpetas. Los archivos de otros tipos se ignoran sin avisar.
- [ ] **A5** Arrastrar desde el explorador de archivos uno o varios libros a la ventana.
  *Esperado:* al arrastrar aparece el recuadro «Suelta aquí libros o carpetas»; al soltar se añaden.
- [ ] **A6** Arrastrar una carpeta a la ventana.
  *Esperado:* igual que A4.
- [ ] **A7** Añadir un PDF protegido con contraseña.
  *Esperado:* se añade pero sin portada ni título interno (usa el nombre del archivo). Al abrirlo muestra un mensaje de error en lugar de bloquearse. *(Pedir la contraseña aún no está implementado.)*

### Vistas y contadores (barra lateral)

- [ ] **A8** Comprobar que **Todos** cuenta todos los libros que no están en la papelera.
- [ ] **A9** Abrir un libro y volver.
  *Esperado:* aparece en **Leídos recientemente** (máximo 20, el más reciente primero).
- [ ] **A10** Con libros EPUB y PDF a la vez, la sección **Formatos** muestra **EPUB** y **PDF** con su número. Con un solo formato, la sección no aparece.
- [ ] **A11** **Sin categoría** cuenta los libros que no están en ninguna categoría.

### Categorías

- [ ] **A12** Pulsar **+** junto a «Categorías», escribir «Novela» y aceptar.
  *Esperado:* aparece «Novela» con 0 libros.
- [ ] **A13** Crear otra categoría con el mismo nombre en otras mayúsculas («novela»).
  *Esperado:* aparece un mensaje de que ya existe; no se duplica.
- [ ] **A14** Clic derecho en una tarjeta → **Añadir a categoría** → «Novela».
  *Esperado:* «Novela» pasa a 1 y «Sin categoría» baja en 1.
- [ ] **A15** Clic derecho → **Añadir a categoría** → **+ Nueva categoría** → «Ensayo».
  *Esperado:* se crea «Ensayo» y el libro ya está dentro.
- [ ] **A16** Entrar en «Novela», clic derecho en el libro → **Quitar de «Novela»**.
  *Esperado:* el libro desaparece de esa vista pero sigue en **Todos**.
- [ ] **A17** Botón **⋯** de la categoría → **Renombrar** → «Novelas».
- [ ] **A18** Botón **⋯** de la categoría → **Eliminar** → confirmar.
  *Esperado:* la categoría desaparece; sus libros siguen en la biblioteca.

### Favoritos, leídos y papelera

- [ ] **A19** Menú de una tarjeta → **Añadir a favoritos**.
  *Esperado:* aparece una ★ sobre la portada y sube **Favoritos**. Repetir: ahora el menú dice **Quitar de favoritos**.
- [ ] **A20** Menú → **Marcar como leído**.
  *Esperado:* aparece ✓ en la portada y sube **Leídos**.
- [ ] **A21** Menú → **Mover a la papelera**.
  *Esperado:* desaparece de **Todos**; **Papelera** sube a 1.
- [ ] **A22** En **Papelera**: el libro no se abre al hacer clic. Clic derecho → **Restaurar**.
  *Esperado:* vuelve a **Todos** con su progreso y sus notas intactos.
- [ ] **A23** Mover dos libros a la papelera → **Restaurar todo**.
- [ ] **A24** Mover un libro a la papelera → **Vaciar papelera** → confirmar.
  *Esperado:* desaparece de la biblioteca. **El archivo sigue en el disco** (compruébalo en el explorador).
- [ ] **A25** Volver a añadir ese mismo archivo.
  *Esperado:* se añade como libro nuevo (sin progreso anterior).
- [ ] **A26** Mover un libro a la papelera y luego añadir otra vez su archivo.
  *Esperado:* sale de la papelera en lugar de duplicarse.

### Selección múltiple

- [ ] **A27** Pulsar **Seleccionar**, marcar 3 libros.
  *Esperado:* aparecen casillas; la barra inferior dice «3 seleccionados».
- [ ] **A28** Con la selección: **Añadir a favoritos**, **Añadir a categoría**, **Marcar como leído** y **Mover a la papelera** aplican a los 3.
- [ ] **A29** Sin pulsar **Seleccionar**: `Ctrl`+clic en dos tarjetas las selecciona; `Mayús`+clic selecciona el rango entre ellas.
- [ ] **A30** **Seleccionar todo** marca todos los libros visibles; **Quitar selección** sale del modo selección.
- [ ] **A31** Con varios seleccionados, clic derecho sobre uno de ellos.
  *Esperado:* el menú aplica a toda la selección.

### Buscar y ordenar

- [ ] **A32** Escribir parte de un título o de un autor en **Buscar en la biblioteca**.
  *Esperado:* filtra al instante, sin distinguir mayúsculas.
- [ ] **A33** Probar cada orden: Recientes, Título, Autor (los que no tienen autor van al final), Progreso, Fecha de adición.
- [ ] **A34** Cerrar y abrir la app.
  *Esperado:* se mantienen el orden elegido y la vista de la barra lateral.

### Propiedades y portada

- [ ] **A35** Menú → **Propiedades…**
  *Esperado:* muestra portada, título, autor, descripción, formato, tamaño, progreso, número de notas, fecha de adición, última lectura y carpeta.
- [ ] **A36** Cambiar título y autor, escribir una descripción → **Guardar**.
  *Esperado:* la tarjeta muestra los nuevos datos.
- [ ] **A37** Borrar el título por completo → **Guardar**.
  *Esperado:* se mantiene el título anterior (no queda vacío).
- [ ] **A38** **Cambiar portada** → elegir una imagen JPG/PNG.
  *Esperado:* la portada cambia al momento, también en la tarjeta.
- [ ] **A39** **Restaurar portada original**.
  *Esperado:* vuelve la portada del libro.
- [ ] **A40** **Cambiar portada** eligiendo un archivo que no sea imagen.
  *Esperado:* mensaje «No se pudo leer esa imagen.» y la portada no cambia.

### Continuar leyendo

- [ ] **A41** Leer un libro hasta la mitad y volver a **Todos**.
  *Esperado:* arriba aparece «Continuar leyendo · título · %»; al pulsarlo se abre el libro en esa posición.
- [ ] **A42** Marcar ese libro como leído.
  *Esperado:* deja de proponerse en «Continuar leyendo».

---

## B. Lector (todos los formatos)

- [ ] **B1** Abrir un libro.
  *Esperado:* se ve la primera página (o la última posición guardada) sin quedarse en blanco.
- [ ] **B2** Pasar página con `→`, `←`, `AvPág`, `RePág`, `Espacio` y los botones **‹ ›** del pie.
- [ ] **B3** `Inicio` y `Fin` van al principio y al final del libro.
- [ ] **B4** Arrastrar la **barra de progreso** del pie hasta la mitad y soltar.
  *Esperado:* salta a ~50%. Justo después, `→` sigue funcionando (la barra no se queda con el foco).
- [ ] **B5** Saltar a un capítulo desde el **Índice** (`☰` o `Ctrl+T`) y pulsar **↶ Volver** (o `Alt+←`).
  *Esperado:* vuelve a donde estabas antes del salto. El botón está desactivado si no hay a dónde volver.
- [ ] **B6** **Marcadores** (`⚑`): **Añadir marcador** en dos sitios distintos.
  *Esperado:* la lista los ordena por posición; al pulsar uno, salta allí.
- [ ] **B7** `Ctrl+B` añade un marcador en la posición actual.
- [ ] **B8** Quitar un marcador con **×**; **Borrar todos** pide confirmación.
- [ ] **B9** **Buscar** (`⌕` o `Ctrl+F`): buscar una palabra que aparezca varias veces.
  *Esperado:* lista de resultados con el contexto y la palabra resaltada; «N resultados». Al pulsar uno, salta allí.
- [ ] **B10** Buscar algo que no existe → «Sin resultados».
- [ ] **B11** Pantalla completa con `⛶` o `F11`; `Esc` sale de pantalla completa.
- [ ] **B12** **Paso automático** (`▶`): cambia de página solo cada N segundos (por defecto 30; ajústalo a 5 en **Aa** para probar). `⏸` lo detiene. Se para solo al llegar al final.
- [ ] **B13** `?` muestra la lista de atajos de teclado.
- [ ] **B14** `Esc` por orden: cierra el menú o panel abierto → sale de pantalla completa → vuelve a la biblioteca.
- [ ] **B15** Leer hasta el final y volver a la biblioteca.
  *Esperado:* pregunta «Has terminado «…». ¿Marcarlo como leído?». Al aceptar aparece ✓ en la tarjeta.

### Ajustes de lectura (**Aa**)

- [ ] **B16** Temas **Claro**, **Sepia**, **Oscuro** y **Sepia nocturno**: cambian la interfaz y el libro. `T` los recorre en orden.
- [ ] **B17** **Atenuación**: oscurece la página sin cambiar el tema.
- [ ] **B18** **Una página / Dos páginas**; `D` alterna entre ambas. El panel **Aa** muestra siempre la opción activa, aunque se haya cambiado con la tecla.
- [ ] **B19** Tamaño con **− / +**, `Ctrl+=` y `Ctrl+-`; `Ctrl+0` vuelve a 100%.
- [ ] **B20** Cerrar y abrir la app → los ajustes se conservan.

---

## C. EPUB

- [ ] **C1** **Fuente**: Original, Serif, Sans y Monoespaciada cambian el texto del libro.
- [ ] **C2** **Interlineado** − / + entre 1.0 y 2.4.
- [ ] **C3** **Alineación**: Original, Izquierda y Justificada.
- [ ] **C4** Pulsar un enlace interno del libro (por ejemplo, una nota al pie o el índice dentro del texto).
  *Esperado:* navega dentro del libro.
- [ ] **C5** Pulsar un enlace a una web.
  *Esperado:* pregunta «¿Abrir este enlace en el navegador?»; al aceptar se abre en tu navegador, **nunca dentro de la app**.
- [ ] **C6** Con el texto seleccionado o el foco dentro del libro, los atajos (`→`, `T`, `N`…) siguen funcionando.

## D. PDF

- [ ] **D1** El campo **Página** del pie: escribir un número y pulsar `Enter` salta a esa página. Muestra «/ total».
- [ ] **D2** **Ajustar**: **A la página** (la página entera cabe) y **Al ancho** (ocupa el ancho; se desplaza en vertical).
- [ ] **D3** **Zoom** − / + en **Aa**.
- [ ] **D4** **Dos páginas** muestra pares (1–2, 3–4…) y `→` avanza de dos en dos.
- [ ] **D5** Índice: si el PDF tiene marcadores internos, aparecen en **Índice** y llevan a su página.
- [ ] **D6** Buscar un número, por ejemplo «12».
  *Esperado:* el primer resultado es «Ir a la página 12», seguido de las coincidencias en el texto.
- [ ] **D7** **PDF escaneado**: las páginas muestran las imágenes, no salen en blanco.
- [ ] **D8** Temas oscuro y sepia: el PDF se ve invertido o en sepia, pero legible.
- [ ] **D9** En PDF **no** aparecen el botón ni la pestaña **Notas**. *(Las notas en PDF aún no están implementadas.)*

## E. Notas y resaltados (EPUB)

- [ ] **E1** Seleccionar una frase con el ratón.
  *Esperado:* aparece encima un menú con 5 colores, **Añadir nota**, **Copiar**, **Buscar en el libro**, **Google**, **Wikipedia** y **Traducir**.
- [ ] **E2** Elegir un color.
  *Esperado:* la frase queda resaltada en ese color y el menú se cierra.
- [ ] **E3** Seleccionar otra frase → **Añadir nota** → escribir varias líneas → **Guardar**.
  *Esperado:* queda resaltada en el último color usado y la nota se guarda.
- [ ] **E4** Hacer clic sobre un resaltado existente.
  *Esperado:* el menú muestra el color actual marcado, la nota (si tiene), **Editar nota** o **Añadir nota**, y **Quitar resaltado**.
- [ ] **E5** Cambiar el color de un resaltado existente desde ese menú.
- [ ] **E6** **Editar nota** y dejarla vacía → **Guardar**.
  *Esperado:* el resaltado se queda, pero sin nota.
- [ ] **E7** **Quitar resaltado** → el color desaparece del texto y de la lista.
- [ ] **E8** **Copiar** → pegar en otra aplicación: llega el texto seleccionado.
- [ ] **E9** **Buscar en el libro** → se abre la pestaña **Buscar** con esa frase y sus resultados.
- [ ] **E10** **Google**, **Wikipedia** y **Traducir** abren el navegador con el texto seleccionado (Wikipedia y Traductor en tu idioma).
- [ ] **E11** `Esc` con el menú abierto lo cierra y quita la selección.
- [ ] **E12** Panel **Notas** (`✎` o tecla `N`): lista en orden de lectura, con el color a la izquierda, la cita, la nota y el %. Al pulsar una, salta a ese texto.
- [ ] **E13** **Filtrar notas**: busca en la cita y en la nota.
- [ ] **E14** **✎** en la lista abre el editor de esa nota; **×** la quita.
- [ ] **E15** **Exportar ▾ → Página web (HTML)**: elegir dónde guardar y abrir el archivo en el navegador.
  *Esperado:* título, autor, fecha y cada cita con su color y su nota.
- [ ] **E16** **Exportar ▾ → Markdown**: abrir el `.md` en un editor (Obsidian, VS Code).
  *Esperado:* cada cita como `>`, la nota debajo **fuera** de la cita y el % en cursiva.
- [ ] **E17** **🗑 Borrar todas** → confirmar → la lista queda vacía y el texto sin resaltados.
- [ ] **E18** Cerrar y reabrir el libro → resaltados y notas siguen ahí, también en capítulos que no estaban cargados.
- [ ] **E19** En la biblioteca, la tarjeta muestra `✎ N` con el número de notas, y **Propiedades** también lo indica.
- [ ] **E20** Seleccionar texto, cambiar de página sin elegir nada → el menú desaparece.

---

## F. Persistencia y actualización

- [ ] **F1** Hacer cambios de cada tipo (progreso, marcadores, notas, categorías, favoritos, papelera, ajustes), cerrar la app por completo y abrirla.
  *Esperado:* todo se conserva.
- [ ] **F2** Mover o renombrar en el disco un libro de la biblioteca y abrirlo desde la app.
  *Esperado:* mensaje de error al abrir, sin cierre de la app. *(Relocalizar libros movidos aún no está implementado.)*
- [ ] **F3** Si tenías una biblioteca de una versión anterior, al abrir la nueva versión los libros, el progreso y las portadas siguen ahí (la base de datos se actualiza sola).

## G. Ventana estrecha / móvil

Reduce la ventana a unos 400 px de ancho (o prueba en el teléfono cuando haya versión móvil):

- [ ] **G1** La barra lateral de la biblioteca se convierte en una fila de botones desplazable.
- [ ] **G2** La barra de selección no tapa las tarjetas.
- [ ] **G3** En el lector, el panel lateral se superpone al libro y se puede cerrar.
- [ ] **G4** No aparece desplazamiento horizontal en ninguna pantalla.

## H. Seguridad

- [ ] **H1** Un EPUB con JavaScript dentro (algunos libros interactivos lo traen) se muestra, pero sus scripts **no se ejecutan**.
- [ ] **H2** Ningún enlace de un libro abre páginas web dentro de la aplicación; siempre se pregunta y se abren en el navegador.
- [ ] **H3** Ninguna acción de la app borra archivos del disco (papelera, vaciar papelera, quitar de categoría, eliminar categoría).

---

## Pruebas automáticas

Además de este plan manual:

```bash
cd src-tauri && cargo test
```

Tests del backend: formatos, biblioteca, carpetas, papelera, categorías,
propiedades, migraciones, marcadores y notas.

```bash
npm run build
```

Comprueba los tipos de TypeScript y que el frontend compila.

```bash
npm run dev
```

Con el servidor en marcha, abre `http://localhost:1420/dev/harness.html` en un
navegador. Esta página carga la interfaz completa con un backend simulado y
tres libros de ejemplo. Sirve para probar la interfaz sin compilar Rust; los
cambios no se guardan.

## Limitaciones conocidas

- Notas y resaltados solo en EPUB; en PDF aún no se puede seleccionar texto.
- La búsqueda en PDF encuentra la página, pero no resalta la palabra.
- Los PDF con contraseña no piden la contraseña.
- Los libros movidos o renombrados en el disco no se relocalizan.
- Sin exportar/importar la biblioteca, texto a voz ni impresión (fases siguientes).

## Cómo reportar un fallo

Indica el identificador de la prueba, qué esperabas, qué pasó, el sistema
operativo y, si puedes, el libro que lo provoca (o uno parecido de dominio
público) y una captura.
