# 📅 post. Webmail 1.2.2

## Deutsch

In der Monats- und Wochenansicht öffnet ein Klick auf eine freie Fläche im Tagesfeld die Terminerstellung als Popup mit vorausgewähltem Datum. „Neuer Termin“ und bestehende Termine verwenden ebenfalls das Popup. Abbrechen, Schließen und Escape schließen es; Fehler beim Speichern werden direkt im Popup angezeigt. Die bestehende Synchronisation mit dem ausgewählten Kalender bleibt erhalten.

Die Dateien im Projektordner und in `post-webmail-1.2.2.zip` enthalten denselben Stand. Den Inhalt des Archivs in den vorhandenen Server-Projektordner übertragen. `.env`, Datenvolume, Datenbank und `secret.key` beibehalten. Die Änderung benötigt keine Datenbankmigration. Beide Pakete tragen zur eindeutigen Veröffentlichung die Version 1.2.2; der Backend-Funktionsumfang ist unverändert.

### Bauen und prüfen

```bash
cd /mnt/seagate/webmail &&
docker build --pull -t paquele/post-webmail-frontend:1.2.2 -t paquele/post-webmail-frontend:latest ./frontend &&
docker build --pull -t paquele/post-webmail-backend:1.2.2 -t paquele/post-webmail-backend:latest ./backend

docker run --rm --entrypoint cat paquele/post-webmail-frontend:1.2.2 /usr/share/nginx/html/version.json
docker run --rm --entrypoint node paquele/post-webmail-backend:1.2.2 -p 'require("./package.json").version'
```

Erst nach erfolgreichen Builds und der Anzeige **1.2.2** veröffentlichen:

```bash
docker login --username paquele &&
docker push paquele/post-webmail-frontend:1.2.2 &&
docker push paquele/post-webmail-backend:1.2.2 &&
docker push paquele/post-webmail-frontend:latest &&
docker push paquele/post-webmail-backend:latest
```

### Installation aktualisieren

In Portainer `WEBMAIL_VERSION=1.2.2` einstellen und den Stack mit erneutem Herunterladen der Images aktualisieren. Bisherigen Port und das Datenvolume beibehalten. Alternativ in der vorhandenen `.env` die Version auf 1.2.2 setzen und aus dem Projektverzeichnis ausführen:

```bash
docker compose pull && docker compose up -d
```

Anschließend im Browser **STRG + F5**. Die Images müssen vom Betreiber gebaut und veröffentlicht werden; dieses Quellcodepaket veröffentlicht sie nicht automatisch.

## English

Click an empty area within a day cell in month or week view to open the event popup with that date selected. The New event button and existing events use the same popup. Cancel, Close and Escape dismiss it. Save errors appear inside the popup. Events continue to sync with the selected calendar.

The project directory and `post-webmail-1.2.2.zip` contain the same source. Upload the archive's contents into your existing server project while preserving `.env`, the data volume, database and `secret.key`. No database migration is needed. Both packages use version 1.2.2 for publishing; backend functionality is unchanged.

Build and verify both images using the commands above, then log in and push only after both checks show 1.2.2. Set `WEBMAIL_VERSION=1.2.2` in Portainer and update the existing stack while pulling the images again, or change the version in `.env` and run `docker compose pull && docker compose up -d`. Preserve the existing port and volume. Reload with **CTRL + F5**. Publishing requires the operator to build and push the images.
