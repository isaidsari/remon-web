# Gözlenen aralığı koruyan rollup uygulaması

CPU, bellek, disk ve network alanları için min/max/sum/valid_count saklanır. Raw satırlar bu kolonları doldurmaz; ilk rollup ham değerlerden özet üretir. Üst katmanlar özetleri birleştirir. INTEGER ölçümlerde sonraki rollup kırpılmış ortalamayı değil korunmuş toplamı kullanır. Disk ve bellekte yüzde, her ham gözlemde hesaplanıp kendi başına özetlenir.

REST ve batch aynı adlandırılmış satır → DTO dönüşümünü kullanır. `bucket_seconds` raw için 0, rollup için resolutions tablosundaki aralıktır. Raw yanıtta tek örneklik istatistikler üretilir; nullable alanlarda count=0 gerçek sıfırdan ayrılır. Mevcut veritabanındaki yalnız ortalama içeren kovaların gerçek uçları bilinmediğinden bunların `statistics` alanı null kalır. Bu veri niteliği ayrımıdır; eski istemci sürümlerini destekleyen bir protokol katmanı değildir.

Grafikler ortalama ve kova bazlı gözlenen aralık gösterir. Ortak dönüşüm dashboard ve metrik sayfasında kullanılır. Yumuşatma/LTTB bu serilerde kapalıdır; boş kovalar çizgide boşluk bırakır. Tooltip kova sınırlarını, min/max ve geçerli örnek sayısını gösterir. Özet satırı grafik için eklenen uç noktaları tekrar saymaz; sum/count kullanır ve rollup'ta p95 üretmez. Bant açılıp kapatılabilir; üçten fazla seride odaklanılan serinin bandı gösterilir. Bant güven aralığı, yüzdelik veya pik süresi değildir.

## Metrik anlamları

- Bellek yüzdesi: `100 × max(total - available, 0) / total`. Total sıfırsa bilinmiyor.
- Disk yüzdesi: `100 × used / total`. Dosya sisteminin reserved alanı nedeniyle `used + available` payda olarak kullanılmaz. Total sıfırsa bilinmiyor.
- Disk I/O: mount bazında B/s, IOPS ve utilization seçilebilir. Farklı mount uçları toplanmaz.
- Network: interface metrikleri ayrı saklanır. Host toplamı `metrics_network_total` tablosunda aynı timestamp'teki tünel olmayan gözlemlerden üretilir; interface maksimumlarından türetilmez. Bu, `network/usage` toplamının tünel hariç kapsamıyla uyumludur. Yeni tablonun raw yazımı ana tick transaction'ındadır; rollup cursor ve retention politikasını network ile paylaşır.
- Assistant: `network` interface bazında, `network_total` host grafiğiyle aynı toplamı sorgular. CPU/bellek/disk/network özetleri gözlenen min/max ve örnek ağırlıklı ortalamaları döndürür. `observed_statistics`, `count_unit`, kova süresi ve pencere kapsamı yanıtta açıktır; eksik ortalama üzerinden trend uydurulmaz.

## Beta çalışma düzeni

Şema doğrudan `remon-server/migrations/0001_schema.sql` içinde güncellenir. Ek numaralı migration, kalıcı upgrade SQL dosyası veya eski client sürüm desteği eklenmez. Tek kullanılan VPS'in veritabanı yeni sürüm kurulurken manuel olarak eşitlenir; SQLx checksum da repository kuralına göre güncellenir. Önceki CPU dilimi için yazılan upgrade dosyaları kaldırıldı.

Bu turdaki ek şema kapsamı: memory ve disk için `used_percent`, alan özetleri ve summary_version; network için alan özetleri ve summary_version; yeni `metrics_network_total` tablosu. CPU kolonları önceki dilimde zaten eklendi. Kaynak şemasını güncellemek çalışan VPS veritabanını otomatik değiştirmez.

## Kapsam sınırları

Docker, process, sıcaklık ve PSI rollup'ları bu genişletmenin dışında kaldı. Eski tarihli kısa sorguların çözünürlük seçimi ve genel LIMIT davranışı ayrı iştir; bu turda değiştirilmedi. Assistant sınırla kesişen kovayı tamamıyla özetlediğini açıklar; kova içindeki pikin kesin zamanı veya süresi bilinmez. Silinmiş ham ölçümlerin uçları sonradan geri getirilemez.

Yeni network toplamı kurulumdan itibaren üretilir; geçmiş interface ortalamalarından yapay toplam bandı çıkarılmaz. İhtiyaç olursa eldeki ham veri için ayrı kontrollü backfill yapılabilir. VPS şeması dağıtım sırasında manuel eşitlenmelidir.
