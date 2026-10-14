"""A small textbook as a PDF, the way publishers lay them out: cover, copyright, contents, preface,
chapters with headings, bold terms, lists and a table, running headers and page numbers, an index."""
from __future__ import annotations

import io

from reportlab.lib import colors
from reportlab.lib.pagesizes import A5
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (
    ListFlowable,
    ListItem,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

BODY = ParagraphStyle("body", fontName="Helvetica", fontSize=10, leading=13, spaceAfter=6)
H1 = ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=18, leading=22, spaceAfter=10)
H2 = ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=13, leading=16, spaceBefore=6, spaceAfter=6)
TITLE = ParagraphStyle("title", fontName="Helvetica-Bold", fontSize=26, leading=30, spaceAfter=20)

LONG = ("Water is called hard when it carries dissolved salts of calcium and magnesium. These salts come from the rocks "
        "the water flows through on its way to rivers and wells, and they change how water behaves with soap and in kettles. ")


def _page(canvas, doc):
    if doc.page > 3:  # running header and page number, like a real book
        canvas.setFont("Helvetica", 8)
        canvas.drawString(40, A5[1] - 30, "Science for Grade 8")
        canvas.drawString(A5[0] / 2, 25, str(doc.page))


def make_book() -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A5, leftMargin=40, rightMargin=40, topMargin=50, bottomMargin=50)
    s: list = [Paragraph("Science for Grade 8", TITLE), Paragraph("A. Author and B. Writer", BODY), PageBreak(),
               Paragraph("© 2024 Green Publishers. All rights reserved.", BODY), Paragraph("ISBN 978-1-23456-789-0", BODY),
               Paragraph("First published 2024. Printed in India.", BODY), PageBreak(),
               Paragraph("Contents", H1)]
    for name, page in [("Preface", 4), ("1 Water", 5), ("Hard and soft water", 5), ("2 Air", 7), ("Index", 9)]:
        s.append(Paragraph(f"{name} {'.' * 30} {page}", BODY))
    s += [PageBreak(), Paragraph("Preface", H1), Paragraph("This book was written for students and teachers. We thank our families.", BODY), PageBreak(),
          Paragraph("Chapter 1 Water", H1), Paragraph("Hard and soft water", H2),
          Paragraph(LONG * 2 + "Hardness is measured in <b>parts per million</b> of calcium carbonate.", BODY),
          ListFlowable([ListItem(Paragraph("Temporary hardness goes away when water is boiled.", BODY)),
                        ListItem(Paragraph("Permanent hardness needs washing soda or ion exchange.", BODY))], bulletType="bullet"),
          Paragraph("Kinds of hardness", H2)]
    t = Table([["Kind", "Cause", "Removed by"], ["Temporary", "Bicarbonates", "Boiling"], ["Permanent", "Sulphates", "Washing soda"]])
    t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.5, colors.black), ("FONTSIZE", (0, 0), (-1, -1), 9)]))
    s += [t, Spacer(1, 8), Paragraph("Boiling turns soluble calcium bicarbonate into insoluble calcium carbonate, which settles as scale.", BODY),
          PageBreak(), Paragraph("Chapter 2 Air", H1), Paragraph("What air is made of", H2),
          Paragraph("Air is a mixture of gases. About 78 percent is nitrogen and 21 percent is oxygen.", BODY), PageBreak(),
          Paragraph("Index", H1), Paragraph("air, 7", BODY), Paragraph("boiling, 5, 6", BODY), Paragraph("hardness, 5", BODY)]
    doc.build(s, onFirstPage=_page, onLaterPages=_page)
    return buf.getvalue()


if __name__ == "__main__":
    import sys
    sys.stdout.buffer.write(make_book())
