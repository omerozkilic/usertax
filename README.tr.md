<div align="center">

# usertax

**Bu pull request kullanıcıya ne kadara mal oluyor?**<br>
Web ve mobil · _Nedenini_ açıklar · API anahtarı yok

[English README](README.md) · [Metrikler ve bütçeler](docs/metrics.md) · [Mimari kararlar](docs/adr/README.md) · [Demo](docs/demo/README.md)

</div>

---

usertax bir pull request'in kullanıcıya maliyetini ölçer: route başına gönderilen JavaScript,
Lighthouse lab metrikleri, React Native bundle'ları ve APK / AAB / IPA boyutu. Asıl farkı,
değişimin **nedenini** söylemesidir: PR'daki lockfile farkını source map'ten çıkan boyutlarla
birleştirir; yorum "bundle büyüdü" yerine _"`moment` eklendi, 60 kB getirdi"_ der.

Deterministiktir: **LLM yok, API anahtarı yok, hesap yok, veri yükleme yok.** Aynı build aynı
raporu verir.

**Kullanmak için:** GitHub Action
[`omerozkilic/usertax-action@v0`](https://github.com/marketplace/actions/usertax-pr-performance-cost) (Marketplace) · CLI ve MCP
sunucusu [`npx @usertax/cli`](https://www.npmjs.com/package/@usertax/cli). usertax 0.x
sürümünde: rapor şeması ve action girdileri küçük sürümler arasında değişebilir.

```bash
npx @usertax/cli measure apps/web -o once.json      # değişiklikten önce
npx @usertax/cli measure apps/web -o sonra.json     # değişiklikten sonra
npx @usertax/cli diff sonra.json --base once.json
```

## Gerçek bir örnek

[`examples/vite-app`](examples/vite-app) uygulamasına tarih göstermek için `moment` ekleyen bir
PR. Gerçek build'lerde ölçüldü ([yorumun tamamı](docs/demo/add-moment.md),
[nasıl yeniden üretilir](docs/demo/README.md)):

- Ana sayfanın JavaScript'i (gzip): **68.9 kB → 88.5 kB (+19.6 kB, +%28.4)**
- Neden: `moment` `2.30.1` doğrudan bağımlılık olarak eklendi, bundle'a **60.1 kB** (minified)
  ekledi.
- Alternatifler ([e18e module-replacements](https://github.com/e18e/module-replacements)):
  day.js, date-fns, luxon, Date, Temporal.

## Neden usertax?

- **Değişimi açıklar:** pnpm, npm, Yarn 1, Yarn 2+ ve Bun lockfile farkları byte düzeyinde source map
  atfıyla birleştirilir; dolaylı paketler ve onları getiren bağımlılık da gösterilir.
- **Dürüst rakamlar:** Her JavaScript byte'ı bir pakete, sizin kodunuza ya da açıkça
  "atfedilmemiş"e yazılır; toplam dosya boyutuna eşittir. Lighthouse değişimleri ölçülmüş
  gürültüye göre değerlendirilir.
- **Yalnızca kaynaklı öneriler:** Alternatifler MIT lisanslı e18e veri setinden gelir.
- **Fork PR'larında güvenli:** Ölçüm `pull_request`'te, yorum `workflow_run`'da yapılır.
- **Hızlı:** Base raporu varsayılan branch'te bir kez üretilir, her PR'da yeniden kullanılır.
- **Yapay zekâ asistanları için:** `usertax mcp` bir MCP sunucusu başlatır; kodlama ajanları
  tahmin etmek yerine usertax'in ölçtüğü rakamları kullanır ([kurulum](docs/mcp.md)).

Durum tablosu, hızlı kurulum ve geliştirme komutları için [İngilizce README](README.md).

## Lisans

[MIT](LICENSE). Alternatif paket verisi [e18e module-replacements](https://github.com/e18e/module-replacements)
(MIT) veri setinden üretilir.
