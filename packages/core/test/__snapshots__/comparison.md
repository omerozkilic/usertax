<!-- usertax:report -->

## usertax report

Base `aaaaaaa` → head `ccccccc` · 2 apps · ❌ 1 budget failed

### web <sub>Vite · `apps/web`</sub>

| | Metric | Base | Head | Change |
| :-: | --- | --: | --: | --: |
| 🔴 | JS total (gzip) | 34.0 kB | 56.0 kB | +22.0 kB (+64.7%) |
| 🔴 | JS for / (gzip) | 30.0 kB | 52.0 kB | +22.0 kB (+73.3%) |
| 🔴 | JS for /about (gzip) | 34.0 kB | 56.0 kB | +22.0 kB (+64.7%) |

<details><summary>2 unchanged</summary>

| | Metric | Base | Head | Change |
| :-: | --- | --: | --: | --: |
| ⚪ | CSS total (gzip) | 2.0 kB | 2.0 kB | ±0 B (±0.0%) |
| ⚪ | CSS for / (gzip) | 2.0 kB | 2.0 kB | ±0 B (±0.0%) |

</details>

**Packages with the largest change** <sub>minified bytes from source maps</sub>

| Package | Bundle | Base | Head | Change |
| --- | --- | --: | --: | --: |
| `moment` | web | – | 72.0 kB | +72.0 kB |

**Alternatives** suggested by [e18e module-replacements](https://github.com/e18e/module-replacements) 3\.4\.0:

- `moment`: day\.js, date\-fns, luxon, Date, Temporal ([guide](https://e18e.dev/docs/replacements/moment))

<details><summary>Files with the largest change (gzip)</summary>

| File | Base | Head | Change |
| --- | --: | --: | --: |
| `assets/index-1a2b3c.js` | 30.0 kB | 52.0 kB | +22.0 kB |

</details>

### mobile <sub>Expo · `apps/mobile`</sub>

| | Metric | Base | Head | Change |
| :-: | --- | --: | --: | --: |
| 🔴 | Android APK \(android\) | 30.0 MB | 30.4 MB | +400.0 kB (+1.3%) |

<details><summary>4 unchanged</summary>

| | Metric | Base | Head | Change |
| :-: | --- | --: | --: | --: |
| ⚪ | Android JS bundle \(Hermes bytecode\) | 2.0 MB | 2.0 MB | ±0 B (±0.0%) |
| ⚪ | android\: dex \(compressed\) | 8.0 MB | 8.0 MB | ±0 B (±0.0%) |
| ⚪ | android\: js\-bundle \(compressed\) | 1.0 MB | 1.0 MB | ±0 B (±0.0%) |
| ⚪ | android\: native \(compressed\) | 20.0 MB | 20.0 MB | ±0 B (±0.0%) |

</details>

<details><summary>Archive entries with the largest change (compressed)</summary>

| Entry | Archive | Category | Base | Head | Change |
| --- | --- | --- | --: | --: | --: |
| `res/drawable-xxhdpi/hero.png` | `android` | resources | – | 400.0 kB | +400.0 kB |

</details>

### Budgets

| | App | Metric | Limit | Actual | Result |
| :-: | --- | --- | --- | --: | --- |
| ❌ | `web` | JS total | maxIncrease +10.0 kB | +22.0 kB | maxIncrease exceeded |
| ✅ | `mobile` | Android APK \(android\) | max 50.0 MB | 30.4 MB | max within limit |

Budgets that matched no metric: `*` / `nope.*`

<sub>usertax 0\.1\.0 · gzip level 9, brotli quality 11 · [workflow run](https://github.com/o/r/actions/runs/1)</sub>