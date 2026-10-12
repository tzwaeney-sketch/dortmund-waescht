import { getStore } from "@netlify/blobs";
import { createHash, randomUUID } from "node:crypto";

const STADTTEILE = ["Innenstadt", "Kreuzviertel", "Nordstadt", "Hörde", "Hombruch", "Barop / Uni", "Eving", "Scharnhorst", "Brackel", "Aplerbeck", "Huckarde", "Lütgendortmund", "Mengede", "Hacheney", "Kirchhörde"];
const ANZEIGEN_PRO_TAG = 5;        // pro Internetanschluss
const MELDUNGEN_BIS_AUSBLENDEN = 3;
const OEFFENTLICH = ["id", "erstellt", "name", "stadtteil", "angebot", "preis", "trockner", "abholung", "zeiten", "beschreibung"]; // WhatsApp-Nummer bleibt privat
const KONTAKTE_PRO_TAG = 30;      // pro Internetanschluss, gegen das Absammeln von Nummern

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});
const weiterleiten = to => new Response(null, { status: 302, headers: { location: to, "cache-control": "no-store", "x-robots-tag": "noindex" } });
const sha = s => createHash("sha256").update(String(s)).digest("hex");
const text = (v, max) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");

export function normalizePhone(raw) {
  let d = String(raw || "").replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = "49" + d.slice(1);
  d = d.replace(/\D/g, "");
  return /^\d{8,15}$/.test(d) ? d : null;
}

export function validate(b) {
  if (!b || typeof b !== "object") return { error: "Ungültige Anfrage." };
  if (b.website) return { error: "Ungültige Anfrage." }; // Spam-Falle
  const name = text(b.name, 40);
  if (name.length < 2) return { error: "Bitte gib deinen Vornamen an." };
  if (!STADTTEILE.includes(b.stadtteil)) return { error: "Bitte wähle einen Stadtteil." };
  if (b.angebot !== "maschine" && b.angebot !== "service") return { error: "Bitte wähle, was du anbietest." };
  const preis = Math.round(Number(b.preis) * 100) / 100;
  if (!(preis >= 1 && preis <= 100)) return { error: "Bitte einen Preis zwischen 1 und 100 € angeben." };
  const whatsapp = normalizePhone(b.whatsapp);
  if (!whatsapp) return { error: "Die WhatsApp-Nummer sieht nicht richtig aus." };
  if (b.einverstanden !== true) return { error: "Bitte akzeptiere die Nutzungsbedingungen." };
  return {
    anzeige: {
      name, stadtteil: b.stadtteil, angebot: b.angebot, preis, whatsapp,
      trockner: b.trockner === true, abholung: b.abholung === true,
      zeiten: text(b.zeiten, 120), beschreibung: text(b.beschreibung, 400)
    }
  };
}

const publicView = a => Object.fromEntries(OEFFENTLICH.map(k => [k, a[k]]));
const sichtbar = a => a && (a.meldungen || []).length < MELDUNGEN_BIS_AUSBLENDEN;

async function readBody(req) {
  const raw = await req.text();
  if (raw.length > 5000) return null;
  try { return JSON.parse(raw || "{}"); } catch { return null; }
}

async function alleAnzeigen(store) {
  const { blobs } = await store.list();
  const items = await Promise.all(blobs.map(b => store.get(b.key, { type: "json" })));
  return items.filter(Boolean);
}

export async function handle(req, ip, { anzeigen, zaehler }) {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const method = req.method;

  // GET /api/anzeigen
  if (method === "GET" && parts.length === 1 && parts[0] === "anzeigen") {
    const list = (await alleAnzeigen(anzeigen)).filter(sichtbar)
      .sort((a, b) => b.erstellt.localeCompare(a.erstellt))
      .map(publicView);
    return json(200, { anzeigen: list });
  }

  // GET /api/statistik
  if (method === "GET" && parts.length === 1 && parts[0] === "statistik") {
    const all = await alleAnzeigen(anzeigen);
    const live = all.filter(sichtbar);
    return json(200, {
      anzeigen: live.length,
      ausgeblendet: all.length - live.length,
      anfragen: all.reduce((s, a) => s + (a.kontakte || 0), 0),
      proStadtteil: Object.fromEntries(STADTTEILE.map(s => [s, live.filter(a => a.stadtteil === s).length]).filter(([, n]) => n))
    });
  }

  // GET /api/anzeigen/:id/kontakt -> Weiterleitung in den WhatsApp-Chat, die Nummer steht nie auf der Seite
  if (method === "GET" && parts.length === 3 && parts[0] === "anzeigen" && parts[2] === "kontakt") {
    const id = parts[1];
    const a = /^[0-9a-f-]{36}$/.test(id) ? await anzeigen.get(id, { type: "json" }) : null;
    if (!a || !sichtbar(a)) return weiterleiten("/#finden");
    const tag = new Date().toISOString().slice(0, 10);
    const limitKey = "kontakt-" + sha(ip + tag);
    const count = (await zaehler.get(limitKey, { type: "json" }))?.n || 0;
    if (count >= KONTAKTE_PRO_TAG) return new Response("Zu viele Anfragen heute. Bitte versuch es morgen wieder.", { status: 429, headers: { "content-type": "text/plain; charset=utf-8" } });
    await zaehler.setJSON(limitKey, { n: count + 1 });
    await anzeigen.setJSON(id, { ...a, kontakte: (a.kontakte || 0) + 1 });
    const typ = a.angebot === "service" ? "Waschen & Falten" : "Maschine nutzen";
    const preis = Number(a.preis).toLocaleString("de-DE", { minimumFractionDigits: a.preis % 1 ? 2 : 0 }) + " €";
    const text = `Hallo ${a.name}, ich habe deine Anzeige bei Dortmund wäscht gesehen (${typ}, ${preis}). Wann hättest du Zeit?`;
    return weiterleiten(`https://wa.me/${a.whatsapp}?text=${encodeURIComponent(text)}`);
  }

  if (method !== "POST") return json(405, { error: "Nicht erlaubt." });

  // POST /api/anzeigen
  if (parts.length === 1 && parts[0] === "anzeigen") {
    const body = await readBody(req);
    const { anzeige, error } = validate(body);
    if (error) return json(400, { error });

    const tag = new Date().toISOString().slice(0, 10);
    const limitKey = "limit-" + sha(ip + tag);
    const count = (await zaehler.get(limitKey, { type: "json" }))?.n || 0;
    if (count >= ANZEIGEN_PRO_TAG) return json(429, { error: "Du hast heute schon genug Anzeigen erstellt. Versuch es morgen wieder." });
    await zaehler.setJSON(limitKey, { n: count + 1 });

    const id = randomUUID();
    const schluessel = randomUUID().replace(/-/g, "");
    await anzeigen.setJSON(id, {
      ...anzeige, id, erstellt: new Date().toISOString(),
      schluesselHash: sha(schluessel), kontakte: 0, meldungen: []
    });
    return json(201, { id, schluessel });
  }

  // POST /api/anzeigen/:id/(loeschen|kontakt|melden)
  if (parts.length === 3 && parts[0] === "anzeigen") {
    const [, id, aktion] = parts;
    if (!/^[0-9a-f-]{36}$/.test(id)) return json(404, { error: "Anzeige nicht gefunden." });
    const a = await anzeigen.get(id, { type: "json" });
    if (!a) return json(404, { error: "Anzeige nicht gefunden." });

    if (aktion === "loeschen") {
      const body = await readBody(req);
      if (!body || typeof body.schluessel !== "string" || sha(body.schluessel) !== a.schluesselHash) {
        return json(403, { error: "Der Löschcode passt nicht zu dieser Anzeige." });
      }
      await anzeigen.delete(id);
      return json(200, { ok: true });
    }
    if (aktion === "melden") {
      const melder = sha("melden" + ip);
      const meldungen = a.meldungen || [];
      if (!meldungen.includes(melder)) await anzeigen.setJSON(id, { ...a, meldungen: [...meldungen, melder] });
      return json(200, { ok: true });
    }
  }

  return json(404, { error: "Nicht gefunden." });
}

export default async (req, context) => handle(req, context.ip || "", {
  anzeigen: getStore({ name: "anzeigen", consistency: "strong" }),
  zaehler: getStore({ name: "zaehler", consistency: "strong" })
});

export const config = { path: "/api/*" };
