# Dortmund wäscht

Wäsche-Service aus der Nachbarschaft in Dortmund. Kunden buchen eine Abholung, Wäscher aus dem Viertel nehmen den Auftrag an, waschen, falten und bringen zurück.

## Online stellen (einmalig, ca. 5 Minuten)

1. Bei https://app.netlify.com anmelden (mit demselben Konto wie fürs WC-Gästebuch).
2. **Add new site** → **Import an existing project** → **GitHub** → dieses Repository `dortmund-waescht` auswählen.
3. Nichts ändern, einfach **Deploy** klicken. Die Einstellungen stehen schon in `netlify.toml`.
4. Unter **Site configuration** → **Change site name** den Namen ändern, z. B. `dortmund-waescht`.
   Die Seite ist dann unter `https://dortmund-waescht.netlify.app` erreichbar.

Die Anzeigen werden im Speicher von Netlify gespeichert (Netlify Blobs). Ein weiteres Konto brauchst du nicht.

## Wie es läuft

- Kunden buchen eine Abholung: Menge (S/M/L/XL), Standard oder Express, Tag und Uhrzeit. Preis: 2,50 €/kg, Express 4 €/kg, mindestens 15 €.
- Wäscher melden sich einmal an und nehmen offene Aufträge an (höchstens 3 gleichzeitig).
- Erst nach der Annahme bekommen beide per Knopfdruck den WhatsApp-Kontakt zueinander. Nummern sind nie öffentlich.
- Bezahlt wird bei der Rückgabe direkt an den Wäscher. Die Plattform nimmt (noch) kein Geld.
- Aufträge werden 30 Tage nach dem Abholtag automatisch gelöscht.
- Spam-Schutz: höchstens 3 Aufträge und 3 Wäscher-Anmeldungen pro Internetanschluss und Tag.

## Zahlen ansehen

`https://dortmund-waescht.netlify.app/api/statistik` zeigt Wäscher, Aufträge nach Status und den Umsatz erledigter Aufträge.

Preise ändern: in `netlify/functions/api.mjs` (`PREIS`) und in `public/index.html` (`PREIS`) gleich setzen.

## Dateien

- `public/index.html`: die Webseite
- `netlify/functions/api.mjs`: der Server-Teil (Aufträge, Wäscher, Kontakt)
- `netlify.toml`, `package.json`: Einstellungen für Netlify

## Vor dem Start

Ein Impressum und eine Datenschutzerklärung sind Pflicht, bevor die Seite öffentlich beworben wird.
