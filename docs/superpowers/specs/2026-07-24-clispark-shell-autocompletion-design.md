# Shell-Autocompletion für generierte CLIs (#89)

## Kontext

Roher Backlog-Einfall aus der Sichtungssession vom 2026-07-23, ursprünglich nur für Node/.NET formuliert. Diese Session (2026-07-24, direkt nach dem #82-PowerShell-Ship) hat den Scope bewusst auf alle drei Sprachen erweitert, und dabei drei reale, nicht erwartete Funde gemacht, die den ursprünglich angenommenen Zuschnitt ("ähnliches Opt-in-Muster für alle Sprachen wie #65/#70") deutlich verändern.

## Reale Funde (alle drei live in dieser Session verifiziert, nicht angenommen)

**Node:** `@oclif/plugin-autocomplete` (offizielles oclif-Plugin, unterstützt bash/zsh/**und PowerShell als Client-Shell**) real installiert und getestet — Setup ist wirklich nur zwei Config-Zeilen (`dependencies` + `oclif.plugins`-Array-Eintrag), kein einziger Code-Change nötig. `<cli> autocomplete bash` generierte sofort echte, funktionierende Setup-Anweisungen gegen ein real gescaffoldetes Testprojekt.

**.NET:** braucht **null Code-Änderungen**. System.CommandLine 2.0.10 hat die `[suggest]`-Directive bereits eingebaut — real verifiziert: `dotnet run --project src -- "[suggest]" ""` gegen ein frisch gescaffoldetes .NET-Testprojekt listete sofort alle Top-Level-Commands, ganz ohne jede Anpassung an `Program.cs`. Was fehlt, ist nur die einmalige Maschinen-Registrierung des Nutzers (`dotnet-suggest register`) plus Shell-Integration (`dotnet-suggest script <Shell>` ins Profil einbinden) — reine Dokumentation, kein Scaffold-Inhalt.

**PowerShell:** braucht **gar nichts**. Cmdlet-Namen-Vervollständigung (`Get-H<TAB>` → `Get-Hello`) und `[ValidateSet(...)]`-Parameterwert-Vervollständigung sind native PowerShell-Shell-Features für jedes importierte Modul — real mit `TabExpansion2` gegen eine echte Test-Funktion mit `[ValidateSet('World','PowerShell')]` verifiziert, beide Fälle lieferten sofort korrekte Vorschläge ohne jeden Custom-Code.

**Konsequenz:** Das ursprünglich angenommene einheitliche "Wizard-Opt-in pro Sprache"-Muster passt nur auf Node. Für .NET/PowerShell gibt es nichts zu scaffolden oder zu reconcilen — die Antwort ist "es funktioniert schon, hier ist wie du es aktivierst," nicht "willst du das haben."

## Scope

**Node:** echter, core-verwalteter Scaffold-Inhalt (Dependency + Config), Wizard-Opt-in (Default Nein) wie bei #65/#70.

**.NET, PowerShell:** kein Wizard-Opt-in, keine Wahl. Jedes generierte Projekt bekommt automatisch einen kurzen README-Abschnitt, der erklärt, dass Completion bereits funktioniert und wie man sie pro Shell aktiviert (`dotnet-suggest register` bzw. — bei PowerShell — schlicht "importiere das Modul, Tab-Completion funktioniert sofort").

**Explizit nicht Teil dieser Arbeit:**
- Jede Art von benutzerdefinierten Parameter-Wert-Completern über die jeweils native Sprachmechanik hinaus (z.B. dynamische Werte aus einer API) — reines "mach die eingebaute Mechanik nutzbar"-Feature, keine neue Completion-Engine.
- Automatische Registrierung von `dotnet-suggest register`/Shell-Profil-Änderungen durch clispark selbst — bewusst dem Nutzer überlassen (clispark editiert nie fremde Shell-Profile).

## Abhängigkeit von #70 (Lint-Tooling) — bewusste Sequenzierung

Der Node-Teil dieses Features braucht exakt das Muster, das #70s Spec bereits als "subtraktives Design" für core-verwalteten, optionalen Scaffold-Inhalt eingeführt hat (siehe `docs/superpowers/specs/2026-07-22-clispark-lint-tooling-design.md`, Abschnitt "Architecture"/"Update-system impact"): ein neues optionales `LanguagePack`-Feld nach dem `UpdateAdapter`/`RegistryChecker`/`CommandGenerator`-Muster, ein neues Manifest-Feld für die getroffene Wizard-Entscheidung, und — der bei #70 gefundene, nicht-triviale Teil — `UpdateAdapter.coreFilePaths` (und bei Node zusätzlich `CORE_SCRIPT_NAMES` sowie die Dependency-Reconciliation) müssen manifest-bewusst werden (`coreFilePaths(manifest: Manifest)` statt einer statischen Liste), sonst würde `clispark update` die Autocomplete-Dependency bei abgelehnten Projekten fälschlich nachträglich hinzufügen.

**Entscheidung (auf Nutzerwunsch):** #70 wird zuerst umgesetzt. #89 baut direkt auf dem dabei real eingeführten Mechanismus auf, statt ihn ein zweites Mal parallel zu erfinden. Der genaue Namen/die genaue Signatur des wiederverwendeten Mechanismus (`LanguagePack.lintSupport`-Pendant, exakte `coreFilePaths(manifest)`-Signatur) steht erst nach #70s Implementierung fest — dieser Spec beschreibt das analog-formulierte Zielbild, der Implementierungsplan für #89 übernimmt die dann tatsächlich existierenden echten Typnamen 1:1.

## Design: Node

**Wizard:** neue Ja/Nein-Frage ("Shell-Completion einrichten?"), Default Nein — gleiches Muster wie #65/#70.

**Scaffold-Inhalt (subtraktiv, analog #70):** `templates/node/package.json` enthält `@oclif/plugin-autocomplete` in `dependencies` und im `oclif.plugins`-Array **permanent** — bei Ablehnung entfernt ein neuer `LanguagePack`-Hook (Node-Pendant zu #70s `LintSupport.scaffoldFiles()`) beides wieder aus der kopierten Datei, post-copy, gleiches Muster wie die bestehenden `registry.applyPrivateIntent()`/`applyRegistryUrl()`-Aufrufe.

**Core-Verwaltung:** neues Manifest-Feld (`autocompleteEnabled: boolean`, analog #70s `lintEnabled`). `coreFilePaths(manifest)` liefert `package.json`s Dependency-/Plugin-Eintrag nur mit, wenn `autocompleteEnabled === true` — reuse des #70-Mechanismus 1:1, keine eigene Parallel-Lösung.

**Dokumentation:** README-Abschnitt (nur wenn aktiviert), der `<cli> autocomplete <shell>` als Einstiegspunkt erklärt.

## Design: .NET

**Kein Wizard, kein Opt-in, kein Scaffold-Inhalt.** Jedes generierte .NET-Projekt bekommt automatisch einen README-Abschnitt ("Shell completion"), der real-verifiziert erklärt:

1. `dotnet tool install -g dotnet-suggest` (einmalig pro Maschine)
2. `dotnet-suggest register --command <ausführbarer-tool-Pfad>` (einmalig pro Projekt/Installation)
3. Shell-Integrationsskript einbinden (`dotnet-suggest script <Bash|PowerShell|Zsh>` ins Profil), analog zur oclif-Anleitung
4. Danach funktioniert Tab-Completion automatisch — die `[suggest]`-Directive ist bereits Teil von System.CommandLines eigener Parsing-Pipeline, `Program.cs` bleibt unverändert.

## Design: PowerShell

**Kein Wizard, kein Opt-in, kein Scaffold-Inhalt, kein Registrierungsschritt.** README-Abschnitt (kürzer als bei Node/.NET, da wirklich nichts zu tun ist außer das Modul zu importieren): erklärt, dass Cmdlet-Namen- und `[ValidateSet]`-Parameterwert-Completion automatisch funktionieren, sobald `Import-Module ./Module.psd1` gelaufen ist — optional ein Hinweis, wie man das dauerhaft ins PowerShell-`$PROFILE` einbindet, damit das Modul nicht jede Session neu importiert werden muss (reine Komfort-Doku, kein clispark-verwalteter Inhalt, da clispark nie fremde Profile editiert).

## Entscheidungsrahmen für künftige Sprachen (auf Nutzerwunsch: Design soll das automatisch mit abdecken)

Kein einheitlicher Code-Mechanismus ist möglich, da die drei untersuchten Ökosysteme strukturell verschieden sind — stattdessen ein Entscheidungsraster für einen künftigen vierten `LanguagePack`:

1. **Hat das CLI-Framework der Sprache eine eingebaute Completion-Directive/-Mechanik** (wie .NETs `[suggest]`)? → nur Doku, kein Scaffold-Inhalt, kein Wizard.
2. **Bietet die Ziel-Shell selbst native Completion für die Art, wie die Sprache Commands registriert** (wie PowerShells modul-basierte Reflection)? → gar nichts nötig, höchstens ein Komfort-Hinweis.
3. **Sonst** (kein eingebauter Mechanismus, keine native Shell-Unterstützung) → Node-Muster: echtes Plugin/Paket, core-verwalteter Scaffold-Inhalt über den #70-Mechanismus, Wizard-Opt-in.

Bevor ein künftiger LanguagePack-Autor Fall 3 annimmt, muss er wie in dieser Session real gegenprüfen, ob nicht eigentlich Fall 1 oder 2 zutrifft — die anfängliche Annahme in diesem Backlog-Item selbst war falsch (Node UND .NET wurden ursprünglich beide als "brauchen echtes Setup" angenommen, real stimmte das nur für Node).

## Offene Punkte für den Implementierungsplan

1. **Wartet auf #70s tatsächliche Implementierung** — exakte Typnamen/Signaturen des wiederverwendeten Mechanismus stehen erst danach fest.
2. Exakte Platzierung des neuen `LanguagePack`-Hooks für Node (eigenes Feld wie `autocompleteSupport?` vs. ob #70 am Ende einen generischeren "optionale Features"-Mechanismus einführt, der beide Fälle abdeckt — abhängig von #70s finaler Implementierung, nicht vorab entscheidbar).
3. Reale Verifikation der Setup-Anleitungen für .NET/PowerShell direkt in einem echten Terminal (nicht nur `TabExpansion2`/`dotnet run -- "[suggest]"` isoliert, sondern der komplette Nutzer-Weg inkl. `dotnet-suggest register` gegen ein echtes installiertes Tool) — Teil der Task-Verifikation im Plan, nicht dieser Spec.
4. Ob `@oclif/plugin-autocomplete`s PowerShell-Client-Unterstützung (es generiert auch PowerShell-Completion-Skripte für Node-CLIs) irgendeine Überschneidung mit dem separaten PowerShell-`LanguagePack`-Thema hat — vermutlich nicht (unterschiedliche Ebenen: das eine ist "PowerShell als Nutzer-Shell für ein Node-CLI", das andere ist "ein in PowerShell selbst geschriebenes CLI"), aber nicht weiter weder recherchiert noch fürs Design relevant.

## Ergebnis

Deutlich kleineres Feature als ursprünglich angenommen — die drei real verifizierten Funde reduzieren es von "drei ähnlich aufwändige Opt-in-Mechanismen" auf "ein echter Node-Mechanismus (der #70s noch zu bauenden Kern wiederverwendet) plus zwei reine Doku-Ergänzungen." Bewusste Sequenzierung nach #70, um den subtraktiven Core-Management-Mechanismus nicht zweimal zu bauen.
