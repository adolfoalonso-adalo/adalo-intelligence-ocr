export const COMPANY_PERSONNEL_COLUMNS = [
  "Empresa",
  "CUIT",
  "NombreApellido",
  "DNI",
  "Provincia",
  "Localidad",
] as const;

export type CompanyPersonnelRow = Record<
  (typeof COMPANY_PERSONNEL_COLUMNS)[number],
  string
>;

export type CompanyPersonnelMetrics = {
  cuitsDetectados: number;
  dnisDetectados: number;
  empresasDetectadas: number;
  filasConCUIT: number;
  filasConDNI: number;
  filasConEmpresa: number;
  filasConLocalidad: number;
  filasConNombre: number;
  filasConProvincia: number;
  porcentajeCompletitud: number;
  registrosEstructurados: number;
};

export type CompanyPersonnelPatternResult = {
  acceptable: boolean;
  metrics: CompanyPersonnelMetrics;
  qualityScore: number;
  rows: CompanyPersonnelRow[];
  warnings: string[];
};

const CUIT_PATTERN = /\b\d{2}-\d{8}-\d\b/g;
const CUIT_SINGLE_PATTERN = /\b\d{2}-\d{8}-\d\b/;
const DNI_PATTERN = /\b\d{7,8}\b/g;
const COMPANY_SUFFIX_PATTERN =
  /\b(?:S\.?\s*R\.?\s*L\.?|S\.?\s*A\.?|SOCIEDAD\s+ANONIMA|SOCIEDAD\s+DE\s+RESPONSABILIDAD\s+LIMITADA)\b/i;

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
  PROVINCES.map((province) => [
    normalizeSearchValue(province),
    restoreProvinceAccents(province),
  ]),
);

const NOISE_LINES = new Set([
  "empresa",
  "cuit",
  "nombre apellido",
  "nombre y apellido",
  "dni",
  "provincia",
  "localidad",
  "escaneado con camscanner",
  "camscanner",
]);

export function extractCompanyPersonnelByPattern(
  rawText: string,
): CompanyPersonnelPatternResult {
  const lines = prepareLines(rawText);
  const anchors = findDniAnchors(lines);
  const rows = anchors.map((anchor, index) =>
    buildCompanyPersonnelRow(lines, anchors, anchor, index),
  );
  const metrics = calculateCompanyPersonnelMetrics(rows, rawText);
  const validCoreRows = rows.filter(
    (row) => row.Empresa && row.NombreApellido && isValidDni(row.DNI),
  ).length;
  const coreCompleteness =
    rows.length > 0 ? validCoreRows / rows.length : 0;
  const acceptable =
    metrics.dnisDetectados >= 10 &&
    metrics.cuitsDetectados >= 1 &&
    metrics.empresasDetectadas >= 1 &&
    coreCompleteness >= 0.6;
  const qualityScore = roundConfidence(
    rows.length > 0
      ? coreCompleteness * 0.7 +
          (metrics.filasConProvincia / rows.length) * 0.15 +
          (metrics.filasConLocalidad / rows.length) * 0.15
      : 0,
  );
  const warnings: string[] = [];

  if (metrics.filasConEmpresa < rows.length) {
    warnings.push(
      `${rows.length - metrics.filasConEmpresa} fila(s) no tienen empresa asociada.`,
    );
  }

  if (metrics.filasConNombre < rows.length) {
    warnings.push(
      `${rows.length - metrics.filasConNombre} fila(s) no tienen nombre legible.`,
    );
  }

  if (!acceptable) {
    warnings.push(
      `El patron empresa/personal alcanzo ${(coreCompleteness * 100).toFixed(0)}% de filas con Empresa, NombreApellido y DNI.`,
    );
  }

  return {
    acceptable,
    metrics,
    qualityScore,
    rows,
    warnings,
  };
}

export function calculateCompanyPersonnelMetrics(
  rows: Array<Record<string, string>>,
  rawText = "",
): CompanyPersonnelMetrics {
  const registrosEstructurados = rows.length;
  const filledCells = COMPANY_PERSONNEL_COLUMNS.reduce(
    (total, column) =>
      total +
      rows.filter((row) => String(row[column] ?? "").trim().length > 0).length,
    0,
  );
  const possibleCells = registrosEstructurados * COMPANY_PERSONNEL_COLUMNS.length;
  const rawCuits = new Set(rawText.match(CUIT_PATTERN) ?? []);
  const textWithoutCuits = rawText.replace(CUIT_PATTERN, " ");
  const rawDnis = new Set(textWithoutCuits.match(DNI_PATTERN) ?? []);
  const rowCompanies = new Set(
    rows.map((row) => row.Empresa).filter(Boolean),
  );
  const rowCuits = new Set(rows.map((row) => row.CUIT).filter(Boolean));
  const rowDnis = new Set(rows.map((row) => row.DNI).filter(isValidDni));

  return {
    cuitsDetectados: Math.max(rawCuits.size, rowCuits.size),
    dnisDetectados: Math.max(rawDnis.size, rowDnis.size),
    empresasDetectadas: Math.max(
      countCompanyLines(rawText),
      rowCompanies.size,
    ),
    filasConCUIT: countRowsWithValue(rows, "CUIT"),
    filasConDNI: rows.filter((row) => isValidDni(row.DNI)).length,
    filasConEmpresa: countRowsWithValue(rows, "Empresa"),
    filasConLocalidad: countRowsWithValue(rows, "Localidad"),
    filasConNombre: rows.filter((row) =>
      isLikelyPersonName(row.NombreApellido),
    ).length,
    filasConProvincia: rows.filter((row) =>
      isRecognizedProvince(row.Provincia),
    ).length,
    porcentajeCompletitud:
      possibleCells > 0
        ? Math.round((filledCells / possibleCells) * 1000) / 10
        : 0,
    registrosEstructurados,
  };
}

export function scoreCompanyPersonnelText(rawText: string) {
  const result = extractCompanyPersonnelByPattern(rawText);

  return (
    result.metrics.cuitsDetectados * 8 +
    result.metrics.dnisDetectados * 5 +
    result.metrics.empresasDetectadas * 8 +
    result.metrics.filasConNombre * 4 +
    result.metrics.filasConProvincia * 2 +
    result.metrics.filasConLocalidad * 2 +
    Math.min(rawText.trim().length / 500, 10)
  );
}

export function hasCompanyPersonnelSignals(rawText: string) {
  const metrics = calculateCompanyPersonnelMetrics([], rawText);

  return (
    metrics.cuitsDetectados >= 1 &&
    metrics.dnisDetectados >= 2 &&
    metrics.empresasDetectadas >= 1
  );
}

export function hasPotentialCompanyPersonnelSignals(rawText: string) {
  const metrics = calculateCompanyPersonnelMetrics([], rawText);

  return (
    metrics.cuitsDetectados >= 1 ||
    metrics.dnisDetectados >= 2 ||
    metrics.empresasDetectadas >= 1
  );
}

export function assessCompanyPersonnelRows(
  rows: Array<Record<string, string>>,
) {
  const metrics = calculateCompanyPersonnelMetrics(rows);
  const validCoreRows = rows.filter(
    (row) =>
      String(row.Empresa ?? "").trim() &&
      isLikelyPersonName(String(row.NombreApellido ?? "")) &&
      isValidDni(String(row.DNI ?? "")),
  ).length;
  const coreRatio = rows.length > 0 ? validCoreRows / rows.length : 0;
  const acceptable =
    metrics.dnisDetectados >= 10 &&
    metrics.cuitsDetectados >= 1 &&
    metrics.empresasDetectadas >= 1 &&
    coreRatio >= 0.6;
  const qualityScore = roundConfidence(
    rows.length > 0
      ? coreRatio * 0.7 +
          (metrics.filasConProvincia / rows.length) * 0.15 +
          (metrics.filasConLocalidad / rows.length) * 0.15
      : 0,
  );

  return {
    acceptable,
    coreRatio,
    metrics,
    qualityScore,
  };
}

export function isValidDni(value: string) {
  return /^\d{7,8}$/.test(String(value ?? "").replace(/\D/g, ""));
}

function prepareLines(rawText: string) {
  return rawText
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .flatMap(splitDenseLine)
    .map(cleanLine)
    .filter(Boolean);
}

function splitDenseLine(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const cuits: string[] = [];
  const protectedCuits = normalized.replace(CUIT_PATTERN, (match) => {
    const placeholder = `__ADALO_CUIT_${cuits.length}__`;
    cuits.push(match);
    return `\n${placeholder}\n`;
  });

  return protectedCuits
    .replace(DNI_PATTERN, (match) => `\n${match}\n`)
    .split("\n")
    .map((part) =>
      part.replace(/__ADALO_CUIT_(\d+)__/g, (_, index: string) =>
        cuits[Number(index)] ?? "",
      ),
    );
}

function cleanLine(value: string) {
  const cleaned = value
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/Escaneado\s+con\s+CamScanner/gi, " ")
    .replace(/\bCamScanner\b/gi, " ")
    .replace(/[\t\f\v|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned || NOISE_LINES.has(normalizeSearchValue(cleaned))) {
    return "";
  }

  return cleaned;
}

function findDniAnchors(lines: string[]) {
  const anchors: Array<{ dni: string; lineIndex: number }> = [];

  lines.forEach((line, lineIndex) => {
    if (CUIT_SINGLE_PATTERN.test(line)) {
      return;
    }

    for (const match of line.matchAll(DNI_PATTERN)) {
      anchors.push({
        dni: match[0],
        lineIndex,
      });
    }
  });

  return anchors;
}

function buildCompanyPersonnelRow(
  lines: string[],
  anchors: ReturnType<typeof findDniAnchors>,
  anchor: ReturnType<typeof findDniAnchors>[number],
  anchorIndex: number,
): CompanyPersonnelRow {
  const previousAnchorLine = anchors[anchorIndex - 1]?.lineIndex ?? -1;
  const nextAnchorLine = anchors[anchorIndex + 1]?.lineIndex ?? lines.length;
  const companyContext = findCompanyContext(lines, anchor.lineIndex);
  const before = lines.slice(
    Math.max(previousAnchorLine + 1, companyContext.contextStart, anchor.lineIndex - 8),
    anchor.lineIndex,
  );
  const after = lines.slice(
    anchor.lineIndex + 1,
    Math.min(nextAnchorLine, anchor.lineIndex + 8),
  );
  const province = findProvince(after);
  const locality = findLocality(after, province);
  const name = findPersonName(before);

  return {
    Empresa: companyContext.company,
    CUIT: companyContext.cuit,
    NombreApellido: name,
    DNI: anchor.dni.replace(/\D/g, ""),
    Provincia: province?.canonical ?? "",
    Localidad: locality,
  };
}

function findCompanyContext(lines: string[], anchorLineIndex: number) {
  let company = "";
  let cuit = "";
  let contextStart = 0;

  for (let index = anchorLineIndex - 1; index >= 0; index -= 1) {
    const line = lines[index];
    const cuitMatch = line.match(CUIT_SINGLE_PATTERN)?.[0];

    if (!cuit && cuitMatch) {
      cuit = cuitMatch;
      contextStart = index + 1;
    }

    if (!company && isLikelyCompany(line)) {
      company = normalizeCompanyName(line);
      contextStart = Math.max(contextStart, index + 1);
    }

    if (company && cuit) break;
  }

  return { company, cuit, contextStart };
}

function findPersonName(lines: string[]) {
  for (const line of [...lines].reverse()) {
    if (isLikelyPersonName(line)) {
      return normalizePersonName(line);
    }
  }

  return "";
}

function findProvince(lines: string[]) {
  for (const line of lines) {
    const normalized = normalizeSearchValue(line);
    const canonical = CANONICAL_PROVINCES.get(normalized);

    if (canonical) {
      return { canonical, line };
    }
  }

  return null;
}

function findLocality(
  lines: string[],
  province: ReturnType<typeof findProvince>,
) {
  if (!province) return "";

  const provinceIndex = lines.indexOf(province.line);
  const candidates = [
    ...lines.slice(provinceIndex + 1, provinceIndex + 3),
    ...lines.slice(Math.max(0, provinceIndex - 2), provinceIndex),
  ];

  for (const candidate of candidates) {
    if (isLikelyLocality(candidate)) {
      return toTitleCase(candidate);
    }
  }

  return "";
}

function isLikelyCompany(value: string) {
  const cleaned = value.trim();
  return (
    cleaned.length >= 5 &&
    COMPANY_SUFFIX_PATTERN.test(cleaned) &&
    !CUIT_SINGLE_PATTERN.test(cleaned)
  );
}

function isLikelyPersonName(value: string) {
  const cleaned = value.trim();
  const words = cleaned.split(/\s+/).filter(Boolean);

  return (
    cleaned.length >= 5 &&
    words.length >= 2 &&
    words.length <= 8 &&
    /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(cleaned) &&
    !/\d/.test(cleaned) &&
    !COMPANY_SUFFIX_PATTERN.test(cleaned) &&
    !isRecognizedProvince(cleaned) &&
    !NOISE_LINES.has(normalizeSearchValue(cleaned))
  );
}

function isLikelyLocality(value: string) {
  const cleaned = value.trim();

  return (
    cleaned.length >= 3 &&
    cleaned.length <= 60 &&
    !/\d{7,}/.test(cleaned) &&
    !CUIT_SINGLE_PATTERN.test(cleaned) &&
    !COMPANY_SUFFIX_PATTERN.test(cleaned) &&
    !isRecognizedProvince(cleaned) &&
    !cleaned.includes(",")
  );
}

function normalizeCompanyName(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizePersonName(value: string) {
  return value
    .replace(/^\d{1,4}\s*[-.)]?\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isRecognizedProvince(value: string) {
  return CANONICAL_PROVINCES.has(normalizeSearchValue(value));
}

function countCompanyLines(rawText: string) {
  const companies = new Set(
    rawText
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map(cleanLine)
      .filter(isLikelyCompany)
      .map(normalizeSearchValue),
  );

  return companies.size;
}

function countRowsWithValue(
  rows: Array<Record<string, string>>,
  column: string,
) {
  return rows.filter((row) => String(row[column] ?? "").trim().length > 0)
    .length;
}

function normalizeSearchValue(value: string) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
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

function toTitleCase(value: string) {
  return value
    .toLocaleLowerCase("es-AR")
    .replace(/(^|\s)\p{L}/gu, (match) => match.toLocaleUpperCase("es-AR"))
    .trim();
}

function roundConfidence(value: number) {
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}
