# ADALO Intelligence OCR

Nota de UI: la herramienta muestra `Motor ADALO` en los resultados para mantener una experiencia simple y profesional. Los modelos reales usados internamente, como Gemini, fallback o Gemma experimental, quedan en logs del servidor y variables de entorno.

Aplicación web simple para convertir documentos PDF, JPG y PNG en CSV/JSON mediante análisis OCR/IA con Google AI.

La app mantiene un flujo único: iniciar sesión con Google, validar un código privado de ADALO, cargar un archivo, procesarlo del lado servidor, revisar una vista previa y descargar CSV/JSON. No guarda archivos originales ni resultados completos permanentemente.

La app usa como estrategia principal JSON estructurado generado por Google AI y convertido a CSV seguro del lado servidor. Para robustecer el MVP, si el modelo devuelve CSV directo, el servidor lo parsea, lo normaliza y vuelve a generar un CSV seguro. Si devuelve texto libre, se intenta una segunda llamada corta para reparar esa salida a JSON estructurado. Si todo eso falla y el PDF tiene texto extraíble, se genera un CSV local básico con columnas `Página`, `Línea` y `Texto`.

Despues del procesamiento, la UI muestra una vista previa compacta de los primeros registros y permite descargar el CSV completo y, si el plan lo permite, un JSON con metadata, columnas y filas.

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
pnpm hash:access-code "ADALO-ADMIN-2026-TEST-8K4P"
```

## Variables de entorno

Creá un archivo `.env.local` basado en `.env.example`:

Variables administrativas nuevas:

```env
DATABASE_URL=""
ADMIN_EMAILS="adolfoalonso19@gmail.com"
MASTER_ACCESS_CODE_HASH=""
MASTER_ACCESS_EMAIL="adolfoalonso19@gmail.com"
```

`DATABASE_URL` habilita la administración manual con Postgres/Supabase Postgres. Si no está configurada, el OCR conserva compatibilidad temporal con `ACCESS_CODE_HASHES`.

`ADMIN_EMAILS` es una lista separada por comas de cuentas Google autorizadas para entrar a `/admin`.

`MASTER_ACCESS_CODE_HASH` habilita un codigo maestro interno para pruebas OCR del admin. No consume plan comercial y permite seleccionar perfiles documentales internos desde `/app`.

La protección de `/admin` es server-side: la página, las server actions y las APIs administrativas validan sesión Google y comparan el email normalizado contra `ADMIN_EMAILS` antes de cargar datos o ejecutar acciones. Un usuario sin sesión es redirigido al login; un usuario logueado pero no autorizado ve `Acceso denegado`.

Prueba recomendada de seguridad:

1. Abrir una ventana incógnito y entrar a `/admin`: debe bloquear o redirigir.
2. Iniciar sesión con un email que no esté en `ADMIN_EMAILS`: debe mostrar `Acceso denegado`.
3. Iniciar sesión con un email autorizado: debe mostrar la administración.

## Base de datos y admin

La fase administrativa agrega una base Postgres mínima para controlar clientes, planes, códigos y metadata de uso. No guarda PDFs, imágenes, CSV completo, JSON completo ni contenido sensible extraído.

Comandos:

```bash
corepack pnpm db:migrate
corepack pnpm db:seed
```

El seed crea los planes iniciales `Demo`, `Piloto`, `Basico`, `Profesional` y `Empresa`, y agrega como administradores los correos definidos en `ADMIN_EMAILS`.

Para usar `/admin`:

1. Configurá `DATABASE_URL` y `ADMIN_EMAILS`.
2. Ejecutá migraciones y seed.
3. Iniciá sesión con Google usando un correo autorizado.
4. Entrá a `/admin`.
5. Creá clientes, asigná perfil/plan y generá códigos de acceso.

Los códigos se muestran completos solo al generarlos. La base guarda el hash SHA-256, un alias visual y metadata operativa. La validación de acceso intenta primero la base `access_codes`; si no hay DB o no encuentra el código, usa `ACCESS_CODE_HASHES` como compatibilidad temporal.

## Planes y usos

Cada código queda asociado a un cliente y un plan. Antes de procesar OCR, la API valida:

- cliente activo;
- código activo, no revocado y no vencido;
- plan activo;
- límite diario;
- límite mensual;
- límite de tamaño por tipo de archivo.

Los límites globales `MAX_PDF_SIZE_MB` y `MAX_IMAGE_SIZE_MB` siguen funcionando como techo máximo. Si el plan tiene un límite menor, se aplica el límite del plan.

La tabla `usage_events` registra solo metadata: cliente, código, estado, nombre original del archivo, nombre de salida, MIME, tamaño, tipo estimado, registros, campos, duración y error controlado si lo hubo. No registra archivos ni resultados completos.

## Descarga JSON

El procesamiento genera una estructura base:

```json
{
  "metadata": {},
  "columns": [],
  "rows": []
}
```

Desde esa misma estructura se entregan CSV y JSON. No se hace una segunda llamada a la IA para generar JSON.

Si el plan tiene `allowJsonExport=true`, la UI muestra `Descargar datos (.json)`. Si el plan no lo permite, el botón no se muestra.

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
MAX_IMAGE_SIZE_MB="50"
OCR_BLOB_MAX_FILE_SIZE_MB="50"
BLOB_READ_WRITE_TOKEN=""
OCR_TIMEOUT_SECONDS="120"
OCR_DIRECT_FILE_TIMEOUT_SECONDS="45"
OCR_CHUNK_TIMEOUT_SECONDS="45"
OCR_MOVEMENT_PAGE_TIMEOUT_SECONDS="45"
OCR_CHUNK_MAX_CHARS="12000"
OCR_CHUNK_OVERLAP_CHARS="500"
OCR_MAX_PDF_PAGES="30"
OCR_PDF_RENDER_MAX_WIDTH="2200"
OCR_PDF_RENDER_DENSITY="220"
OCR_PDF_RENDER_JPEG_QUALITY="90"
OCR_BALANCED_MODE="true"
OCR_FAST_MODE="false"
OCR_MAX_PROCESSING_SECONDS="120"
OCR_MAX_CHUNKS_BALANCED_MODE="4"
OCR_USE_EXPERIMENTAL_MODEL="false"
OCR_ALLOW_CHUNKS_IN_FAST_MODE="false"
OCR_IMAGE_OPTIMIZATION_ENABLED="true"
OCR_IMAGE_MAX_DIMENSION="1800"
OCR_IMAGE_JPEG_QUALITY="85"
OCR_IMAGE_CONTRAST_NORMALIZATION_ENABLED="true"
OCR_PRIMARY_PROVIDER="google-ai"
OCR_FALLBACK_PROVIDER="google-document-ai"
OCR_ADVANCED_PROVIDER="google-document-ai"
OCR_ENABLE_FALLBACK="true"
OCR_MIN_CONFIDENCE="0.75"
GOOGLE_CLOUD_PROJECT_ID=""
GOOGLE_DOCUMENT_AI_LOCATION="us"
GOOGLE_DOCUMENT_AI_PROCESSOR_ID=""
GOOGLE_APPLICATION_CREDENTIALS=""
GOOGLE_APPLICATION_CREDENTIALS_JSON=""
GOOGLE_CLIENT_EMAIL=""
GOOGLE_PRIVATE_KEY=""
FORCE_LOCAL_PDF_FALLBACK="false"

RATE_LIMIT_OCR_REQUESTS="5"
RATE_LIMIT_OCR_WINDOW_SECONDS="600"

UPSTASH_REDIS_REST_URL=""
UPSTASH_REDIS_REST_TOKEN=""

ACCESS_CODE_HASHES=""
MASTER_ACCESS_CODE_HASH=""
MASTER_ACCESS_EMAIL="adolfoalonso19@gmail.com"
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

`MAX_FILE_SIZE_MB` define el techo general. `MAX_PDF_SIZE_MB` limita PDFs y `MAX_IMAGE_SIZE_MB` limita JPG/JPEG/PNG. Por defecto, PDFs e imagenes admiten hasta 50 MB. Los limites menores definidos por cada plan siguen aplicandose antes de procesar.

## Cargas de archivos con Vercel Blob

Los documentos no se envian dentro del body de `/api/ocr/process`. La interfaz usa Vercel Blob Client Uploads para transferir el archivo directamente desde el navegador a un Blob Store privado y evitar el limite de 4,5 MB de las Vercel Functions.

Flujo:

1. El navegador solicita un token temporal a `POST /api/upload`.
2. `/api/upload` valida sesion Google, codigo de acceso, plan, MIME, tamano y prefijo de la sesion.
3. El navegador sube el archivo directamente a Vercel Blob mediante multipart upload.
4. La interfaz llama `POST /api/ocr/process` con JSON liviano: URL, pathname, nombre, MIME, tamano y perfil interno.
5. La API valida la metadata con el Blob Store, descarga el archivo privado con `get()`, ejecuta OCR y elimina el Blob en `finally`.

Configuracion en Vercel:

1. Crear un Blob Store desde `Storage` y elegir acceso `Private`.
2. Conectarlo al proyecto y a los entornos Production/Preview necesarios.
3. Confirmar que Vercel agrego `BLOB_READ_WRITE_TOKEN`.
4. Definir `OCR_BLOB_MAX_FILE_SIZE_MB="50"`.
5. Redeployar.

Para desarrollo local, traer el token con `vercel env pull` o agregar `BLOB_READ_WRITE_TOKEN` manualmente a `.env.local`.

`/api/ocr/process` acepta solamente `POST application/json`; no recibe archivos, base64 ni parametros por querystring. Las URLs externas arbitrarias se rechazan: el pathname debe pertenecer al prefijo de la sesion y coincidir con la metadata devuelta por el Blob Store del proyecto.

Los Blobs son temporales. La API intenta borrarlos tanto en exito como en error. Una falla de limpieza solo genera un warning seguro y no reemplaza la respuesta OCR.

## CSV y Microsoft 365

Los CSV se descargan en UTF-8 con BOM para mejorar compatibilidad con Excel.

Antes de generar el archivo, el servidor normaliza los nombres de columnas:

- elimina saltos de linea y caracteres de control;
- recorta espacios al inicio y final;
- evita columnas vacias usando `Columna_N`;
- si hay columnas duplicadas, las renombra como `Columna`, `Columna_2`, `Columna_3`.

Esto facilita el uso posterior en Power Automate, SharePoint y Microsoft Lists. La app no sube archivos automaticamente a Microsoft 365 en esta fase.

La descarga JSON contiene metadata operativa, columnas y filas, pensada para integraciones externas o auditorias livianas del cliente. ADALO OCR no almacena ese JSON completo.

## Uso con Power Automate / Microsoft 365

Flujo recomendado para pilotos:

1. El usuario procesa el documento en ADALO OCR y descarga el CSV o JSON.
2. El usuario sube el archivo exportado a una carpeta de SharePoint.
3. Power Automate detecta el archivo nuevo.
4. El flujo externo lee el CSV.
5. Luego puede cargar datos en Microsoft Lists, Excel, SharePoint, Power BI o enviar correos.

ADALO OCR no almacena archivos, no guarda CSVs/JSON completos y solo conserva metadata de uso cuando la base administrativa esta configurada. La trazabilidad, validaciones, alertas y registros historicos detallados se implementan en el flujo externo del cliente.

## Detección interna del documento

La interfaz no pide elegir si el archivo es una tabla, comprobante, remito o documento técnico. El usuario solo carga el archivo y la app detecta internamente el tipo probable según el nombre y el formato.

Esa detección viaja como `documentType` en el `FormData` para orientar el prompt y la estructura del CSV, pero no se muestra en pantalla, no se guarda en base de datos y no se conserva como preferencia.

Si no hay señales claras, la app usa modo `auto` y el motor decide la estructura más conveniente: tabla con encabezados originales, campos comerciales/operativos, o datos técnico-administrativos por secciones.

Los archivos en `test-files/` se usan solo para pruebas de desarrollo. Los documentos reales se procesan desde la carga en la UI.

## Codigos de acceso y perfiles OCR internos

Los codigos de acceso solo autentican, aplican planes y habilitan el uso del OCR. El texto del codigo no selecciona prompts ni quality gates. Por ejemplo, `ADALO-2026-MATEO` puede ser un codigo comercial valido sin representar un perfil documental.

La seleccion documental se realiza despues de recuperar senales del archivo y del texto OCR. Los perfiles iniciales son:

- `internal-general`
- `internal-tabla-administrativa`
- `internal-movimiento-camiones`
- `internal-nomina-personal`
- `internal-dtve-senasa-arca`
- `internal-comprobante-generico`

El clasificador reconoce encabezados, patrones como CUIL, campos logisticos, indicadores DTVe/SENASA/ARCA y senales tabulares. Luego aplica el prompt y el quality gate del perfil detectado. El usuario final solo ve un nombre amigable como `Nomina de personal`, `Movimiento de camiones` o `Documento administrativo`.

El administrador puede definir una restriccion documental opcional mediante `profileId`. El valor recomendado por defecto es `internal-general`, que mantiene la deteccion automatica. Los aliases historicos `general`, `mateo`, `movimiento` y `technical-admin` siguen siendo compatibles con registros existentes.

### Compatibilidad historica de perfiles

La herramienta puede adaptar internamente el prompt y la estructura CSV segun el perfil asociado al cliente o al modo de prueba master. Esto no se muestra al usuario final y no requiere que el usuario elija categorias.

Los nombres historicos `ADALO-2026-MATEO` y `ADALO-2026-MOVIMIENTO` ya no seleccionan perfiles por coincidencia textual. Si existen como codigos comerciales validos, autentican como cualquier otro codigo.

El alias historico `mateo` resuelve a `internal-dtve-senasa-arca`, que usa la plantilla `commercial-operations`.

El alias historico `movimiento` resuelve a `internal-movimiento-camiones`, que usa la plantilla `vision-table` para tablas escaneadas de logistica.

Columnas esperadas:

```text
FechaSalida, CantidadCamion, Unidad, Tons, Proveedor, Producto, Origen,
RutaCaminosPuna, Destino, FechaArribo, CantidadEscoltas
```

Para este perfil, la salida CSV final debe contener solo esas columnas de tabla. El JSON agrega metadata por fila como `pageNumber`, `rowNumber`, `confidence` y `warnings`. Si el resultado contiene columnas genericas `Pagina`, `Linea` y `Texto`, la extraccion se considera fallida.

Para PDFs escaneados o de CamScanner clasificados como `internal-movimiento-camiones`, la app no acepta el fallback local `Pagina/Linea/Texto`. Si no reconstruye una tabla valida, falla con `failed_quality_gate_movimiento` y no entrega CSV/JSON descargable como exito.

La arquitectura de perfiles queda preparada para futuros codigos con:

- `code`;
- `name`;
- `documentType`;
- `extractionMode`;
- `expectedColumns` o `expectedFields`;
- prompt especifico;
- reglas de normalizacion;
- reglas de validacion;
- textos a ignorar;
- formato de salida CSV/JSON;
- mensajes de error propios.

Los codigos comerciales reales se generan desde `/admin`. `profileId` es una restriccion administrativa opcional, no una propiedad derivada del codigo. Para pruebas internas, el modo master puede forzar un perfil sin convertirlo en codigo publico.

Este patron permite mejorar velocidad y calidad para clientes con documentos repetitivos, manteniendo la UI simple.

## Arquitectura OCR documental

La app ahora trata el OCR como extraccion documental estructurada, no solo como lectura de texto.

Antes de aceptar un resultado, el servidor ejecuta:

1. Preprocesamiento documental: detecta si el archivo es imagen, PDF digital o PDF probablemente escaneado; busca senales de tabla; identifica marcas a ignorar como CamScanner, folios, sellos, sombras o bordes definidos por el perfil.
2. Proveedor OCR primario: por defecto `google-ai`, que usa el flujo actual con Gemini/Gemma configurables.
3. Quality gate: valida que la salida cumpla el perfil, columnas esperadas, filas utiles, confianza minima y ausencia de texto corrupto o marcas de escaneo como datos.
4. Fallback avanzado: si el resultado no pasa calidad y `OCR_ENABLE_FALLBACK="true"`, se intenta Google Document AI cuando esta configurado.

La interfaz interna de proveedores permite mantener Google AI como motor principal y usar Google Document AI para OCR avanzado de PDFs escaneados:

```ts
interface OCRProvider {
  name: string;
  supportsTables: boolean;
  supportsScannedPdf: boolean;
  extract(input, profile): Promise<OCRResult>;
}
```

Variables:

```env
OCR_PRIMARY_PROVIDER="google-ai"
OCR_FALLBACK_PROVIDER="google-document-ai"
OCR_ADVANCED_PROVIDER="google-document-ai"
OCR_ENABLE_FALLBACK="true"
OCR_MIN_CONFIDENCE="0.75"
GOOGLE_CLOUD_PROJECT_ID=""
GOOGLE_DOCUMENT_AI_LOCATION="us"
GOOGLE_DOCUMENT_AI_PROCESSOR_ID=""
GOOGLE_APPLICATION_CREDENTIALS=""
GOOGLE_APPLICATION_CREDENTIALS_JSON=""
GOOGLE_CLIENT_EMAIL=""
GOOGLE_PRIVATE_KEY=""
```

Google Document AI admite tres formas de autenticacion, evaluadas en este orden:

1. `GOOGLE_APPLICATION_CREDENTIALS`: ruta local al JSON de una cuenta de servicio. Es la opcion recomendada para desarrollo.
2. `GOOGLE_APPLICATION_CREDENTIALS_JSON`: contenido JSON completo de la cuenta de servicio, adecuado para una variable secreta en Vercel.
3. `GOOGLE_CLIENT_EMAIL` y `GOOGLE_PRIVATE_KEY`: credenciales separadas. La clave privada puede guardarse con saltos escapados `\n`; la app los normaliza al construir el cliente.

Ejemplo local:

```env
GOOGLE_APPLICATION_CREDENTIALS="C:\ruta\segura\google-document-ai.json"
```

Ejemplo Vercel con JSON completo:

```env
GOOGLE_APPLICATION_CREDENTIALS_JSON='{"client_email":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"}'
```

Alternativa Vercel con variables separadas:

```env
GOOGLE_CLIENT_EMAIL="document-ai@proyecto.iam.gserviceaccount.com"
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

No configures una ruta local en `GOOGLE_APPLICATION_CREDENTIALS` dentro de Vercel. Si esa variable existe, tiene prioridad sobre las credenciales embebidas. El archivo o contenido de credenciales no debe guardarse en Git ni imprimirse en logs.

Si no hay ninguna modalidad de credenciales completa, Google Document AI queda deshabilitado con un warning seguro en servidor. El cliente no se inicializa durante el build y el flujo OCR principal puede continuar con Google AI.

`OCR_ADVANCED_PROVIDER` tiene prioridad sobre el alias anterior `OCR_FALLBACK_PROVIDER`, de modo que una configuracion heredada no impida activar Google Document AI.

Cuando el preprocesamiento detecta un PDF escaneado, Document AI se intenta antes del flujo convencional. Document AI recupera el texto y las tablas; luego Gemini normaliza esa salida al JSON estructurado existente y el servidor genera CSV/JSON seguros. No se pide CSV directo a ninguno de los modelos.

Si el flujo principal devuelve la extraccion generica `Pagina`, `Linea`, `Texto`, el quality gate la deriva a Document AI. Con `google-document-ai` configurado como fallback, esa salida basica no se marca como exito si el proveedor avanzado no logra producir una estructura aceptable.

Configuracion minima:

1. Crear un processor en Google Cloud Document AI.
2. Otorgar acceso al processor a la cuenta de servicio.
3. Configurar proyecto, ubicacion e identificador del processor.
4. Definir una de las modalidades de credenciales anteriores.

En produccion, las credenciales deben configurarse como secreto del entorno y nunca incluirse en el repositorio.

La metadata JSON puede incluir `primaryProvider`, `fallbackProvider`, `providerUsed`, `profileCode`, `profileName`, `extractionMode`, `confidence`, `qualityStatus`, `warnings`, `pagesProcessed` y `rowsExtracted`.

Estados de calidad:

- `completed`
- `completed_with_warnings`
- `failed_quality_gate`
- `fallback_required`
- `manual_review_required`

Para `internal-movimiento-camiones`, el quality gate exige exactamente estas columnas:

```text
FechaSalida, CantidadCamion, Unidad, Tons, Proveedor, Producto, Origen,
RutaCaminosPuna, Destino, FechaArribo, CantidadEscoltas
```

No acepta `Pagina`, `Linea`, `Texto` como salida final, URLs de CamScanner, texto corrupto ni filas vacias. Si una celda es ilegible, debe quedar vacia. Las fechas se prefieren en `DD/MM/YYYY`; si no cumplen, el resultado puede quedar con advertencias.

## Ejemplos corregidos por perfil

La base queda preparada con `profile_correction_examples` para una etapa futura de aprendizaje asistido. Esa tabla permite asociar a un `profileCode` una salida original y una salida corregida en CSV/JSON.

El OCR normal no guarda automaticamente documentos ni resultados completos. Los ejemplos corregidos deben guardarse de forma explicita en una futura accion administrativa. Cuando existen ejemplos para un perfil, se agregan como referencia resumida al prompt del proveedor Google para mejorar extracciones posteriores.

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
OCR_IMAGE_CONTRAST_NORMALIZATION_ENABLED="true"
```

Para mejores fotos de tablas o listados: usar buena iluminación, evitar sombras, enfocar la tabla completa y tomar la foto lo más perpendicular posible.

## Acceso privado mediante código

1. El usuario inicia sesión con Google.
2. Luego ingresa un código privado otorgado por ADALO Consulting Group.
3. Los códigos no se guardan en texto plano: se comparan contra hashes SHA-256 configurados en variables de entorno.
4. Para crear un hash:

```bash
corepack pnpm hash:access-code "ADALO-ADMIN-2026-TEST-8K4P"
```

5. Pegá el resultado en:

```env
MASTER_ACCESS_CODE_HASH="resultado_hash"
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
OCR_MOVEMENT_PAGE_TIMEOUT_SECONDS="45"
OCR_PDF_RENDER_MAX_WIDTH="2200"
OCR_PDF_RENDER_DENSITY="220"
OCR_PDF_RENDER_JPEG_QUALITY="90"
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
