"use client";

import { signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

type AccessResponse = {
  success: boolean;
  error?: string;
};

export function AccessCodeForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitting) return;

    setIsSubmitting(true);
    setError("");

    try {
      const response = await fetch("/api/access/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ code }),
      });
      const data = (await response.json()) as AccessResponse;

      if (!response.ok || !data.success) {
        throw new Error(
          data.error ||
            "El código ingresado no es válido o expiró. Verificá la información e intentá nuevamente.",
        );
      }

      router.replace("/app");
      router.refresh();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "El código ingresado no es válido o expiró. Verificá la información e intentá nuevamente.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSignOut() {
    setIsSigningOut(true);
    await fetch("/api/access/clear", { method: "POST" }).catch(() => undefined);
    await signOut({ callbackUrl: "/login" });
  }

  return (
    <div className="mt-7 space-y-5">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="access-code" className="text-sm font-semibold text-brand-ink">
            Código de acceso
          </label>
          <input
            id="access-code"
            name="access-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="Código de acceso"
            autoComplete="off"
            className="w-full rounded-2xl border border-brand-border bg-white px-4 py-3 text-base font-semibold tracking-wide text-brand-ink outline-none transition placeholder:text-brand-muted focus:border-brand-accent focus:ring-4 focus:ring-brand-accent/15"
          />
        </div>

        {error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-2xl bg-brand-deep px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-deep/15 transition hover:-translate-y-0.5 hover:bg-brand-petrol disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isSubmitting ? "Validando..." : "Validar acceso"}
        </button>
      </form>

      <p className="text-center text-sm leading-6 text-brand-slate">
        Si todavía no tenés un código de acceso, contactá a ADALO Consulting Group para solicitar
        la habilitación del servicio:{" "}
        <a
          href="mailto:contacto@adaloconsulting.com.ar"
          className="font-semibold text-brand-deep underline decoration-brand-accent/50 underline-offset-4 transition hover:text-brand-accent"
        >
          contacto@adaloconsulting.com.ar
        </a>
      </p>

      <button
        type="button"
        onClick={handleSignOut}
        disabled={isSigningOut}
        className="w-full rounded-2xl border border-brand-border bg-brand-card px-5 py-3 text-sm font-semibold text-brand-deep transition hover:border-brand-accent hover:text-brand-accent disabled:cursor-not-allowed disabled:opacity-70"
      >
        {isSigningOut ? "Cerrando sesión..." : "Cerrar sesión"}
      </button>
    </div>
  );
}
