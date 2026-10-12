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

- Kunden schätzen die Menge per Schieberegler (3–25 kg). Preis: 2,50 €/kg, Express +1,50 €/kg, Mindestbestellwert 15 €, dazu 4 € Pauschale, wenn der Wäscher abholt und zurückbringt (Kunden können auch selbst bringen). Abgerechnet wird nach exaktem Wiegen bei der Übergabe.
- Vor dem Absenden bestätigen Kunden eine Checkliste (nichts Empfindliches, Taschen leer) und bekommen Tipps zu Übergabefoto und Haftung.
- Wäscher können Push-Benachrichtigungen für ihre Stadtteile aktivieren und bekommen bei jedem neuen Auftrag dort eine Nachricht aufs Handy.
- Wäscher registrieren sich mit WhatsApp-Nummer und Passwort und nehmen offene Aufträge an (höchstens 3 gleichzeitig). Nach 5 falschen Passwörtern ist die Nummer eine Stunde gesperrt.
- Kunden finden ihre Aufträge mit WhatsApp-Nummer und 6-stelliger Auftragsnummer.
- Erst nach der Annahme bekommen beide per Knopfdruck den WhatsApp-Kontakt zueinander. Nummern sind nie öffentlich.
- Bezahlt wird bei der Rückgabe direkt an den Wäscher. Die Plattform nimmt (noch) kein Geld.
- Kunden bewerten ihren Wäscher mit 1–5 Sternen. Ab 3 Bewertungen mit Schnitt unter 3 Sternen kann der Wäscher keine neuen Aufträge annehmen. Kommentare sieht nur der Wäscher.
- Aufträge werden 30 Tage nach dem Abholtag automatisch gelöscht.
- Spam-Schutz: höchstens 3 Aufträge und 3 Wäscher-Anmeldungen pro Internetanschluss und Tag.

## Zahlen ansehen

`https://dortmund-waescht.netlify.app/api/statistik` zeigt Wäscher, Aufträge nach Status und den Umsatz erledigter Aufträge.

Preise ändern: in `netlify/functions/api.mjs` (`PREIS`) und in `public/index.html` (`PREIS`) gleich setzen.

Die Schlüssel für Push-Benachrichtigungen erzeugt der Server beim ersten Aufruf selbst und speichert sie in Netlify Blobs. Es muss nichts eingerichtet werden.

## Dateien

- `public/index.html`: die Webseite
- `netlify/functions/api.mjs`: der Server-Teil (Aufträge, Wäscher, Kontakt)
- `netlify.toml`, `package.json`: Einstellungen für Netlify

## Vor dem Start

Ein Impressum und eine Datenschutzerklärung sind Pflicht, bevor die Seite öffentlich beworben wird.
