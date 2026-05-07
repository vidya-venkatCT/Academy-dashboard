import { HubSpotFilter, CONTACT_PROPERTIES } from "./filters";

const HUBSPOT_BASE = "https://api.hubapi.com/crm/v3/objects/contacts/search";

export interface HubSpotContact {
  id: string;
  properties: Record<string, string | null>;
}

export interface HubSpotSearchResponse {
  total: number;
  results: HubSpotContact[];
  paging?: { next?: { after: string } };
}

export interface SearchPayload {
  filterGroups: { filters: HubSpotFilter[] }[];
  properties: string[];
  limit: number;
  after?: string;
}

export function buildPayload(
  filters: HubSpotFilter[],
  after?: string,
  limit = 100
): SearchPayload {
  return {
    filterGroups: [{ filters }],
    properties: CONTACT_PROPERTIES,
    limit,
    after,
  };
}

/** Server-side only — never call from the browser */
export async function searchContacts(
  filters: HubSpotFilter[],
  after?: string
): Promise<HubSpotSearchResponse> {
  const token = process.env.HUBSPOT_TOKEN;
  if (!token) throw new Error("HUBSPOT_TOKEN not set");

  const payload = buildPayload(filters, after);
  const res = await fetch(HUBSPOT_BASE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HubSpot error ${res.status}: ${text}`);
  }

  return res.json();
}
