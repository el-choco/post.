# 📅 Kalender / Calendars — post. 1.2.2

## Deutsch

Der neue Bereich **Kalender** funktioniert unabhängig vom Mailkonto. Die Anmeldung an der Webmail bleibt bei E-Mail und Passwort/App-Passwort; Kalender-OAuth ersetzt sie nicht.

### Sofort nutzbar

- Persönlicher Kalender und zusätzliche lokale Kalender in SQLite, automatisch angelegt.
- Monats-, Wochen- und Terminlistenansicht; mehrere Kalender mit eigenen Farben und Sichtbarkeit.
- Termine erstellen, bearbeiten und löschen; ganztägige und mehrtägige Termine, Ort und Notizen.
- In der Monats- oder Wochenansicht auf eine freie Fläche im Tagesfeld klicken: Das Termin-Popup übernimmt das Datum. Auch „Neuer Termin“ und bestehende Termine öffnen dieses Popup. Mit Abbrechen, Schließen oder Escape schließen; Speichern legt den Termin im ausgewählten Kalender an.
- Lokale Terminserien: täglich, wöchentlich, monatlich und jährlich. Änderungen und Löschen gelten für die ganze Serie und werden entsprechend angezeigt.
- ICS-Dateien in lokale Kalender importieren und vollständige lokale Kalender exportieren. Bestehende UIDs werden beim Import übersprungen. ICS-Abonnements sind schreibgeschützt.
- Kalenderdaten sind pro Webmail-Konto getrennt. Zugangsdaten und OAuth-Tokens werden mit dem bestehenden Schlüssel im Datenvolume verschlüsselt.

### CalDAV

**Kalender hinzufügen → CalDAV**: Name, HTTPS-Kalenderadresse, Benutzername und Passwort/App-Passwort eingeben. Verwende die offizielle CalDAV-Adresse deines Anbieters; die IMAP-Adresse eignet sich nicht dafür. Es werden die vom Server gefundenen VEVENT-Kalender hinzugefügt.

Die Verbindung unterstützt Erstellen, Bearbeiten und Löschen beim Anbieter. Schreibgeschützte Kalender werden entsprechend angezeigt. Bei CalDAV-Serien bearbeitest/löschst du die gesamte Serie; vorhandene Ausnahmen und Zusatzinformationen bleiben beim Bearbeiten erhalten. Teilnehmerlisten und Einladungen werden beim Anbieter verwaltet.

Interne Adressen werden standardmäßig blockiert. Für einen eigenen Nextcloud-/CalDAV-Server im LAN kannst du ausdrücklich `ALLOW_PRIVATE_CALDAV=true` im Stack setzen. Damit werden für Kalenderverbindungen auch interne Adressen und HTTP erlaubt; Zugangsdaten sollten trotzdem nur über HTTPS übertragen werden.

### Google und Microsoft einmalig konfigurieren

Diese Verbindungen sind optional. Ohne OAuth-Konfiguration funktionieren lokale Kalender, CalDAV und ICS weiterhin.

Für eine echte Serverinstallation benötigst du eine öffentliche **HTTPS-Adresse mit Domain** (zum Beispiel hinter einem Reverse Proxy). Eine HTTP-IP-Adresse genügt für diese OAuth-Konfiguration nicht. Für lokale Entwicklung wird `http://localhost:PORT` unterstützt.

**Direkt in der Webmail:** Wähle **Kalender hinzufügen → Google Kalender / Outlook → Kalender verbinden**. Im Kalenderbereich erscheint das Formular für Webmail-Adresse, Client-ID und Client-Secret (bei Microsoft zusätzlich Tenant-ID). Die Rücksprungadresse wird automatisch angezeigt; trage sie exakt beim OAuth-Client des Anbieters ein. Speichern führt bei passender Webmail-Adresse anschließend zur Anmeldung beim Anbieter. Eine Portainer-Änderung oder ein Backend-Neustart ist für diese Eingaben nicht erforderlich.

Die Daten gelten nur für das angemeldete Postfach und bleiben verschlüsselt in SQLite erhalten. Das Secret wird beim erneuten Öffnen nicht zurückgegeben; bei unveränderter Client-ID kann das Feld leer bleiben. Bei Änderung der Client-ID muss auch ein neues Secret eingegeben werden. Bereits verbundene Kalender behalten ihre ursprüngliche Client-Konfiguration, auch beim automatischen Token-Refresh.

**Bei Zugriff über eine IP-Adresse:** Für Google zuerst eine HTTPS-Domain einrichten. Google akzeptiert normale IP-Adressen auch mit HTTPS nicht als Redirect-URI; localhost ist eine Ausnahme für Entwicklung. Das Formular weist darauf hin. Du kannst eine zukünftige HTTPS-Adresse hinterlegen, musst die Webmail zur Verbindung aber unter dieser Adresse öffnen und dich dort anmelden. OAuth-Daten ersetzen weder die Registrierung einer Anwendung beim Anbieter noch eine gültige Rücksprungadresse.

Alternativ können Betreiber weiterhin folgende Vorgaben in einer privaten `.env` neben Compose oder in den Portainer-Stack-Umgebungsvariablen setzen. Persönliche Formular-Einstellungen haben Vorrang. Client-Secrets niemals in GitHub, öffentliche Compose-Dateien oder Frontend-Code schreiben.

```dotenv
PUBLIC_BASE_URL=https://webmail.example.org
GOOGLE_CLIENT_ID=deine-client-id
GOOGLE_CLIENT_SECRET=dein-client-secret
MICROSOFT_CLIENT_ID=deine-client-id
MICROSOFT_CLIENT_SECRET=dein-client-secret
MICROSOFT_TENANT_ID=common
```

**Google:**

1. Ein Projekt in der [Google Cloud Console](https://console.cloud.google.com/) anlegen und die Google Calendar API aktivieren.
2. OAuth-Zustimmungsseite konfigurieren. Für Testbetrieb die gewünschten Google-Konten als Testnutzer eintragen.
3. Einen OAuth-Client vom Typ **Webanwendung** anlegen.
4. Diese exakte autorisierte Weiterleitungsadresse eintragen:

   `https://webmail.example.org/api/calendar/oauth/google/callback`

5. In der Webmail **Kalender hinzufügen → Google Kalender → Kalender verbinden** wählen und Client-ID, Client-Secret und Webmail-Adresse eingeben.
6. Die Einrichtung speichern und den Zugriff bei Google erlauben.

Verwendete Berechtigungen: `calendar.events` und `calendar.calendarlist.readonly`. Es wird kein Gmail-Zugriff angefordert. Bei Google-Apps im externen Testmodus können Refresh-Tokens nach sieben Tagen ablaufen. Für dauerhafte bzw. öffentliche Nutzung die Veröffentlichungs- und Verifikationsvorgaben von Google beachten.

**Microsoft:**

1. Im [Microsoft Entra Admin Center](https://entra.microsoft.com/) eine App registrieren.
2. Für Outlook.com und verschiedene Microsoft-365-Mandanten den Kontotyp **Organisationsverzeichnisse und persönliche Microsoft-Konten** wählen; `MICROSOFT_TENANT_ID=common` verwenden. Bei einer mandantengebundenen App stattdessen die Tenant-ID konfigurieren.
3. Als Plattform **Web** diese Weiterleitungsadresse eintragen:

   `https://webmail.example.org/api/calendar/oauth/microsoft/callback`

4. Delegierte Graph-Berechtigung **Calendars.ReadWrite** konfigurieren; die Anwendung fordert außerdem `offline_access` an.
5. Client-Secret erzeugen und dessen **Wert**, nicht die Secret-ID, zusammen mit der Application/Client-ID im OAuth-Formular der Webmail eingeben.
6. In der Webmail **Kalender hinzufügen → Outlook / Microsoft 365 → Kalender verbinden** wählen, die Einrichtung speichern und den Zugriff bei Microsoft erlauben. Organisationsrichtlinien können Administratorzustimmung erfordern.

Bei Google/Microsoft zeigt die Webmail einzelne Vorkommen bestehender Serien. Änderungen und Löschen gelten für dieses Vorkommen. Neue externe Serien und Teilnehmerlisten werden zunächst beim Anbieter erstellt. Name/Farbe in der Webmail ändern nur die lokale Anzeige.

### Synchronisation und Daten

Sichtbare Kalender werden beim Öffnen, manuell über Aktualisieren und alle 60 Sekunden bei geöffneter Kalenderseite geladen. Änderungen werden direkt beim Anbieter gespeichert. Es handelt sich nicht um einen dauerhaft laufenden Hintergrund-Sync oder Push-Dienst. Bei Fehlern eines Anbieters bleiben andere Kalender verwendbar. Konflikte werden gemeldet; aktuelle Termine neu öffnen, statt ältere Daten zu überschreiben.

**Verbindung entfernen** entfernt nur die zugehörige Verbindung und Anzeige aus der Webmail. Externe Termine bleiben erhalten. **Termin löschen** in einem externen Kalender löscht dagegen den Termin beim Anbieter. Ein lokaler Kalender wird mit seinen Terminen gelöscht; der persönliche Standardkalender bleibt bestehen.

Bewahre das bestehende Datenvolume einschließlich `webmail.db` und `secret.key` auf. Die neuen Tabellen werden automatisch ergänzt. Ein lokaler SQLite-Kalender allein bietet keine Handy-Synchronisierung; dafür wäre später ein eigener CalDAV-Server nötig.

Die Demo speichert einfache lokale Termine im Browser. Externe Verbindungen, Terminserien und ICS-Dateien benötigen ein angemeldetes Postfach.

## English

The **Calendar** workspace is independent of your mail account. Webmail still uses email and password/app-password sign-in; calendar OAuth does not replace that login.

### Available immediately

- Automatically provisioned personal SQLite calendar and additional local calendars.
- Month, week and agenda views; calendar colors and visibility controls.
- Create, edit and delete events, including all-day/multi-day events, location and notes.
- Click an empty area in a day cell in month or week view to open the event popup with that date selected. New event and existing events also open the popup. Cancel, Close or Escape dismiss it; Save writes to the selected calendar.
- Daily, weekly, monthly and yearly local recurring events. Local and CalDAV series edits/deletions apply to the entire series.
- Import ICS into local calendars and export their complete contents. Existing UIDs are skipped. ICS subscriptions are read-only.
- Calendar data is isolated per webmail account. Credentials and OAuth tokens are encrypted using the existing key in the data volume.

### CalDAV

Choose **Add calendar → CalDAV**, and enter the provider's HTTPS CalDAV/calendar-home URL, username and password/app password. Use the provider's calendar URL, not its IMAP hostname. Discovered VEVENT calendars are added automatically.

The integration reads and writes events at the provider, respects reported read-only privileges and checks revision conflicts. CalDAV series edits/deletions apply to the whole series; existing exceptions and additional properties are retained. Manage attendees and invitations at the provider.

Private/internal destinations are blocked by default. Set `ALLOW_PRIVATE_CALDAV=true` only if users should connect internal calendar services. This also permits HTTP for internal installations; continue using HTTPS for credentials.

### Optional Google and Microsoft setup

Configure a public **HTTPS domain** for server installations. HTTP with an IP address is insufficient for this OAuth configuration; `http://localhost:PORT` is supported for local development.

Choose **Add calendar → Google / Outlook → Connect calendar**. Enter the webmail address, client ID and client secret directly in the calendar workspace (plus tenant ID for Microsoft). Register the displayed redirect URI exactly with the provider. Saving starts provider authorization when the current webmail origin matches the configured address. No Portainer change or backend restart is needed for these form settings.

Settings are isolated per mailbox and encrypted in SQLite. The secret is never returned to the browser; leave it blank to retain it for an unchanged client ID. Changing the client ID requires a new secret. Existing connections retain their original OAuth client for callbacks and token refresh.

Google does not accept ordinary IP addresses as web redirect URIs, even with HTTPS. Configure an HTTPS domain first; localhost is an exception for development. You can save a future HTTPS domain but must open webmail and sign in at that domain before connecting. Provider application registration is still required.

Operator environment defaults (`PUBLIC_BASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`) remain supported; personal form settings take precedence. Never publish secrets.

**Google:** Enable Calendar API in your Cloud project, configure the consent screen and create a **Web application** OAuth client. Add the exact redirect URI:

`https://webmail.example.org/api/calendar/oauth/google/callback`

The app requests `calendar.events` and `calendar.calendarlist.readonly`, not Gmail access. Add test users during testing. External testing-mode refresh tokens may expire after seven days; follow Google's publishing and verification requirements for long-term/public use.

**Microsoft:** Register a Web app in Entra. For Outlook.com and Microsoft 365 across organizations, enable organizational and personal Microsoft accounts and use tenant `common`. Configure delegated Graph `Calendars.ReadWrite`; the app also requests `offline_access`. Configure this exact redirect URI:

`https://webmail.example.org/api/calendar/oauth/microsoft/callback`

Set the Application/Client ID and the client-secret **value**, not its ID. Organizational policies may require administrator consent.

Users connect calendars from **Add calendar → Google / Outlook**. Google/Microsoft recurring events are shown as individual occurrences and edited/deleted as such. Create new external series and manage attendees at the provider. Webmail names/colors affect display only.

### Sync and persistence

Visible calendars refresh on opening, manually, and every 60 seconds while the calendar page is open. Writes go directly to the provider. This is not an always-running background/push sync. A provider failure does not prevent other calendars from loading.

Removing a connection keeps events at the provider. Deleting an external event deletes it at the provider. Preserve the existing volume with `webmail.db` and `secret.key`; schema additions are automatic. The local SQLite calendar does not itself provide phone synchronization; that would require a CalDAV server later.

Demo mode supports simple local events in browser storage. External connections, ICS files and recurring events require a signed-in mailbox.
