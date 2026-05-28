import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getAccessCookieName, verifyAccessCookie } from "@/lib/access-code";

export default async function HomePage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const cookieStore = await cookies();
  const hasAccess = verifyAccessCookie(cookieStore.get(getAccessCookieName())?.value);

  redirect(hasAccess ? "/app" : "/access");
}
