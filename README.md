# ADALO Intelligence OCR

Nota de UI: la herramienta muestra `Motor ADALO` en los resultados para mantener una experiencia simple y profesional. Los modelos reales usados internamente, como Gemini, fallback o Gemma experimental, quedan en logs del servidor y variables de entorno.

Aplicación web simple para convertir documentos PDF en CSV mediante análisis OCR/IA con Google AI.

La app mantiene un flujo único: iniciar sesión con Google, validar un código privado de ADALO, cargar un archivo, procesarlo del lado servidor y descargar un CSV. No guarda archivos ni CSV permanentemente.

La app usa como estrategia principal JSON estructurado generado por Google AI y convertido a CSV seguro del lado servidor. Para robustecer el MVP, si el modelo devuelve CSV directo, el servidor lo parsea, lo normaliza y vuelve a generar un CSV seguro. Si devuelve texto libre, se intenta una segunda llamada corta para reparar esa salida a JSON estructurado. Si todo eso falla y el PDF tiene texto extraíble, se genera un CSV local básico con columnas `Página`, `Línea` y `Texto`.

Despues del procesamiento, la UI muestra una vista previa compacta de los primeros registros y permite descargar el CSV completo.

## Instalación con pnpm

Este proyecto usa `pnpm` y `pnpm-lock.yaml`. No volver a usar `package-lock.json` para este proyecto.

```bash
corepack enable
corepack prepare pnpm@latest --activate
pnpm install
pnpm dev
```

En Windows, si `corepack enable` falla por permisos sobre `C:\Program Files\nodejs`, podés usar:

```bash
npm install -g pnpm
```

Después de la migración, no uses `npm install` para instalar dependencias del proyecto.

## Scripts

```bash
pnpm dev
pnpm lint
pnpm build
pnpm start
pnpm test:structured-output
pnpm test:pdf-fallback
pnpm test:ocr-pdf-flow
pnpm test:ocr-force-local
pnpm hash:access-code "ADALO-2026-CLIENTE"
```

## Variables de entorno

Creá un archivo `.env.local` basado en `.env.example`:

```env
NEXT_PUBLIC_SITE_URL="http://localhost:3000"
NEXTAUTH_URL="http://localhost:3000"

AUTH_SECRET=""
AUTH_GOOGLE_ID=""
AUTH_GOOGLE_SECRET=""

GOOGLE_AI_API_KEY=""
GOOGLE_AI_MODEL="gemini-2.5-flash"
GOOGLE_AI_FALLBACK_MODEL="gemini-2.0-flash"
GOOGLE_AI_EXPERIMENTAL_MODEL="gemma-4-31b-it"
GOOGLE_AI_MAX_RETRIES="1"
GOOGLE_AI_RETRY_BASE_DELAY_MS="750"

MAX_FILE_SIZE_MB="50"
MAX_PDF_SIZE_MB="50"
MAX_IMAGE_SIZE_MB="20"
OCR_TIMEOUT_SECONDS="120"
OCR_DIRECT_FILE_TIMEOUT_SECONDS="45"
OCR_CHUNK_TIMEOUT_SECONDS="45"
OCR_CHUNK_MAX_CHARS="12000"
OCR_CHUNK_OVERLAP_CHARS="500"
OCR_MAX_PDF_PAGES="30"
OCR_BALANCED_MODE="true"
OCR_FAST_MODE="false"
OCR_MAX_PROCESSING_SECONDS="120"
OCR_MAX_CHUNKS_BALANCED_MODE="4"
OCR_USE_EXPERIMENTAL_MODEL="false"
OCR_ALLOW_CHUNKS_IN_FAST_MODE="false"
OCR_IMAGE_OPTIMIZATION_ENABLED="true"
OCR_IMAGE_MAX_DIMENSION="1800"
OCR_IMAGE_JPEG_QUALITY="85"
FORCE_LOCAL_PDF_FALLBACK="false"

RATE_LIMIT_OCR_REQUESTS="5"
RATE_LIMIT_OCR_WINDOW_SECONDS="600"

UPSTASH_REDIS_REST_URL=""
UPSTASH_REDIS_REST_TOKEN=""

ACCESS_CODE_HASHES=""
ACCESS_COOKIE_SECRET=""
ACCESS_CODE_COOKIE_NAME="adalo_ocr_access"
ACCESS_CODE_TTL_SECONDS="1800"
ACCESS_CODE_MAX_ATTEMPTS="5"
ACCESS_CODE_WINDOW_SECONDS="600"
```

`GOOGLE_AI_API_KEY` es server-side y nunca debe exponerse como `NEXT_PUBLIC`.

## Formatos soportados

La validación técnica acepta `.jpg` y `.jpeg`. La UI muestra `JPG` para simplificar el texto visible.

- PDF
- JPG/JPEG
- PNG

`MAX_FILE_SIZE_MB` define el techo general. `MAX_PDF_SIZE_MB` limita PDFs y `MAX_IMAGE_SIZE_MB` limita JPG/JPEG/PNG. Por defecto, PDFs admiten hasta 50 MB e imagenes hasta 20 MB.

## CSV y Microsoft 365

Los CSV se descargan en UTF-8 con BOM para mejorar compatibilidad con Excel.

Antes de generar el archivo, el servidor normaliza los nombres de columnas:

- elimina saltos de linea y caracteres de control;
- recorta espacios al inicio y final;
- evita columnas vacias usando `Columna_N`;
- si hay columnas duplicadas, las renombra como `Columna`, `Columna_2`, `Columna_3`.

Esto facilita el uso posterior en Power Automate, SharePoint y Microsoft Lists. La app no sube archivos automaticamente a Microsoft 365 en esta fase.

## Uso con Power Automate / Microsoft 365

Flujo recomendado para pilotos:

1. El usuario procesa el documento en ADALO OCR y descarga el CSV.
2. El usuario sube el CSV a una carpeta de SharePoint.
3. Power Automate detecta el archivo nuevo.
4. El flujo externo lee el CSV.
5. Luego puede cargar datos en Microsoft Lists, Excel, SharePoint, Power BI o enviar correos.

ADALO OCR no almacena archivos, no guarda CSVs y no mantiene trazabilidad interna en esta etapa. La trazabilidad, validaciones, alertas y registros historicos se implementan en el flujo externo del cliente.

## Detección interna del documento

La interfaz no pide elegir si el archivo es una tabla, comprobante, remito o documento técnico. El usuario solo carga el archivo y la app detecta internamente el tipo probable según el nombre y el formato.

Esa detección viaja como `documentType` en el `FormData` para orientar el prompt y la estructura del CSV, pero no se muestra en pantalla, no se guarda en base de datos y no se conserva como preferencia.

Si no hay señales claras, la app usa modo `auto` y el motor decide la estructura más conveniente: tabla con encabezados originales, campos comerciales/operativos, o datos técnico-administrativos por secciones.

Los archivos en `test-files/` se usan solo para pruebas de desarrollo. Los documentos reales se procesan desde la carga en la UI.

## Perfiles internos por codigo de acceso

La herramienta puede adaptar internamente el prompt y la estructura CSV segun el codigo de acceso validado. Esto no se muestra al usuario final y no requiere que el usuario elija categorias.

El perfil inicial `ADALO-2026-MATEO` usa la plantilla `commercial-operations`, orientada a comprobantes, facturas, tickets, remitos, SENASA, ARCA, DTVe, CADTV, certificados de carga, documentos de movimiento, productos agro/comerciales y transporte.

Para usarlo, el hash del codigo debe estar incluido en `ACCESS_CODE_HASHES`. Al validar el codigo, el servidor guarda solo un `clientProfileId` firmado en una cookie segura; no guarda ni expone el codigo plano.

Este patron permite mejorar velocidad y calidad para clientes con documentos repetitivos, manteniendo la UI simple.

## Optimización de imágenes

Para JPG/JPEG/PNG, el servidor optimiza la imagen antes de enviarla al motor IA cuando `OCR_IMAGE_OPTIMIZATION_ENABLED="true"`.

- Corrige orientación EXIF.
- Redimensiona sin agrandar imágenes pequeñas.
- Usa `OCR_IMAGE_MAX_DIMENSION` como lado largo máximo.
- Convierte a JPEG con `OCR_IMAGE_JPEG_QUALITY`.
- Reduce peso y tiempo de procesamiento sin exponer la imagen al frontend.

Variables:

```env
OCR_IMAGE_OPTIMIZATION_ENABLED="true"
OCR_IMAGE_MAX_DIMENSION="1800"
OCR_IMAGE_JPEG_QUALITY="85"
```

Para mejores fotos de tablas o listados: usar buena iluminación, evitar sombras, enfocar la tabla completa y tomar la foto lo más perpendicular posible.

## Acceso privado mediante código

1. El usuario inicia sesión con Google.
2. Luego ingresa un código privado otorgado por ADALO Consulting Group.
3. Los códigos no se guardan en texto plano: se comparan contra hashes SHA-256 configurados en variables de entorno.
4. Para crear un hash:

```bash
corepack pnpm hash:access-code "ADALO-2026-CLIENTE"
```

5. Pegá el resultado en:

```env
ACCESS_CODE_HASHES="resultado_hash"
```

6. Podés configurar varios hashes separados por coma.
7. En producción configurá `ACCESS_COOKIE_SECRET`. Si no existe, se usa `AUTH_SECRET`; en desarrollo hay un fallback temporal.
8. Nunca subas `.env.local` al repositorio.

La cookie de acceso es `httpOnly`, `sameSite=lax`, `secure` en producción y no contiene el PIN. Al cerrar sesión desde la app, también se borra esta cookie.

El acceso por código dura 30 minutos por defecto mediante `ACCESS_CODE_TTL_SECONDS="1800"`. Para hacerlo más estricto, bajá ese valor. Para hacerlo más laxo, subilo. Si se quisiera pedir código cada vez que se reinicia el navegador, puede cambiarse a una cookie de sesión, pero por defecto se usa TTL para no pedir PIN en cada refresh mientras siga vigente.

## Google OAuth

1. Creá un proyecto en Google Cloud Console.
2. Configurá la pantalla de consentimiento OAuth.
3. Creá credenciales OAuth de tipo aplicación web.
4. Agregá este callback para desarrollo:

```text
http://localhost:3000/api/auth/callback/google
```

5. Para producción, agregá:

```text
https://app.adaloconsultinggroup.com/api/auth/callback/google
```

6. Copiá el Client ID en `AUTH_GOOGLE_ID` y el Client Secret en `AUTH_GOOGLE_SECRET`.

Configurá `NEXTAUTH_URL` para evitar warnings de Auth.js:

```env
NEXTAUTH_URL="http://localhost:3000"
```

En producción:

```env
NEXTAUTH_URL="https://app.adaloconsultinggroup.com"
```

## Google AI

1. Creá una API Key en Google AI Studio.
2. Agregala como `GOOGLE_AI_API_KEY`.
3. El modelo se configura desde `GOOGLE_AI_MODEL`; por defecto se usa `gemini-2.5-flash`.

Si `GOOGLE_AI_API_KEY` no está configurada, la app devuelve un CSV mock de desarrollo para validar el flujo de carga y descarga sin llamar a Google AI.

## JSON estructurado a CSV seguro

El flujo principal es:

```text
PDF con texto extraíble -> extracción local -> chunks -> Google AI -> JSON estructurado -> recordsToCsv -> CSV descargable
Imagen o PDF sin texto extraíble -> Google AI directo -> JSON estructurado -> recordsToCsv -> CSV descargable
```

La respuesta esperada de IA tiene esta forma:

```json
{
  "mode": "table",
  "columns": ["Columna 1", "Columna 2"],
  "rows": [
    {
      "Columna 1": "valor",
      "Columna 2": "valor con coma, dentro de la misma celda"
    }
  ]
}
```

El servidor normaliza valores, completa columnas faltantes, convierte arrays a texto separado por punto y coma, elimina saltos de línea internos y escapa celdas CSV con comillas dobles. Esto evita errores con textos como `General Güemes, Salta`.

El parser detecta respuestas no JSON antes de intentar `JSON.parse`. Si el modelo devuelve CSV, se acepta como fallback y se reescribe con escape seguro. Si devuelve texto libre, el backend intenta un repair pass a JSON. Si un PDF ya tenía texto extraíble y la IA no logra estructurarlo, la app devuelve un CSV local básico en vez de fallar. Si un servicio intermedio devuelve HTML, markdown inválido, texto vacío o un esquema inválido, la app lo convierte en un error controlado, reintenta del lado servidor y evita mostrar al usuario errores crudos como `Unexpected token` o contenido `<!DOCTYPE`.

Prueba rápida del parser:

```bash
corepack pnpm test:structured-output
corepack pnpm test:pdf-fallback
corepack pnpm test:ocr-pdf-flow
corepack pnpm test:ocr-force-local
```

## Diagnóstico: forzar fallback local de PDF

La respuesta exitosa de `/api/ocr/process` incluye `durationMs`. La UI lo muestra como tiempo de procesamiento cuando está disponible, por ejemplo `8,4 s`.

Para comprobar que el endpoint real, la extracción local y la descarga CSV funcionan sin depender de Google AI, podés activar:

```env
FORCE_LOCAL_PDF_FALLBACK="true"
```

Con esa variable activa, si el archivo cargado es PDF, `/api/ocr/process` no llama a Google AI. Extrae texto localmente, genera un CSV básico con `Página`, `Línea` y `Texto`, y responde `success: true` con `modelUsed="local pdf text fallback"`.

No usar este modo en producción salvo diagnóstico puntual. Para volver al flujo normal:

```env
FORCE_LOCAL_PDF_FALLBACK="false"
```

La extracción local intenta primero `pdf-parse`. Si esa librería falla en el runtime del route handler, usa `pdfjs-dist` como fallback server-side con worker configurado explícitamente desde `node_modules`. Si ambos extractores fallan, aplica un último escaneo básico sin dependencias externas para recuperar texto embebido en el PDF. Esto permite que el CSV básico `Página`, `Línea`, `Texto` siga funcionando aunque una librería no sea compatible con el entorno actual.

## Modo balanceado

`OCR_BALANCED_MODE="true"` es la estrategia recomendada para el MVP. Busca una salida CSV de mejor calidad sin permitir esperas excesivas.

- PDFs pequeños o simples se intentan procesar directo con IA para conservar tablas y columnas originales.
- Si el análisis directo falla, la app extrae texto localmente y procesa chunks.
- `OCR_MAX_PROCESSING_SECONDS` limita el presupuesto total por archivo.
- `OCR_DIRECT_FILE_TIMEOUT_SECONDS` evita cortar demasiado pronto documentos simples que pueden devolver tablas de buena calidad.
- `OCR_MAX_CHUNKS_BALANCED_MODE` limita cuántas partes se procesan en modo balanceado.
- Si algunos chunks funcionan y otros no, la app devuelve un CSV parcial útil con filas de error controladas.
- El fallback local `Página`, `Línea`, `Texto` es una extracción básica de seguridad y solo se usa como última opción si no hay resultado IA aceptable.
- Para priorizar más calidad, aumentar `OCR_MAX_PROCESSING_SECONDS` u `OCR_DIRECT_FILE_TIMEOUT_SECONDS`.
- Gemma 4 es experimental y solo se intenta con `OCR_USE_EXPERIMENTAL_MODEL="true"`.

Variables recomendadas:

```env
OCR_BALANCED_MODE="true"
OCR_FAST_MODE="false"
OCR_MAX_PROCESSING_SECONDS="120"
OCR_DIRECT_FILE_TIMEOUT_SECONDS="45"
OCR_MAX_CHUNKS_BALANCED_MODE="4"
OCR_USE_EXPERIMENTAL_MODEL="false"
OCR_ALLOW_CHUNKS_IN_FAST_MODE="false"
OCR_IMAGE_OPTIMIZATION_ENABLED="true"
OCR_IMAGE_MAX_DIMENSION="1800"
OCR_IMAGE_JPEG_QUALITY="85"
GOOGLE_AI_MAX_RETRIES="1"
GOOGLE_AI_RETRY_BASE_DELAY_MS="750"
```

## Cambio de modelo

El modelo recomendado inicial es:

```env
GOOGLE_AI_MODEL="gemini-2.5-flash"
```

También podés configurar un modelo alternativo:

```env
GOOGLE_AI_FALLBACK_MODEL="gemini-2.0-flash"
```

Si el modelo principal falla después de sus reintentos, la app prueba `GOOGLE_AI_FALLBACK_MODEL`. Gemma 4 queda como comparación experimental y solo se intenta si `OCR_USE_EXPERIMENTAL_MODEL="true"` y existe `GOOGLE_AI_EXPERIMENTAL_MODEL`.

## Modelo experimental Gemma 4

La app usa Gemini 2.5 Flash por defecto y puede usar Gemini 2.0 Flash como fallback. Además permite probar Gemma 4 como modelo experimental sin reemplazar Gemini.

Identificadores sugeridos:

```env
GOOGLE_AI_EXPERIMENTAL_MODEL="gemma-4-31b-it"
# o
GOOGLE_AI_EXPERIMENTAL_MODEL="gemma-4-26b-a4b-it"
```

La disponibilidad depende de Google AI Studio / Gemini API. Si no querés usar Gemma 4, dejá `OCR_USE_EXPERIMENTAL_MODEL="false"` o `GOOGLE_AI_EXPERIMENTAL_MODEL=""`. Cuando se usa el experimental, el detalle queda en logs internos; la UI sigue mostrando `Motor ADALO`.

## Resiliencia ante saturación del modelo

La app reintenta automáticamente errores temporales del modelo del lado servidor. Esto cubre errores como `429`, `500`, `502`, `503`, `504`, problemas de red temporales, `high demand` y `service unavailable`.

Cuando Google AI responde `429`, `Too Many Requests`, `quota`, `Resource exhausted` o saturación temporal, la UI muestra `Motor temporalmente ocupado` con un mensaje amigable. No se muestran errores técnicos, URLs de Google ni nombres internos de modelos. En modo balanceado se evita una cadena larga de reintentos: se espera brevemente, se prueba el fallback configurado si corresponde y se devuelve un error claro si el límite persiste.

Variables disponibles:

```env
GOOGLE_AI_MAX_RETRIES="1"
GOOGLE_AI_RETRY_BASE_DELAY_MS="750"
GOOGLE_AI_FALLBACK_MODEL="gemini-2.0-flash"
GOOGLE_AI_EXPERIMENTAL_MODEL="gemma-4-31b-it"
OCR_USE_EXPERIMENTAL_MODEL="false"
```

Con los valores de desarrollo por defecto, las esperas entre intentos son aproximadamente:

- intento 1: 1 segundo;
- intento 2: 2 segundos.

En producción se puede subir `GOOGLE_AI_MAX_RETRIES` a `3` si se prioriza resiliencia por encima de velocidad.

Si todos los reintentos del modelo principal fallan por saturación, salida no estructurable o timeout y hay fallback configurado, se prueba el modelo alternativo. Gemma 4 solo se intenta si `OCR_USE_EXPERIMENTAL_MODEL="true"`. La UI no muestra nombres técnicos de modelos.

## Gemini vs Gemma 4

- La app usa por defecto `GOOGLE_AI_MODEL="gemini-2.5-flash"`.
- Se puede probar Gemma 4 configurando `GOOGLE_AI_EXPERIMENTAL_MODEL` y activando `OCR_USE_EXPERIMENTAL_MODEL="true"`.
- Se puede configurar `GOOGLE_AI_FALLBACK_MODEL` para usar un modelo alternativo ante saturación temporal.
- Si `OCR_USE_EXPERIMENTAL_MODEL="false"` o `GOOGLE_AI_EXPERIMENTAL_MODEL` está vacío, no se intenta modelo experimental.
- El identificador exacto debe salir de Google AI Studio / Gemini API.
- La lógica de OCR, CSV y descarga se mantiene igual.

## Procesamiento de PDFs complejos

Para PDFs pequeños o simples, la app intenta primero el procesamiento directo con el modelo configurado para reducir tiempos. Esto evita extracción local y chunking cuando el documento probablemente puede resolverse en una sola llamada.

Para PDFs extensos o complejos, o cuando el análisis directo falla por timeout o salida no estructurable, la app extrae texto localmente, agrupa páginas en chunks y procesa cada chunk por separado. Esto reduce timeouts en documentos largos, narrativos o mixtos.

Variables:

```env
OCR_CHUNK_MAX_CHARS="12000"
OCR_CHUNK_OVERLAP_CHARS="500"
OCR_MAX_PDF_PAGES="30"
OCR_DIRECT_FILE_TIMEOUT_SECONDS="45"
OCR_CHUNK_TIMEOUT_SECONDS="45"
```

Si el PDF no tiene texto extraíble, parece escaneado o la extracción local falla, la app usa el procesamiento directo con Google AI como fallback. `OCR_DIRECT_FILE_TIMEOUT_SECONDS` controla la espera de análisis directo y `OCR_TIMEOUT_SECONDS` queda como compatibilidad.

Si un chunk aislado falla, el CSV final incluye una fila de sistema indicando qué página o rango no pudo procesarse. Si fallan todos los chunks por salida inválida del modelo, la app intenta una vez el procesamiento directo del PDF completo. Si eso también falla y hay texto extraído, usa `local pdf text fallback` y genera `Página,Línea,Texto`.

Para PDFs tabulares simples con columnas conocidas, la app prioriza el análisis directo para preservar mejor las columnas originales. Si la IA no logra estructurar un PDF con texto extraído, se usa el fallback local `Página`, `Línea`, `Texto`.

Antes del fallback básico, la app intenta fallbacks locales intermedios:

- `pdf table fallback` para PDFs tabulares conocidos.
- `pdf structured sections fallback` para PDFs con secciones claras, como fichas descriptivas, resúmenes ejecutivos, expedientes, componentes de proyecto, resoluciones, consumos, documentos en proceso e inspecciones.

El fallback de secciones genera columnas `Sección`, `Categoría`, `Dato`, `Valor`, `Detalle`, `Fecha`, `Expediente/Resolución`, `Empresa/Proyecto`, `Ubicación` y `Observación`. El CSV `Página`, `Línea`, `Texto` queda como última red de seguridad.

`FORCE_LOCAL_PDF_FALLBACK` solo debe usarse para diagnóstico: fuerza el CSV local y omite Google AI.

Mejora futura posible: conversión página por página a imagen para PDFs escaneados o muy visuales. No está implementado todavía para evitar librerías pesadas y mantener compatibilidad simple con Vercel.

## Seguridad

- No subir `.env.local`.
- No exponer API keys en el frontend.
- Los archivos se procesan en memoria del lado servidor.
- `/app` requiere sesión Google y código privado validado.
- `POST /api/ocr/process` requiere sesión Google, código privado validado, content-type correcto, formato admitido, tamaño máximo y archivo no vacío.
- Si la cookie de acceso expira o se borra, `/app` vuelve a redirigir a `/access`.
- El endpoint OCR tiene rate limiting activo: por defecto 5 solicitudes cada 10 minutos por usuario autenticado o IP.
- La validación de código tiene rate limiting activo: por defecto 5 intentos cada 10 minutos por usuario autenticado o IP.
- Si se excede un límite, responde `429` con un mensaje claro y headers `X-RateLimit-*`.
- Para despliegues simples se usa rate limit en memoria.
- Para producción con múltiples instancias serverless, configurar `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN`.

## Seguridad de dependencias con pnpm

- Se usa `pnpm-lock.yaml` para reproducibilidad.
- `pnpm-workspace.yaml` define `minimumReleaseAge: 1440` para evitar instalar versiones publicadas hace menos de 24 horas.
- No se debe volver a crear ni commitear `package-lock.json`.
- No ejecutar `npm audit fix --force` sin revisar impacto y cambios de versión.
- No aprobar build scripts de dependencias desconocidas.
- Si `pnpm` solicita aprobación de builds, revisar cada dependencia antes de aprobarla.
- No usar `dangerouslyAllowAllBuilds`.

## Deploy en Vercel

1. Subí el repo a GitHub.
2. Importalo en Vercel como proyecto Next.js.
3. Configurá todas las variables de entorno en Vercel.
4. Asociá el dominio o subdominio `app.adaloconsultinggroup.com`.
5. En Google OAuth, agregá el callback de producción.
6. Para rate limits robustos, agregá Redis/KV compatible con Upstash REST.

## Flujo

1. Login con Google.
2. Validar código privado en `/access`.
3. Cargar PDF, JPG/JPEG o PNG desde `/app`.
4. Procesar documento en servidor.
5. Descargar CSV generado.

Los archivos y CSV no se guardan permanentemente. El procesamiento ocurre en memoria del lado servidor.

## Pruebas recomendadas

1. PDF tabular simple.
2. PDF narrativo o ejecutivo.
3. Foto JPG de una tabla o documento.
4. PNG de captura de pantalla.
