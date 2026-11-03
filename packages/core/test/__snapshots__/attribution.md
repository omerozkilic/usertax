## usertax report

Base `aaaaaaa` → head `aaaaaaa` · 1 app

### web <sub>Vite · `apps/web`</sub>

_No changes._

<details><summary>4 unchanged</summary>

| | Metric | Base | Head | Change |
| :-: | --- | --: | --: | --: |
| ⚪ | JS total (gzip) | 34.0 kB | 34.0 kB | ±0 B (±0.0%) |
| ⚪ | CSS total (gzip) | 2.0 kB | 2.0 kB | ±0 B (±0.0%) |
| ⚪ | JS for / (gzip) | 30.0 kB | 30.0 kB | ±0 B (±0.0%) |
| ⚪ | JS for /about (gzip) | 34.0 kB | 34.0 kB | ±0 B (±0.0%) |

</details>

**Packages with the largest change** <sub>minified bytes from source maps</sub>

| Package | Bundle | Base | Head | Change | Why |
| --- | --- | --: | --: | --: | --- |
| `moment` | web | – | 72.0 kB | +72.0 kB | added `2.30.1` via `@acme/dates` |
| `react-dom` | web | 60.0 kB | 61.0 kB | +1.0 kB | upgraded `19.2.0` → `19.3.1` |
| `clsx` | web | – | 400 B | +400 B | added `2.1.1` (direct) |

**Alternatives** suggested by [e18e module-replacements](https://github.com/e18e/module-replacements) 3\.4\.0:

- `moment`: day\.js, date\-fns, luxon, Date, Temporal ([guide](https://e18e.dev/docs/replacements/moment))

<details><summary>1 lockfile change without a bundle size change</summary>

| Package | Change |
| --- | --- |
| `vite` | upgraded `8.3.4` → `8.3.5` <sub>dev</sub> |

</details>

<sub>usertax 0\.1\.0 · gzip level 9, brotli quality 11</sub>