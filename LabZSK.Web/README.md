# LabZSK Web

Przeglądarkowa wersja symulatora **LabZSK**, czyli dydaktycznej maszyny cyfrowej z mikroprogramowaniem. To port
aplikacji Windows Forms z katalogu `LabZKT/` (bez aplikacji serwera) do Angulara 21 i TypeScriptu. Działa w całości
po stronie klienta, jako statyczna strona bez backendu.

## Uruchomienie

```bash
npm install          # .npmrc włącza legacy-peer-deps (obejście błędu npm 10 przy instalacji vitest)
npm start            # http://localhost:4200
npm test -- --watch=false
npm run build        # wynik w dist/labzsk-web/browser – wystarczy dowolny serwer plików statycznych
```

## Publikacja na GitHub Pages

Workflow `.github/workflows/web.yml` testuje i buduje aplikację przy każdej zmianie, a po wypchnięciu na `master`
publikuje ją pod adresem https://maciejlisck.github.io/LabZSK/. Jednorazowo trzeba włączyć Pages w ustawieniach
repozytorium: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Struktura

| Katalog | Zawartość | Odpowiednik w C# |
|---|---|---|
| `src/app/core/` | Czysty TypeScript, bez Angulara: silnik i formaty plików | |
| `core/simulator.ts` | Cykl rozkazowy, takty 0–7, TEST, log, ocena | `Simulation/Execution.cs`, `SimView.cs` |
| `core/registers.ts` | Rejestr (wartość wpisana / oczekiwana, maski LK/RAP/RAPS/SUMA) | `Controls/NumericTextBox.cs` |
| `core/microcode.ts` | Kolumny PM, dozwolone mikrooperacje, reguły SHT, RBPS | `MicroOperations/*`, `Translator.cs` |
| `core/memory.ts` | Komórki PAO, rozkazy zwykłe i rozszerzone | `Memory/*`, `Translator.cs` |
| `core/files.ts`, `crc.ts`, `dotnet-binary.ts` | Pliki `.pm`, `.po`, `.log` zgodne bajt w bajt (BinaryWriter + CRC) | `PMView/MemView.SaveTable`, `LogManager`, `CRC.cs` |
| `schematic/` | Schemat procesora (SVG + pola rejestrów) | `Drawings.cs` |
| `pm-table/`, `pao-table/`, `dialogs/` | Tabele i okna edycji | `PMView`, `MemView`, `PMSubmit`, `MemSubmit`, `Options`, `DevConsole` |

W oryginale oczekiwanie na studenta było zrobione pętlą `while (!clicked) Application.DoEvents()`. W porcie każde
takie miejsce to `await` na obietnicy, którą rozwiązuje przycisk „Zatwierdź” albo „Następny takt”. Poza tym kolejność
operacji i treść logu odpowiadają wersji desktopowej.

## Różnice względem wersji desktopowej

- Log nie trafia na dysk na bieżąco. Jest trzymany w przeglądarce (`localStorage`) i pobierany jako plik `.log`
  (UTF-16 + CRC, ten sam format, więc desktopowy LabZSK go odczyta). Odświeżenie strony nie kasuje błędów i zostawia
  w logu wpis „Wznowienie pracy”.
- W nagłówku logu zamiast nazwy stacji, użytkownika Windows i adresów IP jest imię i nazwisko, grupa oraz przeglądarka.
- Ustawienia prowadzącego (progi ocen, zamykanie logu, konsola) nie są szyfrowane, bo w przeglądarce nie dałoby to
  żadnej ochrony. Każda ich zmiana jest za to odnotowywana w logu.
- Pominięto: połączenie z serwerem, ukryty rejestr uruchomień w strumieniu NTFS, sprawdzanie wersji i czasu NIST,
  wersję angielską interfejsu.
- Doszło: przeciąganie wartości między rejestrami (było też w oryginale), obsługa klawiaturą, tryb ciemny, filtr
  wyróżnionych wierszy w podglądzie logu. Stany na schemacie i w logu są oznaczane także kształtem i ikoną, nie
  tylko kolorem.
