import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AccessCodeForm } from "@/components/access-code-form";
import { AdaloLogo } from "@/components/adalo-logo";
import { auth } from "@/lib/auth";
import { getAccessCookieName, verifyAccessCookie } from "@/lib/access-code";

export const dynamic = "force-dynamic";

export default async function AccessPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const cookieStore = await cookies();
  const hasAccess = verifyAccessCookie(cookieStore.get(getAccessCookieName())?.value);

  if (hasAccess) {
    redirect("/app");
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-10">
      <section className="w-full max-w-lg rounded-[2rem] border border-brand-border bg-brand-card/95 p-7 shadow-premium backdrop-blur sm:p-9">
        <div className="mb-8 flex justify-center">
          <AdaloLogo variant="vertical" />
        </div>

        <div className="space-y-4 text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-brand-accent">
            Acceso privado
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-brand-ink">
            Código de acceso ADALO
          </h1>
          <p className="text-base leading-7 text-brand-slate">
            Ingresá el código privado otorgado por ADALO Consulting Group para habilitar el uso
            del servicio.
          </p>
        </div>

        <div className="mt-7 rounded-2xl border border-brand-border bg-brand-soft/70 px-4 py-3 text-sm text-brand-slate">
          <span className="font-semibold text-brand-ink">Conectado como:</span>{" "}
          {session.user.name || session.user.email}
        </div>

        <AccessCodeForm />
      </section>
    </main>
  );
}
