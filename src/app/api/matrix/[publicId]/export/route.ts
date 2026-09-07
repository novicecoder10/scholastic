import { NextRequest, NextResponse } from "next/server";
import { readOwner } from "@/lib/auth/owner";
import { toCsv } from "@/lib/extraction/csv";
import { renderMatrixMarkdown, type MarkdownRow } from "@/lib/extraction/markdownTable";
import { documentTitles, findMatrix, matrixContents } from "@/lib/extraction/repository";
import { logger } from "@/lib/log/logger";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ publicId: string }>;
}

/** Filenames land in a Content-Disposition header, where a quote or newline in
 * a user-chosen title would forge header content. */
function safeFilename(name: string, extension: string): string {
  const base = name.replace(/[^A-Za-z0-9 _-]/g, "").trim() || "matrix";
  return `${base.slice(0, 60)}.${extension}`;
}

/**
 * The export carries the **provenance**, not only the values: every found cell
 * exports its page and its verbatim quote alongside the value.
 *
 * A CSV of bare numbers extracted by a model is precisely the artefact that
 * should not exist — it looks like data and cannot be checked. Anyone auditing
 * a row must be able to get back to the sentence it came from.
 *
 * `?format=md` renders the same content as a Markdown table for pasting into a
 * draft, with the quotes underneath it. Same rule, different shape: the format
 * changes, the evidence does not get left behind.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { publicId } = await params;
  const markdown = request.nextUrl.searchParams.get("format") === "md";
  const owner = await readOwner();
  const notFound = NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!owner) return notFound;

  try {
    const found = await findMatrix(owner, publicId);
    if (!found) return notFound;

    const { columns, rows, cells } = await matrixContents(found.id);
    const titles = await documentTitles(rows.map((r) => r.documentId));
    const byPair = new Map(cells.map((c) => [`${c.rowId}:${c.columnId}`, c]));

    const header = ["Document", "Document ID"];
    for (const column of columns)
      header.push(column.label, `${column.label} — page`, `${column.label} — quote`);

    const body = rows.map((row) => {
      const line: Array<string | null> = [
        titles.get(row.documentId) ?? row.documentId,
        row.documentId,
      ];
      for (const column of columns) {
        const cell = byPair.get(`${row.id}:${column.id}`);
        if (!cell) {
          line.push("", "", "");
        } else if (cell.status === "found") {
          line.push(
            cell.unit ? `${cell.value} ${cell.unit}` : cell.value,
            cell.pageNumber != null ? String(cell.pageNumber) : "",
            cell.quote,
          );
        } else {
          // "not reported" is written out in full rather than left blank. A
          // blank cell in a spreadsheet is read as missing data; this is a
          // finding about the paper.
          line.push(cell.status === "not_reported" ? "not reported" : "error", "", "");
        }
      }
      return line;
    });

    if (markdown) {
      const mdRows: MarkdownRow[] = rows.map((row) => ({
        document: titles.get(row.documentId) ?? row.documentId,
        cells: columns.map((column) => {
          const cell = byPair.get(`${row.id}:${column.id}`);
          if (!cell) return { value: null, pageNumber: null, quote: null, status: "error" };
          return {
            value: cell.unit ? `${cell.value} ${cell.unit}` : cell.value,
            pageNumber: cell.pageNumber ?? null,
            quote: cell.quote ?? null,
            status: cell.status,
          };
        }),
      }));
      return new NextResponse(
        renderMatrixMarkdown(
          found.title,
          columns.map((column) => column.label),
          mdRows,
        ),
        {
          headers: {
            "Content-Type": "text/markdown; charset=utf-8",
            "Content-Disposition": `attachment; filename="${safeFilename(found.title, "md")}"`,
          },
        },
      );
    }

    return new NextResponse(toCsv([header, ...body]), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safeFilename(found.title, "csv")}"`,
      },
    });
  } catch (err) {
    logger.error({ event: "matrix_export_failed", err: String(err) }, "matrix export failed");
    return NextResponse.json({ error: "Couldn't export that matrix." }, { status: 503 });
  }
}
