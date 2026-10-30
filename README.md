# LabZSK

[![Codacy Badge](https://api.codacy.com/project/badge/Grade/5edb13a34c8a4244a1b904f91245c689)](https://app.codacy.com/app/Konrad-Ziarko/LabZSK?utm_source=github.com&utm_medium=referral&utm_content=Konrad-Ziarko/LabZSK&utm_campaign=Badge_Grade_Dashboard)
[![License](https://img.shields.io/github/license/Konrad-Ziarko/LabZSK.svg)](LICENSE)  

LabZSK version 1.2.3.0

## Wersja webowa

Katalog [`web/`](web) zawiera przeglądarkową wersję symulatora – statyczną stronę (HTML/CSS/JS, bez kompilacji i bez serwera aplikacji).

- silnik procesora jest przeniesiony 1:1 z `LabZKT/Simulation/Execution.cs` (tryby MAKRO i MIKRO, sprawdzanie wartości rejestrów, błędy i ocena, log),
- edytory pamięci mikroprogramów i pamięci operacyjnej z tymi samymi regułami co w wersji desktopowej,
- pliki `.pm` i `.po` są zgodne binarnie z wersją desktopową (wczytywanie i zapis),
- stan symulatora, log i ustawienia są przechowywane w przeglądarce (`localStorage`); log można pobrać jako plik `.log`,
- interfejs po polsku i angielsku, działa także na telefonie,
- bez serwera działa jako tryb swobodnej nauki; ocena jest pokazywana tylko wtedy, gdy progi przekaże system zewnętrzny.

Uruchomienie lokalne (moduły ES wymagają serwera HTTP, samo otwarcie `index.html` z dysku nie wystarczy):

```
cd web
python -m http.server 8080
```

a następnie http://localhost:8080. Katalog `web/` można też opublikować bez zmian, np. na GitHub Pages.

Testy silnika i formatu plików (Node.js 18+):

```
cd web
npm test
```

Nie przeniesiono funkcji związanych z systemem Windows: szyfrowanej konfiguracji ani ukrytego dziennika uruchomień (ADS). Połączenie z serwerem i kontrolę logu zastępuje serwer opisany niżej.

## Serwer: zadania z Lab Managera, podgląd na żywo, panel nauczyciela

Katalog [`server/`](server) to serwer LabZSK (Node.js 22.13+, bez pakietów npm – baza SQLite wbudowana w Node). Jeden proces udostępnia:

- symulator z `web/` pod `/` – bez parametrów tryb swobodnej nauki, z linkiem z Lab Managera zadanie laboratoryjne,
- panel nauczyciela pod `/panel/` (logowanie loginem i hasłem): lista podejść, log na żywo, kafelki wszystkich studentów (przełącznik Log / CPU), pełny widok aplikacji studenta tylko do odczytu, „Wyczyść podejście”, pobranie logu, weryfikacja pliku, ustawienie wspólnego sekretu, link testowy.

Ustalenia: [WYMAGANIA_WEB.md](WYMAGANIA_WEB.md).

### Link do zadania (Lab Manager)

```
https://<adres LabZSK>/?user=17&course=8&session=11&task=26&sig=<HMAC>
```

`sig` = HMAC-SHA256(wspólny sekret, `user=17&course=8&session=11&task=26`) zapisany szesnastkowo (64 znaki). Wartości: litery, cyfry, `-` i `_` (do 64 znaków). Wspólny sekret ustawia się w panelu (Ustawienia) i wpisuje ten sam w ustawieniach Lab Managera.

Szablon linku w Lab Managerze powinien mieć też `&pseudonym={pseudonym}&enc={encName}` tuż przed `&sig={sig}`:

```
https://<adres LabZSK>/?user={userId}&course={courseId}&session={sessionId}&task={taskId}&pseudonym={pseudonym}&enc={encName}&sig={sig}
```

`enc` to szyfrogram danych osobowych studenta (`iv.key.data` w base64url), a `pseudonym` to jawny pseudonim (np. `S-QGT8`); oba są podpisane razem z resztą linku w tej kolejności: `user=17&course=8&session=11&task=26&pseudonym=S-QGT8&enc=…`. Serwer LabZSK nie umie go odczytać i przechowuje go bez zmian. Odszyfrowuje go tylko przeglądarka nauczyciela: plik kopii klucza z Lab Managera wczytany w panelu (Ustawienia) trafia jako nieeksportowalny klucz do IndexedDB tej przeglądarki i nigdy nie jest wysyłany. Bez klucza panel pokazuje pseudonim, a gdy link go nie ma, userId. Web Crypto działa tylko na `https://` i `localhost`, więc odszyfrowanie wymaga panelu pod takim adresem.

Zasady wejścia: brak podejścia → nowe; ta sama przeglądarka → kontynuacja; inna przeglądarka lub druga karta → blokada; zakończone → odmowa. Kolejne podejście: nauczyciel klika „Wyczyść podejście”. Bez serwera zadanie można zacząć i kontynuować – kroki czekają w przeglądarce (IndexedDB) i są dosyłane jako offline.

### Odcisk logu i skrypt sprawdzający

Log końcowy zaczyna się jak zwykły log symulatora, na końcu ma dane podejścia (`#LABZSK {...}`) i odcisk:

```
#LABZSK-HMAC <64 znaki hex>
```

Odcisk = HMAC-SHA256(sekret, `user\ncourse\nsession\ntask\n` + cała treść przed linią `#LABZSK-HMAC`, końce linii jako LF). Skrypt [`tools/verify-log.mjs`](tools/verify-log.mjs) (Node 18+, bez pakietów) robi to samo – kod wyjścia: 0 poprawny, 5 poprawny, ale z przerwą w połączeniu (poinformować nauczyciela), 1 zmieniony / nie z tego serwera, 2 log awaryjny bez odcisku, 3 inny student lub zadanie:

```
node tools/verify-log.mjs plik.log --secret-file sekret.txt --user 17 --course 8 --session 11 --task 26
```

### Testowanie lokalnie

Bez Dockera (Node.js 22.13+): `cd server` i `npm start`. Z Dockerem: `docker compose up --build` w katalogu głównym.

1. http://localhost:8080/panel/ – lokalnie konto `prowadzacy` / `prowadzacy` (z `server/.env`).
2. Ustawienia → „Wygeneruj nowy sekret”.
3. „Link testowy” → utwórz link → otwórz go w innej przeglądarce lub oknie prywatnym (to widok studenta).
4. „Na żywo” → Log / CPU, „Pełny widok”.

Testy: `cd server && npm test` oraz `cd web && npm test`. Konta nauczycieli: `node src/cli.js teacher <login> <hasło>`.
