"use client";

import { useRef, useState } from "react";
import { Spinner } from "@/components/spinner";
import {
  getAcceptedFileInputValue,
  getFileSizeLimitMessage,
  getMaxFileSizeMb,
  getMaxSizeMbForMimeType,
  getSupportedMimeType,
  isAllowedOcrFile,
} from "@/lib/validations";

type PdfDropzoneProps = {
  file: File | null;
  disabled?: boolean;
  isValidating?: boolean;
  onFileSelected: (file: File) => void;
  onInvalidFile: (message: string) => void;
};

export function PdfDropzone({
  file,
  disabled = false,
  isValidating = false,
  onFileSelected,
  onInvalidFile,
}: PdfDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const maxMb = getMaxFileSizeMb();

  function validateAndSelect(candidate?: File) {
    if (!candidate) return;

    if (!isAllowedOcrFile(candidate)) {
      onInvalidFile("Subí un archivo PDF, JPG o PNG para continuar.");
      return;
    }

    const mimeType = getSupportedMimeType(candidate);
    const fileMaxMb = getMaxSizeMbForMimeType(mimeType);

    if (candidate.size > fileMaxMb * 1024 * 1024) {
      onInvalidFile(getFileSizeLimitMessage(mimeType));
      return;
    }

    onFileSelected(candidate);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(event) => {
        if (!disabled && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragging(false);
        if (!disabled) validateAndSelect(event.dataTransfer.files[0]);
      }}
      className={`group cursor-pointer rounded-[2rem] border-2 border-dashed p-8 text-center transition sm:p-12 ${
        isDragging
          ? "border-brand-accent bg-brand-soft"
          : "border-brand-border bg-brand-soft/60 hover:border-brand-accent hover:bg-brand-soft"
      } ${disabled ? "cursor-not-allowed opacity-70" : ""}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={getAcceptedFileInputValue()}
        className="sr-only"
        disabled={disabled}
        onChange={(event) => validateAndSelect(event.target.files?.[0])}
      />

      <div className="mx-auto grid size-16 place-items-center rounded-3xl bg-brand-card text-xl font-bold text-brand-deep shadow-sm ring-1 ring-brand-border">
        OCR
      </div>
      <div className="mt-5 space-y-2">
        <p className="text-xl font-semibold text-brand-ink">Soltá tu archivo aquí</p>
        <p className="text-sm text-brand-slate">o seleccionalo desde tu equipo</p>
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-brand-accent">
          FORMATOS ADMITIDOS: PDF · JPG · PNG&nbsp;&nbsp;·&nbsp;&nbsp;HASTA {maxMb} MB
        </p>
      </div>

      {isValidating ? (
        <div className="mx-auto mt-6 flex max-w-md items-center justify-center gap-2 rounded-2xl border border-brand-border bg-brand-card px-4 py-3 text-sm font-semibold text-brand-deep">
          <Spinner />
          Validando archivo...
        </div>
      ) : null}

      {!isValidating && file ? (
        <div className="mx-auto mt-6 max-w-md rounded-2xl border border-brand-border bg-brand-card px-4 py-3 text-left">
          <div className="mb-2 inline-flex rounded-full bg-brand-soft px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-brand-deep">
            ARCHIVO LISTO
          </div>
          <p className="truncate text-sm font-semibold text-brand-ink">{file.name}</p>
          <p className="mt-1 text-xs font-medium uppercase tracking-[0.12em] text-brand-slate">
            {getDisplayFileType(file)} · {(file.size / 1024 / 1024).toFixed(2)} MB
          </p>
        </div>
      ) : null}
    </div>
  );
}

function getDisplayFileType(file: File) {
  const mimeType = getSupportedMimeType(file);

  if (mimeType === "application/pdf") return "PDF";
  if (mimeType === "image/png") return "PNG";
  if (mimeType === "image/jpeg") return "JPG";

  return "ARCHIVO";
}
