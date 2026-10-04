// PROTOCOL 17 — approximate network location
// city / region / country only, fetched once, kept in memory only,
// never persisted, never presented as an exact address.

import { emit } from "./state.js";

const SOURCES = [
  {
    url: "https://ipwho.is/",
    parse: (d) => ({
      country: d.country,
      region: d.region,
      city: d.city,
      timezone: d.timezone?.id || d.timezone || null,
      org: d.connection?.isp || d.connection?.org || null
    })
  },
  {
    url: "https://ipapi.co/json/",
    parse: (d) => ({
      country: d.country_name,
      region: d.region,
      city: d.city,
      timezone: d.timezone,
      org: d.org || d.asn || null
    })
  }
];

async function fetchJSON(url, timeoutMs = 6000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer"
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export const location = {
  state: {
    city: null,
    region: null,
    country: null,
    timezone: null,
    org: null
  },
  loaded: false,
  failed: false,
  offline: false,

  // resolves { ok, offline } — result kept in memory only
  async resolve() {
    if (this.loaded) return { ok: true, offline: this.offline };

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      this.offline = true;
      emit("location:offline");
      return { ok: false, offline: true };
    }

    for (const source of SOURCES) {
      try {
        const data = await fetchJSON(source.url);
        const parsed = source.parse(data);
        if (!parsed.country && !parsed.city) continue;
        this.state = parsed;
        this.loaded = true;
        emit("location:resolved", { ...parsed });
        return { ok: true, offline: false };
      } catch {
        /* try next source */
      }
    }

    this.failed = true;
    emit("location:failed");
    return { ok: false, offline: false };
  },

  // called after the reveal — nothing is kept beyond this point
  forget() {
    this.state = {
      city: null,
      region: null,
      country: null,
      timezone: null,
      org: null
    };
  }
};
