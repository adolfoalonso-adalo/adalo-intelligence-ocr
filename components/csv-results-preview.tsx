"use client";

import { parseCsvPreview } from "@/lib/csv-preview";

type CsvResultsPreviewProps = {
  csvContent: string;
};

const MAX_VISIBLE_COLUMNS = 8;
const MAX_VISIBLE_ROWS = 5;

export function CsvResultsPreview({ csvContent }: CsvResultsPreviewProps) {
  const preview = parseCsvPreview(csvContent);
  const visibleColumns = preview.columns.slice(0, MAX_VISIBLE_COLUMNS);
  const visibleRows = preview.rows.slice(0, MAX_VISIBLE_ROWS);
  const hiddenColumns = Math.max(preview.columns.length - visibleColumns.length, 0);
  const hiddenRows = Math.max(preview.rows.length - visibleRows.length, 0);

  if (preview.columns.length === 0) {
    return null;
  }

  return (
    <section className="rounded-2xl border border-brand-border bg-brand-card/85 p-4 text-left shadow-sm sm:p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-brand-ink">Vista previa de resultados</h3>
        <p className="mt-1 text-xs leading-5 text-brand-slate">
          Revisa una muestra de los datos extraidos antes de descargar el archivo completo.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-brand-border">
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-xs">
            <thead className="bg-brand-soft text-brand-deep">
              <tr>
                {visibleColumns.map((column, columnIndex) => (
                  <th
                    key={`${column}-${columnIndex}`}
                    scope="col"
                    className="max-w-40 border-b border-brand-border px-3 py-2 text-left font-semibold"
                  >
                    <span className="block truncate">{column}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border bg-white/70 text-brand-slate">
              {visibleRows.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`}>
                  {visibleColumns.map((column, columnIndex) => (
                    <td key={`${column}-${columnIndex}`} className="max-w-48 px-3 py-2 align-top">
                      <span className="block truncate">{row[columnIndex] ?? ""}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {hiddenColumns > 0 || hiddenRows > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2 text-xs font-medium text-brand-slate">
          {hiddenColumns > 0 ? (
            <span className="rounded-full bg-brand-soft px-3 py-1">
              + {hiddenColumns} columnas adicionales
            </span>
          ) : null}
          {hiddenRows > 0 ? (
            <span className="rounded-full bg-brand-soft px-3 py-1">
              + {hiddenRows} registros adicionales
            </span>
          ) : null}
        </div>
      ) : null}

      <p className="mt-3 text-xs text-brand-slate">
        CSV preparado para Excel, Power BI y automatizaciones Microsoft 365.
      </p>
    </section>
  );
}
