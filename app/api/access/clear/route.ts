import { NextResponse } from "next/server";
import { getAccessCookieName } from "@/lib/access-code";
import { getClientProfileCookieName } from "@/lib/client-profiles";

export const runtime = "nodejs";

export async function POST() {
  const response = NextResponse.json({ success: true });

  response.cookies.set(getAccessCookieName(), "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  response.cookies.set(getClientProfileCookieName(), "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });

  return response;
}
