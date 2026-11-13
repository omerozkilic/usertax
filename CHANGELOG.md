# Changelog

## [0.3.0](https://github.com/omerozkilic/usertax/compare/v0.2.0...v0.3.0) (2026-11-13)


### Features

* **core:** budget the bytes of each package with package[&lt;name&gt;].bytes ([#82](https://github.com/omerozkilic/usertax/issues/82)) ([2411604](https://github.com/omerozkilic/usertax/commit/24116045adb032072c03973661dd5585af0eee2b))
* **measure,core:** explain why a dependency was added with the chain from a direct dependency ([#78](https://github.com/omerozkilic/usertax/issues/78)) ([370711a](https://github.com/omerozkilic/usertax/commit/370711a9deba78ca2dfabf7939983d53ab8d0801))
* **measure,core:** mark Lighthouse runs with browser extensions active as not comparable ([53fc739](https://github.com/omerozkilic/usertax/commit/53fc7394ef30574db79cb44282e971da53bb6649))
* **measure,core:** report packages bundled in more than one version ([#71](https://github.com/omerozkilic/usertax/issues/71)) ([100dc44](https://github.com/omerozkilic/usertax/commit/100dc445102f29723ad8d577d87d73a127d1bceb))
* **measure,core:** report the CSS each route loads as route[].css.* ([#80](https://github.com/omerozkilic/usertax/issues/80)) ([dd3b938](https://github.com/omerozkilic/usertax/commit/dd3b938d33076915ac1c7221e6072f4ce818676a))
* **measure,core:** report the images and fonts each route references ([#81](https://github.com/omerozkilic/usertax/issues/81)) ([e6d70f7](https://github.com/omerozkilic/usertax/commit/e6d70f75f6c89463d4ea8367dfa7276b69c32002))
* **measure:** measure Astro and SvelteKit apps with routes from their prerendered pages ([#75](https://github.com/omerozkilic/usertax/issues/75)) ([230d720](https://github.com/omerozkilic/usertax/commit/230d7200cfbadc9d1225d4c4a54c52d467f9e235))
* **measure:** measure Nuxt apps with routes from their prerendered pages ([f7ff25a](https://github.com/omerozkilic/usertax/commit/f7ff25acfde7cfda5ba124ece4511e0711210e29))
* **measure:** measure React Router framework-mode apps with routes from their client manifest ([#77](https://github.com/omerozkilic/usertax/issues/77)) ([ecc1c83](https://github.com/omerozkilic/usertax/commit/ecc1c83f345d5fd1bc90987f0ffaf0c992cc5354))
* **measure:** measure Rsbuild and Rspack builds ([#84](https://github.com/omerozkilic/usertax/issues/84)) ([2564670](https://github.com/omerozkilic/usertax/commit/2564670b17f4059f3b0bebb0ba2358ecb18ecbe5))


### Bug Fixes

* **measure:** do not gzip and brotli files in compressed formats ([#86](https://github.com/omerozkilic/usertax/issues/86)) ([5fdaa7a](https://github.com/omerozkilic/usertax/commit/5fdaa7a3c0be4a980a5ce9ca99cc428a79bc62ca))
* **measure:** read the prerendered page of React Router routes for images ([#87](https://github.com/omerozkilic/usertax/issues/87)) ([3c30694](https://github.com/omerozkilic/usertax/commit/3c306941fb7e0a54eb5fd083ac22b64f1fcb9036))
* **security:** override node-forge to 1.4.3 in the Expo example's tooling ([#85](https://github.com/omerozkilic/usertax/issues/85)) ([719ebd3](https://github.com/omerozkilic/usertax/commit/719ebd342d385617c794758955a681c019473eed))

## [0.2.0](https://github.com/omerozkilic/usertax/compare/v0.1.4...v0.2.0) (2026-11-07)


### Features

* **cli:** `usertax init` writes the workflows and configuration for a repository ([#37](https://github.com/omerozkilic/usertax/issues/37)) ([f2be100](https://github.com/omerozkilic/usertax/commit/f2be1000eae1241d8db014f0eb3d56b83de7782e))
* **measure:** read Bun lockfiles (bun.lock) ([#38](https://github.com/omerozkilic/usertax/issues/38)) ([89986f9](https://github.com/omerozkilic/usertax/commit/89986f93520231a7fbfa37bb286c67fcb70786ac))


### Bug Fixes

* **measure:** find Next.js static files behind basePath and assetPrefix ([#31](https://github.com/omerozkilic/usertax/issues/31)) ([5b38a45](https://github.com/omerozkilic/usertax/commit/5b38a45f3c3778d9c9f692a9c808557fe5011982))

## [0.1.4](https://github.com/omerozkilic/usertax/compare/v0.1.3...v0.1.4) (2026-11-04)


### Bug Fixes

* **security:** require patched Node.js releases and patch vulnerable dev dependencies ([#28](https://github.com/omerozkilic/usertax/issues/28)) ([252be76](https://github.com/omerozkilic/usertax/commit/252be7669dcc107b3b679a980ad98597c49746ca))

## [0.1.3](https://github.com/omerozkilic/usertax/compare/v0.1.2...v0.1.3) (2026-11-04)


### Bug Fixes

* **cli:** publish to npm as @usertax/cli ([#24](https://github.com/omerozkilic/usertax/issues/24)) ([f2ca445](https://github.com/omerozkilic/usertax/commit/f2ca445729c690cabe9a30da4f0594b1f7ba3ed7))

## [0.1.2](https://github.com/omerozkilic/usertax/compare/v0.1.1...v0.1.2) (2026-11-04)


### Bug Fixes

* **examples:** export the Expo example one platform at a time for reproducible bundles ([#21](https://github.com/omerozkilic/usertax/issues/21)) ([8ad13b3](https://github.com/omerozkilic/usertax/commit/8ad13b3e457a07c13960d12fb9c11a1a4d436673))

## [0.1.1](https://github.com/omerozkilic/usertax/compare/v0.1.0...v0.1.1) (2026-11-04)


### Bug Fixes

* **action:** inject the version at bundle time so the released action starts ([#18](https://github.com/omerozkilic/usertax/issues/18)) ([a5fe723](https://github.com/omerozkilic/usertax/commit/a5fe723ab0dbc4bbe9dc701e5bf17c3bf876eeab))

## 0.1.0 (2026-11-04)


### Features

* **action:** budget commit status on the PR, base recreation and renamed apps ([#13](https://github.com/omerozkilic/usertax/issues/13)) ([8356ca6](https://github.com/omerozkilic/usertax/commit/8356ca68ea3bbe8536f6b4101dfdb742908484a1))
* calibrated Lighthouse noise thresholds from 3 runners × 30 runs (ADR 0007 accepted) ([#10](https://github.com/omerozkilic/usertax/issues/10)) ([6cfba2c](https://github.com/omerozkilic/usertax/commit/6cfba2cbb9212520a17f974a4ba4e2a7ca5dea05))
* **cli:** MCP server for coding agents (`usertax mcp`) ([#15](https://github.com/omerozkilic/usertax/issues/15)) ([6782624](https://github.com/omerozkilic/usertax/commit/6782624bf86109df9a98fb1b75e0569313d3bfb5))
* configuration file, monorepo discovery and budgets in the CLI (M6a) ([#8](https://github.com/omerozkilic/usertax/issues/8)) ([3575da4](https://github.com/omerozkilic/usertax/commit/3575da487f62f1e5c8dd60aa1877d3aee0cf02b5))
* explain package changes with lockfile diffs and e18e alternatives (M3) ([#5](https://github.com/omerozkilic/usertax/issues/5)) ([87e77cc](https://github.com/omerozkilic/usertax/commit/87e77cc449df7d5dd9efe2bec0a0ca99cb617c2e))
* GitHub Action with fork-safe measure and comment workflows (M6b) ([#9](https://github.com/omerozkilic/usertax/issues/9)) ([4e32f40](https://github.com/omerozkilic/usertax/commit/4e32f40ebd130114884ecc3744ade77ab960edf1))
* **measure:** measure Next.js webpack builds with honest attribution ([#12](https://github.com/omerozkilic/usertax/issues/12)) ([18e6a90](https://github.com/omerozkilic/usertax/commit/18e6a908b8aedcf47d7e37bb059cb91424279a33))
* Next.js routes, Lighthouse runs and noise calibration (M4) ([#6](https://github.com/omerozkilic/usertax/issues/6)) ([ff27004](https://github.com/omerozkilic/usertax/commit/ff2700441a65c5f7ae51b62473a9f96d17eda7ef))
* React Native, Expo and APK / AAB / IPA measurement (M5) ([#7](https://github.com/omerozkilic/usertax/issues/7)) ([ddbb37c](https://github.com/omerozkilic/usertax/commit/ddbb37c29ed888697dafaa7553d3329b401b820e))
* report schema, diff, budgets, rendering and web bundle measurement (M1 + M2) ([#4](https://github.com/omerozkilic/usertax/issues/4)) ([cae44d4](https://github.com/omerozkilic/usertax/commit/cae44d46fc6647ad04c4eef7606e4ae024fee2ff))


### Bug Fixes

* **core:** Lighthouse noise floors that hold across runners, plus a warm-up run ([#17](https://github.com/omerozkilic/usertax/issues/17)) ([eac9ce2](https://github.com/omerozkilic/usertax/commit/eac9ce2e989f86b0b1a6b8a560f12ba573eec598))
