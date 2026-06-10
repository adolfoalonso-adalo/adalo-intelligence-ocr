"use client";

import { useEffect, useState } from "react";

export type ProcessingProgressStage =
  | "preparing"
  | "uploading"
  | "preprocessing"
  | "ocr"
  | "structuring"
  | "quality"
  | "output"
  | "completed"
  | "error";

type ProcessingProgressProps = {
  percentage: number;
  currentStep: string;
  detailMessage?: string;
  stage: ProcessingProgressStage;
  isIndeterminate?: boolean;
  startedAt?: number | null;
  elapsedTime?: number;
  debugStage?: string;
  showDebug?: boolean;
  showLongDocumentHint?: boolean;
};

export function ProcessingProgress({
  percentage,
  currentStep,
  detailMessage,
  stage,
  isIndeterminate = false,
  startedAt,
  elapsedTime,
  debugStage,
  showDebug = false,
  showLongDocumentHint = false,
}: ProcessingProgressProps) {
  const [measuredElapsedTime, setMeasuredElapsedTime] = useState(0);
  const safePercentage = Math.max(0, Math.min(100, Math.round(percentage)));
  const isError = stage === "error";
  const isCompleted = stage === "completed";
  const visibleElapsedTime = elapsedTime ?? measuredElapsedTime;

  useEffect(() => {
    if (!startedAt || isCompleted || isError) return;

    const updateElapsedTime = () => {
      setMeasuredElapsedTime(Math.max(0, Date.now() - startedAt));
    };

    updateElapsedTime();
    const intervalId = window.setInterval(updateElapsedTime, 1000);

    return () => window.clearInterval(intervalId);
  }, [isCompleted, isError, startedAt]);

  return (
    <section
      className={`rounded-2xl border px-4 py-4 shadow-sm ${
        isError
          ? "border-red-200 bg-red-50 text-red-800"
          : isCompleted
            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
            : "border-brand-border bg-brand-soft/70 text-brand-deep"
      }`}
      aria-live="polite"
      aria-busy={!isCompleted && !isError}
    >
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm font-semibold">{currentStep}</p>
        <span className="min-w-12 text-right text-sm font-semibold tabular-nums">
          {safePercentage}%
        </span>
      </div>

      <div
        className={`mt-3 h-2.5 overflow-hidden rounded-full ${
          isError ? "bg-red-100" : "bg-white/80"
        }`}
        role="progressbar"
        aria-label="Progreso del procesamiento OCR"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={safePercentage}
      >
        <div
          className={`relative h-full rounded-full transition-[width] duration-700 ease-out ${
            isError
              ? "bg-red-400"
              : isCompleted
                ? "bg-emerald-500"
                : "bg-brand-accent"
          }`}
          style={{ width: `${safePercentage}%` }}
        >
          {isIndeterminate && !isError && !isCompleted ? (
            <span className="absolute inset-0 animate-pulse bg-white/25" />
          ) : null}
        </div>
      </div>

      {detailMessage ? (
        <p className="mt-3 text-xs leading-5 opacity-90">{detailMessage}</p>
      ) : null}

      {showLongDocumentHint && !isCompleted && !isError ? (
        <p className="mt-2 text-xs leading-5 opacity-75">
          Los documentos extensos o escaneados pueden demorar unos segundos más
          mientras se optimiza la lectura.
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-current/10 pt-2 text-[11px] opacity-70">
        <span>Tiempo transcurrido: {formatElapsedTime(visibleElapsedTime)}</span>
        {showDebug && debugStage ? (
          <code className="rounded-md bg-white/60 px-2 py-0.5 font-mono">
            {debugStage}
          </code>
        ) : null}
      </div>
    </section>
  );
}

function formatElapsedTime(elapsedTime: number) {
  const totalSeconds = Math.max(0, Math.floor(elapsedTime / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return minutes > 0 ? `${minutes} min ${seconds} s` : `${seconds} s`;
}
