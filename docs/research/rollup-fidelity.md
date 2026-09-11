# Remon geçmiş metriklerinde piklerin korunması

## Karar

Remon için öneri, mevcut `raw → 1m → 5m → 1h` zincirini koruyup kritik gauge ve hız ölçümlerine **minimum, maksimum, toplam ve alan bazında geçerli örnek sayısı** eklemektir. Grafikte ortalama çizgisine gözlemlenen min–max aralığı eşlik etmelidir. Ortalama, bir sonraki katmana aktarılacak tek veri olmaktan çıkar; saklanan özetten son aşamada hesaplanan bir görünüm olur. Yüzdelikler ilk sürümün temel çözümü olmamalıdır.

Bu kararın nedeni yalnızca maliyet değildir. Bir saat içindeki tek bir pik p99 değerine yansımayabilir; buna karşılık maksimum doğrudan bu soruyu cevaplar. Yüzdelik, “yüksek değerler ne kadar yaygındı?” sorusuna; maksimum ise “gözlenen en yüksek değer neydi?” sorusuna yarar. İleride dağılım ihtiyacı doğarsa seçilmiş metriklere birleşebilir histogram veya sketch eklenebilir.

Uygulama üç ayrı sorumluluğu ele almalıdır: kalıcı özetin doğruluğu, sorgunun zaman aralığını doğru temsil etmesi ve grafiğin veriyi dürüstçe göstermesi. Sadece veritabanına iki kolon eklemek; eksik alan ağırlıkları, sayaç resetleri, türetilmiş yüzdeler ve grafik örneklemesi nedeniyle yeterli değildir. Bu rapor üretim uygulaması değil, kod incelemesi ve çalıştırılabilir referans deneyle desteklenen uygulama tasarımıdır.

## Mevcut sistem ve kapsam

İncelenen şemada dört çözünürlük bulunuyor. Raw nominal aralığı iki saniye; bu, her kolektörün mutlaka iki saniyede bir değer ürettiği anlamına gelmez. Sekiz rollup kaynağında varsayılan saklama süreleri aşağıdaki gibidir. Yapılandırma değiştirilebildiğinden sorgular bu değerleri sabit kodlamamalıdır.

| Katman | Kova aralığı | Varsayılan saklama | Kaynak   |
| ------ | ------------ | ------------------ | -------- |
| raw    | 2 saniye     | 1 gün              | Kolektör |
| 1m     | 60 saniye    | 7 gün              | raw      |
| 5m     | 300 saniye   | 30 gün             | 1m       |
| 1h     | 3600 saniye  | 365 gün            | 5m       |

Şema `remon-server/migrations/0001_schema.sql`, birleştirme `src/services/rollup.rs` içindedir. Rollup, kapanmış `[başlangıç, bitiş)` kovalarını işler. Kaynak/çözünürlük cursor'ı vardır; tekrar yazım `INSERT OR REPLACE` ile idempotent olacak şekilde tasarlanmıştır. Mevcut backfill bütçesi tur başına 720 kovadır. Bu altyapıyı değiştirmek yerine yeni özetin aynı cursor ve yeniden deneme davranışına katılması gerekir.

| Tablo                | Seri anahtarı | Şu anki anlam                                      | Önerilen kapsam                                                                                  |
| -------------------- | ------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `metrics_cpu`        | Host          | Kullanım, load, CPU zaman oranları, olay hızları   | Kullanım ve tüm dinamik gauge/hız alanları için birleşebilir özet                                |
| `metrics_memory`     | Host          | Bellek miktarları, swap, page fault hızları        | Kullanılan/available/cache/swap ve olay hızları; ayrıca kanonik bellek yüzdesi                   |
| `metrics_disk`       | Mount point   | Kapasite, doluluk, I/O hızları, inode, utilization | Doluluk yüzdesi, inode yüzdesi ve tüm I/O hızları; byte kullanım/available                       |
| `metrics_network`    | Interface     | Byte/packet/error hızları                          | Altı hız alanının tamamı; toplam trafik ayrı semantik gerektirir                                 |
| `metrics_docker`     | Container ID  | CPU/bellek/PID gauge; dört kümülatif I/O sayacı    | Gauge özeti; sayaçlar için ayrı reset farkındalığı                                               |
| `metrics_process`    | Process name  | Süreç grubu CPU, bellek, PID sayısı, disk hızları  | Beş alan; top-K gözlemlerinin eksik kapsamı belirtilmeli                                         |
| `metrics_components` | Label         | Sıcaklık ve cihazın bildirdiği sınır/max alanları  | Öncelikle `temperature_c`; `max_c` zamansal maksimum diye yeniden yorumlanmamalı                 |
| `metrics_pressure`   | cpu/memory/io | some/full için avg10/60/300                        | Altı gauge desteklenebilir; varsayılan grafikte avg10; gerçek kısa stall için ek kolektör verisi |

`metrics_cpu_cores` ve probe metrikleri mevcut zincirin parçası değil. Probe history okuyucusu raw ile sınırlı; yalnızca yazma tarafına rollup eklemek erişilemeyen veri üretir. SMART ve durum/log tablolarına genel min/max eklenmemelidir. Kapasite, limit ve kritik sıcaklık eşiği gibi bağlam alanları için her istatistiği çoğaltmak da öncelik değildir: değişim/son değer anlamı ayrıca tanımlanmalıdır.

İlk dikey uygulama CPU history olmalıdır. Sonrasında bellek, disk, network, sıcaklık ve pressure; ardından kardinalitesi daha yüksek process ve Docker gelir. **Ortalama doğruluğu düzeltmesi bütün gauge alanlarına**, görsel bant önceliği ise kullanılan grafiklere uygulanmalıdır. Örneğin bant henüz çizilmese bile nullable alanın geçerli örnek sayısı kaybedilmemelidir.

## Doğrulanmış kayıp ve doğruluk sorunları

Mevcut `sample_count`, eşit olmayan sayıdaki ham örnekleri temsil eden kovaların ortalamalarını ağırlıklandırıyor. Bu doğru bir temel, fakat sayı satır bazında. Bir opsiyonel alan kovadaki 30 satırın yalnızca birinde doluysa, üst katman o alanın ortalamasını 30 geçerli ölçüm gibi değerlendiriyor. Tamamen NULL olan alt kovayı dışlamak, kısmen NULL kovayı düzeltmiyor.

`MeanInt`, her katmanda tekrar INTEGER'a dönüyor. Son kullanıcıya tam sayı göstermek mantıklı olabilir; hesaplamanın ara durumunu tam sayıya kırpmak bilgi kaybıdır. Dört örnek `[0,1,1,2]`, iki alt kovada önce `[0,1]` ortalamalarına kırpılıyor; üst kova 0 oluyor, doğrudan ortalama ise 1. Bu hata min/max eklemekle kendiliğinden düzelmez.

Docker'ın dört byte sayacında `MAX` kullanılıyor. Kod yorumu bunu son değer olarak açıklasa da reset halinde eşit değiller. `[900,1000,10,30]` için maksimum 1000, son değer 30. Görülen aralıklardaki reset düzeltilmiş artış 130; örnekler arasında resetten hemen önce gerçekleşmiş ama ölçülmemiş artış bilinemez. Sayaç maksimumunu trafik miktarı veya son değer diye sunmamak gerekir.

| Sentetik deney                                          | Mevcut/yanlış sonuç                            | Doğru yorum veya özet                 |
| ------------------------------------------------------- | ---------------------------------------------- | ------------------------------------- |
| Saatte 1800 örnek: 1799 kez 10, bir kez 100             | Pik içeren 1m ortalaması 13; 5m 10,6; 1h 10,05 | Her katmanda maksimum 100             |
| Aynı saat için nearest-rank p99                         | 10                                             | p99, tek piki koruma garantisi vermez |
| Bir kovada 1 geçerli 100 ve 29 NULL; diğerinde 30 sıfır | Üst ortalama 50                                | Geçerli 31 örnek için 100/31 ≈ 3,2258 |
| `[0,1]` ve `[1,2]` alt kovaları                         | Katmanlı INTEGER ortalama 0                    | Doğrudan ortalama 1                   |
| Resetli sayaç `[900,1000,10,30]`                        | MAX 1000                                       | Son 30; gözlenen artış 130            |
| İki interface: A `[100,0]`, B `[0,100]`                 | Interface maksimumları toplamı 200             | Anlık toplamın maksimumu 100          |

Bu sonuçlar [çalıştırılabilir deney](../../scripts/research/rollup-lab.ts) ve [JSON çıktısında](rollup-lab-results.json) bulunur. NULL ve INTEGER senaryoları SQLite üzerinde mevcut SQL ifadelerini yeniden üretir. Referans birleşim ayrıca değişken uzunluklu, NULL içeren ve negatif değerli 200 deterministik bölümlendirme denemesinden geçer. Bunlar Rust entegrasyon testlerinin yerine geçmez; mevcut sorunu ve önerilen cebiri izole eder.

## Sektör ve bilimsel seçenekler

Elastic'in güncel downsampling modeli gauge için min/max/sum/value_count tutuyor. Sayaçlar ayrı işleniyor; güncel dokümantasyon resetleri koruyan davranışı da açıklıyor. Remon'a taşınabilecek fikir ürünün tamamı değil, metrik türüne göre farklı birleşim durumları saklamak.[^1]

Thanos da downsample edilmiş bloklarda count/sum/min/max/counter özetleri kullanıyor. Ancak onun downsampling motivasyonu geniş aralıklı sorgu maliyeti; bütün çözünürlükleri birlikte saklamak depolamayı artırabilir. Dolayısıyla bir sistemin “downsampling kullanıyor” olması otomatik disk tasarrufu veya her alanda aynı politikanın doğru olduğu anlamına gelmez.[^2]

Timescale Toolkit'in iki aşamalı aggregation yaklaşımında birleştirilebilir ara durum ve kullanıcıya dönen sonuç ayrılıyor. Remon için doğrudan karşılığı: `sum/count` saklamak ve ortalamayı okurken üretmek. Bu, daha sonra farklı pencereleri yeniden birleştirmeyi mümkün kılar; finalize edilmiş ortalamalar tek başına aynı esnekliği sağlamaz.[^3]

| Seçenek               | Koruduğu bilgi                        | Temel sınırlama                                | Remon kararı                                         |
| --------------------- | ------------------------------------- | ---------------------------------------------- | ---------------------------------------------------- |
| Yalnız ortalama       | Genel seviye                          | Kısa pik ve dipler kaybolur                    | Tek başına yetersiz                                  |
| Min/max + sum/count   | Gözlenen uçlar ve örnek ortalaması    | Dağılım, sıra ve pik süresi bilinmez           | Varsayılan temel                                     |
| Min/max zamanları     | Ucun hangi örnekte görüldüğü          | Diğer olayları/sırayı geri getirmez            | İlk sürümde opsiyonel; olay inceleme ihtiyacına göre |
| p50/p95/p99 sayıları  | Seçilmiş dağılım noktaları            | Sonraki katmana doğru birleşmez                | Kalıcı ara durum olarak kullanma                     |
| Sabit histogram       | Eşik sayıları, yaklaşık quantile      | Kova seçimi/hassasiyet ve alan maliyeti        | SLO/threshold gereksiniminde iyi                     |
| KLL                   | Yaklaşık quantile, rank hata denetimi | Nadir uçlarda değer hatası büyük olabilir      | Genel dağılım analizi için aday                      |
| DDSketch/UDDSketch    | Göreli değer hatalı quantile          | Kütüphane, aralık ve bellek politikası gerekir | Özellikle geniş aralıklı latency için aday           |
| t-digest              | Kompakt, kuyruk odaklı quantile       | Hata/merge davranışı uygulamaya bağlı          | Ölçülerek seçilecek alternatif                       |
| M4 / MinMaxLTTB       | Çizim için temsilci noktalar          | Analitik özet veya ham veri yerine geçmez      | Sorgu/gösterim katmanında ayrı değerlendirme         |
| Daha uzun raw saklama | Gözlenen sıra ve ayrıntı              | Sürekli depolama maliyeti                      | Kısa olay inceleme tamponu için tamamlayıcı          |

Prometheus belgeleri, önceden hesaplanmış quantile değerlerini farklı örneklem veya zaman aralıkları üzerinden tekrar toplamanın yanlışlığını vurguluyor. “Beş dakikalık p99 = beş adet bir dakikalık p99'un ortalaması” doğru değildir. Histogram kullanıldığında aynı sınırlar ve uyumlu semantikle sayılar birleşir; quantile en son hesaplanır.[^4]

KLL çalışması eklemeli rank hatası üzerine garantiler sağlar. Bu, “gerçek değerden en fazla yüzde bir sapar” demek değildir. DDSketch ise göreli değer hatası hedefler; özellikle çarpık dağılımlarda bu ayrım önemlidir. Sıfır, negatif değerler, bounded store/collapse ve sketch sürümü uygulama kararının parçası olmalıdır; bir makalenin garantisi rastgele bir kütüphane konfigürasyonuna aktarılmamalıdır.[^5][^6]

t-digest kuyruğa yakın quantile'lar için güçlü pratik bir alternatiftir; fakat uygulama/sıkıştırma/merge sırası değerlendirilmeden tek bir evrensel hata yüzdesi vaat edilmemelidir. Her üç seçenek de minimum ve maksimumun yerine zorunlu olarak geçmez. Remon'un şu anki “tek pik görünmüyor” ihtiyacı için dağılım yapısını her alan ve seriye eklemek gereksiz başlangıç maliyetidir.[^7]

M4, piksel sütununa göre first/last/min/max örneklerini gerçek zamanlarıyla seçer. Makalenin çizim eşdeğerliği garantisi tanımladığı raster/çizgi modeline bağlıdır; keyfi yumuşatılmış çizimler veya sonradan her yakınlaştırma için ham veriyi yeniden kurma garantisi değildir. Remon'da gelecekte ham sorguların çizim bütçesinde değerlidir; kalıcı min/max/sum/count ile aynı problemi çözmez.[^8]

MinMaxLTTB, önce MinMax ön seçimi sonra LTTB uygulayarak görselleştirme örneklemesini hızlandırır. İkinci seçim adımından dolayı “bütün önemli maksimumlar kesin kalır” kabul edilmemelidir. Zaten ortalamaya dönüşmüş saatlik veriye bunu uygulamak kaybolmuş piki geri getirmez.[^9]

## Birleşebilir veri modeli

Her dinamik alan için temel durum `min`, `max`, `sum`, `valid_count` olsun. Ham NULL ölçüm sayılmaz; gerçek sıfır sayılır. Geçerli değer yoksa min/max NULL, sum 0 ve count 0'dır. Üst katmanda min alt minimumların minimumu; max alt maksimumların maksimumu; sum ve count ise alt değerlerin toplamıdır. Sonuç ortalaması count pozitifse sum/count olur.

Bu işlem matematiksel olarak bölümlendirmeden bağımsızdır; kayan nokta toplamlarında normal sayısal tolerans gerekir. FLOAT64, büyük tam sayıları sonsuz hassasiyetle saklamaz. Çok büyük kümülatif byte sayaçları gauge `sum REAL` yoluna sokulmamalı; INTEGER taşma sınırları ve sayaç farklarının temsili ayrı doğrulanmalıdır. API'nin eski INTEGER alanı için yuvarlama gerekiyorsa yalnız dışa sunarken yapılmalıdır.

Ortalamanın tanımı ilk sürümde **geçerli gözlemlerin örnek ortalaması** olarak kalmalıdır. Düzenli iki saniyelik ölçümlerde zaman ortalamasına yaklaşır; düzensiz örnekleme veya uzun kesintide ikisi eşit değildir. Zaman ağırlıklı ortalama istenirse süre, uç değerler ve interpolasyon kuralı gerekir. Kesintiyi son değeri sınırsız uzatarak dolu saymak doğru olmaz. Timescale'in ara durum yaklaşımı zaman ağırlığına da örnek verir, fakat Remon için yeni semantik ayrı sürümlenmelidir.[^3]

Fiziksel şemada mevcut geniş tablolara tipli nullable kolonlar eklemek, mevcut SQL/Rust yapısına en yakın seçenektir. Örneğin CPU kullanımına `usage_percent_min`, `_max`, `_sum`, `_valid_count`; ayrıca satır düzeyinde özet sürümü eklenebilir. Aynı satırdaki bütün alanlar sürüm kapsamında tutarlı yazılmalıdır. Raw satırda istatistik kopyası tutmaya gerek yok; raw okuma sırasında tek örnek özetine çevrilebilir.

JSON tek kolonla esneklik sağlar ama anahtar tekrarı, tip denetimi, SQL agregasyonu ve sorgu maliyetini artırır. Alan başına normalize edilmiş sidecar tablo ise yüksek satır/anahtar tekrarı ve join maliyeti getirir. Her ikisi ileride dinamik probe alanları için yeniden değerlendirilebilir; sabit host metrikleri için başlangıç tercihi tipli kolonlardır. Bu tercih üretim yük testiyle doğrulanmalı; sentetik deney rakip bütün şemaları karşılaştırmış değildir.

`summary_version` ile eski özetleri ayırmak gerekir. NULL istatistik “bilinmiyor”; count=0 “bu alan için geçerli gözlem yok” demektir. Bir üst kovada bazı çocuklar eskiyse yalnız yeni çocukların min/max'ını tüm kovanın eksiksiz aralığı gibi sunmak yanlıştır. İlk uygulamada böyle kovaların envelope'u `unavailable` olarak dönebilir; daha gelişmiş sürümde bilinen bölümün kapsamı ayrıca taşınabilir.

Pik zamanı istenirse `_min_ts` ve `_max_ts` saklanmalı; eşitlikte en erken zaman gibi deterministik bir kural kullanılmalıdır. Bu bilgi olmadan saatlik maksimumun tam 14:17:22'de oluştuğu söylenemez, yalnızca 14:00–15:00 içinde gözlendiği söylenebilir. Her alan için iki timestamp eklemek ilk sürümün zorunlu parçası değildir.

## Sayaçlar ve türetilmiş metrikler

Docker sayaçları için iki geçerli yol var. Mevcut kümülatif alanın son örnek anlamını koruyup ayrı hız alanları üretmek kullanıcı grafiği için anlaşılırdır. Daha genel çözümde first/last değer ve zaman, gözlenen reset sayısı ve reset düzeltilmiş iç artış saklanır. Komşu özetler birleşirken aradaki sınır farkı da eklenir; yalnız alt kovaların artışlarını toplamak sınır geçişini kaçırır.

İlk sürümde sayaçların MAX davranışı açıkça ayrı bir düzeltme olarak ele alınmalı; gauge şemasına uyarlamak için adları aynı kalırken anlamları sessizce değiştirilmemelidir. Container kimliği ve yeniden başlatma semantiği test edilmelidir. Negatif farkın reset mi, wrap mı, geç gelen kayıt mı olduğu da tanımlanmalıdır. Thanos'un ayrı counter durumu bu ayrım için yararlı bir referanstır.[^2]

Grafikte gösterilen oran ham örnek seviyesinde hesaplanmalıdır. `used/total` için bağımsız used ve total uçlarından oranın uçları çıkarılamaz. Örneğin 50/100 ve 60/200 gözlemlerinin oran ortalaması %40; toplamların oranı yaklaşık %36,67'dir. Bellekte hangi formülün kullanılacağı da kesinleştirilmeli: mevcut history widget'ının `used/(used+available)` hesabı ile diğer görünümlerin bellek tanımı tek kanonik ölçümde uzlaştırılmalıdır.

Diskte reserved alanlar nedeniyle `used+available`, total ile aynı olmak zorunda değildir. Docker bellek limitinin değişmesi de oran uçlarını etkiler. Çözüm, UI tarafından kullanılan `memory_used_percent` ve `disk_used_percent` gibi kanonik türetilmiş değerleri ingestion sırasında veya raw'dan ilk rollup sırasında üretmek ve bunları kendi başına özetlemektir. Formül değişirse geçmiş ve yeni serinin semantiği sürümlenmelidir.

Network grafiğinde fiziksel interface hızları toplanıyor. Interface maksimumlarını toplayarak toplam maksimum elde edilemez. Önce aynı ham ölçüm zamanında toplam hesaplanmalı ve ayrı özetlenmeli; alternatif olarak sadece interface bazında doğru bant sunulmalıdır. Eksik interface ölçümü ve fiziksel interface seçiminin değişmesi, toplam kapsamının parçasıdır.

PSI `avg10/60/300` değerleri zaten kernel tarafından yumuşatılmıştır. Bunların maksimumu, ölçülmüş ortalama sinyalinin maksimumudur. Daha kısa stall bilgisini korumak için kernel'in kümülatif `total` mikrosaniye alanlarından aralık farkı ve süreyle stall oranı üretmek gerekir. Min/max eklemek geçmişte saklanmamış bu ayrıntıyı geri getiremez.[^10]

## API, sorgular ve grafik

Değişim zinciri server schema → rollup → repository → REST/DTO ve batch → web API tipleri → veri dönüştürücüler → `HistoryChart` şeklindedir. Aynı history verisini kullanan assistant summary ve forecast da kontrol edilmelidir. Büyük tuple dönüşlerine daha fazla pozisyon eklemek yerine adlandırılmış internal history row/summary tipleri hata riskini azaltır.

Mevcut REST `pick_resolution`, pencerenin uzunluğuna göre seçim yapıyor: 30 dakikaya kadar raw, bir güne kadar 1m, bir haftaya kadar 5m, sonrası 1h. Ancak geçen ayın 15 dakikasını sorgulamak kısa olduğu için raw seçebilir; raw artık yoktur. Çözünürlük seçimi pencerenin yaşı, gerçek kapsama, retention ve istenen nokta bütçesini birlikte değerlendirmelidir. İstenen ayrıntı bulunmuyorsa daha kaba veri ve açık çözünürlük bilgisi dönmelidir.

Mevcut LIMIT davranışı son kayıtları seçerek pencerenin başını kesebilir. Daha az nokta döndürmek, bütün aralığı temsil etmekle aynı şey değildir. Sorgu katmanı bütün pencereyi eşit zaman kovalarına yeniden birleştirmeli veya açık pagination/truncation bilgisi sunmalıdır. Çok serili sorgularda toplam satır bütçesi korunmalı; seri başına bütçe nedeniyle görünmeyen anahtarlar sessizce kaybolmamalıdır.

Önerilen additive API, eski mean alanlarını korurken isteğe bağlı `statistics` içinde alan bazında min/max/count ve yanıt seviyesinde `resolution`, `bucket_seconds`, `aggregation`, `summary_version` ve kapsam bilgisi döndürür. Ham sum'ı her grafik isteğine taşımak gerekli değil; birleşimi server yapabilir. Sadece ortalamaya ihtiyaç duyan istemci daha büyük payload ödememelidir. Bu isimler taslaktır; mevcut DTO üslubuyla kesinleştirilmelidir.

Kova zamanı tek bir an gibi değerlendirilmemeli. Kullanıcının 14:10–14:20 seçimiyle çakışan 14:00–15:00 özetindeki pik 14:45'te olmuş olabilir. Ham veri yoksa o piki seçili on dakikaya mal etmek yanlıştır. API gerçek kapsanan kova sınırlarını bildirmeli; seçili aralık dışını içeren sınır kovası tooltip veya bilgi metninde belirtilmelidir.

`HistoryChart.svelte` şu an `smooth: 0.55`, `smoothMonotone: 'x'` ve `sampling: 'lttb'` kullanıyor. Min/max için bu ayarları kopyalamak uygun değil. Ortalama çizgisi düz segment veya açıkça tanımlanmış kova çizimi kullanmalı; gözlenen aralık hafif opaklıkla, düz/step sınırlarla gösterilmelidir. Her seriyi bağımsız LTTB ile seçmek bandın ortak zaman eksenini bozabilir. Gerekirse server'da ortak zaman kovalarıyla min/max/sum/count yeniden birleştirilmelidir.

Tooltip “Ortalama / En düşük / En yüksek / Ölçüm sayısı / Kova aralığı” gösterebilir. Bant bir güven aralığı veya p5–p95 bandı değildir; “gözlenen aralık” denmelidir. Bant genişliği pikin ne kadar sürdüğünü söylemez. Çok serili grafiklerde bütün bantları aynı anda açmak görsel karmaşa yaratabilir; seçili/hover edilen serinin bandı veya kullanıcı ayarı uygundur.

Eksik zaman kovaları açık boşluk olmalıdır. `connectNulls: false` ancak veri içinde gerçekten NULL/boş nokta varsa işe yarar; hiç eklenmemiş timestamp aralığını kendiliğinden kesmez. Örnek sayısı da tek başına süre kapsamı değildir: process kolektörü ile CPU kolektörünün sıklıkları aynı olmayabilir. Top-K dışında kalan süreç, sıfır tüketim demek değildir.

Assistant tarafındaki `history_summary`, seçilmiş katman üzerinde MIN/MAX/AVG hesaplıyor. Bu, şu anda ham gözlem maksimumundan ziyade kova ortalamalarının maksimumunu verebilir. Ortak özet okuyucusu kullanılmalı, sonuç semantiği açık olmalıdır. Forecast ise kapasite trendini ölçüyorsa ortalama/uygun trend serisini kullanmaya devam etmeli; yeni maksimum değerler mevcut trend girişinin yerine geçirilmemelidir. Canlı alarm ve geçmiş summary yolları ayrı doğrulanmalıdır.

## Depolama maliyeti

Varsayılan süre ve nominal sıklıkla sürekli tek bir seri, dört katman birlikte sayıldığında yaklaşık 70.680 satır tutar: 43.200 raw, 10.080 dakika, 8.640 beş dakika, 8.760 saat. Bu, bütün host veritabanı için satır sayısı değildir; interface, mount, process ve container sayılarıyla çarpılan tablolar vardır. Bir yıl dolmadan da steady-state hesabına ulaşılmaz.

Deneyde SQLite `WITHOUT ROWID` üzerinde 11 REAL alanlı sentetik geniş tablo kullanıldı. Altı alana ilave istatistik kolonları eklendi; raw satırlarda bunlar NULL bırakıldı. Ölçüm 4096 byte sayfalarla ayrılmış veritabanı sayfalarıdır; WAL, ikincil indeks, üretim değer dağılımı, silme/yeniden kullanım ve disk sıkıştırması dahil değildir. Gerçek CPU tablosunun INTEGER/NULL dağılımını birebir taklit etmez.

| Altı alan için ek istatistik   | Ayrılmış byte | Baseline'a göre yaklaşık fark |
| ------------------------------ | ------------: | ----------------------------: |
| Yok                            |     9.166.848 |                             — |
| min/max                        |    13.393.920 |                          +%46 |
| min/max/sum/count              |    15.618.048 |                          +%70 |
| Öncekiler + iki uç timestamp'i |    18.239.488 |                          +%99 |

Ölçüm “bütün Remon DB %70 büyür” anlamına gelmez. Ancak dört birleşebilir istatistiğin bedava olmadığını ve her bağlam alanına otomatik çoğaltma yapmamamız gerektiğini gösterir. Min/max tek başına daha ucuzdur fakat NULL ve kırpılmış ortalama sorunlarını çözmez. Raw satırlara NULL kolonlar eklemek bile kayıt başlığı maliyeti taşır.

Üretim kararı öncesi anonimleştirilmiş temsilî veritabanı kopyasında toplam boyut, yazılan byte, rollup süresi ve history sorgu gecikmesi ölçülmelidir. Process/container churn içeren örnek özellikle gereklidir. [CSV](rollup-storage.csv) ve deney betiği varsayımları değiştirip ölçümü tekrar etmeye uygundur; sentetik sayı bir kapasite garantisi değildir.

## Eski veri, geçiş ve uygulama sırası

Eski ortalamadan min/max veya dağılım geri üretilemez. `COALESCE(min, mean)` ile eski kovayı sıfır genişlikte “kesin aralık” gibi göstermek yanlış güven verir. Raw hâlâ duruyorsa kapsadığı tam kovalar yeniden hesaplanabilir. Daha eski veri için mevcut mean korunur, yeni istatistikler bilinmiyor olarak kalır. Eksik raw parçadan eski tam kovanın üzerine yazılmamalıdır.

Backfill cursor'ını başa almak tek başına güvenli değildir. Önce her aralıkta kaynak kapsamı kanıtlanmalı; yeni özet sürümü için ayrı ilerleme veya sınırlandırılmış yeniden hesaplama kullanılmalıdır. Retention ile yarışta kaynaklar silinmeden çocuk özetin tamamlanması sağlanmalıdır. Geç gelen örnek politikası da açık olmalı: kapanmış kovaya yazılabiliyorsa etkilenen üst kovaların yeniden işlenmesi gerekir.

Repository kuralı gereği yeni kurulum şeması `0001_schema.sql` içine işlenir; yeni numaralı migration açılmaz. Mevcut kurulum için ayrı, gözden geçirilebilir ALTER/backfill operasyonu hazırlanır; veritabanı yedeği ve schema doğrulaması sonrası SQLx checksum kuralı uygulanır. Şema dosyasını değiştirmek çalışan veritabanını kendiliğinden güvenli biçimde güncellemez. Bu çalışma üretim DB'sine müdahale etmez.

Önerilen teslim sırası şöyledir:

1. **CPU dikey dilimi:** adlandırılmış özet tipi, per-field sum/count ve min/max; schema, rollup, repository, tekli/batch history, CPU bandı, eski veride fallback. Bu dilim diğer tablolar için sözleşmeyi doğrular.
2. **Gauge yayılımı:** bellek/disk kanonik yüzdeleri ve hızlar, network interface özetleri, sıcaklık ve pressure. Toplam network ayrı doğru türetilmiş seri olarak ele alınır.
3. **Docker/process:** reset farkındalığı, counter sınır birleşimi, top-K kapsamı ve kardinalite maliyeti. Mevcut counter davranışı testleri bilinçli olarak güncellenir.
4. **Tüm okuyucular:** yaş/kapsam farkındalığı olan çözünürlük seçimi, bütün pencereyi koruyan nokta bütçesi, assistant summary ve forecast uyumluluğu.
5. **İhtiyaç kanıtlanırsa dağılım:** latency/SLO veya belirli gauge dağılımı için histogram/sketch. p99 API sonucu olarak hesaplanır; tek başına kalıcı birleşim girdisi olmaz.

İlk dilimin kabul testleri; raw'dan doğrudan ve çok katmanlı birleşimin tolerans içinde eşitliği, tek örneklik pik/dip, NULL/sıfır ayrımı, düzensiz örnek sayısı, tam sayı kırpılması, boş kova, seri izolasyonu, restart/backfill idempotency ve eski veri kapsamını içermelidir. REST ve batch aynı sonuç üretmeli; çizim daha kaba çözünürlükte bile gözlenen maksimumu saklamalıdır. Eski dar zaman aralığı, sınır kovası ve veri boşluğu ayrıca denenmelidir.

Sonraki testler sayaç resetinin kova içinde ve sınırda olması, değişen toplam/limit üzerinden oran, eşzamanlı olmayan interface pikleri ve kaybolan process grubunu kapsar. SQLx metadata ve Rust mevcut rollup/history testleri güncellenmeli; web type-check, ilgili dönüşüm/grafik testleri ve lint çalıştırılmalıdır. Araştırma deneyi bu dağıtım kapılarının yerine geçmez.

Hiçbir özet, kolektörün gözlemediği iki örnek arasındaki fiziksel piki garanti edemez. “Pik korunuyor” vaadi saklanan geçerli örneklerin uçlarıyla sınırlıdır. Tam olay şeklini incelemek gerekiyorsa sınırlı ham veri tamponu veya olay anında ayrıntılı kayıt, min/max özetinin tamamlayıcısıdır.

## Kaynaklar

Kod bulguları 9 Eylül 2026 tarihinde yerel çalışma ağaçlarına dayanır; paralel değişiklikler nedeniyle yayımlanmış bir release'in değişmez taraması değildir. Temel dosyalar: server `migrations/0001_schema.sql`, `src/services/rollup.rs`, `src/storage/repositories/metrics.rs`, `src/routes/rest/metrics.rs`, `src/routes/dtos/metrics.rs`, `src/services/alerting/resolver.rs`, `src/api_tests/rollup_aggregate.rs`; web `src/lib/components/charts/HistoryChart.svelte`, `src/lib/components/dashboard/widgets/HistoryChartWidget.svelte`. Dış kaynaklar 8–9 Eylül 2026'da incelendi; yaşayan ürün belgelerinin davranışı sürüme bağlıdır.

[^1]: Elastic. [Downsampling concepts](https://www.elastic.co/docs/manage-data/data-store/data-streams/downsampling-concepts). Güncel ürün belgesi; gauge ve counter ayrımı.

[^2]: Thanos. [Compactor documentation](https://github.com/thanos-io/thanos/blob/main/docs/components/compact.md) ve [downsample implementation](https://github.com/thanos-io/thanos/blob/main/pkg/compact/downsample/downsample.go). Birleşebilir özetler ve downsampling amacı.

[^3]: Timescale. [Two-Step Aggregation — What It Is and Why We Use It](https://github.com/timescale/timescaledb-toolkit/blob/main/docs/two-step_aggregation.md). Ara durum, accessor ve yeniden birleşim.

[^4]: Prometheus. [Histograms and summaries](https://prometheus.io/docs/practices/histograms/). Quantile agregasyonu ve histogram semantiği.

[^5]: Karnin, Z.; Lang, K.; Liberty, E. [Optimal Quantile Approximation in Streams](https://arxiv.org/abs/1603.05346), 2016. Rank hata garantili sketch araştırması.

[^6]: Masson, C.; Rim, J. E.; Lee, H. K. [DDSketch: A fast and fully-mergeable quantile sketch with relative-error guarantees](https://arxiv.org/abs/1908.10693), PVLDB 12(12), 2195–2205, 2019.

[^7]: Dunning, T. ve katkıcılar. [t-digest](https://github.com/tdunning/t-digest). Algoritmanın yazarlarına ait uygulama ve teknik açıklamalar.

[^8]: Jugel, U.; Jerzak, Z.; Hackenbroich, G.; Markl, V. [M4: A Visualization-Oriented Time Series Data Aggregation](https://datavis.cs.columbia.edu/files/papers/m4.pdf), PVLDB 7(10), 797–808, 2014.

[^9]: Van Der Donckt, Jeroen; Van Der Donckt, Jonas; Rademaker, M.; Van Hoecke, S. [MinMaxLTTB: Leveraging MinMax-Preselection to Scale LTTB](https://arxiv.org/abs/2305.00332), 2023.

[^10]: Linux Kernel. [PSI — Pressure Stall Information](https://docs.kernel.org/accounting/psi.html). Avg pencereleri ve total stall zamanları.
