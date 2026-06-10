"use client";

import { useState } from "react";

type AdminGenerateCodeProps = {
  clientId: string;
  defaultPlanId?: string | null;
  plans: { id: string; name: string }[];
  profileOptions: { id: string; label: string }[];
};

export function AdminGenerateCode({
  clientId,
  defaultPlanId,
  plans,
  profileOptions,
}: AdminGenerateCodeProps) {
  const [allowedProfiles, setAllowedProfiles] = useState<string[]>([]);
  const [forcedProfile, setForcedProfile] = useState(
    profileOptions[0]?.id ?? "",
  );
  const [generatedCode, setGeneratedCode] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [planId, setPlanId] = useState(defaultPlanId ?? plans[0]?.id ?? "");
  const [restrictionMode, setRestrictionMode] = useState<
    "automatic" | "allowed_profiles" | "forced_profile"
  >("automatic");

  async function generateCode() {
    setIsLoading(true);
    setError("");
    setGeneratedCode("");

    try {
      const response = await fetch("/api/admin/access-codes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          allowedProfiles,
          clientId,
          forcedProfile,
          planId,
          restrictionMode,
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
        <select
          value={restrictionMode}
          onChange={(event) =>
            setRestrictionMode(
              event.target.value as
                | "automatic"
                | "allowed_profiles"
                | "forced_profile",
            )
          }
          className="rounded-xl border border-brand-border bg-white px-3 py-2 text-xs text-brand-deep"
        >
          <option value="automatic">Deteccion automatica</option>
          <option value="allowed_profiles">Permitir solo ciertos tipos</option>
          <option value="forced_profile">Forzar siempre un tipo documental</option>
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
      {restrictionMode === "allowed_profiles" ? (
        <fieldset className="rounded-xl border border-brand-border bg-brand-cream p-3">
          <legend className="px-1 text-xs font-semibold text-brand-deep">
            Tipos permitidos
          </legend>
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            {profileOptions.map((profile) => (
              <label
                key={profile.id}
                className="flex items-center gap-2 text-xs text-brand-slate"
              >
                <input
                  type="checkbox"
                  checked={allowedProfiles.includes(profile.id)}
                  onChange={(event) =>
                    setAllowedProfiles((current) =>
                      event.target.checked
                        ? [...current, profile.id]
                        : current.filter((id) => id !== profile.id),
                    )
                  }
                />
                {profile.label}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      {restrictionMode === "forced_profile" ? (
        <select
          value={forcedProfile}
          onChange={(event) => setForcedProfile(event.target.value)}
          className="w-full rounded-xl border border-brand-border bg-white px-3 py-2 text-xs text-brand-deep"
        >
          {profileOptions.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.label}
            </option>
          ))}
        </select>
      ) : null}
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
