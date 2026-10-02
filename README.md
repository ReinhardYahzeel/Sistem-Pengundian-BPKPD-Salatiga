# Grand Draw BPKPD — Pengundian Wajib Pajak

Sistem pengundian berbasis **browser** untuk Grand Draw BPKPD yang transparan, adil,
dan aman. Peserta diidentifikasi berdasarkan **No NPWPD (Nomor Pokok Wajib Pajak Daerah)**,
**Nama OP (Objek Pajak)**, dan **Jenis Pajak** (Pajak Restoran, Hotel, Parkir, dll).

Tidak memerlukan server atau database — cukup dibuka di browser, semua data tersimpan
lokal di perangkat (localStorage).

---

## Fitur Utama

| Menu | Fungsi |
| --- | --- |
| **Dashboard** | Statistik peserta aktif, jumlah pemenang, peserta tersisa, total peserta, progres undian, dan daftar hadiah terpasang. |
| **Peserta** | Impor peserta massal dari file Excel/CSV (banyak file sekaligus, multi-sheet), pencarian, filter jenis pajak & status, dan data contoh 15.000 wajib pajak dummy. |
| **Undian & Hadiah** | Atur hadiah (jumlah pemenang + nama hadiah, manual atau impor dari file), lalu jalankan pengundian secara acak yang aman. |
| **Arsip Pemenang** | Riwayat lengkap seluruh pemenang (termasuk yang dibatalkan) dengan filter, pengurutan, dan export ke Excel/CSV. |

---

## Cara Menggunakan

1. Buka `index.html` di browser.
2. Buka menu **Peserta** → impor file Excel/CSV (bisa banyak file sekaligus), atau
   muat **15.000 Data Dummy** untuk uji coba.
   - Sebelum diimpor muncul dialog untuk **mengisi jenis pajak** per file (terisi
     otomatis bila terdeteksi dari kolom/file).
3. Buka menu **Undian & Hadiah** → tambahkan hadiah (contoh: `1x MOTOR`, `3x TV`),
   baik via form manual maupun tombol impor dari file.
4. Klik **Putar Undian Hadiah** untuk mengundi.
5. Hasil muncul di layar lengkap dengan rincian jatah per jenis pajak;
   klik **Simpan & Lanjutkan** untuk mencatat pemenang.
6. Lihat riwayat dan unduh laporan via menu **Arsip Pemenang** → Export Excel/CSV.

---

## Sistem Pengundian — Bagaimana Ia Bekerja

### Pool peserta aktif
Pool undian = seluruh peserta dengan status **belum menang** (`won = false`).
Peserta yang sudah menang **tidak** ikut diundi lagi di undian berikutnya
(1 orang hanya boleh menang 1 kali).

### Acak kriptografis
Pemenang dipilih memakai `crypto.getRandomValues` (Uint32) dengan
**rejection sampling** via fungsi `secureRandomInt()` — angka acak bebas bias dan
tidak dapat diprediksi maupun dimanipulasi.

### Dua mode pengundian (toggle di halaman Undian & Hadiah)

**1. Mode Standar (acak murni)**
`need` pemenang diacak langsung dari seluruh pool aktif, tanpa pengelompokan jenis pajak.
Konsekuensi: peluang tiap jenis pajak menang **proporsional terhadap jumlah pesertanya**.
Jika data Pajak Restoran jauh lebih banyak, wajar bila pemenangnya juga didominasi
Pajak Restoran.

**2. Mode Merata / proporsional per jenis pajak (default AKTIF)**
Algoritma `pickMerata()`:
1. Peserta aktif dikelompokkan per jenis pajak.
2. Jika jumlah pemenang (kuota hadiah) **mencukupi jumlah jenis pajak**, setiap jenis
   pajak dijamin mendapat minimal 1 jatah.
3. Sisa kuota dibagikan **proporsional** ke jenis pajak yang paling jauh di bawah
   bagiannya. Rumus: `jatah ≈ kuota × jumlah peserta jenis ÷ total peserta aktif`.
4. Jenis pajak yang pesertanya sudah habis tidak menerima jatah lagi.
5. Pemenang diacak seragam di dalam masing-masing jenis pajak.

Hasilnya: jenis pajak dengan data terbanyak tetap mendapat jatah lebih besar, tapi
**tidak memborong semua pemenang** — jenis pajak kecil tetap diwakili. Rincian
`Jatah per jenis pajak` ditampilkan di modal hasil undian.

**Lainnya:**
- Undian hanya 1 hadiah per klik (bisa dipilih dari dropdown hadiah yang tersisa).
- **Batalkan Pemenang Terakhir** mengembalikan peserta ke pool dan mencatatnya
  ke arsip dengan status *Dibatalkan*.

---

## Format File Peserta

File yang didukung: `.xlsx`, `.xls`, `.csv`, `.txt` (termasuk multi-sheet).

Kolom **dideteksi otomatis** dari nama header:

| Data | Kolom yang dikenali (contoh) |
| --- | --- |
| No NPWPD | `No NPWPD`, `NPWPD`, `No NPWP`, `ID Peserta`, `Kode Piutang`, dll. |
| Nama OP | `Nama OP`, `Nama WP`, `Nama`, `Wajib Pajak`, `Nama Pemilik`, dll. |
| Jenis Pajak | `Jenis Pajak`, `Jenis`, `Kategori`, atau **judul pojok file** mis. "PAJAK RESTORAN TAHUN 2026". |

Baris non-data (judul berulang, total/jumlah, keterangan, baris kosong) dilewati otomatis.

> **Perhatian:** kebijakan impor adalah *semua baris data masuk apa adanya* —
> duplikat NPWPD antar file **tidak** dibuang. Wajib pajak yang muncul di beberapa
> file akan tercatat lebih dari satu baris dan berpeluang lebih besar di mode
> **standar**. Pastikan satu wajib pajak hanya satu baris pada file resmi final.

---

## Kelebihan (Kelebihan Sistem)

1. **Adil secara kriptografis** — acak berbasis `crypto.getRandomValues` + rejection
   sampling, bebas bias, tidak bisa ditebak atau dimanipulasi.
2. **Merata default** — mode proporsional per jenis pajak mencegah satu jenis pajak
   mendominasi pemenang meski datanya paling banyak.
3. **Transparan & ada jejak audit** — seluruh riwayat undian tersimpan, pembatalan
   tercatat status *Dibatalkan*, bisa diekspor.
4. **Tanpa server** — bisa dipakai offline di acara resmi, tidak butuh koneksi,
   mudah di-deploy ke hosting statis (Vercel, GitHub Pages).
5. **Impor fleksibel** — banyak file sekaligus, multi-sheet, deteksi kolom otomatis,
   deteksi jenis pajak dari kolom maupun judul file.
6. **Tidak ada double winner** — satu peserta hanya bisa menang sekali.
7. **Export lengkap** — XLSX berwarna (hijau pemenang / merah dibatalkan) dan CSV.
8. **Pembatalan mudah** — *Batalkan Pemenang Terakhir* untuk mengoreksi kesalahan.

---

## Kekurangan / Batasan yang Perlu Diketahui

1. **Hanya di satu perangkat** — data di localStorage, tidak sinkron antar
   komputer tanpa export/import manual. Data bisa hilang jika cache browser dibersihkan.
2. **Kapasitas penyimpanan terbatas** — localStorage ± 5 MB; pool besar (ratusan ribu
   peserta) atau riwayat menumpuk bisa membuat penyimpanan gagal.
3. **Tanpa autentikasi** — siapa pun yang membuka aplikasi di perangkat itu bisa
   melihat data, menambah hadiah, atau menekan **Reset Data** (tanpa konfirmasi
   kata sandi).
4. **Mode pemenang tunggal** — peserta yang sudah menang tidak bisa menang lagi di
   undian berikutnya (oleh desain; tak ada opsi "boleh menang lebih dari sekali").
5. **Mode standar tidak merata** — saat toggle merata dimatikan, dominasi data
   terbesar akan terlihat jelas (proporsional terhadap jumlah peserta).
6. **Mode merata bukan jaminan 100%** — jika kuota hadiah lebih kecil dari jumlah
   jenis pajak, sebagian jenis pajak tidak mendapat jatah; jenis pajak berpeserta 1
   hanya bisa menerima maksimal 1 pemenang.
7. **1 undian per klik** — tidak ada mode otomatis mengundi banyak hadiah sekaligus.
8. **Deteksi kolom mengandalkan penamaan** — format file dengan header tidak
   baku perlu pemilihan manual di dialog impor.
9. **Duplikat NPWPD tidak otomatis dibuang** — sangat disarankan data final sudah
   bersih (1 baris per wajib pajak) sebelum diundi.
10. **Reset global** — tombol Reset Data menghapus peserta + riwayat sekaligus,
    tanpa opsi reset sebagian (misal hanya pemenang).

---

## Keamanan & Transparansi

- Pengundian memakai **acak kriptografis** (`crypto.getRandomValues`) — hasil tidak
  dapat diprediksi maupun dimanipulasi.
- Setiap peserta hanya dapat menang **satu kali** per sesi undian.
- Seluruh riwayat pengundian tercatat (audit trail), termasuk pembatalan pemenang.
- Data tersimpan otomatis di browser (localStorage) hingga tombol **Reset Data** digunakan.

---

## Teknologi

| Komponen | Keterangan |
| --- | --- |
| Bahasa | HTML5, CSS3, JavaScript (Vanilla, tanpa framework) |
| Acak | `crypto.getRandomValues` (rejection sampling) |
| Parsing file | SheetJS (`xlsx.full.min.js`) untuk Excel, parser CSV bawaan |
| Penyimpanan | LocalStorage (tanpa backend) |
| Hosting | Static hosting (Vercel / GitHub Pages / server file biasa) |

---

## Struktur Project

```
grand-draw/
├── index.html   # Halaman utama
├── app.js       # Logika aplikasi, impor, pengundian, penyimpanan
├── styles.css   # Tampilan dan tema
├── lib/         # Pustaka pihak ketiga (SheetJS)
├── images/      # Aset gambar (logo, background, karakter)
├── assets/      # Aset animasi (GIF pemenang)
└── README.md    # Dokumentasi ini
```

---

## Deployment

Aplikasi bersifat statis — dapat di-deploy ke layanan hosting statis apa pun
(**Vercel**, **GitHub Pages**, atau direktori file biasa) tanpa konfigurasi tambahan.

---

## Catatan

> Data contoh (15.000 peserta) berupa data simulasi untuk keperluan demo.
> Data peserta resmi harus diimpor melalui file Excel/CSV yang sudah bersih
> (satu baris per wajib pajak).

&copy; 2026 BPKPD. All rights reserved. (RYL)