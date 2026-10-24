import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { ADMIN_COOKIE, verifySessionToken } from "@/lib/session";

export async function POST(request: NextRequest) {
  const token = request.cookies.get(ADMIN_COOKIE)?.value;
  const session = await verifySessionToken(token, "admin");
  if (!session) {
    return NextResponse.json({ detail: "Admin session required." }, { status: 401 });
  }
  revalidatePath("/");
  revalidatePath("/menu");
  return NextResponse.json({ revalidated: true, paths: ["/", "/menu"] });
}
