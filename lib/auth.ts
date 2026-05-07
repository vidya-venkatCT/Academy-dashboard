import { createHmac, timingSafeEqual } from "crypto";

const SECRET = process.env.SESSION_SECRET ?? "dev-secret-change-me";
const COOKIE_NAME = "dashboard_session";
const EXPIRY_DAYS = 30;

function sign(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("hex");
}

export function makeSessionCookie(): string {
  const ts = Date.now().toString();
  const sig = sign(ts);
  const value = `${ts}.${sig}`;
  const maxAge = EXPIRY_DAYS * 24 * 60 * 60;
  return `${COOKIE_NAME}=${value}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}

export function validateSessionCookie(cookieHeader: string | null): boolean {
  if (!cookieHeader) return false;
  const cookies = Object.fromEntries(
    cookieHeader.split(";").map((c) => {
      const [k, ...v] = c.trim().split("=");
      return [k, v.join("=")];
    })
  );
  const value = cookies[COOKIE_NAME];
  if (!value) return false;
  const dotIdx = value.lastIndexOf(".");
  if (dotIdx < 0) return false;
  const ts = value.slice(0, dotIdx);
  const sig = value.slice(dotIdx + 1);
  const expected = sign(ts);
  try {
    return timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

export function checkPassword(input: string): boolean {
  const pw = process.env.DASHBOARD_PASSWORD ?? "";
  if (!pw || !input) return false;
  try {
    return timingSafeEqual(Buffer.from(input), Buffer.from(pw));
  } catch {
    return false;
  }
}

export { COOKIE_NAME };
