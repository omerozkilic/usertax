<!-- usertax:report -->

## usertax report

Base `aaaaaaa` → head `bbbbbbb` · 1 app · ⏭️ 1 budget skipped

> [!WARNING]
> Lighthouse ran with browser extensions active on head for / \(mobile\) \(chrome\-extension\://nojlinpnfpblhnlcjpgaeankkhjbnean\)\. Those scores are not comparable and are not checked against budgets\.

### site <sub>Next.js · `apps/site`</sub>

| | Metric | Base | Head | Change |
| :-: | --- | --: | --: | --: |
| ⚠️ | Performance score \(/, mobile\) | 90 <sub>IQR 0, n=3</sub> | 60 <sub>IQR 0, n=3</sub> | -30 (-33.3%) <sub>not comparable</sub> |
| ⚠️ | LCP \(/, mobile\) | 1.8 s <sub>IQR 0 ms, n=3</sub> | 3.2 s <sub>IQR 0 ms, n=3</sub> | +1.4 s (+77.8%) <sub>not comparable</sub> |

<details><summary>2 unchanged</summary>

| | Metric | Base | Head | Change |
| :-: | --- | --: | --: | --: |
| ⚠️ | TBT \(/, mobile\) | 100 ms <sub>IQR 0 ms, n=3</sub> | 100 ms <sub>IQR 0 ms, n=3</sub> | ±0 (±0.0%) <sub>not comparable</sub> |
| ⚠️ | CLS \(/, mobile\) | 0.01 <sub>IQR 0, n=3</sub> | 0.01 <sub>IQR 0, n=3</sub> | ±0 (±0.0%) <sub>not comparable</sub> |

</details>

### Budgets

| | App | Metric | Limit | Actual | Result |
| :-: | --- | --- | --- | --: | --- |
| ⏭️ | `site` | LCP \(/, mobile\) | max 2 s | – | skipped\: Lighthouse ran with browser extensions active |

<sub>usertax 0\.1\.0 · gzip level 9, brotli quality 11</sub>