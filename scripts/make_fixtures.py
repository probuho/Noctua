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
            '<dc:identifier id="id">urn:uuid:noctua-sample</dc:identifier>'
            "<dc:title>Libro de prueba EPUB</dc:title><dc:creator>Noctua</dc:creator>"
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


# --- PDF ---------------------------------------------------------------------
#
# Minimal hand-written PDFs. Optional link annotations exercise internal and
# external links; optional RC4 encryption (standard security handler, R2,
# 40-bit) exercises the password prompt. Both are plain PDF 1.4 features.

import hashlib

PAD = bytes.fromhex("28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a")


def _rc4(key: bytes, data: bytes) -> bytes:
    s = list(range(256))
    j = 0
    for i in range(256):
        j = (j + s[i] + key[i % len(key)]) % 256
        s[i], s[j] = s[j], s[i]
    i = j = 0
    out = bytearray()
    for byte in data:
        i = (i + 1) % 256
        j = (j + s[i]) % 256
        s[i], s[j] = s[j], s[i]
        out.append(byte ^ s[(s[i] + s[j]) % 256])
    return bytes(out)


def _pad(password: str) -> bytes:
    return (password.encode("latin-1") + PAD)[:32]


class _Encryption:
    """Standard security handler, revision 2 (PDF 1.4 spec, algorithms 3.1-3.4)."""

    def __init__(self, user: str, owner: str, file_id: bytes, permissions: int = -4):
        self.p = permissions
        self.o = _rc4(hashlib.md5(_pad(owner)).digest()[:5], _pad(user))
        digest = hashlib.md5(_pad(user) + self.o + permissions.to_bytes(4, "little", signed=True) + file_id).digest()
        self.key = digest[:5]
        self.u = _rc4(self.key, PAD)

    def object_key(self, num: int) -> bytes:
        return hashlib.md5(self.key + num.to_bytes(3, "little") + (0).to_bytes(2, "little")).digest()[:10]

    def string(self, num: int, text: str) -> str:
        return "<" + _rc4(self.object_key(num), text.encode("latin-1")).hex() + ">"

    def dictionary(self) -> str:
        return f"<< /Filter /Standard /V 1 /R 2 /O <{self.o.hex()}> /U <{self.u.hex()}> /P {self.p} >>"


def make_pdf(path: Path, pages: int = 3, links: bool = True, password: str | None = None) -> None:
    file_id = hashlib.md5(path.name.encode()).digest()
    enc = _Encryption(password, password + "-owner", file_id) if password else None
    objects: list[bytes] = []

    def reserve() -> int:
        objects.append(b"")
        return len(objects)

    def put(num: int, body: str | bytes) -> None:
        objects[num - 1] = body.encode("latin-1") if isinstance(body, str) else body

    def text_string(num: int, text: str) -> str:
        return enc.string(num, text) if enc else f"({text})"

    def stream(num: int, data: str) -> bytes:
        raw = data.encode("latin-1")
        if enc:
            raw = _rc4(enc.object_key(num), raw)
        return f"<< /Length {len(raw)} >>\nstream\n".encode() + raw + b"\nendstream"

    catalog, pages_obj, font = reserve(), reserve(), reserve()
    put(catalog, f"<< /Type /Catalog /Pages {pages_obj} 0 R >>")
    put(font, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    page_nums = []
    for n in range(1, pages + 1):
        content, page = reserve(), reserve()
        page_nums.append(page)
        # A heading plus a few lines of plain ASCII text to select and search.
        lines = [f"Linea {i} del parrafo de prueba en la pagina {n}." for i in range(1, 6)]
        if links and n == 1:
            lines += ["Ir a la pagina 3 (enlace interno)", "Visitar example.org (enlace externo)"]
        body = " ".join(f"0 -24 Td ({line}) Tj" for line in lines)
        title = "Documento protegido" if enc else f"Pagina {n} de {pages}"
        put(content, stream(content, f"BT /F1 36 Tf 72 700 Td ({title}) Tj /F1 16 Tf 0 -24 Td {body} ET"))
        put(page, (content, n))  # filled below, once all page numbers are known

    for n, page in enumerate(page_nums, 1):
        content, _ = objects[page - 1]
        annots = ""
        if links and n == 1:
            # Lines 6 and 7 of page 1 sit at y = 700 - 24*7 and 700 - 24*8.
            internal, external = reserve(), reserve()
            put(internal, f"<< /Type /Annot /Subtype /Link /Rect [70 528 360 548] /Border [0 0 0] "
                          f"/Dest [{page_nums[-1]} 0 R /Fit] >>")
            put(external, f"<< /Type /Annot /Subtype /Link /Rect [70 504 380 524] /Border [0 0 0] "
                          f"/A << /S /URI /URI {text_string(external, 'https://example.org/')} >> >>")
            annots = f" /Annots [{internal} 0 R {external} 0 R]"
        put(page, f"<< /Type /Page /Parent {pages_obj} 0 R /MediaBox [0 0 612 792] "
                  f"/Resources << /Font << /F1 {font} 0 R >> >> /Contents {content} 0 R{annots} >>")

    put(pages_obj, f"<< /Type /Pages /Count {pages} /Kids [{' '.join(f'{k} 0 R' for k in page_nums)}] >>")
    info = reserve()
    put(info, f"<< /Title {text_string(info, 'Libro de prueba PDF' if not enc else 'PDF protegido')} "
              f"/Author {text_string(info, 'Noctua')} >>")
    encrypt = None
    if enc:
        encrypt = reserve()
        put(encrypt, enc.dictionary())

    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    out += b"".join(f"{o:010d} 00000 n \n".encode() for o in offsets)
    extra = f" /Encrypt {encrypt} 0 R" if encrypt else ""
    out += (f"trailer\n<< /Size {len(objects) + 1} /Root {catalog} 0 R /Info {info} 0 R{extra} "
            f"/ID [<{file_id.hex()}> <{file_id.hex()}>] >>\n").encode()
    out += f"startxref\n{xref}\n%%EOF\n".encode()
    path.write_bytes(bytes(out))


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    make_epub(OUT / "sample.epub")
    make_pdf(OUT / "sample.pdf")
    # Password: noctua
    make_pdf(OUT / "sample-protected.pdf", pages=2, links=False, password="noctua")
    print(f"Fixtures written to {OUT}")
