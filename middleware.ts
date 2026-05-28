import { withAuth } from "next-auth/middleware";

const middlewareSecret =
  process.env.AUTH_SECRET ||
  (process.env.NODE_ENV === "production" ? undefined : "adalo-intelligence-ocr-dev-secret");

export default withAuth({
  pages: {
    signIn: "/login",
  },
  secret: middlewareSecret,
});

export const config = {
  matcher: ["/app/:path*", "/access/:path*"],
};
