# Python-Template (#136)

## Kontext

Die `LanguagePack`-Architektur (M12) hat mit Node/oclif, .NET/System.CommandLine und zuletzt PowerShell (#82, siehe `2026-07-24-clispark-powershell-template-design.md`) bewiesen, dass ein neues Sprach-Template ohne Änderung an `wizard.ts`/`scaffold.ts`/`update.ts`/`add.ts`/`manifest.ts` möglich ist — verifiziert in dieser Session erneut durch Quellcode-Lektüre von `wizard.ts`: die Sprachauswahl iteriert bereits generisch über `Object.values(LANGUAGE_PACKS)`, keine hartkodierten Sprachnamen im generischen Engine-Code.

Auslöser: Community-Issue #136 (@Tefchen, 2026-08-06) — Wunsch nach einem Python-Projekt-Skelett (`rsc/`, `classes/`, `tests/`, `pyproject.toml`, keine explizite CLI-Argument-Parsing-Bibliothek erwähnt). Da clispark explizit *CLI-Tools* generiert (siehe `clispark.plan.md`, Beschreibung), wurde das mit dem Maintainer abgeglichen (2026-08-07, siehe Frage/Antwort-Runde) und als echtes CLI-Template konkretisiert: **Typer** (Framework), **uv** (Build/Dependency-Tool), **structlog** (Logging), PyPI (Registry) — als Kommentar auf #136 gepostet, Rückmeldung von @Tefchen zum Zeitpunkt dieser Spec noch ausstehend. Der Plan ist unabhängig davon startbar, da die Kernrichtung (CLI statt generisches Package) architektonisch aus clisparks eigener Projektdefinition folgt, nicht aus der Rückmeldung.

Zuschnitt für v1 (mit dem Maintainer abgestimmt): schlank wie beim PowerShell-Template — Scaffold, Update-Mechanismus, PyPI-Namenscheck, `clispark add` kommen mit v1; Lint-Tooling-Opt-in (#70-Äquivalent, vermutlich `ruff`) und eine Command-Convention-Lint-Regel (#80-Äquivalent) werden bewusst als eigene, spätere Issues zurückgestellt.

## Scope

**Ziel:** `pythonPack: LanguagePack` — ein Python-**CLI-Tool** (Typer) als viertes Sprach-Template, mit automatischem strukturiertem Logging pro Command ohne Opt-out (gleiches Prinzip wie bei den drei bestehenden Templates), `clispark add`- und `clispark update`-Unterstützung.

**Explizit nicht Teil dieser Session:**
- Lint-Tooling-Opt-in (`ruff`) — eigenes späteres Issue, analog #70
- Command-Convention-Lint-Regel (BaseCommand-Erzwingung à la #80) — eigenes späteres Issue
- Alles aus "Bewusst nicht Teil dieser Arbeit" unten

## Architektur-Überblick

`pythonPack` implementiert `LanguagePack` exakt wie `powershellPack`, ohne Änderung an der generischen Engine:

```ts
export const pythonPack: LanguagePack = {
  id: 'python',
  displayName: 'Python (Typer)',
  templateDir: path.join(findPackageRoot(), 'templates', 'python'),
  scaffoldCommands: [
    { command: 'uv', args: ['sync'] },
  ],
  validateProjectName,
  updateAdapter: pythonAdapter,
  registry: { /* PyPI-RegistryChecker, siehe unten */ },
  commandGenerator: pythonCommandGenerator,
  stripLintTooling: async () => {},       // v1: kein Lint-Opt-in, siehe Scope
  supportsAutocompleteOptIn: false,        // kommt kostenlos mit Typer, siehe unten
  stripAutocompleteSupport: async () => {},
  stripCommandConvention: async () => {},  // v1: keine Command-Convention-Regel, siehe Scope
};
```

Vier neue Bausteine, analog zur bestehenden Struktur: `templates/python/` (Template-Inhalt), `src/update/adapters/python.ts` (`UpdateAdapter`), `src/languages/registry-checkers/pypi.ts` (`RegistryChecker`), `src/languages/command-generators/python.ts` (`CommandGenerator`).

`scaffoldCommands: uv sync` installiert Dependencies und legt `.venv` an — ein einzelner Befehl, kein Mehrschritt wie bei Node (`npm install` + `npm run build`), da Python keinen Kompilierschritt kennt und `uv sync` Dependency-Resolution und venv-Erstellung in einem Aufruf erledigt (echt gegen `uv`s Dokumentation abgeglichen).

Passt dieser Überblick so weit?

## Ordnerstruktur (Template)

```
templates/python/
  pyproject.toml              # Kern-Datei, core-verwaltet
  app/
    __init__.py
    cli.py                    # Entry Point: baut den Command-Tree via discover.py auf (Kern-Datei)
    base_command.py           # BaseCommand-Abstraktion + structlog-Wrapper (Kern-Datei)
    discover.py                # Auto-Discovery-Scanner (Kern-Datei)
    commands/
      __init__.py
      hello.py                 # Beispiel-Command, analog zu hello.ts/HelloCommand.cs/Get-Hello.ps1
  tests/
    test_hello.py
  ARCHITECTURE.md
  README.md
  .gitignore
```

`commands/` = Konvention für Commands, ein Modul pro Command, **Ordnerstruktur = Command-Pfad** (Unterordner = Command-Gruppe) — direktes Pendant zu Node/oclifs `src/commands/`-Konvention (Dateiname/Pfad = Command-Name), näher an oclif als am .NET-Attribut-Ansatz, weil Python keine Compile-Zeit-Reflection wie C# hat und der Scan ohnehin nötig ist.

**Echter Architektur-Fund (beim Plan-Entwurf, nicht mehr Python-typisches "src-layout"):** ein `src/<project_name>/`-Layout (Python-Idiom) würde `coreFilePaths` — eine statische, projektunabhängige Pfadliste (siehe `src/update/adapter.ts`) — brechen, weil der Package-Ordnername dann vom Projektnamen abhinge. Exakt dasselbe Problem, das die PowerShell-Spec für `Module.psd1`/`.psm1` und die .NET-Spec für `Cli.csproj`/`Program.cs` bereits gelöst haben: **fester Package-Ordnername (`app/`), unabhängig vom Projektnamen.** `[project].name` in `pyproject.toml` trägt weiterhin den echten Projektnamen; der importierbare Package-Ordner heißt immer `app`. `coreFilePaths` wird dadurch trivial statisch: `app/base_command.py`, `app/discover.py`, `app/cli.py`, `ARCHITECTURE.md`, `.gitignore`.

## Command-Auto-Discovery & BaseCommand — real verifiziert

**Dies war der als am unklarsten eingestufte Teil und wurde in dieser Session echt prototypt und ausgeführt** (gleiche Disziplin wie beim PowerShell-Proxy-Wrapper-Mechanismus in dessen Spec) — nicht nur angenommen.

Mechanik: `discover.py` läuft beim Start rekursiv über `commands/` (`pathlib`-basierter Verzeichnis-Walk, kein `pkgutil.walk_packages`, weil wir Ordner explizit als Typer-Sub-Apps mounten müssen, nicht nur Module importieren). Jede `.py`-Datei exportiert ein `app: typer.Typer()`-Objekt mit genau einem `@app.callback(invoke_without_command=True)`, dessen Body eine `BaseCommand`-Unterklasse instanziiert und aufruft. Jeder Unterordner mit `__init__.py` wird zu einer eigenen Typer-Gruppe, rekursiv mit `add_typer(sub_app, name=folder_name)` im Elternbaum gemountet.

`BaseCommand` (abstrakte Klasse, `run(self, **kwargs)` abstrakt) wrapt jeden Aufruf über `__call__`: strukturiertes `structlog`-Log `started` vor, `completed` (mit Dauer) nach Erfolg, `failed` (mit Fehlermeldung + Dauer) bei Exception — Exception wird nach dem Log-Eintrag erneut geworfen (`raise`), nicht geschluckt, exakt das gleiche "throw nicht schlucken"-Prinzip wie bei Node/.NET/PowerShell.

**Real verifiziert (diese Session, echter Python-3.11-Interpreter + venv mit Typer 0.x/structlog installiert):**
- Top-Level-Command (`hello --name Martin`): korrektes `started`/`completed`-Logging mit Timing, Parameterübergabe funktioniert.
- Verschachtelter Command über zwei Ordnerebenen (`task create "Buy milk"`): Ordnerpfad wird korrekt zum Command-Pfad `task create`, Discovery + Nesting funktionieren ohne manuelle Registrierung.
- Fehlerfall (`boom`, wirft `RuntimeError`): `failed`-Log mit Original-Fehlermeldung erscheint, Exception wird tatsächlich weitergereicht (Exit-Code 1), nicht verschluckt.
- `--help` zeigt automatisch generierte Befehlsübersicht (`boom`, `hello`, `task`) — Discovery-Baum korrekt im CLI-Interface sichtbar.

**Echter Nebenfund:** Typers Standardverhalten zeigt bei ungefangenen Exceptions zusätzlich einen formatierten Rich-Traceback auf stderr, *nachdem* unser `failed`-Log bereits geschrieben wurde — kein Fehler, aber eine Design-Entscheidung für den Plan (siehe "Offene Punkte" unten): Standardverhalten beibehalten oder `typer.Typer(pretty_exceptions_enable=False)` setzen.

## Autocompletion — kostenlos, kein Opt-in nötig (echter Fund)

**Korrektur gegenüber der ursprünglichen Kommentar-Ankündigung auf #136:** Typer bringt Shell-Completion bereits eingebaut mit — im obigen Testlauf erschienen `--install-completion`/`--show-completion` automatisch in der `--help`-Ausgabe, ganz ohne eigenen Code. Das reiht Python damit in dieselbe Kategorie wie .NET/PowerShell aus #89 ein ("braucht null Code-Änderungen"), nicht wie Node (das echte Scaffold-Inhalte via `@oclif/plugin-autocomplete` braucht). **Kein Wizard-Opt-in nötig** — nur ein kurzer README-Hinweis, analog zu den .NET-/PowerShell-Abschnitten aus #89. Damit entfällt der ursprünglich im #136-Kommentar angekündigte separate Autocompletion-Issue für Python.

## Projektname-Validierung

**Korrektur gegenüber einer ursprünglichen Annahme dieser Spec:** ursprünglich war hier snake_case vorgesehen, mit der Begründung, der Projektname würde direkt zum importierbaren Package-Namen. Das gilt nach dem festen `app/`-Package-Ordnernamen (siehe oben) nicht mehr — der Projektname taucht nur noch als PyPI-Distributionsname (`[project].name`) und als `[project.scripts]`-Befehlsname auf, beides Kontexte, die Bindestriche problemlos erlauben (PyPI normalisiert `-`/`_`/`.` ohnehin als äquivalent) und bei denen Bindestriche sogar idiomatischer sind (`black`, `ruff`, `pip-tools`). Damit entfällt der Python-spezifische Sonderfall komplett — `pythonPack` kann `nodeOclifPack`s Namensvalidierung unverändert wiederverwenden:

```ts
function validateProjectName(value: string | undefined): string | undefined {
  if (!value || value.trim().length === 0) return 'Project name is required.';
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(value)) {
    return 'Use lowercase letters and numbers, with single hyphens between words (no leading, trailing, or repeated hyphens).';
  }
  return undefined;
}
```

## Command-Naming & `CommandGenerator`

`pathSegments` mappen 1:1 auf verschachtelte Ordner unter `commands/` (wie bei Node/oclif) — `generateCommand()` erzeugt `app/commands/<seg1>/.../​<segN>.py` (Typer-App + BaseCommand-Unterklasse, plus ein `__init__.py` in jedem neu angelegten Zwischenordner, damit `discover.py`s Scan ihn als Gruppe erkennt) plus `tests/test_<segN>.py` (pytest, nutzt `typer.testing.CliRunner` für In-Process-Invocation ohne echten Subprozess-Start, analog zu `@oclif/test`s `runCommand`).

`ParameterType` → Typer-Parameter: `string`→`str`, `integer`→`int`, `boolean`→`bool` (Typer macht daraus automatisch ein `--flag/--no-flag`-Options-Paar), `enum`→eine generierte `class ...(str, Enum)` mit den `allowedValues` als Mitgliedern (Typers dokumentierter, typsicherer Weg für Choice-Constraints — bewusst nicht `click.Choice` direkt, das würde Typers deklarativen Type-Hint-Stil unterlaufen, den wir als Framework-Wahl gerade wegen dieser Deklarativität getroffen haben).

**Zur "required-nach-optional"-Falle** (bei oclif/System.CommandLine zur Laufzeit abgelehnt, siehe `clispark add`-Design): Python erzwingt das bereits auf Sprachebene — eine Funktionssignatur mit einem Parameter ohne Default vor einem Parameter mit Default ist ein `SyntaxError`. `pythonCommandGenerator` muss die generierten Funktionsparameter also einfach in der Reihenfolge `required` vor `optional` aus `spec.parameters` emittieren; kein zusätzlicher Laufzeit-Check nötig (ähnlich wie PowerShell strukturell unbetroffen ist, hier aber aus einem anderen Grund: Sprach-Syntax statt fehlender Beschränkung).

`listExistingCommands()` liest die vorhandenen `commands/**/*.py`-Dateipfade rekursiv (kein AST-Parsing nötig, Pfad = Command-Pfad, exakt wie bei Node).

## Manifest & `UpdateAdapter`

`pyproject.toml` (TOML, kein JSON/XML/Data-Language) — viertes Datenformat für `UpdateAdapter`. **Anders als PowerShells `.psd1`** (eigene Datensprache ohne robuste JS-Bibliothek, daher dort Shell-out zu `pwsh`) ist TOML ein einfaches, vollständig spezifiziertes Format — echte Verifikation in dieser Session: `smol-toml@1.7.1` (npm, BSD-3-Clause, `engines.node >= 18` — kompatibel mit clisparks eigener `engines.node: >=18`-Anforderung, ~200KB) parst/schreibt TOML direkt in Node, kein Shell-out nötig.

**Anders als bei PowerShell/.NET** (wo Manifest-/Root-Dateiname bewusst *nicht* dem Projektnamen folgt, um `coreFilePaths`s statische Pfadliste nicht zu brechen) gibt es hier keinen Sonderfall: `pyproject.toml` heißt in jedem Python-Projekt unabhängig vom Package-Namen immer gleich — exakt wie Node's `package.json`. Kein Namens-Workaround nötig.

`coreFilePaths`: `pyproject.toml` wird **nicht** über den generischen Hash-Vergleichs-Pfad behandelt (eigene Merge-Logik wie bei den anderen drei Manifesten), sondern `base_command.py` und `discover.py` sind core-verwaltete Dateien (die eigentliche Auto-Logging-/Discovery-Mechanik — Pendant zu `base-command.ts`/`Module.psm1`). `commands/` und `tests/` bleiben, wie bei allen Templates, immer nutzereigen.

Kern-Felder für die Drei-Wege-Reconciliation: `[project].dependencies` (Typer, structlog als Kern-Dependencies), `[project].name`/`version`.

## PyPI-`RegistryChecker` — real verifiziert

```ts
const url = `https://pypi.org/pypi/${encodeURIComponent(name)}/json`;
// 200 = taken, 404 = available — genau wie bei npm/NuGet
```

**Real getestet in dieser Session** (echter `curl` gegen die Live-API): `requests` (bekanntermaßen vergeben) → `200`; ein zufälliger, praktisch sicher freier Name → `404`. Verhalten deckt sich exakt mit dem bestehenden npm-/NuGet-`RegistryChecker`-Muster, keine Sonderbehandlung nötig.

`applyPrivateIntent`: **genuiner No-op**, gleiche Begründung wie bei PowerShell — PyPI kennt kein Manifest-Feld, das versehentliches Veröffentlichen verhindert (anders als npms `private: true` oder NuGets `<IsPackable>false</IsPackable>`); ein `uv publish`/`twine upload` ist immer ein expliziter, credential-pflichtiger Schritt, den man schlicht nicht ausführt.

`applyRegistryUrl`: schreibt eine separate `uv.toml`-Sidecar-Datei mit einem `[[index]]`-Eintrag für die custom Registry-URL — bewusst nicht direkt in `pyproject.toml`, um Konflikte mit dessen bestehendem Drei-Wege-Merge-Mechanismus zu vermeiden (gleiches Prinzip wie `.npmrc`/`NuGet.config`/`.psresource-repository`, jeweils eigene Sidecar-Dateien statt Eingriff ins Hauptmanifest).

## Testing (pytest)

pytest (Python-Standard-Testframework, analog zu vitest/xUnit/Pester) — ein `test_<name>.py` pro Command in `tests/`, generiert via `typer.testing.CliRunner` (Clicks In-Process-Test-Runner, kein echter Subprozess nötig — schneller und robuster als `subprocess.run`, gleiches Prinzip wie `@oclif/test`s `runCommand`).

## Logging (structlog) — real verifiziert

**Real getestet in dieser Session** (siehe Discovery-Abschnitt oben): automatisches `started`/`completed`/`failed`-Logging pro Command über `BaseCommand.__call__`, strukturierte Key-Value-Ausgabe mit Zeitstempel, ganz ohne manuelle Logging-Statements im Command-Code selbst — erfüllt dasselbe Versprechen wie pino (Node)/Serilog (.NET)/PSFramework (PowerShell). Redaction sensibler Felder (z.B. `registryUrl`) und Log-Retention als Grundsatz analog zu den bestehenden Templates — exakte `structlog`-Processor-Konfiguration (JSON- vs. Konsolen-Renderer, Datei-Sink) gehört in den Implementierungsplan, nicht hierher.

## Bewusst nicht Teil dieser Arbeit

- Lint-Tooling-Opt-in (`ruff`) — eigenes späteres Issue, analog #70
- Command-Convention-Lint-Regel (BaseCommand-Erzwingung) — eigenes späteres Issue, analog #80
- Autocompletion-Opt-in-Mechanik — **nicht nötig**, kommt kostenlos mit Typer (siehe oben), nur ein README-Hinweis
- Alles aus #90–#101 (`.clisparkrc`, `clispark doctor`, Dependabot/Renovate, CI-Test-Workflow, CodeQL-Sync, Mermaid-Diagramm, post-add/post-update-Hooks, SBOM) — eigenständige, sprachunabhängige Backlog-Items

## Offene Punkte für den Implementierungsplan

1. **Rich-Traceback bei ungefangenen Exceptions** (echter Fund, siehe oben): Typers Default-Verhalten beibehalten oder `pretty_exceptions_enable=False` setzen? **Empfehlung:** Default beibehalten — konsistent mit dem "throw nicht schlucken"-Prinzip, unser eigenes `failed`-Log erscheint ohnehin sauber vorgelagert.
2. **`uv.toml` vs. `[tool.uv]`-Sektion direkt in `pyproject.toml`** für die custom Registry-URL — Empfehlung: separate `uv.toml`-Datei (Begründung siehe oben), zur Bestätigung im Plan.
3. **Rückmeldung von @Tefchen auf den #136-Kommentar** — zum Zeitpunkt dieser Spec noch ausstehend. Plan ist unabhängig davon startbar; falls eine Rückmeldung vor Plan-Beginn eintrifft, in den Plan einarbeiten.
4. **Exakte `structlog`-Processor-Konfiguration** (Konsolen- vs. JSON-Renderer, Datei-Sink, Redaction-Liste) — Prinzip wichtiger als exakte API an dieser Stelle, Details gehören in den Plan.
5. **Python-Mindestversion** — noch nicht real recherchiert (anders als die 7.4+-Recherche bei PowerShell). Sollte im Plan kurz verifiziert werden (Typer-/structlog-Mindestanforderungen, vermutlich 3.10+ wegen moderner Type-Hint-Syntax) — diese Session hat nur gegen lokal verfügbares Python 3.11 getestet, kein Hinweis auf eine niedrigere Grenze.

## Ergebnis

Vollständiges Design für ein viertes `LanguagePack` (Python, Typer-CLI), das den unklarsten Mechanismus (dateisystembasierte Command-Discovery + automatisches strukturiertes Logging ohne Opt-out) bereits real prototypt und ausgeführt hat — inklusive eines echten positiven Fundes (Autocompletion kommt kostenlos mit Typer, kein Opt-in-Mechanismus nötig, anders als ursprünglich im #136-Kommentar angekündigt) und einer real gegen die Live-PyPI-API verifizierten Registry-Check-Logik. Fünf konkrete offene Punkte bleiben für den Implementierungsplan, mit jeweils einer begründeten Empfehlung, wo eine sinnvoll ist.
