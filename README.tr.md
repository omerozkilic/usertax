# usertax

**Bu pull request kullanıcıya ne kadara mal oluyor?**

usertax her pull request'in kullanıcıya maliyetini **web** ve **mobil** (React Native, Expo ve
bare) için ölçer ve değişimin _nedenini_ açıklar: hangi bağımlılık eklendi veya güncellendi,
hangi modüller büyüdü.

> **Durum: erken geliştirme.** Henüz sürüm ve yayınlanmış bir ölçüm yok. README'ye girecek her
> rakam `examples/` altındaki uygulamalarda ölçülecek ve nasıl yeniden üretileceği
> yazılacak.

## Ne raporlayacak

- **Web:** Lighthouse performans skoru ve LCP, TBT, CLS (birden fazla koşunun medyanı ve
  dağılımı), route başına JavaScript boyutu (gzip ve brotli), base → head farkı.
- **Mobil:** iOS ve Android JS / Hermes bundle boyutu, APK / AAB / IPA boyutu ve kırılımı.
- **Neden:** PR'daki lockfile farkı ile source map'ten modül boyutlarının birleştirilmesi;
  alternatif önerileri yalnızca kaynağı belirtilmiş küratörlü bir listeden.
- **Bütçeler:** uyarı / hata eşikleri, GitHub check durumu, JSON çıktı.

## İlkeler

Deterministik çekirdek ve API anahtarı yok; dürüst rakamlar (gürültü ölçülür); sıfır
konfigürasyon; mobil build'i action yapmaz; fork PR'larında güvenli; base raporları artefakt
olarak yeniden kullanılır; monorepo desteği. Kararlar [`docs/adr/`](docs/adr/) altında.

Ayrıntılar ve yol haritası için [İngilizce README](README.md).

## Lisans

[MIT](LICENSE)
