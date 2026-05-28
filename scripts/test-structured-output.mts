import assert from "node:assert/strict";
import {
  parseAiStructuredOutput,
  pdfTextPagesToCsvFallback,
  recordsToCsv,
  StructuredOutputError,
  tryParseCsvLikeOutput,
} from "../lib/structured-output.ts";

const valid = parseAiStructuredOutput(
  JSON.stringify({
    mode: "structured",
    columns: ["Lugar", "Detalle"],
    rows: [{ Lugar: "General Güemes, Salta", Detalle: 'Empresa "ABC"' }],
  }),
);

assert.deepEqual(valid.columns, ["Lugar", "Detalle"]);
assert.equal(valid.rows[0]?.Lugar, "General Güemes, Salta");

const fenced = parseAiStructuredOutput(`\`\`\`json
{
  "mode": "structured",
  "columns": ["Estado", "Mensaje"],
  "rows": [{ "Estado": "OK", "Mensaje": "Procesado" }]
}
\`\`\``);

assert.equal(fenced.rows[0]?.Estado, "OK");

assert.throws(
  () => parseAiStructuredOutput("<!DOCTYPE html><html><body>Error</body></html>"),
  (error) =>
    error instanceof StructuredOutputError &&
    error.code === "AI_RESPONSE_HTML_INSTEAD_OF_JSON" &&
    error.technicalDetail === "AI returned HTML instead of JSON",
);

const csvFallback = parseAiStructuredOutput(`N° Anexo,Nombre Anexo,Romano,N° Punto,Frecuencia,Tipo de Plazo,Cant. Días
1,Obligaciones Formales,I,1,Permanente,Permanente,
2,Informe mensual,II,3,Mensual,Días corridos,30`);

assert.deepEqual(csvFallback.columns, [
  "N° Anexo",
  "Nombre Anexo",
  "Romano",
  "N° Punto",
  "Frecuencia",
  "Tipo de Plazo",
  "Cant. Días",
]);
assert.equal(csvFallback.rows.length, 2);
assert.equal(csvFallback.rows[0]?.["Nombre Anexo"], "Obligaciones Formales");

const quotedCsvFallback = tryParseCsvLikeOutput(`Lugar,Detalle
"General Güemes, Salta","Empresa ""ABC"" con observación"
"Salta","Sin novedad"`);

assert.equal(quotedCsvFallback?.rows[0]?.Lugar, "General Güemes, Salta");
assert.equal(quotedCsvFallback?.rows[0]?.Detalle, 'Empresa "ABC" con observación');

assert.throws(
  () =>
    parseAiStructuredOutput(
      "Este es un resumen narrativo sin estructura tabular ni objeto JSON suficiente.",
    ),
  (error) =>
    error instanceof StructuredOutputError &&
    error.code === "AI_RESPONSE_NOT_JSON",
);

const csv = recordsToCsv(["Lugar", "Empresa"], [
  { Lugar: "General Güemes, Salta", Empresa: 'Empresa "ABC"\nNueva línea' },
]);

assert.equal(
  csv,
  '"Lugar","Empresa"\n"General Güemes, Salta","Empresa ""ABC"" Nueva línea"',
);

const duplicateColumnsCsv = recordsToCsv(["Campo", "Campo", "", "Detalle\nExtra"], [
  { Campo: "Valor", "Detalle\nExtra": "Dato" },
]);

assert.equal(
  duplicateColumnsCsv,
  '"Campo","Campo_2","Columna_3","Detalle Extra"\n"Valor","Valor","","Dato"',
);

const commercialCsv = recordsToCsv(
  ["CUIT Receptor", "PesoTotal", "TipoDocumento", "Numero Documento", "Producto/Uso", "CADTV"],
  [
    {
      "CUIT Receptor": "30711111119",
      PesoTotal: "0001234567890123",
      TipoDocumento: "DTVe",
      "Numero Documento": "000000123",
      "Producto/Uso": "Papa consumo",
      CADTV: "ABC123",
    },
  ],
);

assert.ok(commercialCsv.startsWith('"TipoDocumento","Organismo","NumeroDocumento","CUVE","CADTV"'));
assert.ok(commercialCsv.includes('"DTVe","","000000123","","ABC123"'));
assert.ok(commercialCsv.includes('"Papa consumo"'));
assert.ok(commercialCsv.includes('"0001234567890123"'));

const pdfFallback = pdfTextPagesToCsvFallback([
  {
    pageNumber: 1,
    text: `N° Anexo Nombre Anexo Romano N° Punto Frecuencia Tipo de Plazo Cant. Días

1 Obligaciones Formales I 1 Permanente Permanente
General Güemes, Salta "POSCO"`,
  },
  {
    pageNumber: 2,
    text: "Conclusión con espacios    múltiples",
  },
]);

assert.deepEqual(pdfFallback.columns, ["Página", "Línea", "Texto"]);
assert.equal(pdfFallback.rows.length, 4);
assert.equal(pdfFallback.rows[0]?.Página, "1");
assert.equal(pdfFallback.rows[0]?.Línea, "1");
assert.equal(
  pdfFallback.csvContent,
  '"Página","Línea","Texto"\n' +
    '"1","1","N° Anexo Nombre Anexo Romano N° Punto Frecuencia Tipo de Plazo Cant. Días"\n' +
    '"1","2","1 Obligaciones Formales I 1 Permanente Permanente"\n' +
    '"1","3","General Güemes, Salta ""POSCO"""\n' +
    '"2","1","Conclusión con espacios múltiples"',
);

console.log("structured-output tests passed");
