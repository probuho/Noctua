"""Generate tiny EPUB and PDF sample books for development and tests.

Usage: python scripts/make_fixtures.py   (writes to dev/fixtures/)
The content is original placeholder text, so the files can be redistributed.
"""

import zipfile
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "dev" / "fixtures"

LOREM = (
    "Este es un libro de ejemplo generado para probar el lector. "
    "Cada capítulo tiene suficiente texto para ocupar varias páginas. "
) * 40


def make_epub(path: Path) -> None:
    chapters = [f"Capítulo {i}" for i in range(1, 4)]
    with zipfile.ZipFile(path, "w") as z:
        z.writestr(zipfile.ZipInfo("mimetype"), "application/epub+zip", zipfile.ZIP_STORED)
        z.writestr(
            "META-INF/container.xml",
            '<?xml version="1.0"?><container version="1.0" '
            'xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles>'
            '<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>'
            "</rootfiles></container>",
        )
        manifest = "".join(
            f'<item id="c{i}" href="c{i}.xhtml" media-type="application/xhtml+xml"/>'
            for i in range(1, 4)
        )
        spine = "".join(f'<itemref idref="c{i}"/>' for i in range(1, 4))
        z.writestr(
            "OEBPS/content.opf",
            '<?xml version="1.0" encoding="utf-8"?>'
            '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">'
            '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
            '<dc:identifier id="id">urn:uuid:open-ebook-reader-sample</dc:identifier>'
            "<dc:title>Libro de prueba EPUB</dc:title><dc:creator>Open Ebook Reader</dc:creator>"
            '<dc:language>es</dc:language><meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>'
            "</metadata><manifest>"
            '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'
            f"{manifest}</manifest><spine>{spine}</spine></package>",
        )
        links = "".join(f'<li><a href="c{i}.xhtml">{t}</a></li>' for i, t in enumerate(chapters, 1))
        z.writestr(
            "OEBPS/nav.xhtml",
            '<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" '
            'xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Índice</title></head><body>'
            f'<nav epub:type="toc"><ol>{links}</ol></nav></body></html>',
        )
        for i, title in enumerate(chapters, 1):
            z.writestr(
                f"OEBPS/c{i}.xhtml",
                '<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml">'
                f"<head><title>{title}</title></head><body><h1>{title}</h1>"
                + "".join(f"<p>{LOREM}</p>" for _ in range(3))
                + "</body></html>",
            )


def make_pdf(path: Path, pages: int = 3) -> None:
    objects: list[bytes] = []

    def add(body: str) -> int:
        objects.append(body.encode("latin-1"))
        return len(objects)

    add("<< /Type /Catalog /Pages 2 0 R >>")
    add("")  # pages tree, filled below
    font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    kids = []
    for n in range(1, pages + 1):
        text = f"BT /F1 36 Tf 72 700 Td (Pagina {n} de {pages}) Tj ET"
        stream = add(f"<< /Length {len(text)} >>\nstream\n{text}\nendstream")
        kids.append(add(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            f"/Resources << /Font << /F1 {font} 0 R >> >> /Contents {stream} 0 R >>"
        ))
    objects[1] = (
        f"<< /Type /Pages /Count {pages} /Kids [{' '.join(f'{k} 0 R' for k in kids)}] >>"
    ).encode("latin-1")
    info = add("<< /Title (Libro de prueba PDF) /Author (Open Ebook Reader) >>")

    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    out += b"".join(f"{o:010d} 00000 n \n".encode() for o in offsets)
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R /Info {info} 0 R >>\n".encode()
    out += f"startxref\n{xref}\n%%EOF\n".encode()
    path.write_bytes(bytes(out))


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    make_epub(OUT / "sample.epub")
    make_pdf(OUT / "sample.pdf")
    print(f"Fixtures written to {OUT}")
