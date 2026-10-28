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
- interfejs po polsku i angielsku, działa także na telefonie.

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

Nie przeniesiono funkcji związanych z systemem Windows: szyfrowanej konfiguracji, ukrytego dziennika uruchomień (ADS), połączenia z serwerem LabZSKServer ani kontroli integralności pliku logu.
