"use client";

import type { Session } from "next-auth";
import { signOut } from "next-auth/react";

type UserMenuProps = {
  user: NonNullable<Session["user"]>;
};

export function UserMenu({ user }: UserMenuProps) {
  const label = user.name || user.email || "Usuario";
  const initials = getInitials(label);

  async function handleSignOut() {
    await fetch("/api/access/clear", { method: "POST" }).catch(() => undefined);
    await signOut({ callbackUrl: "/login" });
  }

  return (
    <details className="group relative z-50">
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-2xl border border-brand-border bg-brand-card px-3 py-2 shadow-sm outline-none ring-brand-accent/20 transition hover:border-brand-accent focus-visible:ring-4">
        <span className="grid size-10 place-items-center rounded-full bg-brand-deep text-sm font-semibold uppercase text-white shadow-sm">
          {initials}
        </span>
        <span className="hidden min-w-0 text-right sm:block">
          <span className="block max-w-48 truncate text-sm font-semibold text-brand-ink">
            {user.name || "Usuario"}
          </span>
          <span className="block max-w-48 truncate text-xs text-brand-slate">{user.email}</span>
        </span>
      </summary>

      <div className="absolute right-0 top-full z-50 mt-3 w-[min(18rem,calc(100vw-2rem))] rounded-2xl border border-brand-border bg-brand-card p-3 text-sm shadow-premium ring-1 ring-brand-deep/5">
        <div className="rounded-xl bg-brand-soft/70 px-3 py-2">
          <p className="truncate font-semibold text-brand-ink">{user.name || "Usuario"}</p>
          <p className="truncate text-xs text-brand-slate">{user.email}</p>
        </div>
        <button
          type="button"
          onClick={() => void handleSignOut()}
          className="mt-2 w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-brand-deep transition hover:bg-brand-soft hover:text-brand-accent"
        >
          Cerrar sesión
        </button>
      </div>
    </details>
  );
}

function getInitials(value: string) {
  const parts = value
    .replace(/@.*/, "")
    .split(/\s+|[._-]/)
    .map((part) => part.trim())
    .filter(Boolean);

  return (parts[0]?.[0] ?? "U") + (parts[1]?.[0] ?? "");
}
