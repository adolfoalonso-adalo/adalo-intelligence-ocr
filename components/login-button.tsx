"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";

export function LoginButton() {
  const [isLoading, setIsLoading] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        setIsLoading(true);
        void signIn("google", { callbackUrl: "/app" });
      }}
      disabled={isLoading}
      className="flex w-full items-center justify-center gap-3 rounded-2xl bg-brand-deep px-5 py-4 text-sm font-semibold text-white shadow-lg shadow-brand-deep/20 transition hover:-translate-y-0.5 hover:bg-brand-petrol disabled:cursor-not-allowed disabled:opacity-70"
    >
      <span className="grid size-5 place-items-center rounded-full bg-white text-xs font-bold text-brand-deep">
        G
      </span>
      {isLoading ? "Redirigiendo..." : "Continuar con Google"}
    </button>
  );
}
