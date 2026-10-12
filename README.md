# Dortmund wäscht

Vermittlungs-Plattform für Waschmaschinen in Dortmund. Anbieter stellen ihre Maschine oder einen Wäsche-Service ein, Kunden finden sie und fragen per WhatsApp an.

## Online stellen (einmalig, ca. 5 Minuten)

1. Bei https://app.netlify.com anmelden (mit demselben Konto wie fürs WC-Gästebuch).
2. **Add new site** → **Import an existing project** → **GitHub** → dieses Repository `dortmund-waescht` auswählen.
3. Nichts ändern, einfach **Deploy** klicken. Die Einstellungen stehen schon in `netlify.toml`.
4. Unter **Site configuration** → **Change site name** den Namen ändern, z. B. `dortmund-waescht`.
   Die Seite ist dann unter `https://dortmund-waescht.netlify.app` erreichbar.

Die Anzeigen werden im Speicher von Netlify gespeichert (Netlify Blobs). Ein weiteres Konto brauchst du nicht.

## Wie es läuft

- Anbieter erstellen Anzeigen ohne Konto und bekommen einen Löschcode.
- Kunden schreiben den Anbietern direkt per WhatsApp. Termine und Bezahlung laufen zwischen ihnen.
- Pro Internetanschluss gehen höchstens 5 neue Anzeigen am Tag.
- Wird eine Anzeige von 3 verschiedenen Leuten gemeldet, blendet die Seite sie automatisch aus.

## Zahlen ansehen

`https://<deine-seite>.netlify.app/api/statistik` zeigt:
- wie viele Anzeigen online sind,
- wie viele ausgeblendet wurden,
- wie oft Kunden auf „Per WhatsApp anfragen“ getippt haben,
- wie viele Anzeigen es pro Stadtteil gibt.

Einzelne Anzeigen siehst und löschst du in Netlify unter **Blobs** → `anzeigen`.

## Dateien

- `public/index.html`: die Webseite
- `netlify/functions/api.mjs`: der Server-Teil (Anzeigen speichern, löschen, melden)
- `netlify.toml`, `package.json`: Einstellungen für Netlify

## Vor dem Start

Ein Impressum und eine Datenschutzerklärung sind Pflicht, bevor die Seite öffentlich beworben wird.
