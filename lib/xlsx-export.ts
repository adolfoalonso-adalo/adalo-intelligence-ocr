export async function createXlsxBase64(input: {
  columns: string[];
  rows: Record<string, string>[];
  sheetName?: string;
}) {
  const excelModule = await import("exceljs");
  const ExcelJS = excelModule.default ?? excelModule;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ADALO OCR";
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet(
    sanitizeSheetName(input.sheetName || "Resultados"),
    {
      views: [{ state: "frozen", ySplit: 1 }],
    },
  );

  worksheet.columns = input.columns.map((header) => ({
    header,
    key: header,
    width: estimateColumnWidth(
      header,
      input.rows.map((row) => row[header] ?? ""),
    ),
    style: { numFmt: "@" },
  }));

  for (const row of input.rows) {
    worksheet.addRow(
      Object.fromEntries(
        input.columns.map((column) => [column, String(row[column] ?? "")]),
      ),
    );
  }

  const header = worksheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF0D5B50" },
  };
  header.alignment = { vertical: "middle", wrapText: true };
  header.height = 28;
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(worksheet.rowCount, 1), column: input.columns.length },
  };

  for (let rowIndex = 2; rowIndex <= worksheet.rowCount; rowIndex += 1) {
    const row = worksheet.getRow(rowIndex);
    row.alignment = { vertical: "top", wrapText: true };
    if (rowIndex % 2 === 0) {
      row.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF2F8F5" },
      };
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer).toString("base64");
}

function estimateColumnWidth(header: string, values: string[]) {
  const longest = values.reduce(
    (length, value) => Math.max(length, String(value).length),
    header.length,
  );
  return Math.min(Math.max(longest + 2, 12), 42);
}

function sanitizeSheetName(value: string) {
  return value.replace(/[\\/*?:[\]]/g, " ").trim().slice(0, 31) || "Resultados";
}
