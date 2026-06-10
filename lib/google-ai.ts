import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  getClientProfileCode,
  isVisionTableProfile,
  type ClientProfile,
} from "@/lib/client-profiles";
import { createCsvFileName } from "@/lib/csv";
import { chunkPdfPages, PdfChunkingError } from "@/lib/chunk-text";
import type { DocumentType } from "@/lib/document-type";
import { createLocalPdfTextFallbackResult } from "@/lib/pdf-local-fallback";
import {
  getPdfPageCount,
  renderPdfPageToImage,
  PdfPageRenderError,
} from "@/lib/pdf-page-render";
import {
  extractPdfTextByPages,
  PdfTextExtractionError,
  type PdfTextExtractionResult,
} from "@/lib/pdf-text";
import {
  assessExtractionQuality,
  areStructuredChunkColumns,
  createChunkErrorRow,
  type ExtractionQualityContext,
  isRecoverableStructuredOutputError,
  mergeStructuredOutputs,
  type ParsedStructuredOutput,
  parseAiStructuredOutput,
  recordsToCsv,
  StructuredOutputError,
  tryParseCsvLikeOutput,
} from "@/lib/structured-output";

export type CsvAnalysisResult = {
  csvContent: string;
  fileName: string;
  extractedRows: number;
  jsonColumns?: string[];
  jsonRows?: Record<string, string>[];
  modelUsed: string;
  profileValidationWarnings?: string[];
  resultQuality?: "ai" | "partial" | "local-fallback";
  extractionMode?: string;
  pagesProcessed?: number;
  providerConfidence?: number;
  rowsExtracted?: number;
  visualStructuringProvider?: string;
  warnings?: string[];
  personnelQualityMetrics?: {
    filasConCUIL: number;
    filasConLocalidad: number;
    filasConLugarTrabajo: number;
    filasConNombre: number;
    filasConProvincia: number;
    porcentajeCompletitud: number;
    totalRegistros: number;
  };
};

export class CsvAnalysisError extends Error {
  readonly technicalDetail: string;

  constructor(
    message: string,
    technicalDetail: string,
  ) {
    super(message);
    this.name = "CsvAnalysisError";
    this.technicalDetail = technicalDetail;
  }
}

export class GoogleAiTemporaryError extends Error {
  readonly technicalDetail: string;
  readonly fallbackFailed: boolean;

  constructor(
    message: string,
    technicalDetail: string,
    fallbackFailed = false,
  ) {
    super(message);
    this.name = "GoogleAiTemporaryError";
    this.technicalDetail = technicalDetail;
    this.fallbackFailed = fallbackFailed;
  }
}

class OcrTimeBudgetError extends Error {
  readonly technicalDetail: string;

  constructor(stage: string) {
    super("El procesamiento tardó demasiado. Probá dividir el documento o intentá nuevamente.");
    this.name = "OcrTimeBudgetError";
    this.technicalDetail = `OCR time budget exceeded at ${stage}`;
  }
}

class AiOutputQualityError extends Error {
  readonly technicalDetail: string;

  constructor(reason: string) {
    super("AI result quality was too low");
    this.name = "AiOutputQualityError";
    this.technicalDetail = reason;
  }
}

class ProfileExtractionValidationError extends Error {
  readonly technicalDetail: string;

  constructor(message: string, technicalDetail: string) {
    super(message);
    this.name = "ProfileExtractionValidationError";
    this.technicalDetail = technicalDetail;
  }
}

type OcrTimeBudget = {
  maxMs: number;
  startedAt: number;
};

const STRUCTURED_OUTPUT_ERROR_MESSAGE =
  "No se pudo estructurar la respuesta del modelo. Intentá nuevamente.";

const DIRECT_FILE_PROMPT = `Actuá como un sistema OCR y extractor de datos para ADALO Consulting Group.

Tu tarea es leer el archivo cargado, que puede ser PDF, imagen JPG, JPEG o PNG, y transformar la información útil en JSON estructurado para que el servidor genere un CSV seguro.

Primero identificá el tipo de documento:

1. Si el documento contiene una tabla principal clara, usá "mode": "table", respetá sus columnas originales y generá una fila por cada registro.

2. Si el archivo es una foto o captura:
- corregí mentalmente rotaciones leves, perspectiva, sombras o ruido visual;
- extraé texto visible;
- identificá tablas, listas, tickets, remitos, facturas, notas, formularios, capturas de sistemas o documentos administrativos;
- si hay una tabla, respetá filas y columnas;
- si no hay tabla clara, generá JSON normalizado.

3. Si el documento es narrativo, ejecutivo, técnico, administrativo o mixto, usá "mode": "structured" y estas columnas exactas:

Sección
Tipo de dato
Título
Descripción
Fecha
Expediente
Empresa
Volumen
Cantidad
Estado
Riesgo
Decisión/Recomendación

Respondé exclusivamente JSON válido con esta estructura:

{
  "mode": "table" | "structured",
  "columns": ["columna1", "columna2"],
  "rows": [
    {
      "columna1": "valor",
      "columna2": "valor"
    }
  ]
}

Reglas:
- Para tickets, facturas, remitos o comprobantes comerciales, intentá detectar campos como Fecha, Emisor, CUIT, Punto de venta, Comprobante, Cliente, Producto/Servicio, Cantidad, Precio unitario, IVA, Total, Forma de pago y Observaciones, sin limitar el extractor solo a ese tipo de documento.
- Respondé exclusivamente JSON válido.
- El primer carácter de la respuesta debe ser {.
- El último carácter de la respuesta debe ser }.
- No uses markdown.
- No envuelvas la respuesta en \`\`\`json.
- No uses HTML.
- No agregues explicaciones antes ni después.
- No inventes información.
- Si un dato no aparece, usá string vacío "".
- Identificá fechas, expedientes, empresas, lugares, volúmenes, cantidades, estados, riesgos, incumplimientos, autorizaciones, requerimientos y decisiones.
- Si hay línea de tiempo, cada evento debe ser una fila.
- Si hay requerimientos numerados, cada requerimiento debe ser una fila.
- Si hay conclusiones, cada conclusión relevante debe ser una fila.
- Si hay indicadores destacados, cada indicador debe ser una fila.
- Cada fila debe ser un objeto JSON.
- No uses arrays dentro de celdas; si hay varios valores, separalos con punto y coma.
- No uses saltos de línea dentro de valores; reemplazalos por espacios.

Si el archivo es ilegible, devolver:
{
  "mode": "table" | "structured",
  "columns": ["Estado", "Mensaje"],
  "rows": [
    {
      "Estado": "No procesado",
      "Mensaje": "El archivo no contiene información legible o estructurable."
    }
  ]
}`;

function createDirectFilePrompt(documentType: DocumentType, clientProfile?: ClientProfile) {
  return `${DIRECT_FILE_PROMPT}

${getClientProfilePromptGuidance(clientProfile)}

${getDocumentTypePromptGuidance(documentType)}`;
}

function createAdvancedOcrNormalizationPrompt({
  clientProfile,
  documentType,
  extractedTablesText,
  extractedText,
  fileName,
  pageCount,
  providerLabel,
}: {
  clientProfile?: ClientProfile;
  documentType: DocumentType;
  extractedTablesText?: string;
  extractedText: string;
  fileName: string;
  pageCount?: number;
  providerLabel: string;
}) {
  return `Actua como normalizador documental ADALO.

Recibiste texto y tablas extraidas por un proveedor OCR avanzado (${providerLabel}). Tu tarea NO es hacer OCR visual, sino convertir esa salida OCR a JSON estructurado para que el servidor genere CSV/JSON seguros.

Archivo: ${fileName}
Paginas procesadas: ${pageCount ?? "desconocido"}

${getClientProfilePromptGuidance(clientProfile)}

${getDocumentTypePromptGuidance(documentType)}

Reglas generales:
- Responde exclusivamente JSON valido.
- El primer caracter debe ser { y el ultimo debe ser }.
- No uses markdown.
- No uses HTML.
- No inventes datos.
- Si un dato no aparece o es ilegible, usa "".
- No devuelvas Pagina/Linea/Texto como estructura final.
- Si hay tablas, prioriza filas y columnas reales de tabla.
- En tablas multipagina, conserva el mismo esquema entre paginas y concatena todos los registros.
- Trata encabezados repetidos al inicio de cada pagina como encabezados, no como filas de datos.
- No mezcles celdas de filas distintas aunque el OCR haya perdido bordes o separadores.
- Usa la posicion y el orden del texto OCR para reconstruir columnas cuando una tabla escaneada llegue fragmentada.
- En formularios administrativos, consolida los pares campo/valor de una misma operacion en una fila cuando corresponda.
- En listados administrativos, genera una fila por registro y conserva identificadores, fechas, CUIT, expedientes y codigos como texto.
- Ignora encabezados de pagina, pies, folios, sellos, firmas, marcas de agua, URLs y textos de escaner que no pertenezcan a los datos.
- Si una celda no puede asociarse con confianza a una columna, dejala vacia; no desplaces el resto de la fila.
- Revisa la salida completa antes de responder: las columnas deben ser consistentes y cada row debe usar exactamente esas claves.
- El servidor va a generar el CSV final; no devuelvas CSV directo.

Si el perfil es Movimiento, usa exactamente estas columnas y este orden:
FechaSalida
CantidadCamion
Unidad
Tons
Proveedor
Producto
Origen
RutaCaminosPuna
Destino
FechaArribo
CantidadEscoltas

Para Movimiento:
- una fila por cada movimiento logistico real;
- ignora CamScanner, URLs, folios, sellos, bordes, sombras y numeros de pagina;
- no mezcles filas;
- normaliza fechas a DD/MM/YYYY solo cuando sea claro;
- si no hay filas validas, devuelve rows: [].

Estructura requerida:
{
  "mode": "table" | "structured",
  "columns": [],
  "rows": []
}

Tablas detectadas por OCR avanzado:
${truncateAdvancedOcrText(extractedTablesText || "Sin tablas detectadas")}

Texto completo detectado por OCR avanzado:
${truncateAdvancedOcrText(extractedText)}`;
}

function getClientProfilePromptGuidance(clientProfile?: ClientProfile) {
  if (!clientProfile || clientProfile.defaultExtractionProfile === "general") {
    return "";
  }

  return `Perfil interno de extraccion: ${clientProfile.defaultExtractionProfile}.
Codigo de perfil: ${getClientProfileCode(clientProfile)}.
Nombre de perfil: ${clientProfile.label}.
Modo de extraccion recomendado: ${clientProfile.extractionMode ?? "auto"}.
Tipo documental interno: ${clientProfile.documentType ?? "auto"}.
Columnas/campos esperados: ${(clientProfile.expectedColumns ?? []).join(", ") || "segun documento"}.
Textos a ignorar: ${(clientProfile.ignoreText ?? []).join(", ") || "ninguno especifico"}.
${clientProfile.promptHint || ""}`;
}

function getDocumentTypePromptGuidance(documentType: DocumentType) {
  if (documentType === "table") {
    return `Modo seleccionado por el usuario: Tabla o listado.

Actuá como un sistema OCR especializado en tablas fotografiadas y listados administrativos.
Tu tarea es reconstruir la tabla en datos estructurados.

Reglas específicas:
- Identificá encabezados de columna.
- Conservá una fila por cada registro visible.
- No mezcles filas.
- No inventes datos.
- Si un valor no se lee con claridad, dejalo vacío o agregá observación.
- Preservá números como CUIT, CP, DNI, expedientes o códigos sin reformatearlos.
- Si la tabla tiene columnas visibles como N°, Razón Social, CUIT, Provincia, Localidad, CP, Actividad Principal, usalas como columnas.
- Si hay texto fuera de la tabla, ignoralo salvo que sea título o contexto útil.
- Respondé JSON válido con "mode": "table", "columns": [] y "rows": [].`;
  }

  if (documentType === "invoice") {
    return `Modo seleccionado por el usuario: Factura / ticket / remito.

Optimizá la extracción para tickets, facturas, remitos y comprobantes.
Si el documento tiene detalle de productos o servicios, preferí columnas como Fecha, Emisor, CUIT, Comprobante, Cliente, Producto/Servicio, Cantidad, Precio unitario, IVA, Importe, Total, Forma de pago y Observaciones.
Si no hay detalle claro, usá columnas Campo, Valor y Observación.`;
  }

  if (documentType === "report") {
    return `Modo seleccionado por el usuario: Documento técnico / administrativo.

Usá estas columnas exactas cuando el documento sea una ficha descriptiva, resumen ejecutivo, expediente o documento técnico-administrativo:
Sección, Categoría, Dato, Valor, Detalle, Fecha, Expediente/Resolución, Empresa/Proyecto, Ubicación, Observación.

Reglas específicas:
- Una fila por cada dato relevante.
- Si hay viñetas por sección, cada viñeta debe ser una fila.
- Si hay resoluciones anteriores, cada resolución debe ser una fila.
- Si hay componentes de proyecto, cada componente debe ser una fila.
- Si hay consumos de agua/energía, cada dato debe ser una fila.
- Si hay documentos en proceso, cada expediente debe ser una fila.
- Si hay inspecciones realizadas, cada inspección debe ser una fila.
- No inventes datos.
- Si no hay dato para una columna, usá "".
- No devuelvas Página/Línea/Texto salvo que el archivo sea completamente imposible de estructurar.`;
  }

  return `Modo interno: automatico.

Antes de extraer, identifica internamente que tipo de documento es:
- tabla o listado;
- comprobante, factura, remito, formulario comercial, certificado de carga o movimiento;
- documento tecnico/administrativo;
- otro documento estructurable.

Luego elegi la estructura de salida mas adecuada.

Reglas especificas:
- Si detectas tabla clara, devolve una tabla con los encabezados originales.
- Si detectas comprobante/remito/formulario, extrae campos comerciales y operativos.
- Si detectas documento tecnico/administrativo, extrae por secciones, datos, expedientes, resoluciones, fechas y observaciones.
- No devuelvas una sola columna generica si se puede estructurar mejor.
- No devuelvas Pagina/Linea/Texto salvo como ultimo fallback local.
- No inventes datos.
- Si un dato no se lee, dejalo vacio.`;
}

export async function analyzePdfToCsv(
  fileBuffer: Buffer,
  fileName: string,
): Promise<CsvAnalysisResult> {
  return analyzeFileToCsv(fileBuffer, fileName, "application/pdf", "auto");
}

export async function analyzeFileToCsv(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  documentType: DocumentType = "auto",
  clientProfile?: ClientProfile,
): Promise<CsvAnalysisResult> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  const modelName = process.env.GOOGLE_AI_MODEL || "gemini-2.5-flash";
  const fallbackModelName = process.env.GOOGLE_AI_FALLBACK_MODEL || "gemini-2.0-flash";
  const experimentalModelName = process.env.GOOGLE_AI_EXPERIMENTAL_MODEL || "";
  const normalizedMimeType = normalizeSupportedMimeType(mimeType);
  const budget = createTimeBudget();

  if (!apiKey) {
    const columns = ["Estado", "Mensaje", "Archivo"];
    const rows = [
      {
        Estado: "Modo desarrollo",
        Mensaje: "Configurá GOOGLE_AI_API_KEY para activar el análisis real con Google AI",
        Archivo: fileName,
      },
    ];
    const csvContent = recordsToCsv(columns, rows);

    return {
      csvContent,
      fileName: createCsvFileName(),
      extractedRows: rows.length,
      modelUsed: "mock-local",
      resultQuality: "ai",
    };
  }

  if (normalizedMimeType === "application/pdf") {
    const result = await analyzePdfFileToCsv({
      apiKey,
      experimentalModelName,
      fallbackModelName,
      fileBuffer,
      fileName,
      modelName,
      documentType,
      clientProfile,
      budget,
    });
    logAnalyzeFileToCsvResult(result);
    return result;
  }

  // TODO: OCR local visual para imagenes no implementado; JPG/PNG dependen del motor IA.
  const result = await analyzeDirectFileToCsv({
    apiKey,
    experimentalModelName,
    fallbackModelName,
    fileName,
    fileBuffer,
    mimeType: normalizedMimeType,
    modelName,
    documentType,
    clientProfile,
    budget,
  });
  logAnalyzeFileToCsvResult(result);
  return result;
}

export async function analyzeExtractedDocumentToCsv({
  clientProfile,
  documentType = "auto",
  extractedText,
  extractedTablesText,
  fileName,
  pageCount,
  providerLabel,
}: {
  clientProfile?: ClientProfile;
  documentType?: DocumentType;
  extractedText: string;
  extractedTablesText?: string;
  fileName: string;
  pageCount?: number;
  providerLabel: string;
}): Promise<CsvAnalysisResult> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  const modelName = process.env.GOOGLE_AI_MODEL || "gemini-2.5-flash";
  const fallbackModelName = process.env.GOOGLE_AI_FALLBACK_MODEL || "gemini-2.0-flash";
  const experimentalModelName = process.env.GOOGLE_AI_EXPERIMENTAL_MODEL || "";
  const budget = createTimeBudget();

  if (!apiKey) {
    throw new CsvAnalysisError(
      "Google AI no esta configurado para normalizar la salida OCR avanzada.",
      "GOOGLE_AI_API_KEY_REQUIRED_FOR_ADVANCED_OCR_NORMALIZATION",
    );
  }

  const prompt = createAdvancedOcrNormalizationPrompt({
    clientProfile,
    documentType,
    extractedTablesText,
    extractedText,
    fileName,
    pageCount,
    providerLabel,
  });
  const { output, modelUsed } = await generateStructuredOutputWithResilience({
    apiKey,
    budget,
    experimentalModelName,
    fallbackModelName,
    modelName,
    parts: [prompt],
    timeoutMs: getMovementVisualPageTimeoutMs(),
    context: {
      stage: "direct-file-analysis",
      documentType,
      clientProfileId: clientProfile?.id,
      extractionProfile: clientProfile?.defaultExtractionProfile,
      model: modelName,
      mimeType: "text/plain",
      fileName,
    },
  });

  if (output.rows.length === 0) {
    throw new CsvAnalysisError(
      "La extraccion avanzada no encontro filas estructurables.",
      "ADVANCED_OCR_NORMALIZATION_EMPTY_ROWS",
    );
  }

  if (isVisionTableProfile(clientProfile) && clientProfile) {
    const normalized = normalizeVisionTableProfileOutput(output.columns, output.rows, clientProfile);
    const filteredRows = filterVisionTableRows(normalized.csvRows, clientProfile);
    const csvContent = recordsToCsv(normalized.csvColumns, filteredRows);

    validateVisionTableProfileOutput({
      columns: normalized.csvColumns,
      rows: filteredRows,
      clientProfile,
    });

    return {
      csvContent,
      extractionMode: "google-document-ai",
      extractedRows: filteredRows.length,
      fileName: createCsvFileName(),
      jsonColumns: normalized.jsonColumns,
      jsonRows: normalized.jsonRows,
      modelUsed: `${providerLabel} · ${modelUsed} normalized`,
      pagesProcessed: pageCount,
      profileValidationWarnings: normalized.warnings,
      resultQuality: "ai",
      rowsExtracted: filteredRows.length,
      warnings: normalized.warnings,
    };
  }

  return {
    csvContent: recordsToCsv(output.columns, output.rows),
    extractionMode: "google-document-ai",
    extractedRows: output.rows.length,
    fileName: createCsvFileName(),
    modelUsed: `${providerLabel} · ${modelUsed} normalized`,
    pagesProcessed: pageCount,
    resultQuality: "ai",
    rowsExtracted: output.rows.length,
  };
}

type PdfFileOptions = {
  apiKey: string;
  budget: OcrTimeBudget;
  experimentalModelName: string;
  fallbackModelName: string;
  fileBuffer: Buffer;
  fileName: string;
  modelName: string;
  documentType: DocumentType;
  clientProfile?: ClientProfile;
};

async function analyzePdfFileToCsv({
  apiKey,
  budget,
  experimentalModelName,
  fallbackModelName,
  fileBuffer,
  fileName,
  modelName,
  documentType,
  clientProfile,
}: PdfFileOptions): Promise<CsvAnalysisResult> {
  let extractedPages: Array<{ pageNumber: number; text: string }> = [];
  let totalTextLength = 0;
  let directFileError: unknown;
  const fileSizeMB = bytesToMegabytes(fileBuffer.byteLength);

  if (isVisionTableProfile(clientProfile) && clientProfile) {
    try {
      logOcrStrategy({
        fileName,
        fileSizeMB,
        mimeType: "application/pdf",
        reason:
          "Perfil de tabla escaneada: se prioriza OCR visual tabular y se bloquea fallback generico.",
        strategy: "direct-file",
      });

      const result = await analyzeDirectFileToCsv({
        apiKey,
        budget,
        experimentalModelName,
        fallbackModelName,
        fileName,
        fileBuffer,
        mimeType: "application/pdf",
        modelName,
        documentType,
        clientProfile,
      });

      return validateProfileResultOrThrow(result, clientProfile);
    } catch (error) {
      logOcrWarning("Vision table profile extraction failed", {
        stage: "direct-file-analysis",
        model: modelName,
        mimeType: "application/pdf",
        fileName,
        errorType: getSafeErrorCode(error),
        technicalDetail: summarizeSafeError(error),
      });

      try {
        logOcrStrategy({
          fileName,
          fileSizeMB,
          mimeType: "application/pdf",
          reason:
            "El analisis visual directo no paso el perfil Movimiento; se renderiza el PDF por paginas.",
          strategy: "direct-file",
        });

        const visualPagesResult = await analyzeMovementPdfVisualPagesToCsv({
          apiKey,
          budget,
          experimentalModelName,
          fallbackModelName,
          fileBuffer,
          fileName,
          modelName,
          documentType,
          clientProfile,
        });

        return validateProfileResultOrThrow(visualPagesResult, clientProfile);
      } catch (visualPagesError) {
        logOcrWarning("Movement visual pages extraction failed", {
          stage: "direct-file-analysis",
          model: modelName,
          mimeType: "application/pdf",
          fileName,
          errorType: getSafeErrorCode(visualPagesError),
          technicalDetail: summarizeSafeError(visualPagesError),
        });
      }

      throw createVisionTableProfileFailure(error);
    }
  }

  if (shouldTryDirectPdfFirst(fileBuffer)) {
    try {
      logOcrStrategy({
        fileName,
        fileSizeMB,
        mimeType: "application/pdf",
        reason: "PDF menor a 2 MB: se intenta análisis directo para reducir tiempo.",
        strategy: "direct-file",
      });

      return await analyzeDirectFileToCsv({
        apiKey,
        budget,
        experimentalModelName,
        fallbackModelName,
        fileName,
        fileBuffer,
        mimeType: "application/pdf",
        modelName,
        documentType,
        clientProfile,
      });
    } catch (error) {
      directFileError = error;
      logOcrWarning("Direct PDF analysis failed, trying text extraction strategy", {
        stage: "direct-file-analysis",
        model: modelName,
        mimeType: "application/pdf",
        fileName,
        errorType: getSafeErrorCode(error),
        technicalDetail: summarizeSafeError(error),
      });
    }
  }

  try {
    const extractionStartedAt = Date.now();
    const extraction = await extractPdfTextByPages(fileBuffer);
    extractedPages = extraction.pages;
    totalTextLength = extraction.totalTextLength;
    logOcrTiming("pdf-text-extraction", extractionStartedAt, {
      fileName,
      strategy: "text-chunks",
      model: modelName,
    });
    logPdfTextExtractionResult(fileName, extraction);
  } catch (error) {
    logOcrWarning("PDF text extraction failed", {
      stage: "pdf-text-extraction",
      model: modelName,
      mimeType: "application/pdf",
      fileName,
      errorType: getSafeErrorCode(error),
      technicalDetail: summarizeSafeError(error),
    });
  }

  try {
    const isKnownSimpleTable = looksLikeKnownSimpleTable(extractedPages);
    const pageCount = extractedPages.length;

    if (shouldAllowChunks() && totalTextLength > 500 && pageCount > 5 && !isKnownSimpleTable) {
      logOcrStrategy({
        fileName,
        fileSizeMB,
        mimeType: "application/pdf",
        reason: "PDF de más de 5 páginas: se procesa por texto y chunks.",
        strategy: "text-chunks",
      });

      return await analyzePdfTextChunksToCsv({
        apiKey,
        budget,
        experimentalModelName,
        fallbackModelName,
        fileName,
        modelName,
        pages: extractedPages,
        documentType,
        clientProfile,
      });
    }

    if (isKnownSimpleTable) {
      logOcrWarning("Simple table detected, using direct file analysis", {
        stage: "pdf-text-extraction",
        model: modelName,
        mimeType: "application/pdf",
        fileName,
        technicalDetail: "Known tabular PDF columns detected",
      });
    }

    if (directFileError) {
      if (shouldAllowChunks() && totalTextLength > 500) {
        logOcrStrategy({
          fileName,
          fileSizeMB,
          mimeType: "application/pdf",
          reason: "El análisis directo falló; se intenta procesamiento por chunks antes del fallback local.",
          strategy: "text-chunks",
        });

        return await analyzePdfTextChunksToCsv({
          apiKey,
          budget,
          experimentalModelName,
          fallbackModelName,
          fileName,
          modelName,
          pages: extractedPages,
          documentType,
          clientProfile,
        });
      }

      throw directFileError;
    }

    logOcrStrategy({
      fileName,
      fileSizeMB,
      mimeType: "application/pdf",
      reason:
        pageCount > 0 && pageCount <= 5
          ? "PDF de hasta 5 páginas: se intenta análisis directo."
          : "PDF sin texto local suficiente: se intenta análisis directo.",
      strategy: "direct-file",
    });

    return await analyzeDirectFileToCsv({
      apiKey,
      budget,
      experimentalModelName,
      fallbackModelName,
      fileName,
      fileBuffer,
      mimeType: "application/pdf",
      modelName,
      documentType,
      clientProfile,
    });
  } catch (error) {
    logOcrWarning("AI failed. Checking local fallback", {
      stage: "direct-file-analysis",
      model: modelName,
      mimeType: "application/pdf",
      fileName,
      errorType: getSafeErrorCode(error),
      pages: extractedPages.length,
      totalTextLength,
      technicalDetail: summarizeSafeError(error),
    });

    const localFallback = returnLocalPdfFallbackIfAvailable({
      fileName,
      pages: extractedPages,
      totalTextLength,
    });

    if (localFallback) {
      return localFallback;
    }

    throw error;
  }
}

type DirectFileOptions = {
  apiKey: string;
  budget: OcrTimeBudget;
  experimentalModelName: string;
  fallbackModelName: string;
  fileName: string;
  fileBuffer: Buffer;
  mimeType: string;
  modelName: string;
  documentType: DocumentType;
  clientProfile?: ClientProfile;
};

async function analyzeDirectFileToCsv({
  apiKey,
  budget,
  experimentalModelName,
  fallbackModelName,
  fileName,
  fileBuffer,
  mimeType,
  modelName,
  documentType,
  clientProfile,
}: DirectFileOptions): Promise<CsvAnalysisResult> {
  const startedAt = Date.now();
  assertTimeBudget("direct-file-analysis", budget, 1000);
  const { output, modelUsed } = await generateStructuredOutputWithResilience({
    apiKey,
    budget,
    experimentalModelName,
    fallbackModelName,
    parts: [
      createDirectFilePrompt(documentType, clientProfile),
      {
        inlineData: {
          mimeType,
          data: fileBuffer.toString("base64"),
        },
      },
    ],
    timeoutMs: getDirectCallTimeoutMs(),
    modelName,
    context: {
      stage: "direct-file-analysis",
      documentType,
      clientProfileId: clientProfile?.id,
      extractionProfile: clientProfile?.defaultExtractionProfile,
      model: modelName,
      mimeType,
      fileName,
    },
  });
  logOcrTiming("direct-file-analysis", startedAt, {
    fileName,
    strategy: "direct-file",
    model: modelUsed,
  });
  if (output.rows.length === 0) {
    throw new CsvAnalysisError(
      "No se pudo estructurar la respuesta del modelo. Intentá nuevamente o probá con un archivo más simple.",
      "AI response did not include rows",
    );
  }

  if (isVisionTableProfile(clientProfile) && clientProfile) {
    const normalized = normalizeVisionTableProfileOutput(output.columns, output.rows, clientProfile);
    const csvContent = recordsToCsv(normalized.csvColumns, normalized.csvRows);

    validateVisionTableProfileOutput({
      columns: normalized.csvColumns,
      rows: normalized.csvRows,
      clientProfile,
    });

    return {
      csvContent,
      fileName: createCsvFileName(),
      extractedRows: normalized.csvRows.length,
      jsonColumns: normalized.jsonColumns,
      jsonRows: normalized.jsonRows,
      modelUsed: `${modelUsed} · vision table`,
      profileValidationWarnings: normalized.warnings,
      resultQuality: "ai",
    };
  }

  const csvContent = recordsToCsv(output.columns, output.rows);

  const quality = assessExtractionQuality(output.columns, output.rows, {
    clientProfileId: clientProfile?.id,
    documentType,
    extractionProfile: clientProfile?.defaultExtractionProfile,
  });
  logLocalFallbackSkipped({
    columns: output.columns,
    quality: quality.quality,
    reason: "AI result quality was acceptable",
    rows: output.rows.length,
  });

  return {
    csvContent,
    fileName: createCsvFileName(),
    extractedRows: output.rows.length,
    resultQuality: "ai",
    modelUsed: `${modelUsed} · direct file`,
  };
}

type MovementVisualPagesOptions = PdfFileOptions & {
  clientProfile: ClientProfile;
};

async function analyzeMovementPdfVisualPagesToCsv({
  apiKey,
  budget,
  experimentalModelName,
  fallbackModelName,
  fileBuffer,
  fileName,
  modelName,
  documentType,
  clientProfile,
}: MovementVisualPagesOptions): Promise<CsvAnalysisResult> {
  const startedAt = Date.now();
  assertTimeBudget("direct-file-analysis", budget, 1000);
  const pageCount = await getPdfPageCount(fileBuffer);
  const maxPages = Math.min(pageCount, getMaxPdfPages());
  const outputs = [];
  const warnings: string[] = [];
  const modelUsages = new Set<string>();
  let pagesProcessed = 0;

  if (pageCount > maxPages) {
    warnings.push(`Se procesaron ${maxPages} de ${pageCount} paginas por limite configurado.`);
  }

  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    if (!hasEnoughTimeBudget(budget, 10000)) {
      warnings.push(`Pagina ${pageNumber} omitida por presupuesto de tiempo.`);
      break;
    }

    const pageOutput = await analyzeMovementVisualPageWithOrientations({
      apiKey,
      budget,
      clientProfile,
      documentType,
      experimentalModelName,
      fallbackModelName,
      fileBuffer,
      fileName,
      modelName,
      pageNumber,
    });

    pagesProcessed += 1;

    if (pageOutput.warning) {
      warnings.push(pageOutput.warning);
    }

    if (pageOutput.output.rows.length > 0) {
      outputs.push(pageOutput.output);
      modelUsages.add(pageOutput.modelUsed);
    }
  }

  if (outputs.length === 0) {
    throw new ProfileExtractionValidationError(
      "No se pudo estructurar la tabla logistica.",
      "failed_quality_gate_movimiento",
    );
  }

  const merged = mergeMovementVisualPageOutputs(outputs, clientProfile);
  const csvContent = recordsToCsv(merged.columns, merged.rows);

  validateVisionTableProfileOutput({
    columns: merged.columns,
    rows: merged.rows,
    clientProfile,
  });
  logOcrTiming("movement-visual-pages", startedAt, {
    fileName,
    strategy: "movement-visual-pages",
    model: resolveChunkModelUsed(modelUsages, modelName, fallbackModelName),
  });

  return {
    csvContent,
    fileName: createCsvFileName(),
    extractedRows: merged.rows.length,
    extractionMode: "movement-visual-pages",
    jsonColumns: [...merged.columns, "pageNumber", "rowNumber", "confidence", "warnings"],
    jsonRows: merged.jsonRows,
    modelUsed: `${resolveChunkModelUsed(modelUsages, modelName, fallbackModelName)} · movement visual pages`,
    pagesProcessed,
    profileValidationWarnings: warnings,
    resultQuality: "ai",
    rowsExtracted: merged.rows.length,
    warnings,
  };
}

async function analyzeMovementVisualPageWithOrientations({
  apiKey,
  budget,
  clientProfile,
  documentType,
  experimentalModelName,
  fallbackModelName,
  fileBuffer,
  fileName,
  modelName,
  pageNumber,
}: MovementVisualPagesOptions & { pageNumber: number }) {
  const rotations: Array<0 | 90 | 270 | 180> = [0, 90, 270, 180];
  let lastError: unknown;

  for (const rotation of rotations) {
    if (!hasEnoughTimeBudget(budget, 8000)) {
      break;
    }

    try {
      const renderedPage = await renderPdfPageToImage(fileBuffer, {
        pageNumber,
        rotation,
      });
      console.info("[OCR] movement page render", {
        fileName,
        pageNumber,
        rotation,
        width: renderedPage.width,
        height: renderedPage.height,
        size: renderedPage.buffer.byteLength,
      });
      const { output, modelUsed } = await generateStructuredOutputAllowingEmptyRows({
        apiKey,
        budget,
        experimentalModelName,
        fallbackModelName,
        modelName,
        parts: [
          createMovementVisualPagePrompt(clientProfile, pageNumber, rotation),
          {
            inlineData: {
              mimeType: renderedPage.mimeType,
              data: renderedPage.buffer.toString("base64"),
            },
          },
        ],
        timeoutMs: getMovementVisualPageTimeoutMs(),
        context: {
          stage: "direct-file-analysis",
          documentType,
          clientProfileId: clientProfile.id,
          extractionProfile: clientProfile.defaultExtractionProfile,
          model: modelName,
          mimeType: renderedPage.mimeType,
          fileName,
          chunkIndex: pageNumber,
          pageRange: String(pageNumber),
        },
      });
      const normalized = normalizeVisionTableProfileOutput(output.columns, output.rows, clientProfile);
      const filteredRows = filterVisionTableRows(normalized.csvRows, clientProfile);

      if (filteredRows.length > 0 || rotation === rotations[rotations.length - 1]) {
        return {
          modelUsed,
          output: {
            columns: normalized.csvColumns,
            rows: filteredRows,
          },
          warning:
            rotation === 0
              ? ""
              : `Pagina ${pageNumber} procesada con rotacion alternativa ${rotation}.`,
        };
      }
    } catch (error) {
      lastError = error;
      console.warn("[OCR] movement visual page attempt failed", {
        fileName,
        pageNumber,
        rotation,
        errorType: getSafeErrorCode(error),
        technicalDetail: summarizeSafeError(error),
      });
    }
  }

  return {
    modelUsed: modelName,
    output: {
      columns: [...(clientProfile.expectedColumns ?? [])],
      rows: [],
    },
    warning: `Pagina ${pageNumber} sin filas validas. ${lastError ? summarizeSafeError(lastError) : ""}`.trim(),
  };
}

function createMovementVisualPagePrompt(
  clientProfile: ClientProfile,
  pageNumber: number,
  rotation: 0 | 90 | 180 | 270,
) {
  const expectedColumns = [...(clientProfile.expectedColumns ?? [])];

  return `Actua como un sistema OCR visual tabular especializado en tablas escaneadas de movimientos logisticos.

Vas a recibir una imagen renderizada de la pagina ${pageNumber} de un PDF escaneado. Rotacion aplicada: ${rotation} grados.

Tu tarea es extraer exclusivamente filas reales de la tabla logistica.

Respondé exclusivamente JSON valido con esta estructura:
{
  "mode": "table",
  "columns": ["${expectedColumns.join('", "')}"],
  "rows": []
}

Columnas exactas y orden obligatorio:
${expectedColumns.join("\n")}

Ignorar siempre:
- CamScanner
- Escaneado con CamScanner
- URLs
- sellos
- folios
- bordes
- sombras
- numeros de pagina
- encabezados repetidos
- texto fuera de la tabla

Reglas:
- No inventes datos.
- Si una celda no es legible, usa "".
- Fechas preferentemente DD/MM/YYYY.
- Unifica fechas como DD/MM/YYYY solo cuando sea claro.
- Mantene cada fila de la tabla como un registro.
- No devuelvas Pagina, Linea, Texto, Campo, Valor, Contenido ni columnas auxiliares como salida principal.
- Si la pagina no contiene filas validas de la tabla, devolve rows: [].
- No uses markdown.
- No uses HTML.
- El primer caracter debe ser { y el ultimo debe ser }.`;
}

function mergeMovementVisualPageOutputs(
  outputs: ParsedStructuredOutput[],
  clientProfile: ClientProfile,
) {
  const columns = [...(clientProfile.expectedColumns ?? [])];
  const rows: Record<string, string>[] = [];
  const jsonRows: Record<string, string>[] = [];
  const seen = new Set<string>();

  for (const output of outputs) {
    const normalized = normalizeVisionTableProfileOutput(output.columns, output.rows, clientProfile);
    const filteredRows = filterVisionTableRows(normalized.csvRows, clientProfile);

    for (const row of filteredRows) {
      const signature = columns.map((column) => normalizeProfileCell(row[column])).join("|");

      if (!signature || seen.has(signature)) continue;

      seen.add(signature);
      rows.push(row);
      jsonRows.push({
        ...row,
        pageNumber: "",
        rowNumber: String(jsonRows.length + 1),
        confidence: "",
        warnings: "",
      });
    }
  }

  return { columns, rows, jsonRows };
}

type PdfChunkOptions = {
  apiKey: string;
  budget: OcrTimeBudget;
  experimentalModelName: string;
  fallbackModelName: string;
  fileName: string;
  modelName: string;
  pages: Array<{ pageNumber: number; text: string }>;
  documentType: DocumentType;
  clientProfile?: ClientProfile;
};

async function analyzePdfTextChunksToCsv({
  apiKey,
  budget,
  experimentalModelName,
  fallbackModelName,
  fileName,
  modelName,
  pages,
  documentType,
  clientProfile,
}: PdfChunkOptions): Promise<CsvAnalysisResult> {
  const startedAt = Date.now();
  assertTimeBudget("text-chunks-analysis", budget, 1000);
  const allChunks = chunkPdfPages(pages);
  const maxBalancedChunks = getMaxChunksBalancedMode();
  const chunks = isBalancedMode() ? allChunks.slice(0, maxBalancedChunks) : allChunks;
  const outputs = [];
  const errorRows = [];
  const modelUsages = new Set<string>();
  let failedChunks = 0;
  let skippedChunks = Math.max(allChunks.length - chunks.length, 0);

  for (const skippedChunk of allChunks.slice(chunks.length)) {
    errorRows.push(
      createChunkErrorRow(
        skippedChunk.pageRange,
        "No se procesó esta parte por el límite del modo balanceado.",
      ),
    );
  }

  for (const chunk of chunks) {
    if (!hasEnoughTimeBudget(budget, 10000)) {
      skippedChunks += 1;
      errorRows.push(
        createChunkErrorRow(
          chunk.pageRange,
          "No se procesó esta parte porque se agotó el tiempo disponible.",
        ),
      );
      continue;
    }

    try {
      const { output, modelUsed } = await generateStructuredOutputWithResilience({
        apiKey,
        budget,
        experimentalModelName,
        fallbackModelName,
        modelName,
        parts: [
          createChunkPrompt({
            chunkIndex: chunk.chunkIndex,
            documentType,
            fileName,
            pageRange: chunk.pageRange,
            text: chunk.text,
            totalChunks: chunks.length,
            clientProfile,
          }),
        ],
        timeoutMs: getChunkCallTimeoutMs(),
        context: {
          stage: "chunk-analysis",
          documentType,
          clientProfileId: clientProfile?.id,
          extractionProfile: clientProfile?.defaultExtractionProfile,
          model: modelName,
          mimeType: "application/pdf",
          fileName,
          chunkIndex: chunk.chunkIndex,
          pageRange: chunk.pageRange,
        },
      });

      modelUsages.add(modelUsed);
      outputs.push(output);
    } catch (error) {
      failedChunks += 1;
      logOcrWarning("OCR chunk processing failed", {
        stage: "chunk-analysis",
        model: modelName,
        mimeType: "application/pdf",
        fileName,
        chunkIndex: chunk.chunkIndex,
        pageRange: chunk.pageRange,
        errorType: error instanceof Error ? error.name : "UnknownError",
        technicalDetail: summarizeSafeError(error),
      });
      errorRows.push(
        createChunkErrorRow(
          chunk.pageRange,
          "La respuesta del modelo no pudo estructurarse.",
        ),
      );
    }
  }

  if (outputs.length === 0) {
    throw new CsvAnalysisError(
      "No se pudo estructurar la respuesta del modelo. Intentá nuevamente.",
      "All text chunks failed",
    );
  }

  const merged = mergeStructuredOutputs(outputs);
  const rows = areStructuredChunkColumns(merged.columns)
    ? [...merged.rows, ...errorRows]
    : merged.rows;
  const csvContent = recordsToCsv(merged.columns, rows);
  const quality = assessExtractionQuality(merged.columns, rows, {
    clientProfileId: clientProfile?.id,
    documentType,
    extractionProfile: clientProfile?.defaultExtractionProfile,
  });
  logResultQualityAssessment({
    columns: merged.columns,
    clientProfileId: clientProfile?.id,
    documentType,
    extractionProfile: clientProfile?.defaultExtractionProfile,
    quality: quality.quality,
    reason: quality.reason,
    rows: rows.length,
    strategy: "text-chunks",
  });
  logLocalFallbackSkipped({
    columns: merged.columns,
    quality: quality.quality,
    reason: "AI result quality was acceptable",
    rows: rows.length,
  });
  logOcrPartialResult({
    processedChunks: outputs.length,
    failedChunks: failedChunks + skippedChunks,
    rows: rows.length,
  });
  logOcrTiming("text-chunks-analysis", startedAt, {
    fileName,
    strategy: "text-chunks",
    model: resolveChunkModelUsed(modelUsages, modelName, fallbackModelName),
  });

  return {
    csvContent,
    fileName: createCsvFileName(),
    extractedRows: rows.length,
    resultQuality: errorRows.length > 0 ? "partial" : "ai",
    modelUsed: `${resolveChunkModelUsed(modelUsages, modelName, fallbackModelName)} · text chunks`,
  };
}

type ChunkPromptOptions = {
  chunkIndex: number;
  documentType: DocumentType;
  fileName: string;
  pageRange: string;
  text: string;
  totalChunks: number;
  clientProfile?: ClientProfile;
};

function createChunkPrompt({
  chunkIndex,
  documentType,
  fileName,
  pageRange,
  text,
  totalChunks,
  clientProfile,
}: ChunkPromptOptions) {
  return `Actuá como un sistema de extracción documental para ADALO Consulting Group.

Vas a recibir una parte de un documento PDF ya extraído como texto. Archivo: ${fileName}. Esta parte corresponde a las páginas: ${pageRange}. Es el chunk ${chunkIndex} de ${totalChunks}.

Tu tarea es extraer información útil y devolver exclusivamente JSON válido con esta estructura:

{
  "mode": "structured",
  "columns": [
    "Sección",
    "Tipo de dato",
    "Título",
    "Descripción",
    "Fecha",
    "Expediente",
    "Empresa",
    "Volumen",
    "Cantidad",
    "Estado",
    "Riesgo",
    "Decisión/Recomendación",
    "Página"
  ],
  "rows": []
}

Reglas:
- Respondé exclusivamente JSON válido.
- El primer carácter de la respuesta debe ser {.
- El último carácter de la respuesta debe ser }.
- Si esta parte contiene una tabla clara, usá "mode": "table", preservá las columnas originales y generá una fila por registro.
- Si aparecen columnas como N° Anexo, Nombre Anexo, Romano, N° Punto, Frecuencia, Tipo de Plazo y Cant. Días, conservá exactamente esas columnas.
- Si no hay una tabla clara, usá "mode": "structured" con las columnas de la estructura indicada, incluyendo "Página".
- No inventes información.
- Si un dato no aparece, usar "".
- Cada evento, requerimiento, autorización, riesgo, conclusión, indicador o decisión relevante debe ser una fila.
- Si detectás una línea de tiempo, crear una fila por evento.
- Si detectás requerimientos numerados, crear una fila por requerimiento.
- Si detectás conclusiones, crear una fila por conclusión.
- Si detectás una tabla, extraé sus filas y mantené sus columnas originales cuando sea posible.
- Agregar el número o rango de página en la columna "Página".
- No uses markdown.
- No uses \`\`\`json.
- No uses HTML.
- No agregues explicaciones antes ni después.
- No uses saltos de línea dentro de valores.
- Si no hay información útil en este chunk, devolver rows: [].

Si parece ticket, factura, remito o comprobante comercial, intentá detectar Fecha, Emisor, CUIT, Punto de venta, Comprobante, Cliente, Producto/Servicio, Cantidad, Precio unitario, IVA, Total, Forma de pago y Observaciones.

Texto extraído:
${getClientProfilePromptGuidance(clientProfile)}

${getDocumentTypePromptGuidance(documentType)}

${text}`;
}

type GenerateContentOptions = {
  apiKey: string;
  budget: OcrTimeBudget;
  experimentalModelName: string;
  fallbackModelName: string;
  modelName: string;
  parts: Parameters<ReturnType<GoogleGenerativeAI["getGenerativeModel"]>["generateContent"]>[0];
  timeoutMs: number;
};

type OcrLogContext = {
  stage:
    | "pdf-text-extraction"
    | "chunk-analysis"
    | "direct-file-analysis"
    | "parse-ai-output"
    | "api-route";
  model: string;
  mimeType: string;
  fileName: string;
  documentType?: DocumentType;
  clientProfileId?: string;
  extractionProfile?: string;
  chunkIndex?: number;
  pageRange?: string;
};

type GenerateStructuredOutputOptions = GenerateContentOptions & {
  context: OcrLogContext;
};

async function generateStructuredOutputWithResilience({
  apiKey,
  budget,
  experimentalModelName,
  fallbackModelName,
  modelName,
  parts,
  timeoutMs,
  context,
}: GenerateStructuredOutputOptions) {
  if (shouldForceAiFailureForTest()) {
    throw new StructuredOutputError(
      STRUCTURED_OUTPUT_ERROR_MESSAGE,
      "AI response could not be converted to structured output",
      "AI_RESPONSE_NOT_JSON",
    );
  }

  const modelAttempts = buildModelAttempts(modelName, fallbackModelName, experimentalModelName);
  let lastError: unknown;

  for (const attempt of modelAttempts) {
    assertTimeBudget(context.stage, budget, 1000);

    if (attempt.kind === "experimental") {
      console.info("[OCR] Using experimental model", {
        model: attempt.modelName,
        stage: context.stage,
        mimeType: context.mimeType,
        fileName: context.fileName,
      });
    }

    try {
      const output = await generateStructuredOutputWithRetry({
        apiKey,
        budget,
        modelName: attempt.modelName,
        parts,
        timeoutMs,
        context: {
          ...context,
          model: attempt.modelName,
        },
      });
      const qualityContext = getExtractionQualityContext(context);
      const quality = assessExtractionQuality(output.columns, output.rows, qualityContext);
      logResultQualityAssessment({
        columns: output.columns,
        clientProfileId: qualityContext.clientProfileId,
        documentType: qualityContext.documentType,
        extractionProfile: qualityContext.extractionProfile,
        quality: quality.quality,
        reason: quality.reason,
        rows: output.rows.length,
        strategy: context.stage,
      });

      const tableModeReason = getTableModeQualityIssue(context.documentType, output.columns);

      if (quality.quality === "low" || tableModeReason) {
        throw new AiOutputQualityError(tableModeReason ?? quality.reason);
      }

      return {
        output,
        modelUsed: formatModelUsed(attempt),
      };
    } catch (error) {
      lastError = error;

      if (!isRecoverableAiCallError(error)) {
        throw error;
      }

      if (isQuotaOrSaturationError(error) && hasEnoughTimeBudget(budget, 3000)) {
        await wait(2000);
      }
    }
  }

  if (isRetryableGoogleAiError(lastError)) {
    throw new GoogleAiTemporaryError(
      "El servicio de IA está temporalmente ocupado. Intentá nuevamente más tarde.",
      summarizeGoogleAiError(lastError),
      true,
    );
  }

  throw lastError;
}

async function generateStructuredOutputAllowingEmptyRows({
  apiKey,
  budget,
  experimentalModelName,
  fallbackModelName,
  modelName,
  parts,
  timeoutMs,
  context,
}: GenerateStructuredOutputOptions) {
  if (shouldForceAiFailureForTest()) {
    throw new StructuredOutputError(
      STRUCTURED_OUTPUT_ERROR_MESSAGE,
      "AI response could not be converted to structured output",
      "AI_RESPONSE_NOT_JSON",
    );
  }

  const modelAttempts = buildModelAttempts(modelName, fallbackModelName, experimentalModelName);
  let lastError: unknown;

  for (const attempt of modelAttempts) {
    assertTimeBudget(context.stage, budget, 1000);

    try {
      const output = await generateStructuredOutputWithRetry({
        apiKey,
        budget,
        modelName: attempt.modelName,
        parts,
        timeoutMs,
        context: {
          ...context,
          model: attempt.modelName,
        },
      });

      return {
        output,
        modelUsed: formatModelUsed(attempt),
      };
    } catch (error) {
      lastError = error;

      if (!isRecoverableAiCallError(error)) {
        throw error;
      }
    }
  }

  if (isRetryableGoogleAiError(lastError)) {
    throw new GoogleAiTemporaryError(
      "El modelo de IA estÃ¡ temporalmente saturado. IntentÃ¡ nuevamente en unos minutos.",
      summarizeGoogleAiError(lastError),
    );
  }

  throw lastError;
}

// Kept temporarily only as a rollback reference while validating the multi-model flow.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function generateStructuredOutputWithResilienceOld({
  apiKey,
  budget,
  fallbackModelName,
  modelName,
  parts,
  timeoutMs,
  context,
}: GenerateStructuredOutputOptions) {
  try {
    return {
      output: await generateStructuredOutputWithRetry({
        apiKey,
        budget,
        modelName,
        parts,
        timeoutMs,
        context: {
          ...context,
          model: modelName,
        },
      }),
      modelUsed: modelName,
    };
  } catch (error) {
    if (!isRecoverableAiCallError(error) || !fallbackModelName.trim()) {
      throw error;
    }

    try {
      return {
        output: await generateStructuredOutputWithRetry({
          apiKey,
          budget,
          modelName: fallbackModelName,
          parts,
          timeoutMs,
          context: {
            ...context,
            model: fallbackModelName,
          },
        }),
        modelUsed: `${fallbackModelName} (fallback)`,
      };
    } catch (fallbackError) {
      if (isRetryableGoogleAiError(fallbackError)) {
        throw new GoogleAiTemporaryError(
          "El servicio de IA está temporalmente ocupado. Intentá nuevamente más tarde.",
          summarizeGoogleAiError(fallbackError),
          true,
        );
      }

      throw fallbackError;
    }
  }
}

type GenerateContentOnceOptions = {
  apiKey: string;
  budget: OcrTimeBudget;
  modelName: string;
  parts: GenerateContentOptions["parts"];
  timeoutMs: number;
};

type GenerateStructuredOutputOnceOptions = GenerateContentOnceOptions & {
  context: OcrLogContext;
};

async function generateStructuredOutputWithRetry(options: GenerateStructuredOutputOnceOptions) {
  const maxRetries = readPositiveInteger(process.env.GOOGLE_AI_MAX_RETRIES, 1);
  const baseDelayMs = readPositiveInteger(process.env.GOOGLE_AI_RETRY_BASE_DELAY_MS, 750);
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      assertTimeBudget(options.context.stage, options.budget, 1000);
      return await generateStructuredOutputOnce(options);
    } catch (error) {
      lastError = error;

      if (!isRecoverableAiCallError(error) || attempt === maxRetries) {
        break;
      }

      const delayMs = baseDelayMs * 2 ** (attempt - 1);
      if (!hasEnoughTimeBudget(options.budget, delayMs + 1000)) {
        break;
      }

      await wait(delayMs);
    }
  }

  if (isRetryableGoogleAiError(lastError)) {
    throw new GoogleAiTemporaryError(
      "El modelo de IA está temporalmente saturado. Intentá nuevamente en unos minutos.",
      summarizeGoogleAiError(lastError),
    );
  }

  throw lastError;
}

async function generateStructuredOutputOnce({
  context,
  ...options
}: GenerateStructuredOutputOnceOptions) {
  const rawText = await generateContentOnce(options);
  const rawTextValue = typeof rawText === "string" ? rawText : String(rawText ?? "");

  if (!looksLikeJsonOutput(rawTextValue)) {
    const csvLikeOutput = tryParseCsvLikeOutput(rawTextValue);

    if (csvLikeOutput) {
      logOcrFallbackParsing(context, rawTextValue, "csv-like");
      return csvLikeOutput;
    }
  }

  try {
    return parseAiStructuredOutput(rawTextValue);
  } catch (error) {
    if (isRecoverableStructuredOutputError(error)) {
      logOcrNonJsonResponse(context, rawTextValue, error);

      if (shouldAttemptRepairPass(error)) {
        try {
          assertTimeBudget("parse-ai-output", options.budget, 1000);
          const repairedRawText = await repairAiOutputToStructuredJson({
            ...options,
            context,
            rawOutput: rawTextValue,
          });
          const repairedOutput = parseAiStructuredOutput(repairedRawText);

          logOcrFallbackParsing(context, rawTextValue, "repair-pass");
          return repairedOutput;
        } catch (repairError) {
          logOcrFallbackParsing(context, rawTextValue, "failed", repairError);
          throw new StructuredOutputError(
            STRUCTURED_OUTPUT_ERROR_MESSAGE,
            "AI response could not be converted to structured output",
            "AI_RESPONSE_NOT_JSON",
          );
        }
      }
    }

    throw error;
  }
}

type RepairAiOutputOptions = GenerateContentOnceOptions & {
  context: OcrLogContext;
  rawOutput: string;
};

async function repairAiOutputToStructuredJson({
  context,
  rawOutput,
  ...options
}: RepairAiOutputOptions) {
  const prompt = `Recibiste una respuesta generada por un sistema OCR, pero no estÃ¡ en el formato requerido.

ConvertÃ­ el contenido en un objeto JSON vÃ¡lido con esta estructura exacta:

{
  "mode": "table" | "structured",
  "columns": [],
  "rows": []
}

Reglas:
- RespondÃ© exclusivamente JSON vÃ¡lido.
- No uses markdown.
- No agregues explicaciones.
- El primer carÃ¡cter debe ser {.
- El Ãºltimo carÃ¡cter debe ser }.
- Si el contenido parece una tabla, usÃ¡ mode="table" y preservÃ¡ columnas.
- Si el contenido es narrativo, usÃ¡ mode="structured".
- No inventes informaciÃ³n.
- Si un dato no aparece, usÃ¡ "".
- No uses saltos de lÃ­nea dentro de valores.

Contexto:
- Etapa: ${context.stage}
- Archivo: ${context.fileName}
- PÃ¡ginas: ${context.pageRange ?? "No aplica"}

Contenido a convertir:
${truncateForRepair(rawOutput)}`;

  return generateContentOnce({
    ...options,
    parts: [prompt],
  });
}

async function generateContentOnce({
  apiKey,
  budget,
  modelName,
  parts,
  timeoutMs,
}: GenerateContentOnceOptions) {
  assertTimeBudget("direct-file-analysis", budget, 1000);
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      responseMimeType: "application/json",
    },
  });

  const { remainingMs } = getTimeBudget(budget);
  const effectiveTimeoutMs = Math.max(1000, Math.min(timeoutMs, remainingMs - 250));
  const result = await withTimeout(model.generateContent(parts), effectiveTimeoutMs);
  return result.response.text();
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error("OCR processing timed out"));
      }, timeoutMs);
    }),
  ]);
}

function resolveChunkModelUsed(
  usages: Set<string>,
  modelName: string,
  fallbackModelName: string,
) {
  for (const usage of usages) {
    if (usage.includes("(experimental)")) {
      return usage;
    }

    if (usage.includes("(fallback)")) {
      return `${fallbackModelName} (fallback)`;
    }
  }

  return modelName;
}

type ModelAttempt = {
  kind: "primary" | "fallback" | "experimental";
  modelName: string;
};

function buildModelAttempts(
  modelName: string,
  fallbackModelName: string,
  experimentalModelName: string,
) {
  const attempts: ModelAttempt[] = [{ kind: "primary", modelName }];
  const seen = new Set([modelName.trim()]);

  if (fallbackModelName.trim() && !seen.has(fallbackModelName.trim())) {
    attempts.push({ kind: "fallback", modelName: fallbackModelName.trim() });
    seen.add(fallbackModelName.trim());
  }

  if (
    shouldUseExperimentalModel() &&
    experimentalModelName.trim() &&
    !seen.has(experimentalModelName.trim())
  ) {
    attempts.push({ kind: "experimental", modelName: experimentalModelName.trim() });
  }

  return attempts;
}

function formatModelUsed(attempt: ModelAttempt) {
  if (attempt.kind === "fallback") return `${attempt.modelName} (fallback)`;
  if (attempt.kind === "experimental") return `${attempt.modelName} (experimental)`;
  return attempt.modelName;
}

function getDirectCallTimeoutMs() {
  return readPositiveInteger(
    process.env.OCR_DIRECT_FILE_TIMEOUT_SECONDS,
    readPositiveInteger(process.env.OCR_TIMEOUT_SECONDS, 45),
  ) * 1000;
}

function getChunkCallTimeoutMs() {
  return readPositiveInteger(process.env.OCR_CHUNK_TIMEOUT_SECONDS, 45) * 1000;
}

function getMovementVisualPageTimeoutMs() {
  return readPositiveInteger(
    process.env.OCR_MOVEMENT_PAGE_TIMEOUT_SECONDS,
    readPositiveInteger(process.env.OCR_CHUNK_TIMEOUT_SECONDS, 45),
  ) * 1000;
}

function getMaxPdfPages() {
  return readPositiveInteger(process.env.OCR_MAX_PDF_PAGES, 30);
}

function createTimeBudget(): OcrTimeBudget {
  return {
    startedAt: Date.now(),
    maxMs: readPositiveInteger(process.env.OCR_MAX_PROCESSING_SECONDS, 120) * 1000,
  };
}

function getTimeBudget(budget: OcrTimeBudget) {
  const elapsedMs = Date.now() - budget.startedAt;
  const remainingMs = Math.max(budget.maxMs - elapsedMs, 0);

  return { elapsedMs, remainingMs };
}

function assertTimeBudget(stage: string, budget: OcrTimeBudget, minRemainingMs = 0) {
  const current = getTimeBudget(budget);
  logTimeBudget(stage, budget);

  if (current.remainingMs <= minRemainingMs) {
    throw new OcrTimeBudgetError(stage);
  }
}

function hasEnoughTimeBudget(budget: OcrTimeBudget, minRemainingMs: number) {
  return getTimeBudget(budget).remainingMs > minRemainingMs;
}

function isBalancedMode() {
  return readBoolean(process.env.OCR_BALANCED_MODE, true);
}

function isFastMode() {
  return readBoolean(process.env.OCR_FAST_MODE, false);
}

function getMaxChunksBalancedMode() {
  return readPositiveInteger(process.env.OCR_MAX_CHUNKS_BALANCED_MODE, 4);
}

function shouldUseExperimentalModel() {
  return readBoolean(process.env.OCR_USE_EXPERIMENTAL_MODEL, false);
}

function shouldAllowChunks() {
  return !isFastMode() || readBoolean(process.env.OCR_ALLOW_CHUNKS_IN_FAST_MODE, false);
}

function shouldTryDirectPdfFirst(fileBuffer: Buffer) {
  return fileBuffer.byteLength <= 2 * 1024 * 1024;
}

function bytesToMegabytes(value: number) {
  return Number((value / 1024 / 1024).toFixed(2));
}

function logOcrStrategy({
  fileName,
  fileSizeMB,
  mimeType,
  reason,
  strategy,
}: {
  fileName: string;
  fileSizeMB: number;
  mimeType: string;
  reason: string;
  strategy: "direct-file" | "text-chunks" | "local-fallback";
}) {
  console.info("[OCR] strategy selected", {
    fileName,
    mimeType,
    fileSizeMB,
    strategy,
    reason,
    balancedMode: isBalancedMode(),
    maxProcessingSeconds: readPositiveInteger(process.env.OCR_MAX_PROCESSING_SECONDS, 120),
  });
}

function logOcrTiming(
  stage: string,
  startedAt: number,
  context: {
    fileName?: string;
    strategy?: string;
    model?: string;
  } = {},
) {
  console.info("[OCR] timing", {
    stage,
    durationMs: Date.now() - startedAt,
    fileName: context.fileName,
    strategy: context.strategy,
    model: context.model,
  });
}

function logTimeBudget(stage: string, budget: OcrTimeBudget) {
  const current = getTimeBudget(budget);

  console.info("[OCR] time budget", {
    stage,
    elapsedMs: current.elapsedMs,
    remainingMs: current.remainingMs,
  });
}

function logOcrPartialResult({
  failedChunks,
  processedChunks,
  rows,
}: {
  failedChunks: number;
  processedChunks: number;
  rows: number;
}) {
  if (failedChunks <= 0) return;

  console.info("[OCR] partial result", {
    processedChunks,
    failedChunks,
    rows,
  });
}

function logResultQualityAssessment({
  clientProfileId,
  columns,
  documentType,
  extractionProfile,
  quality,
  reason,
  rows,
  strategy,
}: {
  clientProfileId?: string;
  columns: string[];
  documentType?: DocumentType;
  extractionProfile?: string;
  quality: "high" | "medium" | "low";
  reason: string;
  rows: number;
  strategy: string;
}) {
  console.info("[OCR] result quality assessment", {
    strategy,
    quality,
    reason,
    columns: columns.length,
    rows,
    documentType,
    clientProfileId,
    extractionProfile,
  });
}

function getExtractionQualityContext(context: OcrLogContext): ExtractionQualityContext {
  return {
    clientProfileId: context.clientProfileId,
    documentType: context.documentType,
    extractionProfile: context.extractionProfile,
  };
}

function logLocalFallbackSkipped({
  columns,
  quality,
  reason,
  rows,
}: {
  columns: string[];
  quality: "high" | "medium" | "low";
  reason: string;
  rows: number;
}) {
  console.info("[OCR] local fallback skipped", {
    reason,
    quality,
    columns: columns.length,
    rows,
  });
}

function normalizeVisionTableProfileOutput(
  columns: string[],
  rows: Record<string, string>[],
  clientProfile: ClientProfile,
) {
  const expectedColumns = [...(clientProfile.expectedColumns ?? [])];
  const jsonMetaColumns = ["pageNumber", "rowNumber", "confidence", "warnings"];
  const jsonColumns = [...expectedColumns, ...jsonMetaColumns];
  const warnings: string[] = [];
  const csvRows = rows.map((row) => {
    const normalized: Record<string, string> = {};

    for (const expectedColumn of expectedColumns) {
      normalized[expectedColumn] = getProfileCellValue(row, expectedColumn, columns);
    }

    return normalized;
  });
  const jsonRows = rows.map((row, index) => {
    const normalized: Record<string, string> = {};

    for (const expectedColumn of expectedColumns) {
      normalized[expectedColumn] = getProfileCellValue(row, expectedColumn, columns);
    }

    normalized.pageNumber = getProfileCellValue(row, "pageNumber", columns);
    normalized.rowNumber = getProfileCellValue(row, "rowNumber", columns) || String(index + 1);
    normalized.confidence = getProfileCellValue(row, "confidence", columns);
    normalized.warnings = getProfileCellValue(row, "warnings", columns);

    return normalized;
  });

  if (rows.length > 0 && columns.some((column) => normalizeProfileColumn(column) === "pagina")) {
    warnings.push("La respuesta incluyo columnas genericas y fue normalizada al esquema del perfil.");
  }

  return {
    csvColumns: expectedColumns,
    csvRows,
    jsonColumns,
    jsonRows,
    warnings,
  };
}

function validateProfileResultOrThrow(result: CsvAnalysisResult, clientProfile: ClientProfile) {
  if (!isVisionTableProfile(clientProfile)) return result;

  const parsedColumns = getCsvHeaderColumnsFromContent(result.csvContent);
  const parsedRows = parseCsvRowsFromContent(result.csvContent);

  validateVisionTableProfileOutput({
    columns: parsedColumns,
    rows: parsedRows,
    clientProfile,
  });

  return result;
}

function validateVisionTableProfileOutput({
  columns,
  rows,
  clientProfile,
}: {
  columns: string[];
  rows: Record<string, string>[];
  clientProfile?: ClientProfile;
}) {
  const expectedColumns = [...(clientProfile?.validationRules?.requiredColumns ?? clientProfile?.expectedColumns ?? [])];
  const normalizedColumns = columns.map(normalizeProfileColumn);
  const genericColumns = ["pagina", "linea", "texto"];
  const hasGenericLineCsv = genericColumns.every((column) => normalizedColumns.includes(column));
  const missingColumns = expectedColumns.filter(
    (column) => !normalizedColumns.includes(normalizeProfileColumn(column)),
  );
  const nonEmptyRows = rows.filter((row) =>
    expectedColumns.some((column) => normalizeProfileCell(row[column]).length > 0),
  );
  const joinedValues = rows
    .flatMap((row) => Object.values(row))
    .map(normalizeProfileCell)
    .join(" ");

  if (hasGenericLineCsv) {
    throw new ProfileExtractionValidationError(
      "La extraccion basica no es adecuada para este documento. Se requiere OCR visual de tablas.",
      "PROFILE_REJECTED_GENERIC_LINE_CSV",
    );
  }

  if (missingColumns.length > 0) {
    throw new ProfileExtractionValidationError(
      "No se pudo reconstruir la tabla con las columnas esperadas del perfil.",
      `PROFILE_MISSING_COLUMNS: ${missingColumns.join(", ")}`,
    );
  }

  if (nonEmptyRows.length === 0) {
    throw new ProfileExtractionValidationError(
      "No se pudo reconstruir la tabla con al menos una fila válida.",
      "PROFILE_NO_VALID_ROWS",
    );
  }

  if (containsIgnoredProfileText(joinedValues, clientProfile)) {
    throw new ProfileExtractionValidationError(
      "No se pudo reconstruir una tabla confiable porque se detectó texto de escaneo como dato.",
      "PROFILE_INCLUDED_IGNORED_TEXT",
    );
  }

  if (looksCorruptedForProfile(joinedValues)) {
    throw new ProfileExtractionValidationError(
      "No se pudo reconstruir una tabla confiable porque el texto extraído contiene demasiados caracteres corruptos.",
      "PROFILE_CORRUPTED_TEXT_DOMINANT",
    );
  }
}

function filterVisionTableRows(rows: Record<string, string>[], clientProfile: ClientProfile) {
  const expectedColumns = [...(clientProfile.expectedColumns ?? [])];

  return rows.filter((row) => {
    const hasLogisticsData = expectedColumns.some((column) => normalizeProfileCell(row[column]).length > 0);
    const joinedValues = expectedColumns.map((column) => normalizeProfileCell(row[column])).join(" ");

    if (!hasLogisticsData) return false;
    if (containsIgnoredProfileText(joinedValues, clientProfile)) return false;
    if (looksCorruptedForProfile(joinedValues)) return false;
    if (looksLikeHeaderOnlyRow(row, expectedColumns)) return false;

    return true;
  });
}

function looksLikeHeaderOnlyRow(row: Record<string, string>, expectedColumns: string[]) {
  const matches = expectedColumns.filter((column) => {
    const value = normalizeProfileColumn(row[column] ?? "");
    return value && value === normalizeProfileColumn(column);
  }).length;

  return matches >= Math.max(3, Math.floor(expectedColumns.length / 2));
}

function createVisionTableProfileFailure(error: unknown) {
  if (error instanceof ProfileExtractionValidationError) return error;

  return new ProfileExtractionValidationError(
    "La extraccion basica no es adecuada para este documento. Se requiere OCR visual de tablas.",
    summarizeSafeError(error),
  );
}

function getProfileCellValue(row: Record<string, string>, expectedColumn: string, columns: string[]) {
  const expectedKey = normalizeProfileColumn(expectedColumn);
  const sourceColumn =
    columns.find((column) => normalizeProfileColumn(column) === expectedKey) ??
    columns.find((column) => normalizeProfileColumn(column).includes(expectedKey));

  return normalizeProfileCell(sourceColumn ? row[sourceColumn] : row[expectedColumn]);
}

function getCsvHeaderColumnsFromContent(csvContent: string) {
  return csvContent
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)[0]
    ?.split(",")
    .map((column) => column.replace(/^"|"$/g, "").replace(/""/g, '"').trim())
    .filter(Boolean) ?? [];
}

function parseCsvRowsFromContent(csvContent: string) {
  const lines = csvContent
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter(Boolean);
  const columns = getCsvHeaderColumnsFromContent(csvContent);

  return lines.slice(1).map((line) => {
    const cells = parseSimpleCsvLine(line);
    return Object.fromEntries(columns.map((column, index) => [column, cells[index] ?? ""]));
  });
}

function parseSimpleCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function containsIgnoredProfileText(value: string, clientProfile?: ClientProfile) {
  const normalizedValue = normalizeProfileSearchValue(value);
  return (clientProfile?.ignoreText ?? []).some((text) =>
    normalizedValue.includes(normalizeProfileSearchValue(text)),
  );
}

function looksCorruptedForProfile(value: string) {
  if (!value.trim()) return false;

  const lowerValue = value.toLowerCase();
  const urlPenalty = lowerValue.includes("http://") || lowerValue.includes("https://") ? 20 : 0;
  const suspiciousLength =
    [...value].filter((char) => {
      const code = char.charCodeAt(0);
      return char === "�" || char === "Â" || char === "Ã" || code < 32 || code === 127;
    }).length + urlPenalty;

  return suspiciousLength / Math.max(value.length, 1) > 0.03;
}

function normalizeProfileColumn(value: string) {
  return normalizeProfileSearchValue(value).replace(/[^a-z0-9]+/g, "");
}

function normalizeProfileSearchValue(value: string) {
  return normalizeProfileCell(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeProfileCell(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
}

function returnLocalPdfFallbackIfAvailable({
  fileName,
  pages,
  totalTextLength,
}: {
  fileName: string;
  pages: Array<{ pageNumber: number; text: string }>;
  totalTextLength: number;
}): CsvAnalysisResult | null {
  if (totalTextLength <= 0 || pages.length === 0) {
    return null;
  }

  const bestFallback = createLocalPdfTextFallbackResult({
    pages,
    totalTextLength,
  });

  if (!bestFallback) {
    return null;
  }

  logOcrStrategy({
    fileName,
    fileSizeMB: 0,
    mimeType: "application/pdf",
    reason: "Fallaron los modelos o el procesamiento por chunks; se usa texto extraído localmente.",
    strategy: "local-fallback",
  });

  console.warn("[OCR] Using local PDF text fallback", {
    fileName,
    pages: pages.length,
    totalTextLength,
    rows: bestFallback.extractedRows,
    modelUsed: bestFallback.modelUsed,
  });
  console.info("[OCR] local fallback used", {
    reason:
      bestFallback.modelUsed === "local pdf text fallback"
        ? "No structured result available"
        : "Structured local fallback available",
  });

  return {
    csvContent: bestFallback.csvContent,
    fileName: bestFallback.fileName,
    extractedRows: bestFallback.extractedRows,
    modelUsed: bestFallback.modelUsed,
    resultQuality: bestFallback.resultQuality,
  };
}

function logPdfTextExtractionResult(fileName: string, extraction: PdfTextExtractionResult) {
  console.warn("[OCR] PDF text extraction result", {
    fileName,
    pages: extraction.pages.length,
    totalTextLength: extraction.totalTextLength,
    hasText: extraction.totalTextLength > 0,
  });
}

function logAnalyzeFileToCsvResult(result: CsvAnalysisResult) {
  console.info("[OCR] analyzeFileToCsv result", {
    modelUsed: result.modelUsed,
    extractedRows: result.extractedRows,
  });
}

function getSafeErrorCode(error: unknown) {
  if (error instanceof StructuredOutputError) return error.code;
  if (error instanceof GoogleAiTemporaryError) return "GOOGLE_AI_TEMPORARY_ERROR";
  if (error instanceof CsvAnalysisError) return error.technicalDetail;
  if (error instanceof AiOutputQualityError) return "AI_OUTPUT_QUALITY_LOW";
  if (error instanceof ProfileExtractionValidationError) return "PROFILE_EXTRACTION_VALIDATION_ERROR";
  if (error instanceof PdfChunkingError) return "PDF_CHUNKING_ERROR";
  if (error instanceof OcrTimeBudgetError) return "OCR_TIME_BUDGET_EXCEEDED";
  if (error instanceof PdfPageRenderError) return "PDF_PAGE_RENDER_ERROR";
  if (error instanceof Error) return error.name;
  return "UNKNOWN_ERROR";
}

function shouldForceAiFailureForTest() {
  return process.env.FORCE_AI_FAILURE_FOR_TEST === "true" && process.env.NODE_ENV !== "production";
}

function looksLikeJsonOutput(value: string) {
  const trimmed = value.replace(/^\uFEFF/, "").trimStart().toLowerCase();
  return trimmed.startsWith("{") || trimmed.startsWith("```json");
}

function shouldAttemptRepairPass(error: unknown) {
  return (
    error instanceof StructuredOutputError &&
    error.code !== "AI_RESPONSE_EMPTY" &&
    error.code !== "AI_RESPONSE_HTML_INSTEAD_OF_JSON"
  );
}

function truncateForRepair(value: string) {
  return value.replace(/\0/g, "").slice(0, 12000);
}

function truncateAdvancedOcrText(value: string) {
  return value.replace(/\0/g, "").trim().slice(0, 60000);
}

function looksLikeKnownSimpleTable(pages: Array<{ pageNumber: number; text: string }>) {
  const text = normalizeSearchText(pages.map((page) => page.text).join(" ").slice(0, 25000));
  const markers = [
    "n anexo",
    "nombre anexo",
    "romano",
    "n punto",
    "frecuencia",
    "tipo de plazo",
    "cant dias",
  ];
  const matches = markers.filter((marker) => text.includes(marker)).length;

  return matches >= 5;
}

function getTableModeQualityIssue(documentType: DocumentType | undefined, columns: string[]) {
  if (documentType !== "table") return "";

  const normalizedColumns = columns.map(normalizeSearchText);
  const isFieldValueOutput =
    normalizedColumns.includes("campo") &&
    normalizedColumns.includes("valor") &&
    normalizedColumns.length <= 3;

  return isFieldValueOutput
    ? "Table extraction returned generic field/value columns"
    : "";
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[°º#.,:;()[\]{}_-]/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

function isRetryableGoogleAiError(error: unknown) {
  const detail = summarizeGoogleAiError(error).toLowerCase();
  return (
    /\b(429|500|502|503|504)\b/.test(detail) ||
    detail.includes("high demand") ||
    detail.includes("service unavailable") ||
    detail.includes("temporarily unavailable") ||
    detail.includes("timeout") ||
    detail.includes("timed out") ||
    detail.includes("too many requests") ||
    detail.includes("quota") ||
    detail.includes("resource exhausted") ||
    detail.includes("network") ||
    detail.includes("fetch failed") ||
    detail.includes("econnreset") ||
    detail.includes("etimedout") ||
    detail.includes("enotfound")
  );
}

function isQuotaOrSaturationError(error: unknown) {
  const detail = summarizeGoogleAiError(error).toLowerCase();

  return (
    detail.includes("429") ||
    detail.includes("too many requests") ||
    detail.includes("quota") ||
    detail.includes("exceeded your current quota") ||
    detail.includes("resource exhausted") ||
    detail.includes("high demand")
  );
}

function isRecoverableAiCallError(error: unknown) {
  return (
    error instanceof AiOutputQualityError ||
    isRetryableGoogleAiError(error) ||
    isRecoverableStructuredOutputError(error)
  );
}

function summarizeGoogleAiError(error: unknown) {
  if (error instanceof Error) {
    return sanitizeLogText(error.message).slice(0, 240);
  }

  return sanitizeLogText(String(error)).slice(0, 240);
}

function summarizeSafeError(error: unknown) {
  if (error instanceof StructuredOutputError) {
    return error.technicalDetail;
  }

  if (error instanceof OcrTimeBudgetError) {
    return error.technicalDetail;
  }

  if (error instanceof AiOutputQualityError) {
    return error.technicalDetail;
  }

  if (error instanceof ProfileExtractionValidationError) {
    return error.technicalDetail;
  }

  if (error instanceof Error) {
    return sanitizeLogText(error.message).slice(0, 180);
  }

  return "Unknown OCR error";
}

function logOcrNonJsonResponse(
  context: OcrLogContext,
  rawText: unknown,
  error: unknown,
) {
  const responseText = typeof rawText === "string" ? rawText : String(rawText ?? "");

  console.warn("[OCR] Non JSON response", {
    stage: "parse-ai-output",
    sourceStage: context.stage,
    model: context.model,
    mimeType: context.mimeType,
    fileName: context.fileName,
    chunkIndex: context.chunkIndex,
    pageRange: context.pageRange,
    responseLength: responseText.length,
    preview: sanitizeLogText(responseText).slice(0, 120),
    errorType:
      error instanceof StructuredOutputError
        ? error.code
        : error instanceof Error
          ? error.name
          : "UnknownError",
  });
}

function logOcrFallbackParsing(
  context: OcrLogContext,
  rawText: unknown,
  fallback: "csv-like" | "repair-pass" | "failed",
  error?: unknown,
) {
  const responseText = typeof rawText === "string" ? rawText : String(rawText ?? "");

  console.warn("[OCR] AI response required fallback parsing", {
    stage: context.stage,
    model: context.model,
    mimeType: context.mimeType,
    fileName: context.fileName,
    chunkIndex: context.chunkIndex,
    pageRange: context.pageRange,
    fallback,
    responseLength: responseText.length,
    preview: sanitizeLogText(responseText).slice(0, 120),
    errorCode:
      error instanceof StructuredOutputError
        ? error.code
        : error instanceof Error
          ? error.name
          : undefined,
  });
}

function logOcrWarning(
  message: string,
  context: OcrLogContext & {
    errorType?: string;
    pages?: number;
    technicalDetail?: string;
    totalTextLength?: number;
  },
) {
  console.warn("[OCR] " + message, {
    stage: context.stage,
    model: context.model,
    mimeType: context.mimeType,
    fileName: context.fileName,
    chunkIndex: context.chunkIndex,
    pageRange: context.pageRange,
    errorType: context.errorType,
    pages: context.pages,
    totalTextLength: context.totalTextLength,
    technicalDetail: context.technicalDetail
      ? sanitizeLogText(context.technicalDetail).slice(0, 180)
      : undefined,
  });
}

function sanitizeLogText(value: string) {
  return value.replace(/\s+/g, " ").replace(/</g, "‹").replace(/>/g, "›").trim();
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback;
  const normalized = value.trim().replace(/^['"]|['"]$/g, "").toLowerCase();

  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return fallback;
}

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeSupportedMimeType(mimeType: string) {
  if (mimeType === "image/jpg") return "image/jpeg";

  if (mimeType === "application/pdf" || mimeType === "image/jpeg" || mimeType === "image/png") {
    return mimeType;
  }

  throw new CsvAnalysisError("Formato de archivo no soportado.", `MIME no soportado: ${mimeType}`);
}

export { PdfChunkingError, PdfTextExtractionError, StructuredOutputError };
