# SohbetHane v2.3

Kendi bilgisayarınızda çalışan, davetle açılan, **uçtan uca şifreli** sohbet uygulaması.
Çeviri motoru da kendi makinenizde çalışır. Sesli/görüntülü arama yoktur — bilinçli olarak kaldırıldı.

---

## 1. Kurulum

**Adım 1 — Uygulama**
1. [Node.js](https://nodejs.org) LTS sürümünü kurun.
2. `BASLAT-WINDOWS.bat` dosyasına çift tıklayın. (Mac/Linux: `./baslat-mac-linux.sh`)
3. Tarayıcı `http://localhost:3000` adresinde açılır. İlk hesabı siz kurun — yönetici olursunuz.

**Adım 2 — Çeviri motoru**
1. [Python 3.12](https://www.python.org/downloads/) kurun. Kurulum ekranında **"Add python.exe to PATH"** kutusunu işaretleyin.
2. `LIBRETRANSLATE-KUR.bat` dosyasına çift tıklayın.
3. İlk açılışta dil modelleri iner, 5–10 dakika sürebilir. **O pencereyi kapatmayın.**

**Adım 3 — Gizli adres tüneli**
1. `TUNEL-BASLAT.bat` dosyasına çift tıklayın. `cloudflared` kendi kendine iner.
2. Ekranda `https://xxxx.trycloudflare.com` şeklinde bir adres çıkar. Kopyalayın.
3. SohbetHane'de zarf simgesi → **"Davet linkinde kullanılacak adres"** kutusuna yapıştırın.
   Adres orada kayıtlı kalır, her seferinde yazmanız gerekmez.
4. Davet kodu üretip linki gönderin.

Üç pencere de açık kalmalı: uygulama, LibreTranslate, tünel.

---

## 2. IP adresiniz neden gizli

İki sızıntı yolu vardı, ikisi de kapatıldı:

**Sunucu adresi.** Karşı taraf bağlanacağı adresi görmek zorunda. Tünel sayesinde gördüğü tek şey
Cloudflare'in adresi. Sizin ev IP'nize ulaşamaz, modeminizde port açmanıza da gerek yok — tünel
sizin makinenizden dışarı doğru kurulur.

**Doğrudan bağlantı.** Sesli/görüntülü arama, ses kalitesi için sunucuyu atlayıp iki cihazı doğrudan
bağlar; bu da IP'leri karşılıklı açığa çıkarır. Arama özelliği bu sürümde **tamamen kaldırıldı** —
arayüzden, sunucudan ve sinyalleşme kodundan. Kapalı bir düğme bırakmak yerine kodu sildim, böylece
yanlışlıkla açılma ihtimali yok. Artık uygulamada tek bir doğrudan bağlantı noktası bile kalmadı;
her şey sizin sunucunuzdan geçiyor.

**Sesli mesaj duruyor.** Mikrofonla kaydedip gönderdiğiniz ses dosyaları arama değil; şifrelenip
sunucuya yükleniyor, doğrudan bağlantı kurulmuyor. Bu özellik güvenle kullanılabilir.

**Ek olarak:** sayfa hiçbir dış adrese istek atmaz (Google Fonts kaldırıldı, CSP başlığı dış
bağlantıları kapatıyor), `Referrer-Policy: no-referrer` ekli, sunucu IP kaydı tutmuyor.

---

## 3. Şifreleme

| Ne | Nasıl |
|---|---|
| Kimlik anahtarı | ECDH P-256, tarayıcıda üretilir, cihazdan çıkmaz |
| Mesaj şifresi | AES-256-GCM, **her mesaj için yeni anahtar** |
| Anahtar dağıtımı | Her mesajda yeni geçici ECDH anahtarı → gönderen tarafı için ileri gizlilik |
| Parola koruması | PBKDF2-SHA256, 600.000 tur |
| Doğrulama | Güvenlik numarası (kişi bilgisi ekranında) |

**Şifreniz sunucuya hiçbir zaman gitmez.** Tarayıcı şifreden iki ayrı anahtar üretir: biri girişe,
diğeri özel anahtarınızı sarmaya — ikincisi cihazdan çıkmaz.

Sunucuda duran her şey şifrelidir: mesaj metni, dosya içeriği, çeviri önbelleği. `data/` klasörünü
biri kopyalasa bile okuyamaz.

**Güvenlik numarası:** Kişi bilgisi ekranındaki 6 gruplu numarayı karşı tarafla telefonda karşılaştırın.
Aynıysa aranızda kimse yok demektir.

**Şifrenizi unutursanız eski mesajlar açılamaz.** Kurtarma yolu yok.

**Şifrelenmeyenler:** kim kiminle ne zaman yazıştı (sunucu zaten sizin makineniz), emoji tepkileri,
görünen isim ve profil fotoğrafı.

---

## 4. Süreli mesajlar

Sohbet başlığındaki **saat simgesi** → 30 saniye ile 4 hafta arası.

- Sayaç, mesaj **karşı tarafça görüldüğü anda** başlar (Signal mantığı).
- Süre dolunca mesaj sunucudan, dosyası diskten ve iki taraftaki ekrandan silinir.
- Balonun altında kalan süre görünür.
- **Tek görüntülemelik:** yazma satırındaki göz simgesi. Alıcı açtıktan 15 saniye sonra yok olur.

---

## 5. Engelleme

Kişi bilgisi ekranında **"Bu kişiyi engelle"** düğmesi var. Engellediğinizde o kişinin mesajları,
emoji tepkileri, yazıyor göstergesi ve çevrimiçi durumu size hiç ulaşmaz; siz de ona yazamazsınız.
Karşı tarafa hiçbir bildirim gitmez. Engellediklerinizi Ayarlar ekranından görüp kaldırabilirsiniz.

---

## 6. Sessize alma (v2.3)

Kişi bilgisi ekranında **"Sessize al"** düğmesi var. Sessize aldığınızda:

- O kişi yazmaya devam edebilir.
- Mesajları **yöneticiye onay için bekler**, size doğrudan ulaşmaz.
- Yönetici mesajı **onaylarsa** size iletilir; onaylanan mesajlar okundu bilgisini gösterir.
- Yönetici mesajı **reddederse** karşı tarafa bildirim gitmeden silinir.

Sessize aldığınız kişiler aynı ekrandan yönetilebilir.

---

## 7. Gruplar ve arşivler

Sol üstteki grup simgesi üç seçenek sunuyor:

- **Üyeli grup** — seçtiğiniz kişilerle ortak sohbet. Gruba sonradan katılan, önceki mesajları açamaz.
- **Arşiv** — yalnızca size ait, şifreli bir saklama alanı. Ruhsat fotoğrafı, not, belge biriktirmek
  için. Kimse göremez, kimse eklenemez. İstediğiniz kadar arşiv açabilirsiniz.
- **Zaman Tüneli** — Facebook grup akışı gibi çalışır. Üyeler paylaşım yapabilir, yorum ve
  tepki bırakabilir (aşağıda detay).

---

## 8. Zaman Tüneli (v2.3)

Yeni bir grup türü: üyelerin post paylaşabildiği, yorum ve emoji tepkisi bırakabildiği şifreli bir akış.

- Sol üst köşedeki **grup simgesi** → **Zaman Tüneli** sekmesi → isim ver → **Tüneli oluştur**.
- Sohbet alanı açılınca altta büyük bir **yazma kutusu** çıkar. Paylaşmak istediğinizi yazıp **Paylaş** deyin.
- Her paylaşıma altından **yorum** yapılabilir (normal mesaj gibi).
- Dosya ve sesli mesaj gönderimi de çalışır.
- Zaman Tüneli sohbet listesinde turuncu **DUVAR** etiketiyle görünür.

---

## 9. DM → Grup dönüşümü (v2.3)

Birebir sohbette **kişi bilgisi** → **"Bu sohbeti gruba dönüştür"** düğmesi → isim girin.

Yeni bir grup oluşturulur; eski birebir sohbet ve mesajlar olduğu gibi kalır
(E2E şifreleme nedeniyle eski mesajlar yeni gruba taşınamaz).

---

## 10. Davet

Artık **tüm kullanıcılar** davet kodu üretebilir (yalnızca yönetici değil). Zarf simgesine
tıklayıp "Davet kodu oluştur"u kullanın. Davet kodu kaç kişi kullanabilsin ve kaç gün geçerli
olsun seçebilirsiniz.

---

## 11. Yönetici paneli (v2.3)

Ayarlar → Kullanıcılar bölümünde artık her kullanıcı için şunlar görünür:

- **Kullanıcı adı, dil, kayıt tarihi, son görülme.**
- ⭐ / ☆ düğmesiyle yönetici yetkisi ver / al.
- 🚫 düğmesiyle hesabı **askıya al** — kullanıcı hemen çıkarılır, giremez.
- 🔓 düğmesiyle askıyı kaldır.
- 🗑 düğmesiyle hesabı tamamen sil.

---

## 12. Duvar kâğıtları

Sohbet başlığındaki palet simgesinden 15 tema: Romantik, Gül bahçesi, Mum ışığı, Yıldızlı gece,
Deniz, Orman, Hat sanatı, Çini, Kahve, Huzur, Alacakaranlık, Eski kâğıt, Neon, Kar, Sade.

---

## 13. Neler var

Birebir ve grup sohbeti · zaman tüneli · çift tik · yazıyor göstergesi · çevrimiçi durumu ·
her türlü dosya (sürükle-bırak ve yapıştır) · sesli mesaj · emoji paneli · mesaja emoji tepkisi ·
alıntılı yanıt · mesaj düzenleme · herkesten silme · tüm sohbetlerde arama (şifreler cihazda çözülüp
aranır) · profil fotoğrafı · masaüstü bildirimi · telefon uyumlu arayüz · yönetici paneli.

---

## 14. Sık karşılaşılanlar

**Tünel adresi her açılışta değişiyor** — Ücretsiz Cloudflare tünelinin doğası. Adres değişince
eski davet linkleri çalışmaz; yeni adresi davet ekranına yapıştırıp yeni link üretin. Sabit adres
isterseniz bir alan adı alıp Cloudflare'de kalıcı tünel tanımlayabilirsiniz.

**Mikrofon çalışmıyor** — Tarayıcılar mikrofonu sadece `https` veya `localhost` üzerinde açar.
Tünel adresi https olduğu için sesli mesaj oradan sorunsuz çalışır.

**"… henüz şifreleme anahtarını oluşturmamış"** — O kişi bir kez giriş yapsın, anahtarı otomatik üretilir.

**Port 3000 dolu** — `config.json` içinde `"port": 3100`. Tünel komutundaki portu da değiştirin.

**Şifremi unuttum** — Yönetici hesabından Ayarlar → Kullanıcılar'dan hesabı kaldırıp yeni davet gönderin.

**Yedek** — `data/` ve `uploads/` klasörlerini kopyalayın. İkisi de şifreli.
