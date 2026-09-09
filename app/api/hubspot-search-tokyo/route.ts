import { NextRequest, NextResponse } from "next/server";
import { CONTACT_PROPERTIES } from "@/lib/tokyo-filters";

// Membership custom object in portal 51278247 (objectTypeId: 2-61595094)
const HUBSPOT_BASE = "https://api.hubapi.com/crm/v3/objects/2-61595094/search";

const ALLOWED_OPERATORS = new Set([
  "EQ", "NEQ", "LT", "LTE", "GT", "GTE",
  "CONTAINS_TOKEN", "NOT_CONTAINS_TOKEN",
  "HAS_PROPERTY", "NOT_HAS_PROPERTY",
  "IN", "NOT_IN",
]);

const ALLOWED_PROPERTIES = new Set(CONTACT_PROPERTIES);

function isValidFilters(filterGroups: unknown): boolean {
  if (!Array.isArray(filterGroups)) return false;
  for (const group of filterGroups) {
    if (!group || typeof group !== "object") return false;
    const { filters } = group as Record<string, unknown>;
    if (!Array.isArray(filters)) return false;
    for (const f of filters) {
      if (!f || typeof f !== "object") return false;
      const { propertyName, operator } = f as Record<string, unknown>;
      if (typeof propertyName !== "string" || typeof operator !== "string") return false;
      if (!ALLOWED_PROPERTIES.has(propertyName)) return false;
      if (!ALLOWED_OPERATORS.has(operator)) return false;
    }
  }
  return true;
}

export async function POST(req: NextRequest) {
  const token = process.env.TOKYO_HUBSPOT_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "Tokyo HubSpot token not configured" }, { status: 500 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { filterGroups, properties, limit, after } = body as Record<string, unknown>;

  if (!isValidFilters(filterGroups)) {
    return NextResponse.json({ error: "Invalid filter structure" }, { status: 400 });
  }

  const payload: Record<string, unknown> = {
    filterGroups,
    properties: Array.isArray(properties) ? properties : CONTACT_PROPERTIES,
    limit: typeof limit === "number" ? Math.min(limit, 100) : 100,
  };
  if (typeof after === "string" && after) payload.after = after;

  const upstream = await fetch(HUBSPOT_BASE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await upstream.json();
  const res = NextResponse.json(data, { status: upstream.status });
  res.headers.set("Cache-Control", "s-maxage=5, stale-while-revalidate=5");
  return res;
}
