"use client";

import { useState } from "react";

type AdminGenerateCodeProps = {
  clientId: string;
  defaultPlanId?: string | null;
  plans: { id: string; name: string }[];
};

export function AdminGenerateCode({
  clientId,
  defaultPlanId,
  plans,
}: AdminGenerateCodeProps) {
  const [generatedCode, setGeneratedCode] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [planId, setPlanId] = useState(defaultPlanId ?? plans[0]?.id ?? "");

  async function generateCode() {
    setIsLoading(true);
    setError("");
    setGeneratedCode("");

    try {
      const response = await fetch("/api/admin/access-codes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientId,
          planId,
        }),
      });
      const data = (await response.json()) as { success?: boolean; code?: string; error?: string };

      if (!response.ok || !data.success || !data.code) {
        throw new Error(data.error || "No se pudo generar el codigo.");
      }

      setGeneratedCode(data.code);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo generar el codigo.");
    } finally {
      setIsLoading(false);
    }
  }

  async function copyCode() {
    if (!generatedCode) return;
    await navigator.clipboard.writeText(generatedCode).catch(() => undefined);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <select
          value={planId}
          onChange={(event) => setPlanId(event.target.value)}
          className="rounded-xl border border-brand-border bg-white px-3 py-2 text-xs text-brand-deep"
        >
          {plans.map((plan) => (
            <option key={plan.id} value={plan.id}>
              {plan.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={generateCode}
          disabled={isLoading || !planId}
          className="rounded-xl bg-brand-deep px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
        >
          {isLoading ? "Generando..." : "Generar codigo"}
        </button>
      </div>
      <p className="text-xs text-brand-slate">
        Deteccion automatica universal. Los perfiles legacy no se asignan a codigos nuevos.
      </p>
      {generatedCode ? (
        <div className="rounded-xl border border-brand-accent/40 bg-brand-cream px-3 py-2 text-xs text-brand-deep">
          <p className="font-semibold">Codigo generado. Se muestra una sola vez.</p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="rounded-lg bg-white px-2 py-1">{generatedCode}</code>
            <button type="button" onClick={copyCode} className="text-left font-semibold text-brand-accent">
              Copiar
            </button>
          </div>
        </div>
      ) : null}
      {error ? <p className="text-xs text-red-700">{error}</p> : null}
    </div>
  );
}
