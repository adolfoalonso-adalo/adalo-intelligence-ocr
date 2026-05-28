import { getServerSession, type NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

export const authSecret =
  process.env.AUTH_SECRET ||
  (process.env.NODE_ENV === "production" ? undefined : "adalo-intelligence-ocr-dev-secret");

export const authOptions: NextAuthOptions = {
  secret: authSecret,
  providers: [
    GoogleProvider({
      clientId: process.env.AUTH_GOOGLE_ID || "",
      clientSecret: process.env.AUTH_GOOGLE_SECRET || "",
    }),
  ],
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
};

export function auth() {
  return getServerSession(authOptions);
}
