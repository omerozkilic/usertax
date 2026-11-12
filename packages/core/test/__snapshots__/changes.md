## usertax report

Base `aaaaaaa` → head `aaaaaaa` · 3 apps · ⚠️ 2 budget warnings

### web <sub>Vite · `apps/web`</sub>

| | Metric | Base | Head | Change |
| :-: | --- | --: | --: | --: |
| 🟢 | JS total (gzip) | 37.0 kB | 34.0 kB | -3.0 kB (-8.1%) |
| 🟢 | CSS total (gzip) | 2.0 kB | 1.5 kB | -500 B (-25.0%) |
| 🆕 | JS for /new (gzip) | – | 4.0 kB | new |
| ➖ | JS for / (gzip) | 30.0 kB | – | removed |
| ➖ | CSS for / (gzip) | 2.0 kB | – | removed |

<details><summary>1 unchanged</summary>

| | Metric | Base | Head | Change |
| :-: | --- | --: | --: | --: |
| ⚪ | JS for /about (gzip) | 34.0 kB | 34.0 kB | ±0 B (±0.0%) |

</details>

**Packages with the largest change** <sub>minified bytes from source maps</sub>

| Package | Bundle | Base | Head | Change |
| --- | --- | --: | --: | --: |
| `lodash` | web | 9.0 kB | – | -9.0 kB |

<details><summary>Files with the largest change (gzip)</summary>

| File | Base | Head | Change |
| --- | --: | --: | --: |
| `legacy-1.js` | 3.0 kB | – | -3.0 kB |

…and 1 more changed file.

</details>

### new\-app <sub>Expo · `apps/new-app` · new app</sub>

| | Metric | Base | Head | Change |
| :-: | --- | --: | --: | --: |
| 🆕 | Android JS bundle \(Hermes bytecode\) | – | 2.0 MB | new |
| 🆕 | Android APK \(android\) | – | 30.0 MB | new |
| 🆕 | android\: dex \(compressed\) | – | 8.0 MB | new |
| 🆕 | android\: js\-bundle \(compressed\) | – | 1.0 MB | new |
| 🆕 | android\: native \(compressed\) | – | 20.0 MB | new |

**Packages with the largest change** <sub>minified bytes from source maps</sub>

| Package | Bundle | Base | Head | Change |
| --- | --- | --: | --: | --: |
| `react-native` | Android | – | 500.0 kB | +500.0 kB |

…and 1 more changed package.

### old\-app <sub>Expo · `apps/mobile` · removed</sub>

| | Metric | Base | Head | Change |
| :-: | --- | --: | --: | --: |
| ➖ | Android JS bundle \(Hermes bytecode\) | 2.0 MB | – | removed |
| ➖ | Android APK \(android\) | 30.0 MB | – | removed |
| ➖ | android\: dex \(compressed\) | 8.0 MB | – | removed |
| ➖ | android\: js\-bundle \(compressed\) | 1.0 MB | – | removed |
| ➖ | android\: native \(compressed\) | 20.0 MB | – | removed |

**Packages with the largest change** <sub>minified bytes from source maps</sub>

| Package | Bundle | Base | Head | Change |
| --- | --- | --: | --: | --: |
| `react-native` | Android | 500.0 kB | – | -500.0 kB |

…and 1 more changed package.

### Budgets

| | App | Metric | Limit | Actual | Result |
| :-: | --- | --- | --- | --: | --- |
| ⚠️ | `web` | CSS total | maxDecreasePercent 10% | 25% | maxDecreasePercent exceeded |
| ⚠️ | `web` | JS total | min 50.0 kB | 34.0 kB | below min |

<sub>usertax 0\.1\.0 · gzip level 9, brotli quality 11</sub>