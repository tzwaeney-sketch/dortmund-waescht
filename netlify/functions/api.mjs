import { getStore } from "@netlify/blobs";
import { createHash, randomUUID } from "node:crypto";

export const STADTTEILE = ["Innenstadt", "Kreuzviertel", "Nordstadt", "Hörde", "Hombruch", "Barop / Uni", "Eving", "Scharnhorst", "Brackel", "Aplerbeck", "Huckarde", "Lütgendortmund", "Mengede", "Hacheney", "Kirchhörde"];
export const MENGEN = { S: 5, M: 8, L: 12, XL: 18 };          // kg
export const PREIS = { standard: 2.5, express: 4, minimum: 15, transport: 4 }; // € pro kg, Mindestpreis fürs Waschen, Hol- & Bringpauschale
const ZEITFENSTER = ["08–10 Uhr", "10–12 Uhr", "12–14 Uhr", "14–16 Uhr", "16–18 Uhr", "18–20 Uhr"];
const TEMPERATUREN = ["30 °C", "40 °C", "60 °C", "Gemischt, bitte sortieren"];

const AUFTRAEGE_PRO_TAG = 3;     // pro Internetanschluss
const WAESCHER_PRO_TAG = 3;
const AKTIVE_PRO_WAESCHER = 3;   // gleichzeitig angenommene Aufträge
const LOESCHEN_NACH_TAGEN = 30;  // alte Aufträge werden danach gelöscht

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});
const sha = s => createHash("sha256").update(String(s)).digest("hex");
const text = (v, max) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");
const heute = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" }); // JJJJ-MM-TT
const tagePlus = (d, n) => new Date(Date.parse(d + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const neuerCode = () => randomUUID().replace(/-/g, "");

export function preisFuer(menge, express, abholung) {
  const kg = MENGEN[menge] || 0;
  return Math.max(PREIS.minimum, kg * (express ? PREIS.express : PREIS.standard)) + (abholung ? PREIS.transport : 0);
}

export function normalizePhone(raw) {
  let d = String(raw || "").replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = "49" + d.slice(1);
  d = d.replace(/\D/g, "");
  return /^\d{8,15}$/.test(d) ? d : null;
}

export function validateAuftrag(b) {
  if (!b || typeof b !== "object" || b.website) return { error: "Ungültige Anfrage." };
  const vorname = text(b.vorname, 40);
  if (vorname.length < 2) return { error: "Bitte gib deinen Vornamen an." };
  if (!STADTTEILE.includes(b.stadtteil)) return { error: "Bitte wähle deinen Stadtteil." };
  if (!(b.menge in MENGEN)) return { error: "Bitte wähle die Menge." };
  if (!TEMPERATUREN.includes(b.temperatur)) return { error: "Bitte wähle die Temperatur." };
  if (b.transport !== "abholung" && b.transport !== "selbst") return { error: "Bitte wähle, wie die Wäsche zum Wäscher kommt." };
  if (typeof b.termin !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.termin) || b.termin < heute() || b.termin > tagePlus(heute(), 14)) {
    return { error: "Bitte wähle einen Abholtag in den nächsten 14 Tagen." };
  }
  if (!ZEITFENSTER.includes(b.zeitfenster)) return { error: "Bitte wähle ein Zeitfenster." };
  const whatsapp = normalizePhone(b.whatsapp);
  if (!whatsapp) return { error: "Die WhatsApp-Nummer sieht nicht richtig aus." };
  if (b.einverstanden !== true) return { error: "Bitte akzeptiere die Nutzungsbedingungen." };
  const express = b.express === true;
  const abholung = b.transport === "abholung";
  return {
    auftrag: {
      vorname, stadtteil: b.stadtteil, menge: b.menge, kg: MENGEN[b.menge], express, transport: b.transport,
      temperatur: b.temperatur, parfumfrei: b.parfumfrei === true,
      termin: b.termin, zeitfenster: b.zeitfenster, hinweis: text(b.hinweis, 300), whatsapp,
      preis: preisFuer(b.menge, express, abholung)
    }
  };
}

export function validateWaescher(b) {
  if (!b || typeof b !== "object" || b.website) return { error: "Ungültige Anfrage." };
  const name = text(b.name, 40);
  if (name.length < 2) return { error: "Bitte gib deinen Vornamen an." };
  const stadtteile = Array.isArray(b.stadtteile) ? [...new Set(b.stadtteile.filter(s => STADTTEILE.includes(s)))] : [];
  if (!stadtteile.length) return { error: "Bitte wähle mindestens einen Stadtteil." };
  const whatsapp = normalizePhone(b.whatsapp);
  if (!whatsapp) return { error: "Die WhatsApp-Nummer sieht nicht richtig aus." };
  if (b.einverstanden !== true) return { error: "Bitte akzeptiere die Nutzungsbedingungen." };
  return { waescher: { name, stadtteile, whatsapp, trockner: b.trockner === true, auto: b.auto === true } };
}

// Status, wie Kunden und Wäscher ihn sehen
const effektiv = a => (a.status === "offen" && a.termin < heute() ? "abgelaufen" : a.status);
const oeffentlich = a => ({
  id: a.id, erstellt: a.erstellt, stadtteil: a.stadtteil, menge: a.menge, kg: a.kg, express: a.express, transport: a.transport || "abholung",
  temperatur: a.temperatur, parfumfrei: a.parfumfrei, termin: a.termin, zeitfenster: a.zeitfenster, preis: a.preis
});

async function readBody(req) {
  const raw = await req.text();
  if (raw.length > 5000) return null;
  try { const b = JSON.parse(raw || "{}"); return b && typeof b === "object" ? b : null; } catch { return null; }
}
async function alle(store) {
  const { blobs } = await store.list();
  return (await Promise.all(blobs.map(b => store.get(b.key, { type: "json" })))).filter(Boolean);
}
async function limit(zaehler, art, ip, max) {
  const key = `${art}-${sha(ip + heute())}`;
  const n = (await zaehler.get(key, { type: "json" }))?.n || 0;
  if (n >= max) return false;
  await zaehler.setJSON(key, { n: n + 1 });
  return true;
}
function parseCode(code) {
  if (typeof code !== "string") return null;
  const [id, secret] = code.trim().split("~");
  return /^[0-9a-f-]{36}$/.test(id || "") && secret ? { id, secret } : null;
}
async function waescherMitCode(store, code) {
  const c = parseCode(code);
  if (!c) return null;
  const w = await store.get(c.id, { type: "json" });
  return w && w.codeHash === sha(c.secret) ? w : null;
}
const waLink = (nummer, nachricht) => `https://wa.me/${nummer}?text=${encodeURIComponent(nachricht)}`;
const datum = d => new Date(d + "T12:00:00Z").toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Berlin" });

export async function handle(req, ip, { auftraege, waescher, zaehler }) {
  const url = new URL(req.url);
  const p = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const m = req.method;

  // GET /api/auftraege – offene Aufträge, ohne persönliche Daten
  if (m === "GET" && p.length === 1 && p[0] === "auftraege") {
    const list = await alle(auftraege);
    const grenze = tagePlus(heute(), -LOESCHEN_NACH_TAGEN);
    await Promise.all(list.filter(a => a.termin < grenze).map(a => auftraege.delete(a.id))); // Datensparsamkeit
    const offen = list.filter(a => effektiv(a) === "offen")
      .sort((x, y) => (x.termin + x.zeitfenster).localeCompare(y.termin + y.zeitfenster))
      .map(oeffentlich);
    return json(200, { auftraege: offen });
  }

  // GET /api/statistik
  if (m === "GET" && p.length === 1 && p[0] === "statistik") {
    const list = await alle(auftraege);
    const zaehle = s => list.filter(a => effektiv(a) === s).length;
    return json(200, {
      waescher: (await waescher.list()).blobs.length,
      auftraege: { offen: zaehle("offen"), angenommen: zaehle("angenommen"), erledigt: zaehle("erledigt"), storniert: zaehle("storniert"), abgelaufen: zaehle("abgelaufen") },
      umsatzErledigt: list.filter(a => a.status === "erledigt").reduce((s, a) => s + a.preis, 0)
    });
  }

  if (m !== "POST") return json(405, { error: "Nicht erlaubt." });
  const body = await readBody(req);
  if (!body) return json(400, { error: "Ungültige Anfrage." });

  // POST /api/auftraege – Kunde gibt Auftrag auf
  if (p.length === 1 && p[0] === "auftraege") {
    const { auftrag, error } = validateAuftrag(body);
    if (error) return json(400, { error });
    if (!(await limit(zaehler, "auftrag", ip, AUFTRAEGE_PRO_TAG))) return json(429, { error: "Du hast heute schon genug Aufträge aufgegeben. Versuch es morgen wieder." });
    const id = randomUUID(), secret = neuerCode();
    await auftraege.setJSON(id, { ...auftrag, id, erstellt: new Date().toISOString(), status: "offen", codeHash: sha(secret), waescherId: null });
    return json(201, { id, code: `${id}~${secret}`, preis: auftrag.preis });
  }

  // POST /api/waescher – als Wäscher anmelden
  if (p.length === 1 && p[0] === "waescher") {
    const { waescher: w, error } = validateWaescher(body);
    if (error) return json(400, { error });
    if (!(await limit(zaehler, "waescher", ip, WAESCHER_PRO_TAG))) return json(429, { error: "Heute kamen schon genug Anmeldungen von diesem Anschluss. Versuch es morgen wieder." });
    const id = randomUUID(), secret = neuerCode();
    await waescher.setJSON(id, { ...w, id, erstellt: new Date().toISOString(), codeHash: sha(secret) });
    return json(201, { id, code: `${id}~${secret}` });
  }

  // POST /api/waescher/ich – eigenes Profil und angenommene Aufträge
  if (p.length === 2 && p[0] === "waescher" && p[1] === "ich") {
    const w = await waescherMitCode(waescher, body.code);
    if (!w) return json(403, { error: "Dieser Wäscher-Code ist ungültig." });
    const meine = (await alle(auftraege)).filter(a => a.waescherId === w.id && a.status === "angenommen")
      .sort((x, y) => x.termin.localeCompare(y.termin))
      .map(a => ({ ...oeffentlich(a), vorname: a.vorname, hinweis: a.hinweis, status: a.status }));
    return json(200, { name: w.name, stadtteile: w.stadtteile, trockner: w.trockner, auto: w.auto, auftraege: meine });
  }

  // POST /api/waescher/loeschen – Profil löschen, angenommene Aufträge werden wieder frei
  if (p.length === 2 && p[0] === "waescher" && p[1] === "loeschen") {
    const w = await waescherMitCode(waescher, body.code);
    if (!w) return json(403, { error: "Dieser Wäscher-Code ist ungültig." });
    for (const a of await alle(auftraege)) {
      if (a.waescherId === w.id && a.status === "angenommen") await auftraege.setJSON(a.id, { ...a, status: "offen", waescherId: null });
    }
    await waescher.delete(w.id);
    return json(200, { ok: true });
  }

  // POST /api/auftraege/:id/<aktion>
  if (p.length === 3 && p[0] === "auftraege") {
    const [, id, aktion] = p;
    const a = /^[0-9a-f-]{36}$/.test(id) ? await auftraege.get(id, { type: "json" }) : null;
    if (!a) return json(404, { error: "Diesen Auftrag gibt es nicht mehr." });
    const status = effektiv(a);
    const kc = parseCode(body.code);
    const istKunde = !!kc && kc.id === id && sha(kc.secret) === a.codeHash;

    if (aktion === "status") {
      if (!istKunde) return json(403, { error: "Dieser Auftragscode ist ungültig." });
      const w = a.waescherId ? await waescher.get(a.waescherId, { type: "json" }) : null;
      return json(200, { ...oeffentlich(a), status, waescher: w ? { name: w.name } : null });
    }
    if (aktion === "stornieren") {
      if (!istKunde) return json(403, { error: "Dieser Auftragscode ist ungültig." });
      if (status === "erledigt") return json(409, { error: "Dieser Auftrag ist schon erledigt." });
      await auftraege.setJSON(id, { ...a, status: "storniert" });
      return json(200, { ok: true });
    }
    // WhatsApp-Kontakt zur anderen Seite, erst nach Annahme
    if (aktion === "kontakt") {
      if (status !== "angenommen") return json(409, { error: "Der Kontakt ist erst möglich, wenn der Auftrag angenommen wurde." });
      const w = await waescher.get(a.waescherId, { type: "json" });
      if (!w) return json(409, { error: "Die Wäscherin oder der Wäscher ist nicht mehr angemeldet." });
      if (istKunde) {
        return json(200, { link: waLink(w.whatsapp, `Hallo ${w.name}, hier ist ${a.vorname}. Du hast meinen Auftrag bei Dortmund wäscht angenommen (${datum(a.termin)}, ${a.zeitfenster}).`) });
      }
      const ich = await waescherMitCode(waescher, body.waescherCode);
      if (!ich || ich.id !== w.id) return json(403, { error: "Das ist nicht dein Auftrag." });
      const nachricht = a.transport === "selbst"
        ? `Hallo ${a.vorname}, ich bin ${w.name} von Dortmund wäscht und habe deinen Auftrag angenommen: ${datum(a.termin)}, ${a.zeitfenster}, ca. ${a.kg} kg. Du bringst die Wäsche selbst vorbei, ich schicke dir gleich meine Adresse.`
        : `Hallo ${a.vorname}, ich bin ${w.name} von Dortmund wäscht und habe deinen Auftrag angenommen: Ich hole ${datum(a.termin)}, ${a.zeitfenster} ab, ca. ${a.kg} kg. Schickst du mir noch deine Adresse?`;
      return json(200, { link: waLink(a.whatsapp, nachricht) });
    }

    // Ab hier nur für angemeldete Wäscher
    const w = await waescherMitCode(waescher, body.waescherCode);
    if (!w) return json(403, { error: "Bitte melde dich zuerst als Wäscherin oder Wäscher an." });

    if (aktion === "annehmen") {
      if (status !== "offen") return json(409, { error: "Diesen Auftrag hat schon jemand anderes angenommen." });
      const aktiv = (await alle(auftraege)).filter(x => x.waescherId === w.id && x.status === "angenommen").length;
      if (aktiv >= AKTIVE_PRO_WAESCHER) return json(409, { error: `Du hast schon ${AKTIVE_PRO_WAESCHER} laufende Aufträge. Schließ erst einen ab.` });
      await auftraege.setJSON(id, { ...a, status: "angenommen", waescherId: w.id, angenommen: new Date().toISOString() });
      const check = await auftraege.get(id, { type: "json" });
      if (check?.waescherId !== w.id) return json(409, { error: "Diesen Auftrag hat schon jemand anderes angenommen." });
      return json(200, { ok: true });
    }
    if (a.waescherId !== w.id) return json(403, { error: "Das ist nicht dein Auftrag." });
    if (aktion === "freigeben") {
      await auftraege.setJSON(id, { ...a, status: "offen", waescherId: null });
      return json(200, { ok: true });
    }
    if (aktion === "erledigt") {
      await auftraege.setJSON(id, { ...a, status: "erledigt", erledigt: new Date().toISOString() });
      return json(200, { ok: true });
    }
  }

  return json(404, { error: "Nicht gefunden." });
}

export default async (req, context) => handle(req, context.ip || "", {
  auftraege: getStore({ name: "auftraege", consistency: "strong" }),
  waescher: getStore({ name: "waescher", consistency: "strong" }),
  zaehler: getStore({ name: "zaehler", consistency: "strong" })
});

export const config = { path: "/api/*" };
