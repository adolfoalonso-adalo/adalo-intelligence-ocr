import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AdaloLogo } from "@/components/adalo-logo";
import { OcrWorkflow } from "@/components/ocr-workflow";
import { UserMenu } from "@/components/user-menu";
import { getAccessCookieName, verifyAccessCookie } from "@/lib/access-code";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AppPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const cookieStore = await cookies();
  const hasAccess = verifyAccessCookie(cookieStore.get(getAccessCookieName())?.value);

  if (!hasAccess) {
    redirect("/access");
  }

  return (
    <main className="min-h-screen px-5 py-6 sm:px-8 sm:py-8">
      <header className="relative z-30 mx-auto flex min-h-24 w-full max-w-6xl items-center justify-between gap-4 rounded-[1.75rem] border border-brand-border bg-brand-card/92 px-4 py-4 shadow-sm backdrop-blur sm:px-6">
        <AdaloLogo compact />
        <UserMenu user={session.user} />
      </header>

      <section className="mx-auto flex min-h-[calc(100vh-144px)] w-full max-w-6xl items-start justify-center pt-10 pb-10 sm:pt-12 lg:pt-14">
        <div className="w-full rounded-[2.25rem] border border-brand-border bg-brand-card/94 p-5 shadow-premium backdrop-blur sm:p-8 lg:p-11">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-brand-accent">
              ADALO · Extracción Documental
            </p>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-brand-ink sm:text-5xl">
              Convertí documentos en datos listos para analizar
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-brand-slate sm:text-lg">
              Procesá PDFs, fotografías y capturas con precisión. Resultados estructurados,
              exportables directamente a Excel, Google Sheets o Power BI.
            </p>
          </div>

          <div className="mx-auto mt-10 max-w-3xl">
            <OcrWorkflow />
          </div>
        </div>
      </section>
    </main>
  );
}
