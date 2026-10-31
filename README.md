# Kıvılcım

Sınıf için canlı bilgi yarışması. Öğretmen sorularını hazırlar, büyük ekranda oyunu açar; öğrenciler kendi telefonlarından, kendi internetleriyle **6 haneli oda koduyla** katılır. Ücretsiz, hesap gerektirmez, reklam yok.

- **Quiz stüdyosu:** Soruları elle yaz ya da içe aktar (düz metin, CSV, JSON). Soru başına süre, 2–4 şık, şıkları karıştırma.
- **Canlı oyun:** Geri sayım, cevap dağılımı, hız ve seri puanı, her sorudan sonra sıralama, sonda kürsü.
- **Gizlilik:** Hesap ve veritabanı yok. Quizler öğretmenin tarayıcısında saklanır; sunucu yalnızca açık odalardaki quizi bellekte tutar ve oda kapanınca siler. Doğru cevap süre bitmeden telefonlara gönderilmez.
- **Bağımlılık yok:** Sadece Node.js. `npm install` bile gerekmez.

## Kullanım

| Sayfa | Kim için |
| --- | --- |
| `/olustur` | Öğretmen: quiz hazırla, “Oyna”ya bas |
| `/ekran` | Öğretmen: büyük ekran (Oyna’ya basınca açılır) |
| `/` | Öğrenci: oda kodu ve adla katıl |

Büyük ekranda **Enter** bir sonraki adıma geçer.

## Bilgisayarında çalıştır

```bash
npm start
```

Sonra `http://localhost:3000/olustur` adresini aç. Aynı Wi‑Fi’daki telefonlar, ekranda yazan yerel adresle katılabilir.

## İnternette yayınla (ücretsiz, Render)

1. Bu depoyu kendi GitHub hesabına fork’la.
2. [render.com](https://render.com)’a GitHub ile giriş yap → **New → Blueprint** → fork’unu seç → **Apply**.
3. Birkaç dakika içinde `https://…onrender.com` adresin hazır olur. `/olustur`’dan başla.

Ücretsiz planda sunucu 15 dakika kullanılmazsa uyur; ilk açılış yaklaşık bir dakika sürer. Dersten önce sayfayı açman yeterli. Sunucu yeniden başlarsa açık odalar kapanır (quizlerin tarayıcında durduğu için kaybolmaz; ekran kendiliğinden yeni oda açar).

Başka bir sunucuda çalıştırmak için tek gereken Node 18+ ve `PORT` ortam değişkeni.

## İçe aktarma biçimleri

**Düz metin** (yapıştır ya da `.txt`). Doğru şıkkın sonuna `*` koy ya da altına `Cevap: B` yaz:

```
1. Bir yılda kaç ay vardır?
A) 10
B) 12 *
C) 13

2. Suyun kimyasal formülü nedir?
A) CO2
B) H2O
Cevap: B
```

**CSV** (Excel’de “CSV olarak kaydet”). Sütunlar: `soru; A; B; C; D; doğru; süre`. Doğru cevap `A–D` ya da `1–4`; süre isteğe bağlı (5, 10, 20, 30, 60, 90, 120 sn). İlk satır başlık olabilir.

**JSON**: Stüdyodaki ⤓ düğmesiyle indirdiğin dosyalar.

Sınırlar: quiz başına 100 soru, soru 160, şık 80 karakter.

## Puanlama

Doğru cevap, kalan süreye göre 500–1000 puan alır. Üst üste doğru cevaplar her soruda +50 ekler (en fazla +150). Yanlış ya da boş cevap 0 puan ve seriyi sıfırlar.

## Proje yapısı

```
oyun/server.js          HTTP + Server-Sent Events sunucusu, oda ve oyun mantığı
oyun/public/olustur.*   Quiz stüdyosu
oyun/public/library.js  Tarayıcıda quiz saklama, doğrulama, içe aktarma
oyun/public/host.*      Büyük ekran
oyun/public/play.*      Telefon ekranı
oyun/public/style.css   Ortak tasarım
```

## Lisans

MIT. Ayrıntılar için [LICENSE](LICENSE).
