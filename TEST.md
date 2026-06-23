# Otomatik Testler

## Çalıştırma

```bash
npm test          # Hepsi: mantık + parser + senkron + veritabanı
npm run test:logic  # Sadece saf mantık + Excel parser + senkron (hızlı)
npm run test:db     # Sadece veritabanı + senkron birleştirme (Electron)
```

## Kapsam

**test/logic.test.js** (node:test — Electron gerekmez)
- Tarih: `toISO`/`toDE` (Almanca format, geçersiz tarih reddi), `contractEndDate` (aktivasyon + 2 yıl)
- IBAN son-4, Almanya telefon formatı, WhatsApp numara dönüşümü
- Firma normalleştirme, dosya adından yıl çıkarma
- `fields`: başlık + alias eşleme, başlık-satırı algılama, alan listesi, statüler, otelo→Vodafone
- `excelParser`: çok sayfalı içe aktarma, bayi-no filtreleme, şişmiş aralık (donma testi),
  bilinmeyen kolon atlama, sayfa adı kırpma, gerçek tarih hücresi → gg.aa.yyyy

**test/sync.test.js** — iki gerçek süreç başlatıp P2P keşif + senkron yayılımını doğrular

**test/db.electron.js** (Electron altında) — izole geçici DB ile:
- migration, ekleme/güncelleme/durum/yumuşak silme (tombstone), toplu ekleme
- firma sayıları, ayarlar (gizli anahtar sızmaması), yedekleme
- senkron birleştirme (LWW): yeni/eski/yeni timestamp, tombstone gizleme

## Not
Saf mantık `logic.js` içinde toplanmıştır; hem uygulama (renderer + ana süreç) hem testler
aynı kodu kullanır — yani testler gerçek davranışı doğrular, kopya değil.
