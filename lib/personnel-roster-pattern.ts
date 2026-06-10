export const PERSONNEL_ROSTER_COLUMNS = [
  "Numero",
  "NombreApellido",
  "CUIL",
  "LugarTrabajo",
  "Localidad",
  "Provincia",
] as const;

export type PersonnelRosterRow = Record<(typeof PERSONNEL_ROSTER_COLUMNS)[number], string>;

export type PersonnelRosterPatternResult = {
  acceptable: boolean;
  detectedCuils: number;
  metrics: PersonnelRosterMetrics;
  qualityScore: number;
  recognizedProvinceRows: number;
  rows: PersonnelRosterRow[];
  validRows: number;
  warnings: string[];
};

export type PersonnelRosterMetrics = {
  filasConCUIL: number;
  filasConLocalidad: number;
  filasConLugarTrabajo: number;
  filasConNombre: number;
  filasConProvincia: number;
  porcentajeCompletitud: number;
  totalRegistros: number;
};

const CUIL_PATTERN = /\b(?:\d{10,11}|\d{2}[- ]?\d{7,8}[- ]?\d)\b/g;
const WORKPLACE_PATTERN =
  /\b(?:CAMPAMENTO\s+MARIANA|OFICINA(?:\s*\/\s*|\s+Y\s+)?PROYECTOS?|PROYECTOS?)\b/i;

const PROVINCES = [
  "Ciudad Autonoma de Buenos Aires",
  "Tierra del Fuego",
  "Santiago del Estero",
  "Buenos Aires",
  "Santa Cruz",
  "Santa Fe",
  "Rio Negro",
  "Entre Rios",
  "La Pampa",
  "La Rioja",
  "San Juan",
  "San Luis",
  "Catamarca",
  "Chaco",
  "Chubut",
  "Cordoba",
  "Corrientes",
  "Formosa",
  "Jujuy",
  "Mendoza",
  "Misiones",
  "Neuquen",
  "Salta",
  "Tucuman",
] as const;

const CANONICAL_PROVINCES = new Map(
  PROVINCES.map((province) => [normalizeSearchValue(province), restoreProvinceAccents(province)]),
);

const KNOWN_LOCALITIES = [
  "Buenos Aires",
  "Campo Quijano",
  "Catamarca",
  "Chaco",
  "Chubut",
  "Comodoro Rivadavia",
  "Cordoba",
  "General Mosconi",
  "Jujuy",
  "La Pampa",
  "Mendoza",
  "Salta",
  "San Juan",
  "Tucuman",
] as const;

const NORMALIZED_LOCALITIES = new Set(
  KNOWN_LOCALITIES.map((locality) => normalizeSearchValue(locality)),
);

export function extractPersonnelRosterByPattern(
  rawText: string,
): PersonnelRosterPatternResult {
  const lines = prepareLines(rawText);
  const anchors = findCuilAnchors(lines);
  const rows = anchors.map((anchor, index) =>
    buildPersonnelRow(lines, anchors, anchor, index),
  );
  const assessment = assessPersonnelRosterRows(rows, anchors.length);
  const warnings: string[] = [];

  if (assessment.recognizedProvinceRows < anchors.length) {
    warnings.push(
      `${anchors.length - assessment.recognizedProvinceRows} fila(s) no tienen una provincia reconocida.`,
    );
  }

  if (!assessment.acceptable) {
    warnings.push(
      `El patron de nomina alcanzo ${(assessment.qualityScore * 100).toFixed(0)}% de filas validas.`,
    );
  }

  return {
    ...assessment,
    detectedCuils: anchors.length,
    metrics: calculatePersonnelRosterMetrics(rows),
    rows,
    warnings,
  };
}

export function calculatePersonnelRosterMetrics(
  rows: Array<Record<string, string>>,
): PersonnelRosterMetrics {
  const totalRegistros = rows.length;
  const filasConNombre = countRowsWithValue(rows, "NombreApellido");
  const filasConCUIL = rows.filter((row) => isValidCuil(row.CUIL)).length;
  const filasConLugarTrabajo = countRowsWithValue(rows, "LugarTrabajo");
  const filasConLocalidad = countRowsWithValue(rows, "Localidad");
  const filasConProvincia = rows.filter((row) =>
    isRecognizedProvince(row.Provincia),
  ).length;
  const completedCells =
    countRowsWithValue(rows, "Numero") +
    filasConNombre +
    filasConCUIL +
    filasConLugarTrabajo +
    filasConLocalidad +
    filasConProvincia;
  const possibleCells = totalRegistros * PERSONNEL_ROSTER_COLUMNS.length;

  return {
    filasConCUIL,
    filasConLocalidad,
    filasConLugarTrabajo,
    filasConNombre,
    filasConProvincia,
    porcentajeCompletitud:
      possibleCells > 0 ? Math.round((completedCells / possibleCells) * 1000) / 10 : 0,
    totalRegistros,
  };
}

export function assessPersonnelRosterRows(
  rows: Array<Record<string, string>>,
  detectedCuils = rows.length,
) {
  const recognizedProvinceRows = rows.filter((row) =>
    isRecognizedProvince(row.Provincia),
  ).length;
  const validRows = rows.filter(
    (row) =>
      isValidCuil(row.CUIL) &&
      isLikelyPersonName(row.NombreApellido) &&
      isRecognizedProvince(row.Provincia),
  ).length;
  const denominator = Math.max(detectedCuils, rows.length, 1);
  const qualityScore = roundConfidence(validRows / denominator);
  const largeRosterGate =
    detectedCuils > 100 &&
    recognizedProvinceRows > 80 &&
    qualityScore >= 0.65;
  const regularGate = detectedCuils > 0 && validRows > 0 && qualityScore >= 0.65;

  return {
    acceptable: largeRosterGate || regularGate,
    qualityScore,
    recognizedProvinceRows,
    validRows,
  };
}

export function isValidCuil(value: string) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length === 10 || digits.length === 11;
}

export function normalizePersonnelRosterValue(column: string, value: string) {
  let normalized = applyKnownCorrections(
    String(value ?? "")
      .replace(/\s+/g, " ")
      .trim(),
  );

  if (column === "CUIL") {
    return normalized.replace(/\D/g, "");
  }

  if (column === "Localidad") {
    normalized = normalized
      .replace(/^(?:(?:OD|D|0|00|10)\b[\s|:;,.-]*)+/i, "")
      .replace(/\b(?:SECRETARIA|FOLIO|SEC)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  if (column === "Provincia") {
    return canonicalizeProvince(normalized);
  }

  return normalized;
}

function prepareLines(rawText: string) {
  return applyKnownCorrections(rawText)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(cleanOcrLine)
    .filter(Boolean);
}

function cleanOcrLine(value: string) {
  const cleaned = value
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/Escaneado\s+con\s+CamScanner/gi, " ")
    .replace(/\bCamScanner\b/gi, " ")
    .replace(/[\t\f\v]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (
    !cleaned ||
    /^(?:SECRETARIA|FOLIO|SEC)\b/i.test(cleaned) ||
    isRepeatedHeaderOrNoise(cleaned)
  ) {
    return "";
  }

  return cleaned;
}

function findCuilAnchors(lines: string[]) {
  const anchors: Array<{
    cuil: string;
    lineIndex: number;
    matchIndex: number;
    matchLength: number;
  }> = [];

  lines.forEach((line, lineIndex) => {
    for (const match of line.matchAll(CUIL_PATTERN)) {
      anchors.push({
        cuil: match[0].replace(/\D/g, ""),
        lineIndex,
        matchIndex: match.index ?? 0,
        matchLength: match[0].length,
      });
    }
  });

  return anchors;
}

function buildPersonnelRow(
  lines: string[],
  anchors: ReturnType<typeof findCuilAnchors>,
  anchor: ReturnType<typeof findCuilAnchors>[number],
  anchorIndex: number,
): PersonnelRosterRow {
  const previousLineIndex = anchors[anchorIndex - 1]?.lineIndex ?? -1;
  const nextLineIndex = anchors[anchorIndex + 1]?.lineIndex ?? lines.length;
  const anchorLine = lines[anchor.lineIndex] ?? "";
  const prefix = anchorLine.slice(0, anchor.matchIndex).trim();
  const suffix = anchorLine
    .slice(anchor.matchIndex + anchor.matchLength)
    .trim();
  const beforeLines = lines.slice(
    Math.max(previousLineIndex + 1, anchor.lineIndex - 8),
    anchor.lineIndex,
  );
  const afterLines = [
    suffix,
    ...lines.slice(anchor.lineIndex + 1, Math.min(nextLineIndex, anchor.lineIndex + 9)),
  ].filter(Boolean);
  const number = extractOrderNumber(prefix, beforeLines);
  const name = extractPersonName(prefix, beforeLines);
  const rowContext = afterLines.join(" | ");
  const workplaceMatch = WORKPLACE_PATTERN.exec(rowContext);
  const provinceMatch = findProvinceMatch(rowContext);
  const locality = extractLocality(
    rowContext,
    workplaceMatch,
    provinceMatch,
    afterLines,
  );

  return {
    Numero: number,
    NombreApellido: normalizePersonnelRosterValue("NombreApellido", name),
    CUIL: normalizePersonnelRosterValue("CUIL", anchor.cuil),
    LugarTrabajo: normalizePersonnelRosterValue(
      "LugarTrabajo",
      workplaceMatch?.[0] ?? "",
    ),
    Localidad: normalizePersonnelRosterValue("Localidad", locality),
    Provincia: normalizePersonnelRosterValue(
      "Provincia",
      provinceMatch?.canonical ?? "",
    ),
  };
}

function extractOrderNumber(prefix: string, beforeLines: string[]) {
  const prefixMatch = prefix.match(/^\s*(\d{1,4})\b/);
  if (prefixMatch?.[1]) return prefixMatch[1];

  for (const line of [...beforeLines].reverse()) {
    const match = line.match(/^\s*(\d{1,4})\s*$/);
    if (match?.[1]) return match[1];
  }

  return "";
}

function extractPersonName(prefix: string, beforeLines: string[]) {
  const prefixWithoutNumber = prefix.replace(/^\s*\d{1,4}\s*[-.)]?\s*/, "").trim();

  if (isLikelyPersonName(prefixWithoutNumber)) {
    return prefixWithoutNumber;
  }

  const candidateLines = getCurrentPersonPrelude(beforeLines);

  for (const line of [...candidateLines].reverse()) {
    const candidate = line.replace(/^\s*\d{1,4}\s*[-.)]?\s*/, "").trim();

    if (isLikelyPersonName(candidate)) {
      return candidate;
    }
  }

  return "";
}

function getCurrentPersonPrelude(beforeLines: string[]) {
  let boundaryIndex = -1;

  beforeLines.forEach((line, index) => {
    if (findProvinceMatch(line)) {
      boundaryIndex = index;
    }
  });

  if (boundaryIndex >= 0) {
    return beforeLines.slice(boundaryIndex + 1);
  }

  const workplaceIndex = findLastIndex(beforeLines, (line) =>
    WORKPLACE_PATTERN.test(line),
  );

  if (workplaceIndex >= 0) {
    return beforeLines.slice(Math.min(workplaceIndex + 3, beforeLines.length));
  }

  return beforeLines;
}

function extractLocality(
  rowContext: string,
  workplaceMatch: RegExpExecArray | null,
  provinceMatch: ReturnType<typeof findProvinceMatch>,
  afterLines: string[],
) {
  if (provinceMatch) {
    const start = workplaceMatch
      ? (workplaceMatch.index ?? 0) + workplaceMatch[0].length
      : 0;
    const between = rowContext.slice(start, provinceMatch.index);
    const cleaned = cleanLocalityCandidate(between);

    if (cleaned) return cleaned;
  }

  const provinceLineIndex = afterLines.findIndex((line) =>
    Boolean(findProvinceMatch(line)),
  );
  const workplaceLineIndex = afterLines.findIndex((line) =>
    WORKPLACE_PATTERN.test(line),
  );
  const candidates = afterLines.slice(
    workplaceLineIndex >= 0 ? workplaceLineIndex + 1 : 0,
    provinceLineIndex >= 0 ? provinceLineIndex : afterLines.length,
  );

  for (const candidate of candidates) {
    const cleaned = cleanLocalityCandidate(candidate);
    if (cleaned) return cleaned;
  }

  return "";
}

function cleanLocalityCandidate(value: string) {
  const cleaned = value
    .replace(/\|/g, " ")
    .replace(WORKPLACE_PATTERN, " ")
    .replace(/^(?:(?:OD|D|0|00|10)\b[\s:;,.-]*)+/i, "")
    .replace(/\b(?:SECRETARIA|FOLIO|SEC)\b/gi, " ")
    .replace(/\b\d{1,4}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalizeKnownLocality(cleaned);
}

function findProvinceMatch(value: string) {
  const normalized = normalizeSearchValueWithMap(value);
  let best:
    | {
        canonical: string;
        index: number;
      }
    | undefined;

  for (const [searchName, canonical] of CANONICAL_PROVINCES) {
    const normalizedIndex = normalized.text.lastIndexOf(searchName);
    if (normalizedIndex < 0) continue;

    const candidate = {
      canonical,
      index: normalized.originalIndexes[normalizedIndex] ?? 0,
    };

    // Provincia es el ancla final de la fila. Si localidad y provincia
    // comparten nombre (por ejemplo San Juan), usamos la ultima aparicion.
    if (!best || candidate.index > best.index) {
      best = candidate;
    }
  }

  return best;
}

function isLikelyPersonName(value: string) {
  const normalized = String(value ?? "").trim();

  if (
    !normalized ||
    normalized.length < 5 ||
    !/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(normalized)
  ) {
    return false;
  }

  const containsCuil = new RegExp(CUIL_PATTERN.source).test(normalized);

  if (
    isRepeatedHeaderOrNoise(normalized) ||
    WORKPLACE_PATTERN.test(normalized) ||
    isRecognizedProvince(normalized) ||
    looksLikeKnownLocality(normalized) ||
    containsCuil
  ) {
    return false;
  }

  return normalized.split(/\s+/).length >= 2;
}

function isRecognizedProvince(value: string) {
  return CANONICAL_PROVINCES.has(normalizeSearchValue(value));
}

function canonicalizeProvince(value: string) {
  return CANONICAL_PROVINCES.get(normalizeSearchValue(value)) ?? value.trim();
}

function looksLikeKnownLocality(value: string) {
  return NORMALIZED_LOCALITIES.has(normalizeSearchValue(value));
}

function normalizeKnownLocality(value: string) {
  const normalized = normalizeSearchValue(value);
  const known = KNOWN_LOCALITIES.find(
    (locality) => normalizeSearchValue(locality) === normalized,
  );

  if (!known) return value.trim();

  return restoreProvinceAccents(known);
}

function isRepeatedHeaderOrNoise(value: string) {
  const normalized = normalizeSearchValue(value);
  const exactNoise = [
    "nomina del personal",
    "nombre y apellido",
    "cuil",
    "lugar de trabajo",
    "localidad",
    "provincia",
    "numero",
    "nro",
    "secretaria",
    "folio",
    "sec",
  ].includes(normalized);
  const combinedHeader =
    normalized.includes("nombre y apellido") &&
    normalized.includes("cuil") &&
    normalized.includes("localidad");

  return exactNoise || combinedHeader;
}

function applyKnownCorrections(value: string) {
  return String(value ?? "")
    .replace(/\bSatta\b/gi, "Salta")
    .replace(/\bJWUY\b/gi, "Jujuy")
    .replace(/\bCampo Quljano\b/gi, "Campo Quijano")
    .replace(/\bGeneral Mosconl\b/gi, "General Mosconi")
    .replace(/\bComodoro Rivadavla\b/gi, "Comodoro Rivadavia");
}

function normalizeSearchValue(value: string) {
  return normalizeSearchValueWithMap(value).text;
}

function normalizeSearchValueWithMap(value: string) {
  const source = String(value ?? "");
  const output: string[] = [];
  const originalIndexes: number[] = [];
  let pendingSpace = false;

  for (let index = 0; index < source.length; index += 1) {
    const normalizedChar = source[index]
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

    if (/^[a-zA-Z0-9]$/.test(normalizedChar)) {
      if (pendingSpace && output.length > 0) {
        output.push(" ");
        originalIndexes.push(index);
      }

      output.push(normalizedChar.toLowerCase());
      originalIndexes.push(index);
      pendingSpace = false;
    } else if (output.length > 0) {
      pendingSpace = true;
    }
  }

  return {
    originalIndexes,
    text: output.join(""),
  };
}

function restoreProvinceAccents(value: string) {
  return value
    .replace("Ciudad Autonoma", "Ciudad Autónoma")
    .replace("Rio Negro", "Río Negro")
    .replace("Entre Rios", "Entre Ríos")
    .replace("Cordoba", "Córdoba")
    .replace("Neuquen", "Neuquén")
    .replace("Tucuman", "Tucumán");
}

function roundConfidence(value: number) {
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}

function countRowsWithValue(rows: Array<Record<string, string>>, column: string) {
  return rows.filter((row) => String(row[column] ?? "").trim().length > 0).length;
}

function findLastIndex<T>(values: T[], predicate: (value: T) => boolean) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (predicate(values[index])) return index;
  }

  return -1;
}
