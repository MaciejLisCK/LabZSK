# Wymagania rozwoju LabZSK Web

Status: ustalenia integracji z LecturerManager (LM) – uzgodnione, gotowe do wdrożenia. Zastępują wersję z 2026-10-29.
Data: 2026-10-30.

Stan kodu: ustalenia wdrożone w `server/`, `web/` i `tools/verify-log.mjs` (2026-10-30), testowane lokalnie; jeszcze nie na serwerze docelowym. Po stronie LM do zrobienia: link, strona ustawień z sekretem, skrypt sprawdzający, `userId` w `Endpoints.cs`.

## Cel

- Studenci pracują w webowym LabZSK (`web/`), uruchamianym w Dockerze razem z backendem.
- Jedno podejście do symulacji na zadanie; kolejne tylko po działaniu nauczyciela.
- Nauczyciel widzi pracę studentów na żywo.
- Przy awarii internetu lub serwera student kończy pracę i oddaje standardowy `.log` do LM.
- W LM jak najmniej zmian.
- Do LabZSK nie trafiają dane osobowe – tylko `userId`.
- LabZSK działa także bez LM (tryb swobodnej nauki, bez linku).

## Wspólny sekret

1. Jeden sekret HMAC służy zarówno do podpisywania linków (LM → LabZSK), jak i do odcisku logu (LabZSK → skrypt sprawdzający w LM).
2. Sekret jest zapisany w bazie LabZSK i ustawiany w panelu LabZSK (Ustawienia): wygenerowanie nowego, wklejenie istniejącego, skopiowanie do LM. Sekret jest maskowany i pokazywany tylko na żądanie zalogowanego prowadzącego.
3. W LM sekret wpisuje się na stronie ustawień LM (nowa, niewielka zmiana w LM); skrypt sprawdzający odczytuje go stamtąd.
4. Zmiana sekretu unieważnia wszystkie wcześniejsze linki, a skrypt nie sprawdzi już logów podpisanych starym sekretem. Sekretu nie zmienia się w trakcie semestru. (Opcjonalnie później: przechowywanie starych sekretów z identyfikatorem w odcisku.)

## Zmiany w LM (minimalne)

1. Link „Otwórz w LabZSK” przy zadaniu: `https://<labzsk>/?user=17&course=8&session=11&task=26&sig=…`, gdzie `sig = HMAC-SHA256(sekret, parametry)`. Nazwy odpowiadają ścieżce LM `/courses/8/sessions/11/tasks/26`. Link nie ma terminu ważności – LM sam nie pozwala wejść w zadanie poza godzinami laboratoriów.
2. Jedna linia w `Endpoints.cs:380`: skrypt sprawdzający dostaje `userId` zgłaszającego.
3. Strona ustawień z polem na wspólny sekret LabZSK.
4. Skrypt sprawdzający dla zadań LabZSK (konfiguracja, nie kod LM): zna sekret, sprawdza odcisk logu i zgodność `userId`/course/session/task; przy logu z przerwą połączenia lub bez prawidłowego odcisku informuje nauczyciela.

## LabZSK – backend (Docker)

1. Sprawdza podpis linku; bez poprawnego podpisu nie da się rozpocząć zadania.
2. Baza SQLite (`/data/labzsk.sqlite` w wolumenie Dockera) – już istnieje; tabele dostosowane do nowych pól:
   - `attempts`: `userId`, course, session, task, stan (aktywne / zakończone), stan symulatora, sesja przeglądarki. Jedno podejście na (`userId`, course, session, task), bez numerowania.
   - `events`: zdarzenia symulacji, tylko dopisywane, z numerem kolejnym (duplikaty pomijane, luki zgłaszane).
   - `settings`: wspólny sekret.
3. Zasady wejścia:
   - brak podejścia → nowe;
   - aktywne, ta sama przeglądarka → kontynuacja (F5, ponowne kliknięcie linku);
   - aktywne, druga karta → blokada; inna przeglądarka/komputer → blokada (nauczyciel może tylko wyczyścić podejście);
   - zakończone → odmowa.
4. Komunikacja: HTTP (wysyłanie zdarzeń co ok. 3 s, podgląd nauczyciela przez SSE). Bez WebSocket.
5. Po zakończeniu: serwer generuje `.log` z zapisu na serwerze i dopisuje na końcu odcisk `HMAC-SHA256(sekret, userId + course + session + task + treść logu)`.

## Panel nauczyciela

1. Logowanie loginem i hasłem.
2. Lista podejść i log na żywo; studenci jako `userId` (oraz course/session/task).
3. „Wyczyść podejście” – usuwa podejście razem z logiem; student po ponownym otwarciu linku zaczyna od zera. To jedyny sposób na kolejne podejście lub zmianę komputera. Obecne przyciski „Zezwól na ponowne wejście”, „Unieważnij” i „Usuń” znikają.
4. Ustawienia: wspólny sekret (patrz wyżej).
5. Weryfikacja pliku logu (pomocniczo, ten sam algorytm co skrypt w LM).

### Podgląd na żywo (kafelki wszystkich aktywnych studentów)

1. Przełącznik widoku dla wszystkich kafelków naraz:
   - **Log** (obecny) – ostatnie wiersze logu każdego studenta;
   - **CPU** – pomniejszony schemat procesora każdego studenta: rejestry, flagi, takt, cykl, liczba błędów, podświetlony rejestr, na który student właśnie odpowiada.
2. Przycisk „Pełny widok” na kafelku (i w szczegółach podejścia) otwiera podgląd całej aplikacji studenta tylko do odczytu: schemat CPU, pamięć mikroprogramów z podświetlonym wierszem/polem, pamięć operacyjna, bieżący cykl, liczba błędów, pełny log. Widok odświeża się sam, nauczyciel niczego nie może w nim zmienić.
3. Podgląd jest wyświetlany tym samym kodem co symulator studenta (`web/`), w trybie podglądu dla zalogowanego prowadzącego – wygląda dokładnie jak ekran studenta.
4. Opóźnienie ok. 3 s (jak synchronizacja). Student offline: widoczny ostatni znany stan z oznaczeniem „brak połączenia od …”.
5. Technicznie: przeglądarka studenta wysyła wraz ze zdarzeniami migawkę stanu (rejestry, flagi, takt, bieżące pole mikroprogramu, rejestr do sprawdzenia; pamięci tylko gdy się zmieniły), serwer trzyma ostatnią migawkę i rozsyła ją do panelu przez SSE. To nie jest transmisja ekranu ani zdalne sterowanie.

## Frontend (`web/`)

1. Tryb zadania (z linku): zdarzenia wysyłane na serwer; zablokowane „Zamknij log”, tryb AUTO i progi ocen; zerowanie rejestrów nie zeruje licznika błędów.
2. Kopia stanu i kolejki zdarzeń w IndexedDB (zamiast localStorage z limitem ok. 5 MB).
3. „Zakończ pracę” z potwierdzeniem pobiera z serwera `.log` z odciskiem; potem symulacja jest zablokowana, log można pobrać ponownie.
4. Oceny są na razie wyłączone: symulator pokazuje tylko liczbę błędów (w trybie zadania i w trybie nauki). Progi ocen nie są przekazywane z LM.

## Awarie

1. Utrata internetu lub serwera w trakcie: praca trwa dalej, zdarzenia czekają w przeglądarce i są dosyłane po powrocie połączenia; w logu oznaczone jako offline.
2. Gdy serwer nadal jest niedostępny, student zapisuje log lokalnie. Taki log jest wyraźnie oznaczony (fragmenty offline / brak prawidłowego odcisku). Skrypt w LM nie odrzuca go automatycznie, tylko informuje nauczyciela o przerwanym połączeniu; decyzję podejmuje nauczyciel.
3. Start zadania przy niedostępnym serwerze: dozwolony i oznaczony w logu jako offline. Znane ryzyko: przy awarii serwera student może zacząć kilka takich startów w różnych przeglądarkach; serwer wykryje to dopiero po powrocie połączenia i pokaże w panelu.

## Poza zakresem / następny etap

- Odtwarzanie zdarzeń na serwerze własną kopią `engine.js` i liczenie błędów przez serwer – następny etap.
- Zdarzenia przełączania okna (`visibilitychange`, `blur`) – nie robimy.
- WebSocket – nie robimy.

## Ograniczenie

Nieoficjalnej kopii symulatora uruchomionej obok (jako kalkulatora) nie da się zablokować – można ją najwyżej zauważyć w podglądzie na żywo.

## Rozstrzygnięte (2026-10-30)

1. Kolejne podejście lub zmiana komputera: tylko „Wyczyść podejście”.
2. Start zadania bez serwera: dozwolony, oznaczony jako offline.
3. Sekret w LM: na stronie ustawień LM.
4. Oceny: wyłączone, widoczna tylko liczba błędów.
5. Podgląd stanu studenta (CPU wszystkich na kafelkach, pełny widok jednego) – w obecnym zakresie, nie w przyszłym etapie.

## Wdrożenie i aktualizacja

- Docker na Debianie w infrastrukturze Proxmox; dane (baza, sekret) w wolumenie `labzsk-data`, zachowywane przy aktualizacji.
- Aktualizacja z GitHuba poza zajęciami: `git pull` + `docker compose up -d --build`. Szczegółowa instrukcja po akceptacji aplikacji.
- Zalecany HTTPS przez reverse proxy.
