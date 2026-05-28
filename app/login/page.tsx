import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AdaloLogo } from "@/components/adalo-logo";
import { LoginButton } from "@/components/login-button";
import { getAccessCookieName, verifyAccessCookie } from "@/lib/access-code";
import { auth } from "@/lib/auth";

export default async function LoginPage() {
  const session = await auth();

  if (session?.user) {
    const cookieStore = await cookies();
    const hasAccess = verifyAccessCookie(cookieStore.get(getAccessCookieName())?.value);

    redirect(hasAccess ? "/app" : "/access");
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-10">
      <section className="w-full max-w-md rounded-[2rem] border border-brand-border bg-brand-card/95 p-8 shadow-premium backdrop-blur">
        <div className="mb-10 flex justify-center">
          <AdaloLogo variant="vertical" />
        </div>

        <div className="space-y-4 text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-brand-accent">
            ADALO Intelligence OCR
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-brand-ink">
            Transformá documentos PDF en archivos CSV claros, ordenados y listos para trabajar.
          </h1>
          <p className="text-base leading-7 text-brand-slate">
            Accedé con tu cuenta de Google para procesar documentos de forma segura desde una interfaz simple.
          </p>
        </div>

        <div className="mt-8">
          <LoginButton />
        </div>
      </section>
    </main>
  );
}
