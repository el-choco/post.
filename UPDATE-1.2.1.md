# 📅 post. Webmail 1.2.1 veröffentlichen

Für die OAuth-Eingabe im Kalender müssen **Frontend und Backend** neu gebaut werden. Die Compose-Datei enthält nun ausdrücklich den Netzwerk-Alias `backend`; diese Änderung im vorhandenen Portainer-Stack übernehmen. Die aktualisierte Compose-Datei enthält die optionalen Kalender-Umgebungsvariablen. Deren Einrichtung ist in [CALENDAR.md](CALENDAR.md) beschrieben.

## Projektdateien hochladen

Den Inhalt von `post-webmail-1.2.1.zip` direkt in den Projektordner übertragen. Dort müssen `frontend`, `backend` und `docker-compose.yml` liegen. Bestehende `.env`, Datenordner, Docker-Volumes und `secret.key` beibehalten. Die neuen Datenbanktabellen werden automatisch ergänzt. Vor dem Update die vorhandenen Daten sichern.

## Bauen und Version prüfen

```bash
cd /mnt/seagate/webmail

docker build --pull -t paquele/post-webmail-frontend:1.2.1 -t paquele/post-webmail-frontend:latest ./frontend
docker build --pull -t paquele/post-webmail-backend:1.2.1 -t paquele/post-webmail-backend:latest ./backend

docker run --rm --entrypoint cat paquele/post-webmail-frontend:1.2.1 /usr/share/nginx/html/version.json
docker run --rm --entrypoint node paquele/post-webmail-backend:1.2.1 -p 'require("./package.json").version'
```

Beide Builds müssen erfolgreich sein und die Kontrollen Version **1.2.1** zeigen. Die Kontrollbefehle starten keine Webmail und verwenden kein Datenvolume.

## Veröffentlichen

```bash
docker login --username paquele

docker push paquele/post-webmail-frontend:1.2.1
docker push paquele/post-webmail-backend:1.2.1
docker push paquele/post-webmail-frontend:latest
docker push paquele/post-webmail-backend:latest
```

Den Docker-Hub-Zugriffstoken interaktiv bei der Anmeldung eingeben.

## Installation aktualisieren

In einer vorhandenen `.env` `WEBMAIL_VERSION=1.2.1` oder `WEBMAIL_VERSION=latest` einstellen. Port und Datenverzeichnis beibehalten. Dann:

```bash
docker compose pull
docker compose up -d
docker compose ps
```

In Portainer die aktualisierte Compose-Datei verwenden, den bisherigen Port (z. B. `33411`) und die Volume-Zuordnung beibehalten und bei der Stack-Aktualisierung beide Images erneut herunterladen. Keine Datenvolumes löschen. Anschließend **STRG + F5**.

Lokale Kalender sind sofort verfügbar. Für Google/Microsoft eine HTTPS-Domain und einen registrierten OAuth-Client bereitstellen. Client-ID und Client-Secret können direkt im Kalender eingegeben werden (siehe CALENDAR.md). Die Kalender-OAuth-Anbindung ersetzt nicht die bestehende Mailanmeldung.

## English

Upload the archive's contents into the existing project directory while preserving `.env`, data and `secret.key`. Build **both** images using the commands above, verify version `1.2.1`, then push the versioned and `latest` tags.

Set `WEBMAIL_VERSION=1.2.1` or `latest` and run `docker compose pull` followed by `docker compose up -d`. In Portainer, apply the updated Compose file, preserve the existing port/volume configuration and pull both images again. Reload with **CTRL + F5**.

Local calendars work immediately. Enter Google/Microsoft OAuth credentials directly in the calendar workspace and register the HTTPS callback URLs as documented in CALENDAR.md. Apply the explicit backend network alias in your existing stack. Calendar OAuth does not replace webmail sign-in.
