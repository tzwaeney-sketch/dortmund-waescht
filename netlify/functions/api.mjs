import { getStore } from "@netlify/blobs";
import webpush from "web-push";
import { createHash, randomUUID, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";

export const STADTTEILE = ["Innenstadt", "Kreuzviertel", "Nordstadt", "Hörde", "Hombruch", "Barop / Uni", "Eving", "Scharnhorst", "Brackel", "Aplerbeck", "Huckarde", "Lütgendortmund", "Mengede", "Hacheney", "Kirchhörde"];
export const KG = { min: 3, max: 25 };
export const PREIS = { expressAufschlag: 1.5, transport: 4 }; // Express-Aufschlag pro kg, Hol- & Bringpauschale
// Leistungen: Preis pro kg und Mindestbestellwert fürs Waschen
export const LEISTUNGEN = {
  komplett: { name: "Waschen, trocknen, falten", kg: 2.5, minimum: 15 },
  waschen: { name: "Nur waschen", kg: 1.5, minimum: 10 }
};
const BETREIBER_MAIL = "albrecht.sven89@gmail.com";
const ZEITFENSTER = ["08–10 Uhr", "10–12 Uhr", "12–14 Uhr", "14–16 Uhr", "16–18 Uhr", "18–20 Uhr"];
const TEMPERATUREN = ["30 °C", "40 °C", "60 °C", "Gemischt, bitte sortieren"];

const AUFTRAEGE_PRO_TAG = 3;     // pro Internetanschluss
const WAESCHER_PRO_TAG = 3;
const AKTIVE_PRO_WAESCHER = 3;   // gleichzeitig angenommene Aufträge
const LOESCHEN_NACH_TAGEN = 30;  // alte Aufträge werden danach gelöscht
const SPERRE_AB = { anzahl: 3, schnitt: 3 }; // ab 3 Bewertungen mit Schnitt unter 3 Sternen keine neuen Aufträge
const FEEDBACK_MAX = 20;         // so viele Kommentare behält ein Wäscher-Profil
const LOGIN_FEHLER_MAX = 5;      // falsche Passwörter pro Nummer und Stunde
const FINDEN_PRO_TAG = 20;       // Auftragssuchen pro Internetanschluss
const SITZUNGEN_MAX = 10;        // gleichzeitig angemeldete Geräte
const KURZ_ZEICHEN = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const ABOS_PRO_TAG = 10;         // Push-Anmeldungen pro Internetanschluss
// Einmal-Code zum ersten Einrichten der Admin-Seite (nur der Hash steht hier, der Code selbst nicht)
const ADMIN_SETUP_HASH = "cab63a29b99f68d237db2c7e71255f801086687ebf80d863d8c68d94b23fc8f8";
const ADMIN_FEHLER_MAX = 5;      // falsche Admin-Passwörter pro Stunde
const QUELLEN = ["tiktok", "instagram", "facebook", "whatsapp", "google", "direkt", "andere"];

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});
const sha = s => createHash("sha256").update(String(s)).digest("hex");
const text = (v, max) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");
const heute = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" }); // JJJJ-MM-TT
const tagePlus = (d, n) => new Date(Date.parse(d + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const neuerCode = () => randomUUID().replace(/-/g, "");
const kurzcode = () => Array.from({ length: 6 }, () => KURZ_ZEICHEN[randomInt(KURZ_ZEICHEN.length)]).join("");
function passwortHash(pw) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(pw, salt, 32).toString("hex");
}
function passwortOk(pw, gespeichert) {
  if (typeof pw !== "string" || !gespeichert) return false;
  const [salt, hash] = gespeichert.split(":");
  const a = scryptSync(pw, salt, 32), b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
// Codes sind "id~geheim"; gültig ist der ursprüngliche Code oder eine spätere Sitzung (Login, Auftragssuche)
const codePasst = (obj, secret) => obj.codeHash === sha(secret) || (obj.sitzungen || []).includes(sha(secret));
const mitSitzung = (obj, secret) => ({ ...obj, sitzungen: [sha(secret), ...(obj.sitzungen || [])].slice(0, SITZUNGEN_MAX) });

export function preisFuer(kg, express, abholung, leistung = "komplett") {
  const l = LEISTUNGEN[leistung] || LEISTUNGEN.komplett;
  const waschen = Math.max(l.minimum, kg * (l.kg + (express ? PREIS.expressAufschlag : 0)));
  return Math.round((waschen + (abholung ? PREIS.transport : 0)) * 100) / 100;
}

// WhatsApp-Nummer bereinigen: "0176 123 45 67", "+49 (0)176-1234567", "0049176…" → "491761234567"
export function normalizePhone(raw) {
  let d = String(raw || "").trim().replace(/\(0\)/g, "").replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = "49" + d.slice(1);
  else if (/^1[5-7]\d{8,9}$/.test(d)) d = "49" + d;        // Handynummer ohne führende 0
  if (!/^\d+$/.test(d)) return null;
  if (d.startsWith("49")) return /^491[5-7]\d{8,9}$/.test(d) ? d : null; // deutsche Handynummer (015x, 016x, 017x)
  return /^[1-9]\d{7,14}$/.test(d) ? d : null;                           // Nummer aus dem Ausland
}

export function validateAuftrag(b) {
  if (!b || typeof b !== "object" || b.website) return { error: "Ungültige Anfrage." };
  const vorname = text(b.vorname, 40);
  if (vorname.length < 2) return { error: "Bitte gib deinen Vornamen an." };
  if (!STADTTEILE.includes(b.stadtteil)) return { error: "Bitte wähle deinen Stadtteil." };
  const kg = Number(b.kg);
  if (!Number.isInteger(kg) || kg < KG.min || kg > KG.max) return { error: `Bitte wähle zwischen ${KG.min} und ${KG.max} kg.` };
  if (!TEMPERATUREN.includes(b.temperatur)) return { error: "Bitte wähle die Temperatur." };
  const leistung = b.leistung === undefined ? "komplett" : b.leistung;
  if (!(leistung in LEISTUNGEN)) return { error: "Bitte wähle, was gemacht werden soll." };
  if (b.transport !== "abholung" && b.transport !== "selbst") return { error: "Bitte wähle, wie die Wäsche zum Wäscher kommt." };
  if (typeof b.termin !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.termin) || b.termin < heute() || b.termin > tagePlus(heute(), 14)) {
    return { error: "Bitte wähle einen Abholtag in den nächsten 14 Tagen." };
  }
  if (!ZEITFENSTER.includes(b.zeitfenster)) return { error: "Bitte wähle ein Zeitfenster." };
  const whatsapp = normalizePhone(b.whatsapp);
  if (!whatsapp) return { error: "Bitte gib eine Handynummer mit WhatsApp an, z. B. 0176 12345678." };
  if (b.checkliste !== true) return { error: "Bitte bestätige die Checkliste vor dem Absenden." };
  if (b.einverstanden !== true) return { error: "Bitte akzeptiere die Nutzungsbedingungen." };
  const express = b.express === true;
  const abholung = b.transport === "abholung";
  // Trocknen: beim Komplett-Service entweder Trockner oder Luft. Express mit Trocknen geht nur mit Trockner.
  const trockner = leistung === "komplett" ? b.trockner !== false : null;
  if (express && leistung === "komplett" && !trockner) return { error: "Express geht nur, wenn die Wäsche in den Trockner darf. An der Luft dauert das Trocknen bis zum nächsten Tag." };
  return {
    auftrag: {
      vorname, stadtteil: b.stadtteil, kg, express, transport: b.transport, leistung, trockner,
      temperatur: b.temperatur, parfumfrei: b.parfumfrei === true,
      termin: b.termin, zeitfenster: b.zeitfenster, hinweis: text(b.hinweis, 300), whatsapp,
      preis: preisFuer(kg, express, abholung, leistung)
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
  if (!whatsapp) return { error: "Bitte gib eine Handynummer mit WhatsApp an, z. B. 0176 12345678." };
  if (typeof b.passwort !== "string" || b.passwort.length < 6 || b.passwort.length > 100) return { error: "Bitte wähle ein Passwort mit mindestens 6 Zeichen." };
  if (b.einverstanden !== true) return { error: "Bitte akzeptiere die Nutzungsbedingungen." };
  return { waescher: { name, stadtteile, whatsapp, trockner: b.trockner === true, auto: b.auto === true } };
}

// Express mit Trocknen schafft nur, wer einen Trockner hat
const brauchtTrockner = a => !!a.express && (a.leistung || "komplett") === "komplett" && a.trockner !== false;

// Status, wie Kunden und Wäscher ihn sehen
const effektiv = a => (a.status === "offen" && a.termin < heute() ? "abgelaufen" : a.status);
const oeffentlich = a => ({
  id: a.id, erstellt: a.erstellt, stadtteil: a.stadtteil, kg: a.kg, express: a.express, transport: a.transport || "abholung", leistung: a.leistung || "komplett",
  trockner: a.trockner ?? null, trocknerNoetig: brauchtTrockner(a),
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
  return w && codePasst(w, c.secret) ? w : null;
}
// Bewertungen eines Wäschers: { summe, anzahl } für den Schnitt
const schnitt = w => (w?.bewertungen?.anzahl ? Math.round(w.bewertungen.summe / w.bewertungen.anzahl * 10) / 10 : null);
const gesperrtWegenBewertung = w => (w?.bewertungen?.anzahl || 0) >= SPERRE_AB.anzahl && schnitt(w) < SPERRE_AB.schnitt;
const gesperrt = w => !!w?.gesperrtManuell || gesperrtWegenBewertung(w);
const kannBewerten = (a, status) => !a.bewertung && a.waescherId && (status === "erledigt" || (status === "angenommen" && a.termin <= heute()));

const waLink = (nummer, nachricht) => `https://wa.me/${nummer}?text=${encodeURIComponent(nachricht)}`;
const datum = d => new Date(d + "T12:00:00Z").toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Berlin" });

// ===== Push-Benachrichtigungen für Wäscher =====
async function vapidSchluessel(zaehler) {
  let v = await zaehler.get("vapid", { type: "json" });
  if (!v) { v = webpush.generateVAPIDKeys(); await zaehler.setJSON("vapid", v); }
  return v;
}
const eur = n => Number(n).toLocaleString("de-DE", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }) + " €";
// Push an eine Liste von Abos schicken; abgelaufene Abos werden dabei aufgeräumt
async function pushSenden({ abos, zaehler }, liste, nachricht, sender = webpush.sendNotification) {
  if (!liste.length) return 0;
  const v = await vapidSchluessel(zaehler);
  const payload = JSON.stringify(nachricht);
  const optionen = { TTL: 6 * 3600, vapidDetails: { subject: "mailto:" + BETREIBER_MAIL, publicKey: v.publicKey, privateKey: v.privateKey } };
  const ergebnisse = await Promise.allSettled(liste.map(async x => {
    try { await sender(x.subscription, payload, optionen); }
    catch (e) { if (e.statusCode === 404 || e.statusCode === 410) await abos.delete(x.id); throw e; } // abgelaufene Abos aufräumen
  }));
  return ergebnisse.filter(r => r.status === "fulfilled").length;
}
// Wäscher in passenden Stadtteilen über einen neuen Auftrag informieren
export async function benachrichtigen(stores, a, sender) {
  const liste = (await alle(stores.abos)).filter(x => !x.admin && x.stadtteile.includes(a.stadtteil));
  return pushSenden(stores, liste, {
    title: `Neuer Auftrag in ${a.stadtteil}`,
    body: `${(LEISTUNGEN[a.leistung] || LEISTUNGEN.komplett).name}, ca. ${a.kg} kg · ${datum(a.termin)}, ${a.zeitfenster} · ${eur(a.preis)} für dich`,
    url: "/#auftraege"
  }, sender);
}
// Betreiber über Neuigkeiten informieren (neue Wäscher, Aufträge, Bewertungen)
export async function adminInfo(stores, title, body, sender, mailer = mailSenden) {
  try {
    const liste = (await alle(stores.abos)).filter(x => x.admin);
    await pushSenden(stores, liste, { title, body, url: "/admin.html" }, sender);
  } catch {} // Benachrichtigungen dürfen nie eine Aktion verhindern
  try {
    const hook = (await stores.zaehler.get("admin", { type: "json" }))?.mailHook;
    if (hook) await mailer(hook, title, body);
  } catch {}
}
// E-Mail über das Google-Apps-Script des Betreibers verschicken (läuft in seinem Google-Konto)
const MAIL_HOOK_MUSTER = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}\/exec$/;
export async function mailSenden(hook, titel, text) {
  const res = await fetch(hook, {
    method: "POST", headers: { "content-type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ titel, text, link: "https://dortmund-waescht.netlify.app/admin.html" }),
    redirect: "follow", signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) throw new Error("Mail-Skript antwortet mit Fehler " + res.status);
}
function pruefeAbo(sub) {
  if (!sub || typeof sub !== "object" || typeof sub.endpoint !== "string") return null;
  if (!/^https:\/\//.test(sub.endpoint) || sub.endpoint.length > 1000) return null;
  const k = sub.keys || {};
  if (typeof k.p256dh !== "string" || typeof k.auth !== "string" || k.p256dh.length > 200 || k.auth.length > 100) return null;
  return { endpoint: sub.endpoint, keys: { p256dh: k.p256dh, auth: k.auth } };
}

export async function handle(req, ip, { auftraege, waescher, zaehler, abos }, senden) {
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

  // GET /api/bewertungen – Gesamtschnitt für die Startseite
  if (m === "GET" && p.length === 1 && p[0] === "bewertungen") {
    const ws = await alle(waescher);
    const summe = ws.reduce((x, w) => x + (w.bewertungen?.summe || 0), 0);
    const anzahl = ws.reduce((x, w) => x + (w.bewertungen?.anzahl || 0), 0);
    return json(200, { anzahl, schnitt: anzahl ? Math.round(summe / anzahl * 10) / 10 : null });
  }

  // GET /api/push/schluessel – öffentlicher Schlüssel für Push-Abos
  if (m === "GET" && p.length === 2 && p[0] === "push" && p[1] === "schluessel") {
    return json(200, { publicKey: (await vapidSchluessel(zaehler)).publicKey });
  }

  // GET /api/admin/status – ist die Admin-Seite schon eingerichtet?
  if (m === "GET" && p.length === 2 && p[0] === "admin" && p[1] === "status") {
    return json(200, { eingerichtet: !!(await zaehler.get("admin", { type: "json" }))?.passwortHash });
  }

  // GET /api/statistik
  if (m === "GET" && p.length === 1 && p[0] === "statistik") {
    const list = await alle(auftraege);
    const zaehle = s => list.filter(a => effektiv(a) === s).length;
    return json(200, {
      waescher: (await waescher.list()).blobs.length,
      pushAbos: (await abos.list()).blobs.length,
      auftraege: { offen: zaehle("offen"), angenommen: zaehle("angenommen"), erledigt: zaehle("erledigt"), storniert: zaehle("storniert"), abgelaufen: zaehle("abgelaufen") },
      umsatzErledigt: list.filter(a => a.status === "erledigt").reduce((s, a) => s + a.preis, 0)
    });
  }

  if (m !== "POST") return json(405, { error: "Nicht erlaubt." });
  const body = await readBody(req);
  if (!body) return json(400, { error: "Ungültige Anfrage." });

  // POST /api/besuch – anonymer Seitenaufruf-Zähler (keine Cookies, keine IP, nur Tag und Quelle)
  if (p.length === 1 && p[0] === "besuch") {
    const quelle = QUELLEN.includes(body.quelle) ? body.quelle : "andere";
    const key = "besuche-" + heute();
    const t = (await zaehler.get(key, { type: "json" })) || { gesamt: 0, quellen: {} };
    t.gesamt += 1; t.quellen[quelle] = (t.quellen[quelle] || 0) + 1;
    await zaehler.setJSON(key, t);
    return json(200, { ok: true });
  }

  // ===== Admin =====
  if (p[0] === "admin") {
    const admin = (await zaehler.get("admin", { type: "json" })) || {};
    if (p[1] === "einrichten") {
      if (admin.passwortHash) return json(409, { error: "Die Admin-Seite ist schon eingerichtet. Melde dich mit deinem Passwort an." });
      if (typeof body.code !== "string" || sha(body.code.trim().toUpperCase()) !== ADMIN_SETUP_HASH) return json(403, { error: "Der Einrichtungscode stimmt nicht." });
      if (typeof body.passwort !== "string" || body.passwort.length < 8) return json(400, { error: "Bitte wähle ein Passwort mit mindestens 8 Zeichen." });
      const secret = neuerCode();
      await zaehler.setJSON("admin", mitSitzung({ passwortHash: passwortHash(body.passwort) }, secret));
      return json(200, { sitzung: secret });
    }
    if (p[1] === "login") {
      const fehlerKey = "adminfehler-" + new Date().toISOString().slice(0, 13);
      const fehler = (await zaehler.get(fehlerKey, { type: "json" }))?.n || 0;
      if (fehler >= ADMIN_FEHLER_MAX) return json(429, { error: "Zu viele falsche Versuche. Bitte warte eine Stunde." });
      if (!passwortOk(body.passwort, admin.passwortHash)) {
        await zaehler.setJSON(fehlerKey, { n: fehler + 1 });
        return json(403, { error: "Das Passwort stimmt nicht." });
      }
      const secret = neuerCode();
      await zaehler.setJSON("admin", mitSitzung(admin, secret));
      return json(200, { sitzung: secret });
    }
    // Ab hier nur mit gültiger Admin-Sitzung
    if (typeof body.sitzung !== "string" || !admin.passwortHash || !(admin.sitzungen || []).includes(sha(body.sitzung))) {
      return json(401, { error: "Bitte melde dich neu an." });
    }
    if (p[1] === "daten") {
      const [auftragsListe, waescherListe, aboListe] = await Promise.all([alle(auftraege), alle(waescher), alle(abos)]);
      const namen = Object.fromEntries(waescherListe.map(w => [w.id, w.name]));
      const besuche = [];
      for (let i = 29; i >= 0; i--) {
        const tag = tagePlus(heute(), -i);
        const t = await zaehler.get("besuche-" + tag, { type: "json" });
        besuche.push({ tag, gesamt: t?.gesamt || 0, quellen: t?.quellen || {} });
      }
      const aboProStadtteil = {};
      for (const a of aboListe) if (!a.admin) for (const st of a.stadtteile) aboProStadtteil[st] = (aboProStadtteil[st] || 0) + 1;
      return json(200, {
        heute: heute(), besuche, abos: aboListe.filter(a => !a.admin).length, aboProStadtteil, mailAktiv: !!admin.mailHook,
        auftraege: auftragsListe.sort((x, y) => y.erstellt.localeCompare(x.erstellt)).map(a => ({
          id: a.id, kurz: a.kurz, erstellt: a.erstellt, status: effektiv(a), vorname: a.vorname, whatsapp: a.whatsapp,
          stadtteil: a.stadtteil, kg: a.kg, express: a.express, transport: a.transport, leistung: a.leistung || "komplett", trockner: a.trockner ?? null, termin: a.termin, zeitfenster: a.zeitfenster,
          temperatur: a.temperatur, hinweis: a.hinweis, preis: a.preis, waescher: a.waescherId ? (namen[a.waescherId] || "gelöscht") : null,
          bewertung: a.bewertung || null
        })),
        waescher: waescherListe.sort((x, y) => y.erstellt.localeCompare(x.erstellt)).map(w => ({
          id: w.id, name: w.name, whatsapp: w.whatsapp, stadtteile: w.stadtteile, erstellt: w.erstellt, trockner: w.trockner, auto: w.auto,
          sterne: schnitt(w), anzahl: w.bewertungen?.anzahl || 0, gesperrt: gesperrt(w), gesperrtManuell: !!w.gesperrtManuell,
          aktiv: auftragsListe.filter(a => a.waescherId === w.id && a.status === "angenommen").length,
          erledigt: auftragsListe.filter(a => a.waescherId === w.id && a.status === "erledigt").length
        }))
      });
    }
    if (p[1] === "aktion") {
      const { art, id } = body;
      if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id)) return json(400, { error: "Ungültige Anfrage." });
      if (art === "auftrag-stornieren" || art === "auftrag-loeschen") {
        const a = await auftraege.get(id, { type: "json" });
        if (!a) return json(404, { error: "Diesen Auftrag gibt es nicht mehr." });
        if (art === "auftrag-loeschen") await auftraege.delete(id);
        else await auftraege.setJSON(id, { ...a, status: "storniert" });
        return json(200, { ok: true });
      }
      if (art === "waescher-sperren" || art === "waescher-entsperren" || art === "waescher-loeschen") {
        const w = await waescher.get(id, { type: "json" });
        if (!w) return json(404, { error: "Diesen Wäscher gibt es nicht mehr." });
        if (art === "waescher-loeschen") {
          for (const a of await alle(auftraege)) if (a.waescherId === id && a.status === "angenommen") await auftraege.setJSON(a.id, { ...a, status: "offen", waescherId: null });
          await waescher.delete(id);
          await zaehler.delete("login-" + sha(w.whatsapp));
        } else {
          await waescher.setJSON(id, { ...w, gesperrtManuell: art === "waescher-sperren" });
        }
        return json(200, { ok: true });
      }
      return json(400, { error: "Unbekannte Aktion." });
    }
    if (p[1] === "push") {
      const subscription = pruefeAbo(body.subscription);
      if (!subscription) return json(400, { error: "Dein Browser hat keine gültige Anmeldung geschickt." });
      const id = "admin-" + sha(subscription.endpoint);
      await abos.setJSON(id, { id, admin: true, subscription, stadtteile: [], erstellt: new Date().toISOString() });
      await pushSenden({ abos, zaehler }, [{ id, subscription }], { title: "Benachrichtigungen sind an", body: "Du bekommst ab jetzt Bescheid bei neuen Wäschern, Aufträgen und Bewertungen.", url: "/admin.html" }, senden).catch(() => {});
      return json(200, { ok: true });
    }
    if (p[1] === "mail") {
      const url = typeof body.url === "string" ? body.url.trim() : "";
      if (!MAIL_HOOK_MUSTER.test(url)) return json(400, { error: "Das sieht nicht nach einer Web-App-Adresse von Google Apps Script aus. Sie beginnt mit https://script.google.com/macros/s/ und endet mit /exec." });
      try { await mailSenden(url, "Test: E-Mail-Benachrichtigung ist an", "Ab jetzt bekommst du eine Mail bei neuen Wäschern, Aufträgen und Bewertungen."); }
      catch { return json(502, { error: "Die Test-Mail ging nicht raus. Prüfe, ob das Skript als Web-App für „Jeder“ bereitgestellt ist." }); }
      await zaehler.setJSON("admin", { ...admin, mailHook: url });
      return json(200, { ok: true });
    }
    if (p[1] === "mail-aus") {
      const { mailHook, ...rest } = admin;
      await zaehler.setJSON("admin", rest);
      return json(200, { ok: true });
    }
    if (p[1] === "push-status" || p[1] === "push-aus") {
      if (typeof body.endpoint !== "string") return json(400, { error: "Ungültige Anfrage." });
      const id = "admin-" + sha(body.endpoint);
      if (p[1] === "push-aus") { await abos.delete(id); return json(200, { ok: true }); }
      return json(200, { aktiv: !!(await abos.get(id, { type: "json" })) });
    }
    if (p[1] === "abmelden") {
      await zaehler.setJSON("admin", { ...admin, sitzungen: (admin.sitzungen || []).filter(h => h !== sha(body.sitzung)) });
      return json(200, { ok: true });
    }
    return json(404, { error: "Nicht gefunden." });
  }

  // POST /api/push/abo – Benachrichtigungen für Stadtteile anmelden oder ändern
  if (p.length === 2 && p[0] === "push" && p[1] === "abo") {
    const subscription = pruefeAbo(body.subscription);
    const stadtteile = Array.isArray(body.stadtteile) ? [...new Set(body.stadtteile.filter(x => STADTTEILE.includes(x)))] : [];
    if (!subscription) return json(400, { error: "Dein Browser hat keine gültige Anmeldung geschickt." });
    if (!stadtteile.length) return json(400, { error: "Bitte wähle mindestens einen Stadtteil." });
    const id = sha(subscription.endpoint);
    const vorhanden = await abos.get(id, { type: "json" });
    if (!vorhanden && !(await limit(zaehler, "abo", ip, ABOS_PRO_TAG))) return json(429, { error: "Zu viele Anmeldungen heute. Versuch es morgen wieder." });
    await abos.setJSON(id, { id, subscription, stadtteile, erstellt: vorhanden?.erstellt || new Date().toISOString() });
    return json(200, { ok: true, stadtteile });
  }
  // POST /api/push/status und /api/push/abmelden
  if (p.length === 2 && p[0] === "push" && (p[1] === "status" || p[1] === "abmelden")) {
    if (typeof body.endpoint !== "string") return json(400, { error: "Ungültige Anfrage." });
    const id = sha(body.endpoint);
    if (p[1] === "abmelden") { await abos.delete(id); return json(200, { ok: true }); }
    const a = await abos.get(id, { type: "json" });
    return json(200, { stadtteile: a ? a.stadtteile : [] });
  }

  // POST /api/auftraege – Kunde gibt Auftrag auf
  if (p.length === 1 && p[0] === "auftraege") {
    const { auftrag, error } = validateAuftrag(body);
    if (error) return json(400, { error });
    if (!(await limit(zaehler, "auftrag", ip, AUFTRAEGE_PRO_TAG))) return json(429, { error: "Du hast heute schon genug Aufträge aufgegeben. Versuch es morgen wieder." });
    const id = randomUUID(), secret = neuerCode(), kurz = kurzcode();
    await auftraege.setJSON(id, { ...auftrag, id, kurz, erstellt: new Date().toISOString(), status: "offen", codeHash: sha(secret), waescherId: null });
    try { await benachrichtigen({ abos, zaehler }, auftrag, senden); } catch {} // Push darf eine Buchung nie verhindern
    await adminInfo({ abos, zaehler }, `Neuer Auftrag: ${auftrag.stadtteil}`, `${(LEISTUNGEN[auftrag.leistung] || LEISTUNGEN.komplett).name}, ca. ${auftrag.kg} kg · ${datum(auftrag.termin)}, ${auftrag.zeitfenster} · ${eur(auftrag.preis)}`, senden);
    return json(201, { id, kurz, code: `${id}~${secret}`, preis: auftrag.preis });
  }

  // POST /api/auftraege/finden – Auftrag mit WhatsApp-Nummer und Auftragsnummer öffnen
  if (p.length === 2 && p[0] === "auftraege" && p[1] === "finden") {
    const nummer = normalizePhone(body.whatsapp);
    const kurz = typeof body.kurz === "string" ? body.kurz.trim().toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
    if (!nummer || kurz.length !== 6) return json(400, { error: "Bitte gib deine WhatsApp-Nummer und die 6-stellige Auftragsnummer ein." });
    if (!(await limit(zaehler, "finden", ip, FINDEN_PRO_TAG))) return json(429, { error: "Zu viele Versuche heute. Bitte versuch es morgen wieder." });
    const a = (await alle(auftraege)).find(x => x.kurz === kurz && x.whatsapp === nummer);
    if (!a) return json(404, { error: "Zu dieser Nummer gibt es keinen Auftrag." });
    const secret = neuerCode();
    await auftraege.setJSON(a.id, mitSitzung(a, secret));
    return json(200, { code: `${a.id}~${secret}` });
  }

  // POST /api/waescher – als Wäscher anmelden
  if (p.length === 1 && p[0] === "waescher") {
    const { waescher: w, error } = validateWaescher(body);
    if (error) return json(400, { error });
    if (!(await limit(zaehler, "waescher", ip, WAESCHER_PRO_TAG))) return json(429, { error: "Heute kamen schon genug Anmeldungen von diesem Anschluss. Versuch es morgen wieder." });
    const loginKey = "login-" + sha(w.whatsapp);
    const vorhanden = await zaehler.get(loginKey, { type: "json" });
    if (vorhanden && await waescher.get(vorhanden.id, { type: "json" })) return json(409, { error: "Mit dieser Nummer ist schon jemand angemeldet. Melde dich oben mit deinem Passwort an." });
    // Alte Profile ohne Passwort (aus der ersten Version) mit derselben Nummer ersetzen
    for (const alt of await alle(waescher)) if (!alt.passwortHash && alt.whatsapp === w.whatsapp) await waescher.delete(alt.id);
    const id = randomUUID(), secret = neuerCode();
    await waescher.setJSON(id, { ...w, id, erstellt: new Date().toISOString(), codeHash: sha(secret), passwortHash: passwortHash(body.passwort) });
    await zaehler.setJSON(loginKey, { id });
    await adminInfo({ abos, zaehler }, `Neuer Wäscher: ${w.name}`, `Holt ab in: ${w.stadtteile.join(", ")}${w.trockner ? " · mit Trockner" : ""}`, senden);
    return json(201, { id, code: `${id}~${secret}` });
  }

  // POST /api/waescher/login – mit WhatsApp-Nummer und Passwort
  if (p.length === 2 && p[0] === "waescher" && p[1] === "login") {
    const nummer = normalizePhone(body.whatsapp);
    if (!nummer || typeof body.passwort !== "string") return json(400, { error: "Bitte gib Nummer und Passwort ein." });
    const stunde = new Date().toISOString().slice(0, 13);
    const fehlerKey = `loginfehler-${sha(nummer + stunde)}`;
    const fehler = (await zaehler.get(fehlerKey, { type: "json" }))?.n || 0;
    if (fehler >= LOGIN_FEHLER_MAX) return json(429, { error: "Zu viele falsche Versuche. Bitte warte eine Stunde." });
    const eintrag = await zaehler.get("login-" + sha(nummer), { type: "json" });
    const w = eintrag ? await waescher.get(eintrag.id, { type: "json" }) : null;
    if (!w || !passwortOk(body.passwort, w.passwortHash)) {
      await zaehler.setJSON(fehlerKey, { n: fehler + 1 });
      return json(403, { error: "Nummer oder Passwort stimmt nicht." });
    }
    const secret = neuerCode();
    await waescher.setJSON(w.id, mitSitzung(w, secret));
    return json(200, { code: `${w.id}~${secret}` });
  }

  // POST /api/waescher/ich – eigenes Profil und angenommene Aufträge
  if (p.length === 2 && p[0] === "waescher" && p[1] === "ich") {
    const w = await waescherMitCode(waescher, body.code);
    if (!w) return json(403, { error: "Dieser Wäscher-Code ist ungültig." });
    const meine = (await alle(auftraege)).filter(a => a.waescherId === w.id && a.status === "angenommen")
      .sort((x, y) => x.termin.localeCompare(y.termin))
      .map(a => ({ ...oeffentlich(a), vorname: a.vorname, hinweis: a.hinweis, status: a.status }));
    return json(200, {
      name: w.name, stadtteile: w.stadtteile, trockner: w.trockner, auto: w.auto, auftraege: meine,
      sterne: schnitt(w), anzahl: w.bewertungen?.anzahl || 0, gesperrt: gesperrt(w), feedback: w.feedback || [],
      hatPasswort: !!w.passwortHash
    });
  }

  // POST /api/waescher/passwort – Passwort festlegen oder ändern (angemeldet)
  if (p.length === 2 && p[0] === "waescher" && p[1] === "passwort") {
    const w = await waescherMitCode(waescher, body.code);
    if (!w) return json(403, { error: "Bitte melde dich neu an." });
    if (typeof body.passwort !== "string" || body.passwort.length < 6 || body.passwort.length > 100) return json(400, { error: "Bitte wähle ein Passwort mit mindestens 6 Zeichen." });
    const loginKey = "login-" + sha(w.whatsapp);
    const vorhanden = await zaehler.get(loginKey, { type: "json" });
    if (vorhanden && vorhanden.id !== w.id && await waescher.get(vorhanden.id, { type: "json" })) return json(409, { error: "Mit dieser Nummer ist schon ein anderes Profil angemeldet." });
    await waescher.setJSON(w.id, { ...w, passwortHash: passwortHash(body.passwort) });
    await zaehler.setJSON(loginKey, { id: w.id });
    return json(200, { ok: true });
  }

  // POST /api/waescher/loeschen – Profil löschen, angenommene Aufträge werden wieder frei
  if (p.length === 2 && p[0] === "waescher" && p[1] === "loeschen") {
    const w = await waescherMitCode(waescher, body.code);
    if (!w) return json(403, { error: "Dieser Wäscher-Code ist ungültig." });
    for (const a of await alle(auftraege)) {
      if (a.waescherId === w.id && a.status === "angenommen") await auftraege.setJSON(a.id, { ...a, status: "offen", waescherId: null });
    }
    await waescher.delete(w.id);
    await zaehler.delete("login-" + sha(w.whatsapp));
    return json(200, { ok: true });
  }

  // POST /api/auftraege/:id/<aktion>
  if (p.length === 3 && p[0] === "auftraege") {
    const [, id, aktion] = p;
    const a = /^[0-9a-f-]{36}$/.test(id) ? await auftraege.get(id, { type: "json" }) : null;
    if (!a) return json(404, { error: "Diesen Auftrag gibt es nicht mehr." });
    const status = effektiv(a);
    const kc = parseCode(body.code);
    const istKunde = !!kc && kc.id === id && codePasst(a, kc.secret);

    if (aktion === "status") {
      if (!istKunde) return json(403, { error: "Dieser Auftragscode ist ungültig." });
      const w = a.waescherId ? await waescher.get(a.waescherId, { type: "json" }) : null;
      return json(200, {
        ...oeffentlich(a), kurz: a.kurz || null, status, bewertung: a.bewertung ? { sterne: a.bewertung.sterne } : null, kannBewerten: kannBewerten(a, status),
        waescher: w ? { name: w.name, sterne: schnitt(w), anzahl: w.bewertungen?.anzahl || 0 } : null
      });
    }
    // Kunde bewertet den Wäscher, einmal pro Auftrag
    if (aktion === "bewerten") {
      if (!istKunde) return json(403, { error: "Dieser Auftragscode ist ungültig." });
      if (!kannBewerten(a, status)) return json(409, { error: a.bewertung ? "Du hast diesen Auftrag schon bewertet." : "Bewerten geht erst nach dem Termin." });
      const sterne = Number(body.sterne);
      if (!Number.isInteger(sterne) || sterne < 1 || sterne > 5) return json(400, { error: "Bitte wähle 1 bis 5 Sterne." });
      const kommentar = text(body.kommentar, 300);
      const bewertung = { sterne, kommentar, datum: heute() };
      await auftraege.setJSON(id, { ...a, status: "erledigt", erledigt: a.erledigt || new Date().toISOString(), bewertung });
      const w = await waescher.get(a.waescherId, { type: "json" });
      if (w) {
        const b = w.bewertungen || { summe: 0, anzahl: 0 };
        const feedback = [{ sterne, kommentar, datum: bewertung.datum }, ...(w.feedback || [])].slice(0, FEEDBACK_MAX);
        await waescher.setJSON(w.id, { ...w, bewertungen: { summe: b.summe + sterne, anzahl: b.anzahl + 1 }, feedback });
      }
      await adminInfo({ abos, zaehler }, `Neue Bewertung: ${"★".repeat(sterne)}${"☆".repeat(5 - sterne)}`, `Für ${w?.name || "einen Wäscher"}${kommentar ? `: „${kommentar}“` : ""}`, senden);
      return json(200, { ok: true });
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
        : `Hallo ${a.vorname}, ich bin ${w.name} von Dortmund wäscht und habe deinen Auftrag angenommen (${(LEISTUNGEN[a.leistung] || LEISTUNGEN.komplett).name}): Ich hole ${datum(a.termin)}, ${a.zeitfenster} ab, ca. ${a.kg} kg. Schickst du mir noch deine Adresse?`;
      return json(200, { link: waLink(a.whatsapp, nachricht) });
    }

    // Ab hier nur für angemeldete Wäscher
    const w = await waescherMitCode(waescher, body.waescherCode);
    if (!w) return json(403, { error: "Bitte melde dich zuerst als Wäscherin oder Wäscher an." });

    if (aktion === "annehmen") {
      if (gesperrt(w)) return json(403, { error: w.gesperrtManuell ? "Dein Profil ist gerade gesperrt. Schreib uns, wenn du Fragen hast." : "Wegen zu vieler schlechter Bewertungen kannst du gerade keine neuen Aufträge annehmen. Schreib uns, wenn du Fragen hast." });
      if (status !== "offen") return json(409, { error: "Diesen Auftrag hat schon jemand anderes angenommen." });
      if (brauchtTrockner(a) && !w.trockner) return json(409, { error: "Für diesen Express-Auftrag brauchst du einen Trockner, sonst wird die Wäsche heute nicht trocken." });
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
  abos: getStore({ name: "abos", consistency: "strong" }),
  auftraege: getStore({ name: "auftraege", consistency: "strong" }),
  waescher: getStore({ name: "waescher", consistency: "strong" }),
  zaehler: getStore({ name: "zaehler", consistency: "strong" })
});

export const config = { path: "/api/*" };
