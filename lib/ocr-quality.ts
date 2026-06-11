import type { ClientProfile } from "@/lib/client-profiles";
import {
  getClientProfileCode,
  isCompanyPersonnelProfile,
  isPersonnelRosterProfile,
  isVisionTableProfile,
} from "@/lib/client-profiles";
import {
  assessCompanyPersonnelRows,
  COMPANY_PERSONNEL_COLUMNS,
} from "@/lib/company-personnel-pattern";
import { parseCsvPreview } from "@/lib/csv-preview";
import type { DocumentPreprocessingResult } from "@/lib/document-preprocessing";
import type { CsvAnalysisResult } from "@/lib/google-ai";
import {
  assessPersonnelRosterRows,
  isValidCuil,
} from "@/lib/personnel-roster-pattern";
import { assessExtractionQuality } from "@/lib/structured-output";

export type OCRQualityStatus =
  | "completed"
  | "completed_with_warnings"
  | "accepted_with_warnings"
  | "failed_quality_gate"
  | "fallback_required"
  | "manual_review_required";

export type OCRQualityAssessment = {
  acceptable: boolean;
  confidence: number;
  qualityStatus: OCRQualityStatus;
  reason: string;
  requiresManualReview: boolean;
  shouldFallback: boolean;
  warnings: string[];
};

export function assessOCRQuality(
  result: CsvAnalysisResult,
  profile?: ClientProfile,
  preprocessing?: DocumentPreprocessingResult,
): OCRQualityAssessment {
  const parsed = parseCsvPreview(result.csvContent);
  const columns = parsed.columns;
  const rows = parsed.rows.map((row) =>
    Object.fromEntries(columns.map((column, index) => [column, row[index] ?? ""])),
  );
  const warnings = [
    ...(preprocessing?.warnings ?? []),
    ...(result.profileValidationWarnings ?? []),
    ...(result.warnings ?? []),
  ].filter(Boolean);
  const confidence = estimateConfidence(result, columns, rows, profile);
  const minConfidence = readNumber(process.env.OCR_MIN_CONFIDENCE, 0.75);

  if (isVisionTableProfile(profile)) {
    return assessVisionTableProfileResult({
      columns,
      confidence,
      minConfidence,
      preprocessing,
      profile,
      rows,
      warnings,
    });
  }

  if (isPersonnelRosterProfile(profile)) {
    return assessPersonnelRosterResult({
      columns,
      rows,
      warnings,
    });
  }

  if (isCompanyPersonnelProfile(profile)) {
    return assessCompanyPersonnelResult({
      columns,
      rows,
      warnings,
    });
  }

  const structuredQuality = assessExtractionQuality(columns, rows, {
    clientProfileId: profile?.id,
    documentType:
      profile?.defaultExtractionProfile === "commercial-operations"
        ? "invoice"
        : profile?.defaultExtractionProfile === "table-list"
          ? "table"
          : profile?.defaultExtractionProfile === "technical-admin"
            ? "report"
            : "auto",
    extractionProfile: profile?.defaultExtractionProfile,
  });

  if (rows.length === 0 || columns.length === 0) {
    return createAssessment({
      confidence: 0,
      qualityStatus: "fallback_required",
      reason: "No rows or columns were extracted",
      warnings,
    });
  }

  if (
    result.qualityStatus === "accepted_with_warnings" &&
    structuredQuality.quality !== "low"
  ) {
    return {
      acceptable: true,
      confidence: Math.max(confidence, 0.65),
      qualityStatus: "accepted_with_warnings",
      reason: "Structured table recovered from Document AI text/layout",
      requiresManualReview: false,
      shouldFallback: false,
      warnings,
    };
  }

  if (confidence < minConfidence) {
    return createAssessment({
      confidence,
      qualityStatus: "fallback_required",
      reason: `Confidence ${confidence.toFixed(2)} below minimum ${minConfidence.toFixed(2)}`,
      warnings,
    });
  }

  if (structuredQuality.quality === "low") {
    return createAssessment({
      confidence,
      qualityStatus: "fallback_required",
      reason: structuredQuality.reason,
      warnings,
    });
  }

  const hasWarnings =
    warnings.length > 0 ||
    result.resultQuality === "partial" ||
    result.resultQuality === "local-fallback";

  return {
    acceptable: true,
    confidence,
    qualityStatus: hasWarnings ? "completed_with_warnings" : "completed",
    reason: structuredQuality.reason,
    requiresManualReview: false,
    shouldFallback: false,
    warnings,
  };
}

function assessCompanyPersonnelResult({
  columns,
  rows,
  warnings,
}: {
  columns: string[];
  rows: Record<string, string>[];
  warnings: string[];
}): OCRQualityAssessment {
  const normalizedColumns = columns.map(normalizeColumn);
  const missingColumns = COMPANY_PERSONNEL_COLUMNS.filter(
    (column) => !normalizedColumns.includes(normalizeColumn(column)),
  );
  const hasGenericLineCsv = ["pagina", "linea", "texto"].every((column) =>
    normalizedColumns.includes(column),
  );
  const rowAssessment = assessCompanyPersonnelRows(rows);

  if (hasGenericLineCsv) {
    return createAssessment({
      confidence: rowAssessment.qualityScore,
      qualityStatus: "fallback_required",
      reason:
        "Generic Pagina/Linea/Texto output is not valid for company personnel lists",
      warnings,
    });
  }

  if (missingColumns.length > 0) {
    return createAssessment({
      confidence: rowAssessment.qualityScore,
      qualityStatus: "fallback_required",
      reason: `Company personnel columns missing: ${missingColumns.join(", ")}`,
      warnings,
    });
  }

  if (!rowAssessment.acceptable) {
    return createAssessment({
      confidence: rowAssessment.qualityScore,
      qualityStatus: "fallback_required",
      reason:
        `Company personnel pattern quality ${rowAssessment.qualityScore.toFixed(2)} did not meet its profile gate`,
      warnings,
    });
  }

  const profileWarnings = [
    ...warnings,
    ...(rowAssessment.metrics.filasConProvincia < rows.length
      ? [
          `${rows.length - rowAssessment.metrics.filasConProvincia} fila(s) requieren revision de provincia.`,
        ]
      : []),
  ];

  return {
    acceptable: true,
    confidence: rowAssessment.qualityScore,
    qualityStatus:
      profileWarnings.length > 0 ? "completed_with_warnings" : "completed",
    reason: "Company personnel pattern quality gate passed",
    requiresManualReview: false,
    shouldFallback: false,
    warnings: profileWarnings,
  };
}

function assessPersonnelRosterResult({
  columns,
  rows,
  warnings,
}: {
  columns: string[];
  rows: Record<string, string>[];
  warnings: string[];
}): OCRQualityAssessment {
  const expectedColumns = [
    "Numero",
    "NombreApellido",
    "CUIL",
    "LugarTrabajo",
    "Localidad",
    "Provincia",
  ];
  const normalizedColumns = columns.map(normalizeColumn);
  const missingColumns = expectedColumns.filter(
    (column) => !normalizedColumns.includes(normalizeColumn(column)),
  );
  const hasGenericLineCsv = ["pagina", "linea", "texto"].every((column) =>
    normalizedColumns.includes(column),
  );
  const rowAssessment = assessPersonnelRosterRows(rows);
  const confidence = rowAssessment.qualityScore;

  if (hasGenericLineCsv) {
    return createAssessment({
      confidence,
      qualityStatus: "fallback_required",
      reason: "Generic Pagina/Linea/Texto output is not valid for personnel rosters",
      warnings,
    });
  }

  if (missingColumns.length > 0) {
    return createAssessment({
      confidence,
      qualityStatus: "fallback_required",
      reason: `Personnel roster columns missing: ${missingColumns.join(", ")}`,
      warnings,
    });
  }

  if (!rows.some((row) => isValidCuil(String(row.CUIL ?? "")))) {
    return createAssessment({
      confidence: 0,
      qualityStatus: "fallback_required",
      reason: "No personnel rows with a valid CUIL anchor were extracted",
      warnings,
    });
  }

  if (!rowAssessment.acceptable) {
    return createAssessment({
      confidence,
      qualityStatus: "fallback_required",
      reason: `Personnel roster row quality ${confidence.toFixed(2)} below minimum 0.65`,
      warnings,
    });
  }

  const personnelWarnings = [
    ...warnings,
    ...(rowAssessment.recognizedProvinceRows < rows.length
      ? [
          `${rows.length - rowAssessment.recognizedProvinceRows} fila(s) requieren revision de provincia.`,
        ]
      : []),
  ];

  return {
    acceptable: true,
    confidence,
    qualityStatus:
      personnelWarnings.length > 0 ? "completed_with_warnings" : "completed",
    reason: "Personnel roster quality gate passed",
    requiresManualReview: false,
    shouldFallback: false,
    warnings: personnelWarnings,
  };
}

function assessVisionTableProfileResult({
  columns,
  confidence,
  minConfidence,
  preprocessing,
  profile,
  rows,
  warnings,
}: {
  columns: string[];
  confidence: number;
  minConfidence: number;
  preprocessing?: DocumentPreprocessingResult;
  profile?: ClientProfile;
  rows: Record<string, string>[];
  warnings: string[];
}): OCRQualityAssessment {
  const expectedColumns = [...(profile?.expectedColumns ?? [])];
  const normalizedColumns = columns.map(normalizeColumn);
  const normalizedExpected = expectedColumns.map(normalizeColumn);
  const missingColumns = expectedColumns.filter(
    (column) => !normalizedColumns.includes(normalizeColumn(column)),
  );
  const extraColumns = columns.filter(
    (column) => !normalizedExpected.includes(normalizeColumn(column)),
  );
  const hasGenericLineCsv = ["pagina", "linea", "texto"].every((column) =>
    normalizedColumns.includes(column),
  );
  const joinedValues = rows.flatMap((row) => Object.values(row)).join(" ");
  const ignoredText = findIgnoredProfileText(joinedValues, profile);
  const corruptText = looksCorrupt(joinedValues);
  const validRows = rows.filter((row) =>
    expectedColumns.some((column) => String(row[column] ?? "").trim().length > 0),
  );
  const dateWarnings = collectDateWarnings(rows);
  const allWarnings = [
    ...warnings,
    ...dateWarnings,
    ...(preprocessing?.scannedTextWarning ? ["Documento tratado como escaneado o de baja calidad visual."] : []),
  ];

  if (hasGenericLineCsv) {
    return createAssessment({
      confidence,
      qualityStatus: "fallback_required",
      reason: "Generic Pagina/Linea/Texto output is not valid for this profile",
      warnings: allWarnings,
    });
  }

  if (missingColumns.length > 0 || extraColumns.length > 0) {
    return createAssessment({
      confidence,
      qualityStatus: "fallback_required",
      reason: `Profile columns mismatch. Missing: ${missingColumns.join(", ") || "none"}. Extra: ${extraColumns.join(", ") || "none"}.`,
      warnings: allWarnings,
    });
  }

  if (validRows.length === 0) {
    return createAssessment({
      confidence: 0,
      qualityStatus: "fallback_required",
      reason: "No valid movement rows were extracted",
      warnings: allWarnings,
    });
  }

  if (ignoredText.length > 0) {
    return createAssessment({
      confidence,
      qualityStatus: "fallback_required",
      reason: `Ignored scanner text was included as data: ${ignoredText.join(", ")}`,
      warnings: allWarnings,
    });
  }

  if (corruptText) {
    return createAssessment({
      confidence,
      qualityStatus: "manual_review_required",
      reason: "Extracted text looks corrupted",
      warnings: allWarnings,
    });
  }

  if (confidence < minConfidence) {
    return createAssessment({
      confidence,
      qualityStatus: "fallback_required",
      reason: `Confidence ${confidence.toFixed(2)} below minimum ${minConfidence.toFixed(2)}`,
      warnings: allWarnings,
    });
  }

  return {
    acceptable: true,
    confidence,
    qualityStatus: allWarnings.length > 0 ? "completed_with_warnings" : "completed",
    reason: "Profile quality gate passed",
    requiresManualReview: false,
    shouldFallback: false,
    warnings: allWarnings,
  };
}

function createAssessment({
  confidence,
  qualityStatus,
  reason,
  warnings,
}: {
  confidence: number;
  qualityStatus: OCRQualityStatus;
  reason: string;
  warnings: string[];
}): OCRQualityAssessment {
  return {
    acceptable: false,
    confidence,
    qualityStatus,
    reason,
    requiresManualReview:
      qualityStatus === "manual_review_required" || qualityStatus === "failed_quality_gate",
    shouldFallback: qualityStatus === "fallback_required",
    warnings,
  };
}

function estimateConfidence(
  result: CsvAnalysisResult,
  columns: string[],
  rows: Record<string, string>[],
  profile?: ClientProfile,
) {
  if (
    typeof result.providerConfidence === "number" &&
    Number.isFinite(result.providerConfidence)
  ) {
    return roundConfidence(result.providerConfidence);
  }

  const explicitConfidence = collectExplicitConfidence(result.jsonRows ?? rows);

  if (explicitConfidence.length > 0) {
    return roundConfidence(
      explicitConfidence.reduce((total, value) => total + value, 0) / explicitConfidence.length,
    );
  }

  if (
    isPersonnelRosterProfile(profile) &&
    columns.length >= 6
  ) {
    return assessPersonnelRosterRows(rows).qualityScore;
  }

  if (isCompanyPersonnelProfile(profile) && columns.length >= 6) {
    return assessCompanyPersonnelRows(rows).qualityScore;
  }

  const structuredQuality = assessExtractionQuality(columns, rows, {
    clientProfileId: profile?.id,
    extractionProfile: profile?.defaultExtractionProfile,
  });

  if (result.resultQuality === "local-fallback") return 0.45;
  if (result.resultQuality === "partial") return 0.68;
  if (structuredQuality.quality === "high") return 0.9;
  if (structuredQuality.quality === "medium") return 0.78;
  return 0.5;
}

function collectExplicitConfidence(rows: Record<string, unknown>[]) {
  const values: number[] = [];

  for (const row of rows) {
    const rawValue =
      row.confidence ?? row.Confidence ?? row.confianza ?? row.Confianza ?? row.score ?? row.Score;
    const numericValue = Number(String(rawValue ?? "").replace(",", "."));

    if (Number.isFinite(numericValue) && numericValue > 0) {
      values.push(numericValue > 1 ? numericValue / 100 : numericValue);
    }
  }

  return values;
}

function collectDateWarnings(rows: Record<string, string>[]) {
  const warnings: string[] = [];
  const dateColumns = ["FechaSalida", "FechaArribo"];

  for (const column of dateColumns) {
    const invalidCount = rows.filter((row) => {
      const value = String(row[column] ?? "").trim();
      return value.length > 0 && !/^\d{2}\/\d{2}\/\d{4}$/.test(value);
    }).length;

    if (invalidCount > 0) {
      warnings.push(`${column} contiene ${invalidCount} valor(es) fuera de DD/MM/YYYY.`);
    }
  }

  return warnings;
}

function findIgnoredProfileText(value: string, profile?: ClientProfile) {
  const normalized = normalizeSearchValue(value);
  return (profile?.ignoreText ?? []).filter((item) =>
    normalized.includes(normalizeSearchValue(item)),
  );
}

function looksCorrupt(value: string) {
  if (!value.trim()) return false;

  const urlPenalty = /https?:\/\//i.test(value) ? 20 : 0;
  const suspiciousChars =
    [...value].filter((char) => {
      const code = char.charCodeAt(0);
      return char === "\uFFFD" || code < 32 || code === 127;
    }).length + urlPenalty;

  return suspiciousChars / Math.max(value.length, 1) > 0.03;
}

function normalizeColumn(value: string) {
  return normalizeSearchValue(value).replace(/[^a-z0-9]+/g, "");
}

function normalizeSearchValue(value: string) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

function roundConfidence(value: number) {
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}

function readNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function logOCRQualityAssessment(input: {
  assessment: OCRQualityAssessment;
  profile?: ClientProfile;
  providerUsed: string;
  rowsExtracted: number;
}) {
  console.info("[OCR] quality gate", {
    providerUsed: input.providerUsed,
    profileCode: getClientProfileCode(input.profile),
    profileName: input.profile?.label,
    qualityStatus: input.assessment.qualityStatus,
    confidence: input.assessment.confidence,
    rowsExtracted: input.rowsExtracted,
    reason: input.assessment.reason,
    warnings: input.assessment.warnings.length,
  });
}
