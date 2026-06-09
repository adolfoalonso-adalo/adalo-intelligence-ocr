import assert from "node:assert/strict";

import {
  GoogleDocumentAIOCRProvider,
  normalizeProviderName,
  resolveGoogleDocumentAiClientOptions,
} from "@/lib/ocr-providers";

assert.equal(normalizeProviderName("google-document-ai"), "google-document-ai");

const previousValues = {
  clientEmail: process.env.GOOGLE_CLIENT_EMAIL,
  credentialsJson: process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON,
  credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  location: process.env.GOOGLE_DOCUMENT_AI_LOCATION,
  privateKey: process.env.GOOGLE_PRIVATE_KEY,
  processorId: process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID,
  projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
};

clearCredentialEnv();

let rejectedForMissingCredentials = false;

try {
  resolveGoogleDocumentAiClientOptions({
    location: "us",
    projectId: "adalo-test",
  });
} catch (error) {
  rejectedForMissingCredentials =
    error instanceof Error &&
    "technicalDetail" in error &&
    String((error as Error & { technicalDetail?: string }).technicalDetail).includes(
      "GOOGLE_DOCUMENT_AI_CREDENTIALS_NOT_CONFIGURED",
    );
}

assert.equal(rejectedForMissingCredentials, true);

process.env.GOOGLE_APPLICATION_CREDENTIALS = "C:\\secure\\document-ai.json";
const adcOptions = resolveGoogleDocumentAiClientOptions({
  location: "us",
  projectId: "adalo-test",
});
assert.equal(adcOptions.authMode, "application-default-credentials");
assert.equal(adcOptions.clientOptions.keyFilename, "C:\\secure\\document-ai.json");

clearCredentialEnv();
process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = JSON.stringify({
  client_email: "document-ai@example.iam.gserviceaccount.com",
  private_key: "line-one\\nline-two",
});
const jsonOptions = resolveGoogleDocumentAiClientOptions({
  location: "us",
  projectId: "adalo-test",
});
assert.equal(jsonOptions.authMode, "credentials-json");
assert.equal(jsonOptions.clientOptions.credentials?.private_key, "line-one\nline-two");

clearCredentialEnv();
process.env.GOOGLE_CLIENT_EMAIL = "document-ai@example.iam.gserviceaccount.com";
process.env.GOOGLE_PRIVATE_KEY = "line-one\\nline-two";
const envOptions = resolveGoogleDocumentAiClientOptions({
  location: "us",
  projectId: "adalo-test",
});
assert.equal(envOptions.authMode, "service-account-env");
assert.equal(envOptions.clientOptions.credentials?.private_key, "line-one\nline-two");

clearCredentialEnv();
delete process.env.GOOGLE_CLOUD_PROJECT_ID;
delete process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID;
process.env.GOOGLE_DOCUMENT_AI_LOCATION = "us";

const provider = new GoogleDocumentAIOCRProvider();
let rejectedForMissingConfiguration = false;

try {
  await provider.extract({
    documentType: "auto",
    fileBuffer: Buffer.from("%PDF-1.4"),
    fileName: "scanned.pdf",
    mimeType: "application/pdf",
  });
} catch (error) {
  rejectedForMissingConfiguration =
    error instanceof Error &&
    "technicalDetail" in error &&
    String((error as Error & { technicalDetail?: string }).technicalDetail).includes(
      "GOOGLE_CLOUD_PROJECT_ID_REQUIRED",
    );
}

assert.equal(rejectedForMissingConfiguration, true);

restoreEnv("GOOGLE_CLOUD_PROJECT_ID", previousValues.projectId);
restoreEnv("GOOGLE_DOCUMENT_AI_LOCATION", previousValues.location);
restoreEnv("GOOGLE_DOCUMENT_AI_PROCESSOR_ID", previousValues.processorId);
restoreEnv("GOOGLE_APPLICATION_CREDENTIALS", previousValues.credentialsPath);
restoreEnv("GOOGLE_APPLICATION_CREDENTIALS_JSON", previousValues.credentialsJson);
restoreEnv("GOOGLE_CLIENT_EMAIL", previousValues.clientEmail);
restoreEnv("GOOGLE_PRIVATE_KEY", previousValues.privateKey);

console.log("Google Document AI provider configuration test passed.");

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

function clearCredentialEnv() {
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  delete process.env.GOOGLE_CLIENT_EMAIL;
  delete process.env.GOOGLE_PRIVATE_KEY;
}
