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
- [ ] **R6** Cambiar el tema a oscuro en **Ajustes** → cambia la app y el libro.
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
- [ ] **A7** Añadir un PDF protegido con contraseña (hay uno de ejemplo: `dev/fixtures/sample-protected.pdf`, contraseña `noctua`).
  *Esperado:* se añade sin portada y con el nombre del archivo como título (no se puede leer sin la contraseña).

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

Distribución del lector: arriba, **Biblioteca**, el título con la posición,
el selector de vista (**Una página · Dos páginas · Continuo**), **Ajustes**,
**Auto**, **Pantalla** y **Ayuda**. A la izquierda, la barra de actividades con
**Índice**, **Buscar**, **Marcadores**, **Notas** y **Diario**. Abajo,
**Anterior**, **Volver**, la barra de progreso y **Siguiente**.


- [ ] **B1** Abrir un libro.
  *Esperado:* se ve la primera página (o la última posición guardada) sin quedarse en blanco.
- [ ] **B2** Pasar página con `→`, `←`, `AvPág`, `RePág`, `Espacio` y los botones **‹ ›** del pie.
- [ ] **B3** `Inicio` y `Fin` van al principio y al final del libro.
- [ ] **B4** Arrastrar la **barra de progreso** del pie hasta la mitad y soltar.
  *Esperado:* salta a ~50%. Justo después, `→` sigue funcionando (la barra no se queda con el foco).
- [ ] **B5** Saltar a un capítulo desde **Índice** (o `Ctrl+T`) y pulsar **Volver** en el pie (o `Alt+←`).
  *Esperado:* vuelve a donde estabas antes del salto. El botón está desactivado si no hay a dónde volver.
- [ ] **B6** **Marcadores**: **Añadir marcador** en dos sitios distintos.
  *Esperado:* la lista los ordena por posición; al pulsar uno, salta allí.
- [ ] **B7** `Ctrl+B` añade un marcador en la posición actual.
- [ ] **B8** Quitar un marcador con **×**; **Borrar todos** pide confirmación.
- [ ] **B9** **Buscar** (o `Ctrl+F`): buscar una palabra que aparezca varias veces.
  *Esperado:* lista de resultados con el contexto y la palabra resaltada; «N resultados». Al pulsar uno, salta allí.
- [ ] **B10** Buscar algo que no existe → «Sin resultados».
- [ ] **B11** Pantalla completa con **Pantalla** o `F11`; `Esc` sale de pantalla completa.
- [ ] **B12** **Auto**: cambia de página solo cada N segundos (por defecto 30; ajústalo a 5 en **Ajustes → Paso automático** para probar). Pulsarlo otra vez lo detiene. Se para solo al llegar al final.
- [ ] **B13** `?` muestra la lista de atajos de teclado.
- [ ] **B14** `Esc` por orden: cierra el menú o panel abierto → sale de pantalla completa → vuelve a la biblioteca.
- [ ] **B15** Leer hasta el final y volver a la biblioteca.
  *Esperado:* pregunta «Has terminado «…». ¿Marcarlo como leído?». Al aceptar aparece ✓ en la tarjeta.

### Vista y ajustes de lectura

- [ ] **B16** Temas **Claro**, **Sepia**, **Oscuro** y **Sepia nocturno**: cambian la interfaz y el libro. `T` los recorre en orden.
- [ ] **B17** **Atenuación**: oscurece la página sin cambiar el tema.
- [ ] **B18** El selector de vista de la barra superior cambia entre **Una página**, **Dos páginas** y **Continuo**; `D` las recorre en orden. La opción activa se ve marcada siempre.
- [ ] **B18b** **Continuo**: el libro se lee desplazándose hacia abajo, sin cortes de página. La posición del título y la barra de progreso se actualizan al desplazarse.
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
- [ ] **D3** **Zoom** − / + en **Ajustes**.
- [ ] **D4** **Dos páginas** muestra pares (1–2, 3–4…) y `→` avanza de dos en dos.
- [ ] **D5** Índice: si el PDF tiene marcadores internos, aparecen en **Índice** y llevan a su página.
- [ ] **D6** Buscar un número, por ejemplo «12».
  *Esperado:* el primer resultado es «Ir a la página 12», seguido de las coincidencias en el texto.
- [ ] **D7** **PDF escaneado**: las páginas muestran las imágenes, no salen en blanco.
- [ ] **D8** Con cualquier tema (Sepia, Oscuro, Sepia nocturno) las páginas del PDF conservan sus colores originales; solo cambia la interfaz alrededor. **Atenuación** oscurece la página si molesta el brillo.
- [ ] **D9** Buscar una palabra con el panel abierto.
  *Esperado:* las coincidencias se marcan con un recuadro rojo sobre la página (en las dos páginas si la vista es doble). Al cerrar el panel desaparecen.
- [ ] **D11** Abrir un PDF protegido: aparece «Libro protegido» con el cursor en el campo **Contraseña**. Se puede pegar la contraseña y marcar **Mostrar contraseña**.
- [ ] **D12** Escribir una contraseña incorrecta y pulsar `Enter`.
  *Esperado:* el diálogo sigue abierto con el aviso «La contraseña no es correcta…» (icono + texto, no solo color).
- [ ] **D13** Escribir la correcta y pulsar `Enter` → se abre el libro. Volver a la biblioteca y abrirlo otra vez → no la vuelve a pedir mientras la app siga abierta. Tras cerrar la app, sí la pide (nunca se guarda en disco).
- [ ] **D14** Pulsar **Cancelar** o `Esc` en la contraseña → pantalla «Hace falta la contraseña…» con **Abrir libro** (reintentar) y **Biblioteca**. El `Esc` no cierra el libro de golpe.
- [ ] **D15** En `sample.pdf`, página 1: pulsar «Ir a la pagina 3 (enlace interno)» → salta a la página 3; **Volver** regresa a la 1.
- [ ] **D16** Pulsar «Visitar example.org (enlace externo)» → aviso «Vas a salir de Noctua» con el dominio en grande, la dirección completa y el foco en **Cancelar**. **Cancelar** o `Esc` no abre nada; **Abrir en el navegador** la abre en el navegador del sistema; **Copiar enlace** la copia.
- [ ] **D17** Los enlaces se pueden alcanzar con `Tab` y activar con `Enter`; al pasar el ratón se ven subrayados.
- [ ] **D18** Enlaces de riesgo (si tienes un PDF con ellos): `http://` muestra «La conexión no es segura»; enlaces con usuario/contraseña, a una IP o con dominio raro muestran su aviso; `javascript:` y otros tipos no web se bloquean (solo se puede copiar).
- [ ] **D10** Seleccionar texto con el ratón en un PDF con texto (no escaneado) y copiarlo con `Ctrl+C`.
  *Esperado:* se pega el texto seleccionado.

## E. Notas y resaltados (EPUB y PDF)

Haz las pruebas E1–E20 con un EPUB y repite al menos E1–E7, E12 y E15 con un PDF de texto.

- [ ] **E1** Seleccionar una frase con el ratón.
  *Esperado:* aparece encima un menú «Resaltar como» con 5 opciones que muestran color **y nombre** (Importante, Idea, Definición, Duda, Cita), **Añadir nota**, **Copiar**, **Buscar en el libro**, **Google**, **Wikipedia** y **Traducir**.
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
- [ ] **E9** **Buscar en el libro** → se abre **Buscar** con esa frase y sus resultados.
- [ ] **E10** **Google**, **Wikipedia** y **Traducir** abren el navegador con el texto seleccionado (Wikipedia y Traductor en tu idioma).
- [ ] **E11** `Esc` con el menú abierto lo cierra y quita la selección.
- [ ] **E12** **Notas** (o tecla `N`): lista en orden de lectura con el significado del color (por ejemplo «● Duda»), la cita, la nota y el %. Al pulsar una, salta a ese texto.
- [ ] **E13** **Filtrar notas**: busca en la cita y en la nota.
- [ ] **E14** El botón de lápiz de una nota abre su editor; el de la papelera la quita.
- [ ] **E15** **Exportar ▾ → Página web (HTML)**: elegir dónde guardar y abrir el archivo en el navegador.
  *Esperado:* título, autor, fecha y cada cita con su color y su nota.
- [ ] **E16** **Exportar ▾ → Markdown**: abrir el `.md` en un editor (Obsidian, VS Code).
  *Esperado:* cada cita como `>`, la nota debajo **fuera** de la cita y el % en cursiva.
- [ ] **E17** El botón de papelera junto a **Exportar** (Borrar todas) → confirmar → la lista queda vacía y el texto sin resaltados.
- [ ] **E18** Cerrar y reabrir el libro → resaltados y notas siguen ahí, también en capítulos que no estaban cargados.
- [ ] **E19** En la biblioteca, la tarjeta muestra `✎ N` con el número de notas, y **Propiedades** también lo indica.
- [ ] **E20** Seleccionar texto, cambiar de página sin elegir nada → el menú desaparece.

- [ ] **E20b** Un resaltado con nota muestra un pequeño bocadillo al final del texto resaltado; uno sin nota, no.
- [ ] **E20c** **Ajustes → Significado de los colores**: cambiar «Importante» por «Clave».
  *Esperado:* el menú de selección, la lista de **Notas** y la exportación usan «Clave». Se mantiene al reiniciar la app.
- [ ] **E20d** En **Notas**, los filtros «Todas», cada significado usado y «Con nota» muestran cuántas hay y filtran la lista.

### Diario de lectura (archivos Markdown, tipo Obsidian)

El diario es distinto de las notas: se guarda como un archivo `.md` por libro en una carpeta tuya y admite imágenes. Las notas siguen dentro de la app, ligadas a cada resaltado y sin imágenes.

- [ ] **J1** La primera vez, **Diario** (o tecla `J`) explica dónde se guarda y muestra **Elegir carpeta del diario**. Elegir una carpeta (por ejemplo, dentro de tu bóveda de Obsidian).
  *Esperado:* aparece el nombre del archivo (`<Título del libro>.md`) y el cuadro para escribir.
- [ ] **J2** Escribir con Markdown (`**negrita**`, `*cursiva*`, listas `- `) y pulsar **Guardar en el diario**.
  *Esperado:* debajo se ve la entrada formateada, con un encabezado de fecha · % y el enlace **Ir a esta parte del libro**.
- [ ] **J3** Copiar una imagen (captura con Win+Shift+S) y pegarla con Ctrl+V en el cuadro. Probar también **Insertar imagen** y arrastrar un archivo.
  *Esperado:* se añade `![](attachments/noctua-….png)` al texto y, al guardar, la imagen se ve en la vista previa.
- [ ] **J4** Ir a otra parte del libro y pulsar **Ir a esta parte del libro** → vuelve a donde estabas al escribir.
- [ ] **J5** Desmarcar **Vincular a la posición actual** y guardar → la entrada no lleva enlace.
- [ ] **J6** **Editar archivo** abre el `.md` completo; cambiar algo, **Guardar** → se ve el cambio. **Cancelar** no cambia nada.
- [ ] **J7** El botón de carpeta abre el Explorador con el archivo seleccionado.
- [ ] **J8** Abrir la carpeta con Obsidian: el archivo tiene las propiedades `title`, `author` y `tags: [noctua, lectura]`, las imágenes se ven y el enlace de posición queda oculto (es un comentario).
- [ ] **J9** Editar el archivo en Obsidian y volver a abrir el libro en Noctua → se ven los cambios.
- [ ] **J10** Las entradas del diario antiguo (guardadas antes de esta versión) se copian al `.md` la primera vez que eliges carpeta, bajo «Entrada importada».
- [ ] **J11** **Cambiar carpeta** permite usar otra; los archivos anteriores se quedan donde estaban.

### Solo PDF

- [ ] **E21** Resaltar texto y luego cambiar el zoom, **Ajustar al ancho** y **Una / Dos páginas**.
  *Esperado:* el resaltado sigue exactamente sobre el mismo texto.
- [ ] **E22** Resaltar en la página 1, ir al final y pulsar la nota en el panel **Notas**.
  *Esperado:* vuelve a la página 1 con el resaltado visible.
- [ ] **E23** En un PDF escaneado (sin texto) no se puede seleccionar nada y no aparece el menú. Es lo esperado.

---

## N. Notas de toda la biblioteca

- [ ] **N1** En la barra lateral de la biblioteca, **Notas** muestra el total de resaltados de todos los libros. El diario no aparece aquí: vive en tu carpeta de archivos Markdown.
- [ ] **N2** Al entrar, la rejilla de libros se sustituye por la lista; arriba desaparecen el buscador de libros, el orden y **Seleccionar**.
- [ ] **N3** **Mostrar**: Todo / Con nota.
- [ ] **N4** **Significado**: cada chip muestra solo los resaltados de ese color (por su nombre, p. ej. «Duda»).
- [ ] **N5** El desplegable de libro limita la lista a un libro.
- [ ] **N6** **Buscar en las notas** busca en el texto resaltado, en las notas y en título/autor.
- [ ] **N7** **Orden**: «Más recientes» (todo mezclado por fecha) y «Por libro» (agrupado, con los resaltados en orden de lectura).
- [ ] **N8** **Abrir en el libro** abre el libro justo en ese resaltado; **Volver** (pie del lector) regresa a donde ibas leyendo.
- [ ] **N9** **Exportar lo mostrado** → HTML o Markdown: un solo documento con una sección por libro y solo lo que estaba filtrado.
- [ ] **N10** Mover un libro a la papelera quita sus notas de esta vista; restaurarlo las devuelve.

## F. Persistencia y actualización

- [ ] **F1** Hacer cambios de cada tipo (progreso, marcadores, notas, categorías, favoritos, papelera, ajustes), cerrar la app por completo y abrirla.
  *Esperado:* todo se conserva.
- [ ] **F2** Mover o renombrar en el disco un libro de la biblioteca y abrirlo desde la app.
  *Esperado:* mensaje de error al abrir, sin cierre de la app. *(Relocalizar libros movidos aún no está implementado.)*
- [ ] **F3** Si tenías una biblioteca de una versión anterior, al abrir la nueva versión los libros, el progreso y las portadas siguen ahí (la base de datos se actualiza sola).

## G2. Accesibilidad (WCAG 2.2 AA)

- [ ] **W1** Recorrer el lector solo con `Tab`: todos los botones son alcanzables y muestran un contorno de foco visible.
- [ ] **W2** Cada botón tiene texto visible o, en ventanas estrechas, un nombre que el lector de pantalla anuncia (por ejemplo «Ajustes», «Notas»).
- [ ] **W3** En el selector de vista y en los grupos de **Ajustes**, las flechas del teclado cambian de opción.
- [ ] **W4** Abrir **Ajustes** lleva el foco al tema actual; `Esc` lo cierra y devuelve el foco al botón **Ajustes**. Igual con **Ayuda** y con los paneles de la barra lateral.
- [ ] **W5** Con un lector de pantalla (NVDA, VoiceOver o Narrador): los botones de la barra lateral anuncian si su panel está abierto («expandido / contraído»).
- [ ] **W6** Los resaltados nunca dependen solo del color: siempre se acompaña del nombre del significado.
- [ ] **W7** Con el zoom del sistema al 200%, la app sigue siendo usable sin desplazamiento horizontal.

## G. Ventana estrecha / móvil

Reduce la ventana a unos 400 px de ancho (o prueba en el teléfono cuando haya versión móvil):

- [ ] **G1** La barra lateral de la biblioteca se convierte en una fila de botones desplazable.
- [ ] **G2** La barra de selección no tapa las tarjetas.
- [ ] **G3** En el lector, la barra de actividades pasa abajo (con sus nombres visibles); los botones de arriba quedan como iconos con nombre accesible; el panel lateral se superpone al libro y se puede cerrar.
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

- Los PDF escaneados no tienen texto seleccionable (haría falta OCR).
- Los PDF con contraseña no piden la contraseña.
- Los libros movidos o renombrados en el disco no se relocalizan.
- Sin exportar/importar la biblioteca, texto a voz ni impresión (fases siguientes).

## Cómo reportar un fallo

Indica el identificador de la prueba, qué esperabas, qué pasó, el sistema
operativo y, si puedes, el libro que lo provoca (o uno parecido de dominio
público) y una captura.
