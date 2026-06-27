# Pakettracking Scraping Research

> **Scope-Hinweis:** Reine Quellen-Recherche. Kein Lösungsdesign, keine Architektur, keine Umgehung von Captcha/Bot-Detection/2FA. Endpoints und Payloads werden ausschließlich so dokumentiert, wie sie in den untersuchten Quellen stehen. Nicht gefundene Details sind als **nicht gefunden** markiert. Faktebene vs. Interpretation/Vermutung ist gekennzeichnet.
>
> **Zugriffsstand der Recherche:** 2026-06-27. Quellen-Stände (letzter Commit/Release) sind je Quelle vermerkt.

---

## Executive Summary

Die zentrale Trennlinie für „funktioniert wirklich" ist **login-frei vs. login-pflichtig**, nicht der Carrier. **Login-freie Trackingnummer-Abfragen** (DHL öffentlich/offizielle API, DPD, GLS) sind robust und wartungsarm. **Login-/Account-Scraping** (DHL App-Kontext, Hermes, Amazon) baut einen fragilen Session-/MFA-/Captcha-Automaten nach, der bei jedem UI- oder Login-Redesign bricht — sichtbar an der Issue-Last und den wiederkehrenden „fix login"-Changelog-Einträgen von `TA2k/ioBroker.parcel`.

- **Stabilste Quelle insgesamt:** DHL **Shipment Tracking – Unified** (offizielle API, Key + Trackingcode) — kein Scraping nötig, kein UI-Bruchrisiko.
- **Solide login-frei:** DPD und GLS über die öffentlichen Trackingseiten; dahinter liegt jeweils ein client-seitiger **JSON-Endpoint**, der gegenüber HTML-Selektoren weniger schnell bricht (selbst zu verifizieren, s. Abschnitt 11).
- **Bedingt machbar:** Hermes — öffentliche TN-Abfrage in den Repos nicht dokumentiert; nur App-API mit Login belegt. Eigene Verifikation erforderlich.
- **Höchstes Risiko:** Amazon — kein Trackingnummern-Modell (17-stellige **Bestellnummer** + eingeloggter Account), Captcha/MFA/SMS/WhatsApp; die Referenzimplementierung (`ayyybe/amazon-track`) ist archiviert und rät selbst explizit ab.
- **Veraltung beachten:** Pure-Scraper `sauladam/shipment-tracker` (Release Dez 2020) und `Ephigenia/track-parcel` (archiviert Dez 2022) liefern brauchbare Muster, aber ihre Selektoren/Endpoints sind nicht mehr verlässlich aktuell.

---

## 1. Kurzfazit

| Anbieter | Technisch per Trackingnummer abfragbar? | Account/Login nötig? | Inoffizielle Endpoints gefunden? | Scraping-Komplexität | Implementierungsrisiko |
|---|---:|---:|---:|---|---|
| DHL | Ja | Teilweise (öffentl. ohne Login; Account-/App-Kontext mit Login) | Ja | Mittel | Mittel–Hoch |
| Hermes | Unklar (in TA2k nur Account-Kontext) | Ja (in TA2k) | Ja (Mobile-App-API) | Mittel | Mittel |
| DPD | Ja (öffentl. Trackingseite, sauladam/Ephigenia) | Teilweise (Account-Liste mit Login) | Ja (my.dpd.de Account) | Mittel | Mittel |
| GLS | Ja (öffentl. Trackingseite, sauladam) | Teilweise (Account-Liste mit Login) | Ja (gls-one.de App-API) | Mittel | Mittel |
| Amazon | Nein (Bestellnummer, kein klassisches TN-Tracking) | Ja (eingeloggter Account) | Ja (HTML order-history Scraping) | Hoch | Hoch |

**Wichtigste Erkenntnisse (max. 5):**

- **Zwei grundverschiedene Abfragemodelle** existieren in den Quellen: (a) *öffentliche Trackingnummer-Abfrage* ohne Login (sauladam/shipment-tracker, Ephigenia/track-parcel scrapen öffentliche Trackingseiten), und (b) *Account-/App-Scraping* mit Login, das die **gesamte Paketliste eines Kontos** ohne einzelne Trackingnummer liefert (TA2k/ioBroker.parcel für DHL, DPD, GLS, Hermes, Amazon).
- **Amazon ist strukturell anders**: kein klassisches Trackingnummern-Modell, sondern 17-stellige **Amazon-Bestellnummer** + eingeloggter Account; HTML-Scraping der `order-history`; TBA/AMZL-Trackingnummern werden intern abgebildet. Hohe Fragilität durch Captcha, MFA/OTP, SMS/WhatsApp-Verifizierung (TA2k issues, ayyybe-README).
- **Login-getriebene Quellen sind fragil**: dokumentierte Brüche bei DHL-Login (OTP/Code kommt nicht an, Session-Abhängigkeit), Amazon-Login (Captcha, MFA) — sichtbar in TA2k Changelog (0.2.8 „fix amazon login", 0.3.0 „Amazon Captcha-Erkennung", „DHL Neuer Login über Browser-Code `dhllogin://`") und mehreren Issues (#75, #80, #90, #91).
- **Pure-Scraper veralten schnell**: sauladam/shipment-tracker (letztes Release 0.7.0, **Dez 2020**) und Ephigenia/track-parcel (**archiviert Dez 2022**) hängen an HTML-Struktur/Wording der öffentlichen Trackingseiten; Maintainer warnen selbst vor Bruch bei Layout-Änderungen.
- **Offizielle Alternative existiert für DHL**: „Shipment Tracking – Unified" API auf developer.dhl.com (API-Key, Trackingcode), inkl. Pull und Push — für eine eigene Implementierung gegenüber Scraping zu bevorzugen, soweit nutzbar.

---

## 2. Quellenübersicht

| Quelle | Typ | Anbieter | Relevante Dateien/Abschnitte | Aktualität | Einschätzung |
|---|---|---|---|---|---|
| TA2k/ioBroker.parcel | OSS-Repo (JS/Node) | DHL, DPD, GLS, Hermes, Amazon, UPS, 17Track | `main.js`, `lib/dhlLogin.js`, `lib/dhldecrypt.js`, `lib/rsaKey.js`, `io-package.json`, README/Changelog, Issues | Aktiv; Changelog bis **0.3.0 (2026-04-05)** | Höchste Relevanz: konkrete Account-/App-Endpoints + Login-Flows je Carrier |
| sauladam/shipment-tracker | OSS-Repo (PHP) | DHL, DHL Express, GLS, UPS, FedEx, USPS, PostCH, PostAT | `src/` Carrier-Klassen, README | Letztes Release **0.7.0 (Dez 2020)** → veraltet | Klares Muster für öffentl. TN-Scraping; DHL-URL dokumentiert |
| Ephigenia/track-parcel | OSS-Repo (JS, CLI) | DHL, DPD, UPS | `source/`, README | **Archiviert Dez 2022** → veraltet/read-only | Statusmodell + TN-Erkennung nützlich; Endpoints im Detail nicht im README |
| ayyybe/amazon-track | OSS-Repo (JS) | Amazon | `index.js`, `lib/`, README | **Archiviert Aug 2020** → veraltet; Autor rät explizit ab | Erklärt Amazon-Besonderheit (Bestellnr. statt TN), Output-Struktur, Captcha-Lücke |
| developer.dhl.com (Shipment Tracking – Unified) | Offizielle API-Doku | DHL | API-Reference Shipment Tracking | Laufend gepflegt | Offizielle, zu bevorzugende Alternative zu Scraping |
| forum.iobroker.net Topic 51795 | Community-Forum | alle (TA2k-Adapter) | Fehlerlogs, Status-JSON-Beispiele, `delivery_status`-Map | 2022–2025 | Gut für Fehlerfälle, JSON-Feldbeispiele, Statusnormalisierung |

---

## 3. DHL

### 3.1 Quellen

| Quelle | Link | Relevante Datei / Stelle | Erkenntnis |
|---|---|---|---|
| TA2k/ioBroker.parcel | https://github.com/TA2k/ioBroker.parcel/blob/master/main.js | `loginDhlNew()`, `lib/dhlLogin.js`, `refreshToken()` | Account/App-Login via `dhllogin://`-Code (OAuth2 PKCE), Session-Cookie `dhli`, danach Sendungsliste aus Account-Kontext |
| TA2k/ioBroker.parcel | https://github.com/TA2k/ioBroker.parcel/blob/master/io-package.json | `io-package.json` | `encryptedNative` enthält keine DHL-Felder direkt; DHL-Code/Session als States `auth.dhlSession`, `auth.cookie` |
| sauladam/shipment-tracker | https://github.com/sauladam/shipment-tracker | README „Basic Usage" | Öffentliche TN-Abfrage über `nolp.dhl.de` ohne Login |
| Ephigenia/track-parcel | https://github.com/Ephigenia/track-parcel | README | DHL unterstützt; Status-Enum dokumentiert |
| DHL offiziell | https://developer.dhl.com/api-reference/shipment-tracking | API-Reference | Offizielle Shipment-Tracking-Unified API (Key + Trackingcode) |

### 3.2 Abfragearten

| Abfrageart | Gefunden? | Quelle | Details |
|---|---:|---|---|
| Öffentliche Trackingnummer-Abfrage | Ja | sauladam/shipment-tracker README | `http://nolp.dhl.de/nextt-online-public/set_identcodes.do?lang=de&idc=<TN>` ; optional `&zip=<PLZ>` |
| Account-/Login-Abfrage | Ja | TA2k `main.js` `loginDhlNew()` | App-Login-Code `dhllogin://…`, Session `dhli`-Cookie, Sendungsliste ohne einzelne TN |
| App-/Mobile-/inoffizielle API | Ja | TA2k `main.js` | `https://login-api.dhl.de/widget/get_result.jsonp?transactionId=…` (Login); auskommentiert: `https://www.dhl.de/int-stammdaten/public/customerMasterData` mit `x-api-key` |
| Offizielle API | Ja | developer.dhl.com | Shipment Tracking – Unified; API-Key im Header, Trackingcode als Parameter; Pull + Push |

### 3.3 Technische Details

- **URLs / Endpoints:**
  - Öffentlich (sauladam): `http://nolp.dhl.de/nextt-online-public/set_identcodes.do` mit Query `lang`, `idc` (=Trackingnummer), optional `zip`. *(Fakt, README.)*
  - App-Login (TA2k): OAuth2-Authorize-URL `https://login.dhl.de/<tenant-uuid>/login/authorize?redirect_uri=dhllogin://de.deutschepost.dhl/login&…&client_id=83471082-5c13-4fce-8dcb-19d2a3fca413&response_type=code&scope=openid%20offline_access&…&code_challenge=…&code_challenge_method=S256`. *(Fakt, im `main.js` als Kommentar/Referenz vorhanden.)*
  - Login-Resultat (TA2k): `https://login-api.dhl.de/widget/get_result.jsonp?transactionId=<id>&cache=<ts>`. *(Fakt.)*
  - Auskommentiert/Hinweis (TA2k): `https://www.dhl.de/int-stammdaten/public/customerMasterData` mit Header `x-api-key: a0d5b9049ba8918871e6e20bd5c49974`. *(Fakt, aber im Code auskommentiert → Status unklar.)*
- **HTTP-Methoden:** GET (öffentliche Trackingseite, jsonp-Resultat), POST (OAuth-Token-Austausch). *(Fakt für öffentl. GET; OAuth-Flow Interpretation aus Code.)*
- **Query-Parameter:** `idc`, `lang`, `zip` (öffentlich); `transactionId`, `cache`, OAuth-Parameter (`client_id`, `code_challenge`, `scope`, `state`, `nonce`). *(Fakt.)*
- **Request-Headers:** iOS-User-Agent `Mozilla/5.0 (iPhone; CPU iPhone OS 14_8 …) … Mobile/15E148 Safari/604.1`. *(Fakt, TA2k.)*
- **Payload-Struktur (Login):** `id_token`-Claims-Objekt `{"id_token":{"customer_type":null,"email":null,"post_number":null,"twofa":null,…}}`. *(Fakt, TA2k.)*
- **Response-Struktur:** Öffentliche Seite = HTML (Scraping). Account = JSON mit `sendungen[]`, Felder u. a. `sendungsdetails.sendungsverlauf.kurzStatus`, `sendungsdetails.liveTracking.countdown`. *(Fakt, TA2k `updateProvider`/merge-Logik.)*
- **Cookies / Session-Daten:** Cookie `dhli=<id_token>` für Domains `dhl.de`/`www.dhl.de`; persistiert in State `auth.dhlSession` und `auth.cookie` (tough-cookie Jar). *(Fakt, TA2k.)*
- **Login-/OTP-Mechanismus:** Neuer Weg über Browser-/App-Code `dhllogin://` (Changelog 0.3.0). Älterer Weg: App-Login mit E-Mail/Post-Nummer + Passwort, anschließend **SMS/E-Mail-Code** in Adaptereinstellungen (README „DHL App Login eingeben → SMS/EMail Code erhalten"). *(Fakt.)*
- **Parsing-Logik:** Account-Pfad = JSON-Mapping `data.sendungen` → States. Öffentlicher Pfad (sauladam) = HTML-Scraping/Event-Parsing. *(Fakt.)*
- **Statusfelder:** `kurzStatus`, `delivery_status` (normalisiert, s. 8.x), Event-Historie (`sendungsverlauf`). *(Fakt.)*
- **Event-Historie:** vorhanden über `sendungsdetails.sendungsverlauf`. *(Fakt.)*
- **Lieferdatum / Zustellfenster:** `liveTracking.countdown`/`stopps` (Live-Zustellung). *(Fakt, Feldname.)*
- **Fehlerfälle:** `No login session found`, `DHL PreSession failed`, `read ETIMEDOUT`, `invalid_request / code is missing` (400). *(Fakt, Issues/Forum.)*

### 3.4 Relevante Codefundstellen

| Repository | Datei | Funktion / Abschnitt | Carrier | Zweck | Link |
|---|---|---|---|---|---|
| TA2k/ioBroker.parcel | `main.js` | `loginDhlNew()` | DHL | App-Code-Login + Session-Cookie | https://github.com/TA2k/ioBroker.parcel/blob/master/main.js |
| TA2k/ioBroker.parcel | `lib/dhlLogin.js` | `loginDhlNew` (ausgelagert) | DHL | OAuth/Code-Austausch | https://github.com/TA2k/ioBroker.parcel/tree/master/lib |
| TA2k/ioBroker.parcel | `lib/dhldecrypt.js` | DHL-Decrypt | DHL | Entschlüsselung Login-Antwort | https://github.com/TA2k/ioBroker.parcel/tree/master/lib |
| sauladam/shipment-tracker | `src/Trackers/DHL*` | `track()` / `trackingUrl()` | DHL | öffentl. `nolp.dhl.de` Scraping | https://github.com/sauladam/shipment-tracker |

### 3.5 Bekannte Fragilität

| Hinweis | Quelle | Bedeutung für Implementierung |
|---|---|---|
| „DHL: Neuer Login über Browser-Code (`dhllogin://`)" (Changelog 0.3.0) | TA2k README | Login-Flow hat sich geändert; alte Flows brechen |
| DHL sendet keinen Code per E-Mail/SMS; `No login session found` | TA2k Issue #90 | OTP-Zustellung unzuverlässig; Ersteinrichtung fragil |
| `read ETIMEDOUT` über Wochen | TA2k Issue #91 | Netzwerk-/Endpoint-Stabilität schwankt |
| `invalid_request: code is missing` (400), Session-Abhängigkeit | Forum 51795 | Funktioniert teils nur bei bestehender Alt-Session |
| Pure-Scraper bricht bei Layout-/Wording-Änderung | sauladam README („use it at your own risk") | HTML-Selektoren müssen gepflegt werden |

### 3.6 Offene Punkte für Verifikation

- `nolp.dhl.de/nextt-online-public/set_identcodes.do` im Browser-Network-Tab mit eigener TN prüfen (HTML vs. JSON, ob `zip` nötig).
- Prüfen, ob `int-stammdaten/public/customerMasterData` mit dokumentiertem `x-api-key` heute (ohne Login) noch antwortet.
- Offizielle DHL „Shipment Tracking – Unified" mit eigenem Key gegen eigene TN testen (404-Verhalten svb/parcel-de beachten).
- Prüfen, ob `dhllogin://`-Code-Flow OTP/2FA zwingend erfordert.

---

## 4. Hermes

### 4.1 Quellen

| Quelle | Link | Relevante Datei / Stelle | Erkenntnis |
|---|---|---|---|
| TA2k/ioBroker.parcel | https://github.com/TA2k/ioBroker.parcel/blob/master/main.js | `loginHermes()` | Mobile-App-API mit Username/Passwort + statischem `api-key`; Bearer-Token |
| TA2k Changelog | https://github.com/TA2k/ioBroker.parcel | „Fix hermes login" (0.0.30) | Login-Bruch historisch gefixt |
| Forum 51795 | https://forum.iobroker.net/topic/51795 | Status-JSON | Hermes-Status z. B. „Die Sendung wurde zugestellt.", `delivery_status:1` |

### 4.2 Abfragearten

| Abfrageart | Gefunden? | Quelle | Details |
|---|---:|---|---|
| Öffentliche Trackingnummer-Abfrage | Unklar | — | In den vier Primärquellen kein öffentlicher Hermes-TN-Scraper dokumentiert |
| Account-/Login-Abfrage | Ja | TA2k `loginHermes()` | Liefert Paketliste aus Account-Kontext |
| App-/Mobile-/inoffizielle API | Ja | TA2k `loginHermes()` | `mobile-app-api.a0930.prd.hc.de` |
| Offizielle API | Nicht gefunden | — | In Quellen nicht dokumentiert |

### 4.3 Technische Details

- **URL / Endpoint:** `https://mobile-app-api.a0930.prd.hc.de/api/v12/users/login`. *(Fakt, TA2k.)*
- **HTTP-Methode:** POST. *(Fakt.)*
- **Request-Headers:** `accept: application/json`, `api-key: acefe97f-89fc-4f4e-9543-fc6b90f68928` (statisch im Code), `content-type: application/json; charset=utf-8`, `user-agent: Hermes - ios - 12.1.1 (2689)`, `accept-language: de-de`. *(Fakt.)*
- **Payload-Struktur:** `{ "username": <user>, "password": <pass> }`. *(Fakt.)*
- **Response-Struktur:** JSON mit `accessToken` (Bearer), in `sessions['hermes']` gehalten. *(Fakt.)*
- **Cookies / Session:** Token-basiert (`accessToken`), kein Cookie-Login. *(Fakt.)*
- **Login-/OTP-Mechanismus:** reines User/Passwort, **kein OTP** in der Login-Funktion sichtbar. *(Fakt für `loginHermes()`.)*
- **Parsing-Logik:** JSON; danach Sendungs-Endpoint (Detail-Pfad **nicht gefunden** im Snippet). *(Teilweise.)*
- **Statusfelder:** Status-Text + `delivery_status` (normalisiert). *(Fakt, Forum-JSON.)*
- **Event-Historie / Lieferdatum / Zustellfenster:** **nicht gefunden** im untersuchten Snippet.
- **Fehlerfälle:** „Login to Hermes failed" bei fehlendem `accessToken`. *(Fakt.)*

### 4.4 Relevante Codefundstellen

| Repository | Datei | Funktion / Abschnitt | Carrier | Zweck | Link |
|---|---|---|---|---|---|
| TA2k/ioBroker.parcel | `main.js` | `loginHermes()` | Hermes | App-API-Login, Bearer-Token | https://github.com/TA2k/ioBroker.parcel/blob/master/main.js |

### 4.5 Bekannte Fragilität

| Hinweis | Quelle | Bedeutung für Implementierung |
|---|---|---|
| „Fix hermes login" (0.0.30) | TA2k Changelog | Login-Endpoint/Flow änderte sich historisch |
| Statischer `api-key` im Client | TA2k `main.js` | Key kann serverseitig rotiert/gesperrt werden → Bruch |
| Hostname `a0930.prd.hc.de` infrastrukturspezifisch | TA2k `main.js` | Kann sich bei App-Updates ändern |

### 4.6 Offene Punkte für Verifikation

- Prüfen, ob `mobile-app-api…/api/v12/users/login` heute noch mit dokumentiertem `api-key` antwortet.
- Sendungs-/Detail-Endpoint (nach Login) im App-Traffic identifizieren — **nicht im Snippet enthalten**.
- Prüfen, ob es einen öffentlichen Hermes-TN-Tracking-Endpoint gibt (Browser-Network-Tab auf `myhermes.de`).

---

## 5. DPD

### 5.1 Quellen

| Quelle | Link | Relevante Datei / Stelle | Erkenntnis |
|---|---|---|---|
| TA2k/ioBroker.parcel | https://github.com/TA2k/ioBroker.parcel/blob/master/main.js | `loginDPD()` | Web-Login `dpd.com`/`my.dpd.de`, Token aus 302-Redirect |
| Ephigenia/track-parcel | https://github.com/Ephigenia/track-parcel | README | DPD als unterstützter Carrier (CLI, öffentl. Tracking) |
| Forum 51795 | https://forum.iobroker.net/topic/51795 | Status-JSON | DPD-Status mit `statusId`, z. B. „Paket zugestellt – 01.04.2022", `statusId:6` |

### 5.2 Abfragearten

| Abfrageart | Gefunden? | Quelle | Details |
|---|---:|---|---|
| Öffentliche Trackingnummer-Abfrage | Ja | Ephigenia/track-parcel | DPD im CLI-Tracker; öffentl. Trackingseite (Endpoint-Detail nicht im README) |
| Account-/Login-Abfrage | Ja | TA2k `loginDPD()` | `my.dpd.de` Account, Paketliste über `myParcel.aspx` |
| App-/Mobile-/inoffizielle API | Teilweise | TA2k | Web-Form-Login + `dpd_token` (kein dediziertes Mobile-API im Snippet) |
| Offizielle API | Nicht gefunden | — | In Quellen nicht dokumentiert |

### 5.3 Technische Details

- **URLs / Endpoints (TA2k Account):**
  - Logout: `https://my.dpd.de/logout.aspx` (GET).
  - Login: `https://www.dpd.com/de/de/mydpd-anmelden-und-registrieren/` (POST, `maxRedirects:0`).
  - Token: aus `302`-Redirect `location` (`...=<dpd_token>`).
  - Paketliste: `https://my.dpd.de/myParcel.aspx?dpd_token=<token>` (GET). *(Alles Fakt, TA2k.)*
- **HTTP-Methoden:** GET (logout, myParcel), POST (Login). *(Fakt.)*
- **Request-Headers:** Desktop-User-Agent `…Chrome/98.0.4758.66 Safari/537.36`, `content-type: application/x-www-form-urlencoded`. *(Fakt.)*
- **Payload-Struktur (Login):** `dpg_username=<user>&dpg_password=<pass>` (urlencoded). *(Fakt.)*
- **Response-Struktur:** Login-Erfolg via HTTP 302 (Token in Location). Bei Fehler enthält Body „Login fehlgeschlagen". Sendungsdaten danach als HTML/JS-Seite `myParcel.aspx`. *(Fakt.)*
- **Cookies / Session:** Session-Cookie-Jar + `dpd_token` als Query-Parameter. *(Fakt.)*
- **Login-/OTP-Mechanismus:** reines User/Passwort, **kein OTP**. *(Fakt.)*
- **Parsing-Logik:** Account-Seite → Sendungsliste; öffentliche Trackingseite (Ephigenia) → Scraping. Status-JSON enthält `statusId`. *(Fakt; Detailparser DPD nicht im Snippet.)*
- **Statusfelder:** `status` (Text), `statusId`, `delivery_status`. *(Fakt, Forum-JSON.)*
- **Event-Historie / Zustellfenster:** Status-Text enthält teils Lieferfenster („Liefertag: 01.04./04.04."). *(Fakt, Forum.)*
- **Fehlerfälle:** „Login fehlgeschlagen"; „Missing status"/„undefined is not a valid state value" wenn `statusId` fehlt/Feld-Shift. *(Fakt, Forum.)*

### 5.4 Relevante Codefundstellen

| Repository | Datei | Funktion / Abschnitt | Carrier | Zweck | Link |
|---|---|---|---|---|---|
| TA2k/ioBroker.parcel | `main.js` | `loginDPD()` | DPD | Web-Login, `dpd_token`, `myParcel.aspx` | https://github.com/TA2k/ioBroker.parcel/blob/master/main.js |
| Ephigenia/track-parcel | `source/` | DPD-Tracker | DPD | öffentl. CLI-Tracking | https://github.com/Ephigenia/track-parcel |

### 5.5 Bekannte Fragilität

| Hinweis | Quelle | Bedeutung für Implementierung |
|---|---|---|
| Login hängt an ASP.NET-Webformular/302-Verhalten | TA2k `loginDPD()` | Änderungen an `dpd.com`-Login brechen Token-Extraktion |
| Fehlende `statusId` bei manchen Sendungen → Feld-Shift | Forum 51795 | Parser muss robust gegen fehlende Felder sein |
| Ephigenia archiviert (Dez 2022) | GitHub | öffentl. DPD-Scraper potenziell veraltet |

### 5.6 Offene Punkte für Verifikation

- Browser-Network-Tab auf öffentlicher DPD-Trackingseite (`tracking.dpd.de`) prüfen: JSON-Endpoint vs. HTML.
- Prüfen, ob `my.dpd.de/myParcel.aspx` weiterhin `dpd_token`-Query nutzt.
- Prüfen, ob öffentl. TN-Abfrage PLZ erfordert.

---

## 6. GLS

### 6.1 Quellen

| Quelle | Link | Relevante Datei / Stelle | Erkenntnis |
|---|---|---|---|
| TA2k/ioBroker.parcel | https://github.com/TA2k/ioBroker.parcel/blob/master/main.js | `loginGLS()` | App-API `gls-one.de/api/auth`, Token-basiert |
| sauladam/shipment-tracker | https://github.com/sauladam/shipment-tracker | README, `src/` | Öffentl. GLS-Tracking inkl. ParcelShop-Details |
| TA2k Changelog | https://github.com/TA2k/ioBroker.parcel | „Fix GLS Parcel" (0.0.19), „Fix UPS/GLS Login" (0.0.18) | historische Login-/Parser-Brüche |

### 6.2 Abfragearten

| Abfrageart | Gefunden? | Quelle | Details |
|---|---:|---|---|
| Öffentliche Trackingnummer-Abfrage | Ja | sauladam/shipment-tracker | öffentl. GLS-Trackingseite, Scraping; `getAdditionalDetails('parcelShop')` |
| Account-/Login-Abfrage | Ja | TA2k `loginGLS()` | Paketliste aus Account, Token-Header |
| App-/Mobile-/inoffizielle API | Ja | TA2k `loginGLS()` | `gls-one.de/api/...`, `X-Client-Id: iOS`, App-User-Agent |
| Offizielle API | Nicht gefunden | — | In Quellen nicht dokumentiert |

### 6.3 Technische Details

- **URLs / Endpoints (TA2k):**
  - Auth: `https://gls-one.de/api/auth` (POST, JSON Body `{username,password}`) → `token`.
  - Login/Profil: `https://gls-one.de/api/auth/login` (GET, Header `X-Auth-Token: <token>`) → `_id`. *(Fakt.)*
- **HTTP-Methoden:** POST (auth), GET (login). *(Fakt.)*
- **Request-Headers:** `X-Selected-Country: DE`, `X-Selected-Language: DE`, `X-Client-Id: iOS`, `Origin: https://www.gls-one.de`, App-User-Agent `… Mobile/15E148 GLS_App.iOS/v1.3.1`, nach Auth `X-Auth-Token`. *(Fakt.)*
- **Payload-Struktur:** Login-JSON `{"username":…,"password":…}`. *(Fakt.)*
- **Response-Struktur:** JSON; Token in `res.data.token`, Nutzer-ID in `res.data._id`. Sendungs-Endpoint danach (Detail **nicht im Snippet**). *(Teilweise.)*
- **Cookies / Session:** Token-Header (`X-Auth-Token`), plus Cookie-Jar persistiert. *(Fakt.)*
- **Login-/OTP-Mechanismus:** reines User/Passwort, **kein OTP**. *(Fakt.)*
- **Parsing-Logik:** Account = JSON. Öffentlich (sauladam) = HTML-Scraping inkl. ParcelShop/Öffnungszeiten. *(Fakt.)*
- **Statusfelder:** `STATUS_IN_TRANSIT/DELIVERED/PICKUP/EXCEPTION/WARNING/UNKNOWN` (sauladam Track-Konstanten). *(Fakt.)*
- **Ablageort / Paketshop:** `getAdditionalDetails('parcelShop')` (sauladam). *(Fakt.)*
- **Event-Historie:** `events()` mit Datum/Location/Status (sauladam). *(Fakt.)*
- **Fehlerfälle:** fehlender `token` → Log + Abbruch. *(Fakt.)*

### 6.4 Relevante Codefundstellen

| Repository | Datei | Funktion / Abschnitt | Carrier | Zweck | Link |
|---|---|---|---|---|---|
| TA2k/ioBroker.parcel | `main.js` | `loginGLS()` | GLS | App-API-Login, Token | https://github.com/TA2k/ioBroker.parcel/blob/master/main.js |
| sauladam/shipment-tracker | `src/Trackers/GLS*` | `track()`, `getAdditionalDetails()` | GLS | öffentl. Scraping + ParcelShop | https://github.com/sauladam/shipment-tracker |

### 6.5 Bekannte Fragilität

| Hinweis | Quelle | Bedeutung für Implementierung |
|---|---|---|
| „Fix GLS Parcel" / „Fix UPS/GLS Login" | TA2k Changelog | App-API/Login historisch instabil |
| App-Endpoint `gls-one.de/api` versioniert (App-Version im UA) | TA2k `main.js` | Serverseitige App-Version-Checks möglich |
| sauladam veraltet (Release 2020) | GitHub | HTML-Selektoren ggf. überholt |

### 6.6 Offene Punkte für Verifikation

- Prüfen, ob `gls-one.de/api/auth` weiterhin ohne zusätzliche App-Signatur antwortet.
- Öffentliche GLS-Trackingseite im Network-Tab prüfen (JSON-API hinter UI?).
- Sendungslisten-Endpoint nach GLS-Login identifizieren (nicht im Snippet).

---

## 7. Amazon / Amazon Logistics

### 7.1 Quellen

| Quelle | Link | Relevante Datei / Stelle | Erkenntnis |
|---|---|---|---|
| TA2k/ioBroker.parcel | https://github.com/TA2k/ioBroker.parcel/blob/master/main.js | `loginAmz()` | HTML-Scraping `amazon.de/ap/signin` + `order-history`; Captcha/MFA/OTP/WhatsApp-Erkennung |
| ayyybe/amazon-track | https://github.com/ayyybe/amazon-track | README, `index.js` | Tracking über 17-stellige **Bestellnummer**, eingeloggt; Output-Struktur dokumentiert |
| TA2k Issues/Changelog | https://github.com/TA2k/ioBroker.parcel/issues/80 | „fix amazon login" (0.2.8), 0.3.0 Captcha | Login fragil; Captcha-Erkennung ergänzt |

### 7.2 Abfragearten

| Abfrageart | Gefunden? | Quelle | Details |
|---|---:|---|---|
| Öffentliche Trackingnummer-Abfrage | Nein | ayyybe README, TA2k | Kein klassisches öffentliches TN-Tracking; Daten aus eingeloggtem Account |
| Account-/Login-Abfrage | Ja | TA2k `loginAmz()`, ayyybe | E-Mail/Passwort + ggf. OTP; HTML-Scraping `order-history` |
| App-/Mobile-/inoffizielle API | Teilweise | TA2k | iOS-User-Agent + `amzn_mshop_ios_v2_de` OAuth-URL erwähnt; primär HTML-Flow |
| Offizielle API | Nicht gefunden (für Endkunden-Tracking) | — | In Quellen nicht dokumentiert |

### 7.3 Technische Details

- **URLs / Endpoints (TA2k):**
  - Signin: `https://www.amazon.de/ap/signin?...&openid.return_to=https%3A%2F%2Fwww.amazon.de%2Fgp%2Fcss%2Forder-history...` (GET, dann POST-Formulare).
  - Verifizierung: `https://www.amazon.de/ap/cvf/verify` (POST, OTP/SMS/WhatsApp-Code).
  - Order-History (Datenquelle): `amazon.de/gp/css/order-history`. *(Fakt.)*
- **HTTP-Methoden:** GET (Signin-Seite), POST (Username, Passwort, MFA, Verify). *(Fakt.)*
- **Request-Headers:** iOS-User-Agent `…iPhone OS 16_7_7… Mobile/15E148`, `content-type: application/x-www-form-urlencoded`, `origin: https://www.amazon.de`. *(Fakt.)*
- **Payload-Struktur:** Hidden-Form-Felder (`this.extractHidden(body)`), gesetzt werden `email`, `password`, `rememberMe`, bei MFA `otpCode`/`code`, `action=code`. *(Fakt.)*
- **Response-Struktur:** HTML; Erfolg erkannt an Markern `js-yo-main-content` / `order`. *(Fakt.)*
- **Cookies / Session:** Cookie-Jar (`amazon.de`/`www.amazon.de`), persistiert in `auth.cookie`. *(Fakt.)*
- **Login-/OTP-Mechanismus:** Mehrstufig — Unified-Claim-Collection (E-Mail zuerst), Passwort, dann ggf. **MFA (`auth-mfa-otpcode`)**, **SMS-Code**, **WhatsApp-Verifizierung** (`isRedirectForWhatsapp`/`cvf/approval`), **Captcha** (`validateCaptcha`/`cvf_captcha`/„Löse das Rätsel"). *(Alles Fakt, TA2k.)*
- **Parsing-Logik:** HTML-Scraping (Marker-Strings, Hidden-Field-Extraktion). *(Fakt.)*
- **Statusfelder (ayyybe Output):** `primaryStatus`, `secondaryStatus`, `milestoneMessage`, `exceptionSource`, `exceptionExplanation`, `deliveredAddress[]`, `deliveryPhoto`, `events[]` (date → {time, message, location}). *(Fakt, README-Beispiel.)*
- **Lieferdatum / Zustellfenster:** in `primaryStatus`/`milestoneMessage` (z. B. „Delivered Friday, February 9"). *(Fakt.)*
- **Fehlerfälle:** „Failed to post with password", „Captcha detected", „Zurücksetzen des Passworts erforderlich", „Login to Amazon failed". *(Fakt.)*

**Unterschied Bestellnummer vs. TBA-/AMZL-Trackingnummer:**
- ayyybe arbeitet ausdrücklich mit der **17-stelligen Amazon-Bestellnummer** (z. B. `113-9830073-7117051`), *nicht* mit der Trackingnummer; nicht-numerische Zeichen werden vor der Abfrage entfernt. *(Fakt, README.)*
- AMZL/**TBA**-Sendungen (Amazon Logistics) werden im eingeloggten Order-Kontext aufgelöst; das Projekt zielt explizit auf „AMZL/TBA orders". *(Fakt, README.)*

**Tracking nur im eingeloggten Account sichtbar?**
- ayyybe-README: ein Großteil der Tracking-Infos werde „auch ausgeloggt" von Amazon zurückgegeben; *ausgenommen* sind **Lieferadresse/Name** und ggf. **Zustellfoto** (nur eingeloggt). *(Fakt/Selbstaussage des Projekts — Verifikation nötig, Stand 2020.)*

**Captcha / OTP / 2FA / Device-Session:**
- Captcha: TA2k erkennt `validateCaptcha`, `cvf_captcha`, „Löse das Rätsel"; empfiehlt manuelles Lösen im Browser auf gleicher IP/Gerät. *(Fakt.)*
- OTP/2FA: `auth-mfa-otpcode`, SMS, WhatsApp-Code. *(Fakt.)*
- Device/Session: `rememberDevice`/`rememberMe`, Cookie-Persistenz; Captcha-Empfehlung „gleiches Gerät/IP" deutet auf Device-/IP-Bindung. *(Fakt + Interpretation.)*

**Warum Amazon besonders fragil ist:**
- ayyybe selbst: „**Don't use this**", nicht gewartet, kein Captcha-Solver, keine Fehlermeldung bei Login-Fehlschlag, keine Multi-Shipment-Behandlung. *(Fakt, README.)*
- TA2k: zahlreiche Captcha-/MFA-/WhatsApp-Sonderpfade nötig → hohe Bruchwahrscheinlichkeit bei UI-Änderungen. *(Fakt + Interpretation.)*

### 7.4 Relevante Codefundstellen

| Repository | Datei | Funktion / Abschnitt | Carrier | Zweck | Link |
|---|---|---|---|---|---|
| TA2k/ioBroker.parcel | `main.js` | `loginAmz()` | Amazon | HTML-Login, Captcha/MFA/SMS/WhatsApp, order-history | https://github.com/TA2k/ioBroker.parcel/blob/master/main.js |
| ayyybe/amazon-track | `index.js` | `track(email, pass, orderId)` | Amazon | Bestellnr.-basiertes Tracking, Output-Schema | https://github.com/ayyybe/amazon-track |

### 7.5 Bekannte Fragilität

| Hinweis | Quelle | Bedeutung für Implementierung |
|---|---|---|
| „Don't use this … not maintained" | ayyybe README | Referenzimplementierung tot; nur als Muster nutzbar |
| Captcha/MFA/SMS/WhatsApp-Pfade | TA2k `loginAmz()` | Login extrem zustands-/UI-abhängig |
| „Failed to post with password" trotz korrekter Daten | TA2k Issue #80 | MFA/Token-Handling bricht |
| Multi-Shipment-Orders nicht unterstützt | ayyybe README | Datenmodell unvollständig |

### 7.6 Offene Punkte für Verifikation

- Prüfen, welche Felder Amazon **ausgeloggt** liefert (Stand heute) vs. nur eingeloggt.
- Network-Tab der `order-history`/Tracking-Detailseite auf JSON-Endpoints prüfen.
- Prüfen, ob/welche MFA-Variante (App-OTP, SMS, WhatsApp) erzwungen wird.
- TBA-/AMZL-Nummer-Format vs. Bestellnummer-Format im eigenen Account abgleichen.

---

## 8. Cross-Carrier Findings

### 8.1 Datenfelder

| Feld | DHL | Hermes | DPD | GLS | Amazon | Quelle |
|---|---|---|---|---|---|---|
| aktueller Status | `kurzStatus`/`delivery_status` | Status-Text/`delivery_status` | `status`/`statusId`/`delivery_status` | `STATUS_*`/`delivery_status` | `primaryStatus`/`milestoneMessage` | TA2k, sauladam, ayyybe |
| Statushistorie | `sendungsverlauf` | nicht gefunden | teils im Status-Text | `events()` | `events[]` | TA2k, sauladam, ayyybe |
| voraussichtl. Lieferdatum | `liveTracking` (Live) | nicht gefunden | im Status-Text („Liefertag") | nicht gefunden | im `primaryStatus` | TA2k, Forum, ayyybe |
| Zustellfenster | `liveTracking.countdown`/`stopps` | nicht gefunden | teils Status-Text | nicht gefunden | nicht gefunden | TA2k, Forum |
| Ablageort / Paketshop | nicht gefunden | nicht gefunden | nicht gefunden | `parcelShop` | nicht gefunden | sauladam |
| Absender | nicht gefunden | nicht gefunden | nicht gefunden | nicht gefunden | nicht gefunden | — |
| Empfänger | nicht gefunden | nicht gefunden | nicht gefunden | nicht gefunden | `deliveredAddress[]` (eingeloggt) | ayyybe |

### 8.2 Technische Muster

- **HTML-Scraping (öffentliche Trackingseite):** DHL (`nolp.dhl.de`), GLS/UPS/DPD bei sauladam/Ephigenia. *(Quelle: sauladam, Ephigenia.)*
- **JSON-API hinter Webseite/App:** Hermes (`mobile-app-api…`), GLS (`gls-one.de/api`). *(Quelle: TA2k.)*
- **Account-Scraping (Paketliste ohne TN):** DHL, DPD, Amazon, (GLS/Hermes Account-Kontext). *(Quelle: TA2k.)*
- **App-/Mobile-Endpunkte:** Hermes/GLS mit iOS-User-Agents + `X-Client-Id`/`api-key`. *(Quelle: TA2k.)*
- **Session-Cookies:** DHL (`dhli`), Amazon/DPD (Cookie-Jar). *(Quelle: TA2k.)*
- **CSRF-/Hidden-Token:** Amazon (Hidden-Form-Felder), DPD (302-`dpd_token`). *(Quelle: TA2k.)*
- **OTP / Login-Code:** DHL (SMS/E-Mail-Code, `dhllogin://`), Amazon (MFA/SMS/WhatsApp). *(Quelle: TA2k, README.)*
- **Captcha-Erkennung:** Amazon (`validateCaptcha`/`cvf_captcha`). *(Quelle: TA2k.)*
- **Statusnormalisierung:** gemeinsames `delivery_status`-Mapping (s. u.). *(Quelle: TA2k/Forum.)*

**`delivery_status`-Mapping (TA2k, Faktwert aus Code/Forum):**
`ERROR:-1, DELIVERED:1, UNKNOWN:5, REGISTERED:10, IN_PREPARATION:20, IN_TRANSIT:30, OUT_FOR_DELIVERY:40`.

### 8.3 Häufige Fehlerfälle

| Fehlerfall | Betroffene Anbieter | Quelle | Implementierungsrelevanz |
|---|---|---|---|
| Login-Session bricht / „No login session found" | DHL, Amazon | TA2k Issue #90, Forum | Robuste Re-Login-/Session-Persistenz nötig |
| OTP/Code kommt nicht an | DHL | Issue #90 | OTP-Zustellung nicht garantiert |
| Captcha blockiert Login | Amazon | TA2k 0.3.0, Issue | Kein automatisiertes Lösen (Scope-Grenze) |
| `statusId` fehlt → Feld-Shift/`undefined` | DPD (u. a.) | Forum | Defensive Parser, Pflichtfelder prüfen |
| HTML-Layout-/Wording-Änderung | DHL/GLS/UPS (Pure-Scraper) | sauladam README | Selektoren versionieren/monitoren |
| `read ETIMEDOUT` | DHL | Issue #91 | Timeouts/Retry-Strategie |

---

## 9. Rechtliche und operative Hinweise

> Keine juristische Beratung. Nur Beobachtungen aus Quellen.

| Thema | Beobachtung | Quelle | Relevanz |
|---|---|---|---|
| robots.txt | In den Quellen nicht ausgewertet | — | robots.txt ist **keine** Nutzungserlaubnis |
| offizielle API verfügbar | DHL: „Shipment Tracking – Unified" (Key + Trackingcode, Pull/Push) | developer.dhl.com | Offizielle API ggü. Scraping bevorzugen |
| Login erforderlich | Account-Pfade (DHL/DPD/GLS/Hermes/Amazon) erfordern Zugangsdaten | TA2k | Credentials/Secret-Handling nötig |
| Captcha sichtbar | Amazon zeigt Captcha bei Login | TA2k | Schutzmaßnahme; nicht umgehen |
| Rate-Limits genannt | 17Track-User „max 40 Pakete", API-Developer „100 Anfragen dann Bezahlung"; parcel.app-Adapter nennt 20 GET/h | Forum, krobipd README | Poll-Intervalle entsprechend wählen |
| ToS-Hinweise | sauladam: „nur persönlicher Gebrauch, nicht kommerziell"; ayyybe: „Don't use this" | READMEs | Nutzungsbeschränkungen der Projekte/Carrier beachten |

**Wichtig:** robots.txt ≠ Erlaubnis. Offizielle APIs bevorzugen, wenn verfügbar. Keine Empfehlung zur Umgehung technischer Schutzmaßnahmen (Captcha/Bot-Detection/2FA).

---

## 10. Minimal notwendige Details für eigene Implementierung

| Anbieter | Minimal benötigte Inputs | Abfrageweg laut Quellen | Auth nötig | Parser-Input | Extrahierbare Outputs | Wichtige Einschränkungen |
|---|---|---|---:|---|---|---|
| DHL | TN (öffentl.) **oder** App-Code/Session (Account) | öffentl. `nolp.dhl.de` GET **oder** `dhllogin://`-Session → JSON `sendungen` | Teilweise | HTML (öffentl.) / JSON (Account) | Status, Event-Historie, Live-Zustellfenster | OTP-Zustellung unzuverlässig; Login-Flow geändert (`dhllogin://`) |
| Hermes | Username + Passwort | POST `mobile-app-api…/api/v12/users/login` → Bearer-Token | Ja | JSON | `accessToken`, Status (Detail-Endpoint offen) | statischer `api-key`; Sendungs-Endpoint nicht im Snippet |
| DPD | Username + Passwort (Account) / TN (öffentl.) | POST `dpd.com/...anmelden`, 302→`dpd_token`, GET `myParcel.aspx` | Teilweise | HTML/JS-Seite | Status, `statusId`, Lieferfenster im Text | ASP.NET-Login fragil; fehlende `statusId` → Feld-Shift |
| GLS | Username + Passwort (Account) / TN (öffentl.) | POST `gls-one.de/api/auth` → Token, GET `/api/auth/login` | Teilweise | JSON (Account) / HTML (öffentl.) | Status, Events, ParcelShop (öffentl.) | App-Version im UA; Sendungslisten-Endpoint offen |
| Amazon | E-Mail + Passwort + **Bestellnummer** (+ ggf. OTP) | HTML-Login `ap/signin` + `cvf/verify`, Scraping `order-history` | Ja | HTML | primary/secondary Status, Events, Adresse/Foto (eingeloggt) | Captcha/MFA/SMS/WhatsApp; keine TN; Multi-Shipment ungelöst |

---

## 11. Nicht gefundene oder unklare Punkte

| Anbieter | Unklarer Punkt | Warum unklar? | Nächster Verifikationsschritt |
|---|---|---|---|
| Hermes | Sendungs-/Detail-Endpoint nach Login | nur Login im Snippet sichtbar | App-Traffic mitschneiden / Code `loginHermes`-Folgeaufrufe lesen |
| Hermes | Öffentliche TN-Abfrage | in Primärquellen nicht enthalten | `myhermes.de` Network-Tab prüfen |
| GLS | Sendungslisten-Endpoint (nach Token) | nur Auth/Profil im Snippet | Code-Folgeabschnitt / App-Traffic prüfen |
| DPD | öffentl. TN-JSON vs. HTML | Ephigenia-README ohne Endpoint-Detail | `tracking.dpd.de` Network-Tab |
| DHL | `customerMasterData` `x-api-key` aktiv? | im Code auskommentiert | Live-Request ohne Login testen |
| Amazon | ausgeloggt verfügbare Felder (Stand heute) | ayyybe-Aussage von 2020 | aktuelles Verhalten manuell prüfen |
| alle | robots.txt/ToS-Status je Carrier | nicht Teil der Code-Quellen | Carrier-robots.txt + ToS sichten |

---

## 12. Quellenverzeichnis

| Nr. | Quelle | Link | Zugriff / Stand | Genutzte Erkenntnisse |
|---|---|---|---|---|
| 1 | TA2k/ioBroker.parcel (README/Changelog) | https://github.com/TA2k/ioBroker.parcel | 2026-06-27; Changelog bis 0.3.0 (2026-04-05) | Login-Flows, `dhllogin://`, Carrier-Liste, OTP-Hinweise |
| 2 | TA2k/ioBroker.parcel `main.js` | https://github.com/TA2k/ioBroker.parcel/blob/master/main.js | 2026-06-27 | Endpoints/Headers/Payloads DHL, DPD, GLS, Hermes, Amazon |
| 3 | TA2k/ioBroker.parcel `io-package.json` | https://github.com/TA2k/ioBroker.parcel/blob/master/io-package.json | 2026-06-27 | `encryptedNative`, States, Carrier-Keys |
| 4 | TA2k Issue #80 (Amazon Login broken) | https://github.com/TA2k/ioBroker.parcel/issues/80 | 2026-06-27 | Amazon MFA/Passwort-POST-Fehler |
| 5 | TA2k Issue #90 (DHL Login nicht möglich) | https://github.com/TA2k/ioBroker.parcel/issues/90 | 2026-06-27 | DHL OTP/Session-Fragilität |
| 6 | TA2k Issue #91 (DHL ETIMEDOUT) | https://github.com/TA2k/ioBroker.parcel/issues/91 | 2026-06-27 | Timeout-Fehlerfall |
| 7 | sauladam/shipment-tracker | https://github.com/sauladam/shipment-tracker | 2026-06-27; Release 0.7.0 (Dez 2020) | öffentl. DHL/GLS-Scraping, Statusmodell, ParcelShop |
| 8 | Ephigenia/track-parcel | https://github.com/Ephigenia/track-parcel | 2026-06-27; archiviert Dez 2022 | DHL/DPD/UPS CLI, Status-Enum, TN-Erkennung |
| 9 | ayyybe/amazon-track | https://github.com/ayyybe/amazon-track | 2026-06-27; archiviert Aug 2020 | Amazon Bestellnummer-Modell, Output-Schema, Captcha-Lücke |
| 10 | DHL Shipment Tracking – Unified (offiziell) | https://developer.dhl.com/api-reference/shipment-tracking | 2026-06-27 | offizielle API als Alternative, Pull/Push, 404-Verhalten |
| 11 | forum.iobroker.net Topic 51795 | https://forum.iobroker.net/topic/51795 | 2026-06-27 | Status-JSON-Beispiele, `delivery_status`-Map, Rate-Limits, Fehlerlogs |
| 12 | krobipd/ioBroker.parcelapp | https://github.com/krobipd/ioBroker.parcelapp | 2026-06-27 | Aggregator-Muster (parcel.app), Rate-Limits, Feldmodell |

---

## 13. Recommendation

> **Hinweis:** Dieser Abschnitt verlässt die reine Quellen-Recherche und enthält eine **bewertende Implementierungsempfehlung**. Sie ist von der Faktenbasis (Abschnitte 1–12) bewusst getrennt.

**Leitprinzip:** TN-zentriert und login-frei bauen; Account-Scraping vermeiden. Der Account-Weg spart das manuelle Eintippen einer Trackingnummer, kostet dafür aber dauerhaft Wartung bei Login-Flow-Änderungen — für eine private App mit wenigen Sendungen ein schlechtes Verhältnis.

**Empfehlung pro Carrier (Tiers):**

| Carrier | Empfohlener Weg | Tier | Begründung |
|---|---|---|---|
| **DHL** | Offizielle Unified-API (Key + Trackingcode) | **Best-in-class** | Sauberes JSON inkl. Event-Historie; kein UI-Bruchrisiko; kostenlos für moderate Volumina |
| **DPD** | Öffentlicher JSON-Endpoint hinter Trackingseite | **Pragmatisch/Value** | Login-frei; JSON robuster als HTML-Selektoren |
| **GLS** | Öffentlicher JSON-Endpoint hinter Trackingseite | **Pragmatisch/Value** | wie DPD; öffentl. Tracking ohne Account |
| **Hermes** | Öffentliche TN-Abfrage (erst verifizieren) | **Pragmatisch/Value, bedingt** | App-API mit Login als Fallback; öffentl. Weg in Quellen nicht belegt |
| **Amazon** | Nicht implementieren (alternativ: Bestellbestätigungs-Mails parsen) | **Bewusst ausgelassen** | Account-Login fragil; AMZL/TBA oft ohnehin nicht öffentlich trackbar |

**Implementierungsrahmen (kein Detaildesign):** Pro Carrier ein dünner **Fetcher** (Input Trackingnummer → rohes JSON) plus ein **Normalizer** (carrier-spezifisches JSON → einheitliches Statusmodell auf Basis des `delivery_status`-Mappings aus Abschnitt 8.2). Fetcher sind die Sollbruchstellen — einzeln testbar und minimal halten.

**Kritischer erster Schritt vor jeder Implementierung:** Die öffentlichen JSON-Endpoints für DPD/GLS/Hermes stehen in keiner Quelle sauber dokumentiert und müssen aus dem Browser-Network-Tab mit eigener Trackingnummer verifiziert werden (Vorgehen in Abschnitt 11, „Offene Punkte für Verifikation"). Dieser Check zeigt den *heutigen* Stand und ist verlässlicher als die teils veralteten Repos.

**Priorisierte Reihenfolge:** (1) DHL offizielle API → schnellster verlässlicher Gewinn. (2) DPD + GLS öffentliche JSON-Endpoints. (3) Hermes nach erfolgreicher Verifikation. (4) Amazon nur, wenn unbedingt nötig — dann über Mail-Parsing statt Account-Login.

---

### Methodischer Hinweis

Aussagen mit Endpoint-/Header-/Payload-Konkretion stammen direkt aus dem sichtbaren Quellcode bzw. README/Changelog der genannten Repos (**Fakt**). Wo nur Login-Code, aber kein Folgeschritt sichtbar war (Hermes-/GLS-Sendungs-Endpoint), ist dies als **nicht gefunden** markiert. Bewertungen zu Aktualität/Fragilität sind als **Interpretation** gekennzeichnet. Es wurden keine Endpoints oder Payloads erfunden, keine Architektur entworfen und keine Umgehung von Schutzmaßnahmen beschrieben.
