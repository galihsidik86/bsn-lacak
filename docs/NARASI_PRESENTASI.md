# BSN Lacak — Narasi Presentasi 14 Slide

> Panduan berbicara per slide. Durasi target: **30–45 menit** (rata-rata 2–3 menit/slide + Q&A).
> Bahasa: semi-formal, sopan, gunakan istilah Islami yang akrab dengan audiens BSN.
> Tip: jangan baca slide kata-per-kata — slide jadi backdrop, narasi jadi konten.

---

## Slide 1 — Cover (Pembukaan, ±1.5 menit)

**Tampilan:** Logo BSN Lacak + judul "Transformasi Digital Pengawasan Kredit & Field Collection Syariah".

**Narasi:**

> Assalamu'alaikum warahmatullahi wabarakatuh. Bapak/Ibu pimpinan Bank Syariah Nasional yang kami hormati, terima kasih atas kesempatan yang diberikan kepada PT ArtiVisi Intermedia untuk mempresentasikan **BSN Lacak** — solusi terintegrasi untuk mitigasi risiko NPF dan modernisasi pengelolaan field collection.
>
> Presentasi ini akan membahas tiga hal: pertama, **tantangan industri** perbankan syariah dalam pengelolaan kredit bermasalah; kedua, **arsitektur sistem** yang sudah kami bangun dan kini berjalan di lingkungan staging; dan ketiga, **roadmap** menuju go-live di lingkungan produksi BSN.
>
> Estimasi waktu sekitar 30 menit, lalu dilanjutkan diskusi. Mohon dapat menginterupsi kapan saja bila ada pertanyaan.

**Transisi:** *"Mari kita mulai dari konteks masalahnya."*

---

## Slide 2 — Latar Belakang & 5 Akar Masalah (±3 menit)

**Tampilan:** Angka besar "**>5% NPF**" + 5 kelemahan operasional.

**Narasi:**

> Industri perbankan syariah hari ini menghadapi tekanan yang semakin nyata. Otoritas Jasa Keuangan menetapkan ambang batas Non-Performing Financing sebesar 5%. Di atas angka itu, bank masuk zona perhatian regulator: ekspansi pembiayaan dibatasi, profitabilitas tertekan, dan reputasi institusi terganggu.
>
> Yang menarik, kalau kita telaah, tingginya NPF jarang disebabkan oleh satu hal tunggal. Biasanya akar masalahnya bertumpuk di sisi **operasional collection**. Kami identifikasi lima yang paling sering muncul:
>
> 1. **Visibilitas rendah** — supervisor tidak tahu petugas lapangan sedang di mana, sedang apa, sudah ke nasabah mana saja hari ini.
> 2. **Moral hazard** — laporan kunjungan bisa difiksi tanpa cara membuktikan. Petugas duduk di warung sambil mengisi formulir.
> 3. **Kompilasi manual** — data masih disusun di Excel, rekap mingguan, keputusan baru bisa diambil 3 hari kemudian, saat masalahnya sudah membesar.
> 4. **Distribusi tidak merata** — penugasan nasabah dibagi manual, sering kali timpang. Petugas A pegang 200 nasabah, petugas B cuma 80.
> 5. **Komunikasi tidak efektif** — pengingat angsuran masih lewat surat fisik atau telepon manual. Tingkat respons nasabah rendah.
>
> Lima poin ini saling memperkuat. Memperbaiki satu tanpa yang lain tidak menyelesaikan apapun. Solusinya harus **terintegrasi**.

**Transisi:** *"Di sinilah BSN Lacak hadir."*

---

## Slide 3 — Solusi: 3 Modul Terpadu (±3 menit)

**Tampilan:** 3 modul — Web Admin Dashboard, Mobile PWA Petugas, Customer Engagement Engine.

**Narasi:**

> BSN Lacak bukan satu aplikasi tunggal, tapi **ekosistem tertutup** yang menghubungkan tiga pemangku kepentingan: manajemen back-office, petugas lapangan, dan nasabah.
>
> **Modul pertama — Web Admin Dashboard.** Ini adalah pusat kendali untuk Supervisor cabang dan Manajemen Senior di kantor pusat. Mereka melihat posisi petugas secara real-time lewat protokol Server-Sent Events. Distribusi nasabah ke petugas dilakukan oleh Smart Allocation Engine otomatis. Setiap aksi penting tercatat di Audit Trail yang tidak dapat dimodifikasi — penting untuk audit OJK.
>
> **Modul kedua — Mobile Aplikasi Petugas.** Ada dua bentuk: pertama, **PWA browser** yang bisa langsung diakses petugas lewat Chrome di HP-nya tanpa install apapun. Kedua, **APK Android native** yang dibangun dengan teknologi Capacitor. Bedanya: APK punya **foreground service** untuk GPS, artinya pelacakan tetap berjalan walaupun layar HP mati atau aplikasi tertutup di latar belakang. Cakupan tracking-nya naik dari 70% di PWA menjadi 95–99% di APK.
>
> **Modul ketiga — Customer Engagement Engine.** Bagian otomatisasi komunikasi ke nasabah. Saat ini sudah terintegrasi dengan Twilio untuk SMS. Slot untuk WhatsApp Business Cloud API resmi Meta sudah disiapkan, tinggal aktivasi saat BSN sudah punya akun bisnis Meta. Filosofinya: komunikasi tetap **santun**, mengikuti etika muamalah, tanpa intimidasi.
>
> Ketiga modul ini terhubung lewat satu database dan satu API. Bukan tiga sistem terpisah yang nanti pusing integrasinya.

**Transisi:** *"Apa yang membuat BSN Lacak berbeda? Mari lihat empat pilarnya."*

---

## Slide 4 — 4 Pilar Keunggulan (±3 menit)

**Tampilan:** 4 pilar — Efisiensi, Integritas, Transparansi, Kepatuhan Syariah.

**Narasi:**

> Kami menyusun proposisi nilai BSN Lacak ke dalam empat pilar.
>
> **Pilar 1 — Efisiensi Operasional.** Distribusi nasabah ke petugas tidak lagi manual. Smart Allocation Engine mempertimbangkan tiga parameter sekaligus: **zonasi GPS** dengan algoritma Haversine, **tingkat urgensi** berdasarkan Days Past Due, dan **load balancing** antar petugas. Supervisor tidak perlu lagi duduk berjam-jam membagi nasabah di Excel. Sistem yang melakukan, supervisor cukup approve atau override.
>
> **Pilar 2 — Integritas dan Akuntabilitas.** Ini bagian yang langsung menjawab kekhawatiran *moral hazard* yang kita bahas tadi. Sistem punya beberapa lapis proteksi: **geo-fencing** menolak laporan kalau petugas berada lebih dari 50 meter dari koordinat nasabah; **kamera in-app** memastikan foto bukti diambil saat itu juga, bukan dari galeri; **server-side watermark** menanam GPS dan timestamp permanen ke metadata foto; **EXIF freshness check** menolak foto yang lebih dari 1 jam; **speed-jump detection** menandai perpindahan tidak wajar di atas 150 km/jam yang mengindikasikan GPS spoofing.
>
> **Pilar 3 — Transparansi Real-Time.** Dashboard hidup, bukan halaman static yang di-refresh manual. Posisi petugas, postur kolektabilitas Kol 1 sampai Kol 5, tren pembayaran 14 hari, leaderboard kolektor — semuanya update otomatis lewat SSE.
>
> **Pilar 4 — Kepatuhan Syariah.** Ini yang sering dilupakan vendor non-syariah. Sistem otomasi komunikasi yang santun, tanpa nada intimidasi, sesuai etika muamalah. Template pesan dirancang dengan nada hormat. Privasi nasabah dijaga: data tidak dishare ke pihak ketiga, deployment on-premise di Data Center BSN.

**Transisi:** *"Sekarang mari masuk ke sisi teknisnya."*

---

## Slide 5 — Arsitektur Layered & Keamanan (±4 menit)

**Tampilan:** 3 layer arsitektur + bullet keamanan & deployment.

**Narasi:**

> Kami merancang BSN Lacak dengan arsitektur **3 layer** klasik perbankan enterprise: presentation, business logic, dan data infrastructure.
>
> **Layer 1 — Presentation.** Front-end dibangun dengan Vite dan React 18, TypeScript end-to-end. Mode PWA untuk browser, dan APK Capacitor untuk Android native. Peta menggunakan MapLibre dengan basemap MapTiler. Offline queue di localStorage — supaya petugas di area blank spot tetap bisa lapor, datanya nyusul saat online.
>
> **Layer 2 — Business Logic.** Backend Node.js 22 dengan framework Express, TypeScript dan Zod untuk validasi input strict. Autentikasi pakai JWT dengan masa berlaku 15 menit dan refresh token 7 hari yang disimpan di httpOnly cookie. Untuk akun yang sensitif, ada lapis TOTP 2FA — kompatibel Google Authenticator. ORM-nya Prisma, type-safe. Sistem RBAC tiga tingkat: Admin HQ, Supervisor per cabang, Petugas per binaan. Setiap query otomatis di-scope ke cabang user. Total endpoint REST yang sudah dibangun: **lebih dari 190**.
>
> **Layer 3 — Data dan Infrastructure.** Database PostgreSQL 16. Realtime via SSE. Push notification dua jalur: **VAPID Web Push** untuk PWA browser, dan **FCM via Firebase** untuk APK Android. BlastGateway untuk SMS via Twilio. Logging structured dengan pino.
>
> Soal **keamanan dan kedaulatan data**: ini poin penting. Sistem ini bisa di-deploy on-premise di DC BSN — artinya data nasabah tidak transit ke pihak ketiga manapun. Komunikasi pakai TLS 1.3 dan HTTP/3 lewat Caddy. Audit trail tidak dapat dimodifikasi — log immutable, sesuai persyaratan OJK terkait manajemen risiko teknologi informasi.

**Transisi:** *"Yang penting juga, model data harus rapi sejak awal."*

---

## Slide 6 — Domain Model (±2 menit)

**Tampilan:** 8 entitas utama + stat 35+ entitas, 190+ endpoint.

**Narasi:**

> Database BSN Lacak terdiri dari **lebih dari 35 entitas data** yang terintegrasi. Di slide ini kami tampilkan 8 yang paling sering dirujuk:
>
> - **Branch** adalah root entity. Multi-tenancy di BSN Lacak tidak pakai database terpisah per cabang, tapi semua data di-tag dengan branchId — supaya supervisor cabang X tidak bisa melihat data cabang Y, walaupun teknisnya di server yang sama.
> - **User** untuk autentikasi: username, password yang di-hash bcrypt cost 12, role, TOTP secret, lockout otomatis setelah 5 kali gagal login.
> - **Petugas** adalah profil field collector. Terhubung 1:1 ke User. Punya field `lastPosition` yang di-update setiap ping GPS — jadi posisi terakhir selalu fresh tanpa harus query history.
> - **Nasabah** menyimpan data pembiayaan: NIK, akad, kolektabilitas 1–5, outstanding, koordinat alamat, Days Past Due.
> - **Angsuran** ledger pembayaran — setiap transaksi tercatat lengkap.
> - **Kunjungan** adalah laporan harian dari petugas. Setiap kunjungan punya `riskScore` dan `riskFlags` array — dari anti-fraud engine.
> - **Blast** untuk job komunikasi WA atau SMS.
> - **AuditLog** — sekali insert, tidak bisa modify. Catat setiap aksi penting beserta IP dan requestId.
>
> Selain 8 ini ada 27 entitas pendukung lainnya: ChatMessage, PushSubscription, Attendance, AttendanceSession, Wilayah, dan seterusnya. Total **35+ entitas dan 190+ endpoint REST API**.

**Transisi:** *"Mari kita lihat seperti apa dashboard supervisornya."*

---

## Slide 7 — Modul 01: Dashboard Supervisor (±3 menit)

**Tampilan:** 4 area dashboard — Allocation, Peta GIS, Analitik, Laporan.

**Narasi:**

> Dashboard supervisor adalah **kokpit operasional** harian. Dirancang supaya seorang supervisor cabang bisa langsung tahu kondisi tim tanpa perlu nelpon satu-satu.
>
> Pertama, **Smart Allocation Engine**. Tiap pagi, supervisor cukup tekan satu tombol "Auto-Balance" — sistem akan distribusikan nasabah ke petugas dengan tiga pertimbangan: jarak GPS, urgensi DPD, dan beban kerja saat ini. Hasilnya bisa di-review dan di-override sebelum di-commit ke petugas.
>
> Kedua, **Peta GIS dengan Live Tracking**. Marker petugas bergerak secara real-time di peta. Klik marker, muncul timeline kunjungan hari ini. Ada juga fitur **GPS trail historis** — supervisor bisa pilih tanggal, melihat jejak pergerakan petugas hari itu, lengkap dengan jeda waktu di setiap nasabah. Plus **heatmap kunjungan** untuk melihat sebaran aktivitas per zona.
>
> Ketiga, **Analitik dan Pelaporan**. Tren arus pembayaran 14 hari, leaderboard kolektor terbaik per cabang, perbandingan realisasi versus target. Bisa di-export CSV dan PDF.
>
> Keempat, **Laporan dan Audit Compliance**. Antrian laporan yang perlu review muncul dengan badge risk score — supervisor langsung tahu mana yang prioritas. Approve atau reject langsung dari sini, sistem otomatis kirim notifikasi push ke petugas.
>
> Yang kami tambahkan paling baru: **chat in-app petugas ↔ supervisor**, jadi koordinasi cepat tidak harus pindah ke WhatsApp pribadi. Lalu **worker otomatis** yang notify supervisor kalau petugas masuk wilayah yang bukan binaan-nya (geofence violation), atau tidak ada update GPS lebih dari 30 menit padahal jam kerja (live inactivity alert).

**Transisi:** *"Sekarang sisi petugas — yang setiap hari pegang aplikasinya."*

---

## Slide 8 — Modul 02: Mobile Petugas (±3 menit)

**Tampilan:** Mockup mobile + 5 tab utama + label cross-platform.

**Narasi:**

> Aplikasi petugas adalah jembatan antara strategi di kantor dengan eksekusi di lapangan. Filosofi desainnya: **sesedikit mungkin tap untuk selesaikan satu laporan**.
>
> Struktur 5 tab utama:
>
> - **Beranda** — target harian, progres tertagih, status GPS, tombol clock-in/out, dan tombol chat ke supervisor.
> - **Rute** — daftar nasabah hari ini, di-urutkan berdasarkan jarak dari posisi petugas saat ini (nearest neighbor). Bisa juga ditampilkan di peta dengan polyline rute optimal.
> - **Riwayat** — kunjungan yang sudah dilakukan beserta status review-nya dari supervisor.
> - **Profil** — capaian bulanan, pengaturan, toggle notifikasi push.
> - **Lapor** — form ini overlay full-screen, dipanggil dari berbagai tempat. Berisi: kamera in-app dengan watermark, GPS otomatis, pilihan hasil (Bayar/Janji/Tidak Bertemu), nominal, foto bukti.
>
> Dua bentuk distribusi:
>
> Pertama, **PWA browser** — petugas tinggal buka link di Chrome, tap "Add to Home Screen", langsung jalan. Tidak perlu install dari Play Store, tidak ada biaya developer account, update fitur otomatis terjadi saat kami deploy. Tracking GPS bisa berjalan, tapi terbatas saat layar mati.
>
> Kedua, **APK Android Native** dibangun dengan Capacitor. APK ini adalah **shell** tipis yang me-load aplikasi web yang sama, tapi punya satu keunggulan kritikal: **foreground service** untuk GPS. Artinya, walaupun petugas tutup aplikasi dan layar HP mati, GPS tetap aktif merekam pergerakan. Status bar HP menampilkan notifikasi "BSN Lacak — Tracking aktif" sebagai bukti dan transparansi.
>
> Petugas tidak perlu pilih — kami sediakan dua-duanya. Untuk demo BSN bisa pakai APK; untuk skala produksi nanti tinggal sideload via link internal atau distribusi terbatas.

**Transisi:** *"Tapi yang paling sering ditanyakan: bagaimana memastikan laporan tidak fiksi?"*

---

## Slide 9 — Sistem Anti-Fraud Berlapis (±4 menit)

**Tampilan:** 6 kotak proteksi.

**Narasi:**

> Pertanyaan paling penting dari setiap evaluasi sistem field collection: *"Bagaimana memastikan petugas tidak mengarang laporan?"* Jawaban kami: **proteksi berlapis** yang saling melengkapi. Tidak ada satu lapis pun yang dianggap sempurna, tapi gabungannya menyulitkan fraud sampai tidak ekonomis lagi untuk dilakukan.
>
> **Lapis 1 — Geo-Fencing 50 meter.** Saat petugas submit laporan, koordinat GPS-nya dibandingkan dengan koordinat alamat nasabah. Kalau jaraknya di atas 50 meter, server menolak dengan HTTP 403. Bukan warning di klien — hard reject di server, tidak bisa dimanipulasi dari sisi petugas.
>
> **Lapis 2 — In-App Camera Lock.** Foto wajib diambil langsung dari kamera aplikasi. Upload dari galeri foto diblokir. Implementasinya pakai `capture` attribute HTML5 + validasi server-side magic-byte JPEG/PNG.
>
> **Lapis 3 — Server-Side Watermarking.** Setelah foto diterima server, engine `sharp` menulis GPS, timestamp, ID petugas dan ID kunjungan langsung ke metadata EXIF. Permanen, tidak bisa dihapus tanpa kompresi ulang yang akan kelihatan jelas. Foto ini jadi bukti forensik kalau ada sengketa.
>
> **Lapis 4 — Speed-Jump Detection.** Anti-GPS-spoofing. Sistem cek kecepatan antar dua ping GPS. Kalau petugas terdeteksi pindah di atas 150 km/jam — itu fisik tidak mungkin dengan motor — kunjungan tersebut otomatis ditandai sebagai mencurigakan.
>
> **Lapis 5 — EXIF Freshness Check.** Foto yang metadata-nya lebih dari 1 jam ditolak. Mencegah daur-ulang foto dari sesi sebelumnya.
>
> **Lapis 6 — Capacitor Native + Magic Byte.** APK native + validasi tipe file di server. Foto yang dimodifikasi ekstensinya akan terdeteksi.
>
> Semua flag ini diakumulasi dalam **Risk Score** per kunjungan. Supervisor melihat angka itu di dashboard. Kunjungan dengan skor di bawah threshold lolos otomatis. Yang di atas masuk antrian review — supervisor approve atau reject dengan satu klik, plus push notification ke petugas.
>
> Filosofi-nya: kami tidak menuduh petugas, tapi memberi tools supaya yang jujur lebih cepat selesai laporannya, dan yang nakal kesulitan beraksi.

**Transisi:** *"Modul ketiga, komunikasi ke nasabah."*

---

## Slide 10 — Modul 03: Komunikasi Santun WhatsApp (±2.5 menit)

**Tampilan:** 3 fase komunikasi + mockup chat WhatsApp.

**Narasi:**

> Modul komunikasi nasabah dirancang berdasarkan satu prinsip: **etika muamalah Islam**. Tidak ada bahasa intimidasi, tidak ada teror waktu. Tetap profesional, tegas, tapi santun.
>
> Kami rancang tiga fase:
>
> **Fase 1 — Pre-Due Reminder.** Pengingat pro-aktif H-7, H-3, dan H-1 sebelum jatuh tempo. Tone hangat, mengingatkan kewajiban dengan nada ramah. Tujuan: mencegah keterlambatan, bukan menagih yang terlambat. Ini biasanya menurunkan DPD-1 secara signifikan.
>
> **Fase 2 — Past-Due Escalation.** Untuk yang sudah lewat tempo, eskalasi bertingkat: DPD 1, 7, 14, 30 hari. Nada semakin serius sesuai masa tunggakan — **tapi tidak intimidatif**. Tetap berakhir dengan salam Islami.
>
> **Fase 3 — Interactive CTA.** Tombol respons cepat: *"Saya Sudah Bayar"* atau *"Butuh Bantuan"*. Klik nasabah otomatis tercatat di sistem. Kalau dia klik "Sudah Bayar", supervisor langsung dapat notifikasi untuk verifikasi pembayaran.
>
> Status saat ini: **BlastGateway sudah dibangun sebagai modul pluggable**. Twilio SMS sudah terintegrasi. Slot untuk WhatsApp Business Cloud API resmi Meta sudah siap — saat BSN sudah punya akun Meta Business dan template-nya sudah diapprove Meta, tinggal masukkan kredensial di environment variable, langsung jalan. Tidak perlu coding ulang.
>
> Yang penting: ini **WhatsApp resmi**, bukan WA gateway ilegal. Aman dari pemblokiran nomor, dan pesan masuk dengan badge bisnis terverifikasi — meningkatkan kepercayaan nasabah.

**Transisi:** *"Bagaimana kita sampai ke sini? Mari lihat roadmap."*

---

## Slide 11 — Roadmap 14 Minggu (±3 menit)

**Tampilan:** 3 prioritas (P0/P1/P2) + 5 fase mingguan.

**Narasi:**

> Roadmap kami susun dengan **prioritas berbasis dampak**, bukan urutan alfabetis.
>
> **Prioritas P0 — Compliance Wajib.** Hal-hal yang tidak boleh terlewat sebelum go-live. Geo-fencing server-side sudah selesai. TOTP 2FA sudah selesai. In-app camera lock plus magic-byte server validation sudah selesai. Yang masih kami siapkan: **penetration test eksternal OWASP** — kami punya jadwal mengundang vendor independen 2 minggu sebelum go-live.
>
> **Prioritas P1 — Unique Selling Point.** Yang membedakan BSN Lacak dari kompetitor: WhatsApp Business Cloud API resmi, scheduler pre-due dan past-due, Smart Allocation 3-parameter, interactive CTA. Sebagian sudah live di staging, sebagian menunggu akses Meta Business.
>
> **Prioritas P2 — Polish dan Differentiator.** Hal-hal yang menambah nilai tapi tidak menghambat go-live: connector core banking, HA Postgres replica untuk skala besar, encryption LUKS di level disk, monitoring Prometheus + Grafana.
>
> Untuk **timeline 14 minggu**:
>
> - **Minggu 1–2: Kickoff.** Spesifikasi teknis final, setup environment Firebase dan VPS, alignment tim PIC BSN dan ArtiVisi.
> - **Minggu 3–8: Core Development.** Backend API, integrasi WhatsApp Cloud, dashboard, PWA, APK.
> - **Minggu 9–10: Penetration Test.** OWASP Top 10 eksternal, load testing, remediasi temuan kritis.
> - **Minggu 11–12: UAT Staging.** Pengujian oleh tim Supervisor dan beberapa Petugas BSN. Bug fix oleh tim IT bersama.
> - **Minggu 13–14: Go-Live dan Hyper-Care.** Deploy ke DC BSN, pelatihan massal, dan 30 hari pendampingan intensif untuk smoothing onboarding.
>
> Penting dicatat: **mayoritas fitur sudah jalan di staging hari ini**. Bukan janji 14 minggu dari nol. 14 minggu adalah waktu integrasi, hardening, dan onboarding di lingkungan BSN.

**Transisi:** *"Kenapa harus PT ArtiVisi?"*

---

## Slide 12 — Kredensial PT ArtiVisi (±2.5 menit)

**Tampilan:** Klien Tier-1 + statistik + keahlian inti.

**Narasi:**

> Kami sadar, memilih partner teknologi untuk sistem kritikal seperti ini bukan keputusan ringan. Izinkan kami sampaikan kredensial PT ArtiVisi.
>
> **Berpengalaman sejak 2008** — sudah **18 tahun** menyelidiki sistem pembayaran dan infrastruktur perbankan enterprise. Dipimpin oleh **Endy Muhardin**, dengan rekam jejak lebih dari 20 tahun di industri IT payment systems Indonesia.
>
> Klien yang sudah kami layani termasuk: **BCA, BNI, Telkom, KAI, Pegadaian, dan Kementerian Keuangan RI** — semua institusi yang memerlukan kepercayaan tinggi dan standar enterprise.
>
> Statistik singkat: 18+ tahun operasional, 40+ corporate training yang sudah kami jalankan, dan 60+ project API endpoints yang sudah deliver ke klien.
>
> **Keahlian inti** kami yang relevan dengan BSN Lacak:
>
> - **ISO 8583** dan **SNAP API BI** untuk integrasi sistem pembayaran nasional.
> - **HSM Integration** untuk pengelolaan kunci kriptografi.
> - **BI-FAST, QRIS, Payment Gateway** on-premise.
> - **Microservices, Kubernetes, CI/CD GitHub Actions** untuk delivery modern.
>
> Yang ingin kami sampaikan: **BSN Lacak bukan eksperimen R&D**. Ini dibangun di atas pengalaman 18 tahun menangani sistem-sistem kritikal serupa.

**Transisi:** *"Untuk tim teknis BSN, kami siapkan spec API."*

---

## Slide 13 — Spesifikasi API (±2 menit, lebih cepat — slide teknis)

**Tampilan:** Sample endpoint per kategori + standard auth, pagination, rate limit.

**Narasi:**

> Slide ini ringkasan untuk tim teknis BSN.
>
> **Lebih dari 190 REST endpoint** sudah dibangun, semua mengikuti standar OpenAPI 3.1. Dokumentasi interaktif tersedia di `/api/docs` lewat Swagger UI.
>
> Dikelompokkan dalam beberapa domain:
>
> - **Autentikasi dan Sesi** — login dengan rotasi refresh token httpOnly, verifikasi TOTP 6-digit untuk akun sensitif.
> - **Nasabah dan Distribusi** — query nasabah dengan filter Kol/DPD/akad, agregasi postur kolektabilitas, bulk import CSV maksimal 2000 baris per request, dan endpoint auto-balance distribusi.
> - **Kunjungan dan Analytics** — submit laporan multipart (form + foto), review approve/reject, generate PDF bukti per kunjungan, analytics overview revenue 6 bulan.
>
> Standar yang kami terapkan:
>
> - **Rate limit**: login 10x per 15 menit per IP, endpoint umum 600x per 15 menit, dengan budget khusus per-user untuk POST kunjungan.
> - **Auth header**: Bearer JWT 15 menit, refresh otomatis lewat httpOnly cookie 7 hari, header `x-branch-id` untuk supervisor multi-branch.
> - **Pagination**: cursor-based, response shape konsisten `{ data: [], nextCursor }`.
>
> Untuk integrasi nantinya dengan core banking BSN, kami siapkan **webhook** dan **API key** dengan scope terbatas.

**Transisi:** *"Sebagai penutup..."*

---

## Slide 14 — Penutup (±1 menit)

**Tampilan:** "Jazakumullah Khairan Khasiran" + closing statement.

**Narasi:**

> Demikian pemaparan singkat dari PT ArtiVisi tentang BSN Lacak.
>
> **Jazakumullah Khairan Khasiran** — semoga Allah membalas kebaikan Bapak/Ibu dengan balasan yang lebih baik. Terima kasih atas waktu dan perhatian yang diberikan.
>
> Komitmen kami sederhana: bersama-sama mewujudkan perbankan syariah yang **modern**, **akuntabel**, dan tetap **terpercaya** — sesuai nilai-nilai yang menjadi fondasi BSN.
>
> Kami siap menjawab pertanyaan, masuk ke detail teknis manapun yang diperlukan, atau langsung diskusi pilot di cabang prioritas yang dipilih BSN.
>
> Demo live aplikasi staging juga sudah kami siapkan — kalau ada waktu setelah ini, dengan senang hati kami jalankan.
>
> Wassalamu'alaikum warahmatullahi wabarakatuh.

---

## Tips Tambahan Saat Presentasi

### Antisipasi Pertanyaan yang Biasa Muncul

**Q: "Kalau petugas matikan GPS, sistem bisa apa?"**
> Jawaban: GPS off akan terdeteksi sebagai "GPS unavailable" di dashboard. Petugas akan muncul di alert supervisor sebagai "tidak ada update GPS". Sistem tidak bisa memaksa GPS aktif — ini batasan platform Android, semua aplikasi kena. Yang sistem lakukan: surface kondisi itu transparent ke supervisor sehingga ada akuntabilitas.

**Q: "Berapa biaya per bulan kalau pakai MapTiler?"**
> Jawaban: MapTiler free tier sampai 100.000 map loads per bulan. Untuk skala BSN dengan ratusan supervisor + petugas, kira-kira masuk paket berbayar di kisaran USD 25–95 per bulan. Kalau ingin alternatif lebih hemat, basemap bisa swap ke OpenStreetMap self-hosted — sedikit setup, tapi nol biaya recurring.

**Q: "Data nasabah disimpan di mana? Aman dari cloud asing?"**
> Jawaban: Deployment on-premise di DC BSN. Data tidak transit ke cloud asing manapun. Yang kontak ke pihak luar hanya: (1) Firebase FCM untuk push notif APK — payload yang dikirim cuma judul + body singkat, tidak ada data nasabah; (2) Twilio/Meta saat WA aktif — itupun isi pesannya template yang sudah disetujui BSN.

**Q: "Bagaimana kalau ArtiVisi tidak lagi support?"**
> Jawaban: Source code menjadi milik BSN setelah deliver (tergantung kontrak). Stack-nya open-source standar industri: PostgreSQL, Node.js, React. Tim internal BSN atau vendor lain bisa lanjut maintain tanpa lock-in. Dokumentasi teknis lengkap, plus 30 hari pendampingan post-go-live.

**Q: "Berapa lama training petugas?"**
> Jawaban: Aplikasi dirancang dengan onboarding tour 6 langkah di dalam aplikasi sendiri. Untuk petugas yang biasa pakai HP, butuh 15–30 menit pakai pertama kali, lalu lancar. Untuk supervisor butuh sesi 2 jam sekali, plus user manual yang sudah kami siapkan dalam Bahasa Indonesia.

### Aturan Praktis Saat Presentasi

1. **Slide 1, 4, 14** — pelan, kontak mata, suara tegas.
2. **Slide 2** — bangun urgency, tapi jangan menggurui. Audiens BSN tahu masalah ini lebih baik dari kita.
3. **Slide 5, 13** — slide teknis. Kalau audiens non-teknis, tipiskan; kalau ada CTO/IT Head, perlambat dan biarkan mereka bertanya detail.
4. **Slide 9** — bagian paling persuasif untuk decision maker non-IT. Jangan terburu.
5. **Slide 11** — tekankan "**sebagian besar sudah berjalan**" supaya tidak kelihatan jadwal ambisius.
6. **Hindari klaim yang tidak yakin**. Lebih baik bilang "sedang dievaluasi" daripada "siap".
7. **Siapkan demo live** sebagai cadangan — bila ada pertanyaan tentang feature spesifik, bilang "izin kami tunjukkan langsung" lebih impactful daripada deskripsi.

### Durasi Total

| Segmen | Durasi |
|---|---|
| Cover + Latar Belakang (1-2) | ~5 menit |
| Solusi + Pilar (3-4) | ~6 menit |
| Arsitektur + Domain (5-6) | ~6 menit |
| Modul Detail (7-10) | ~12 menit |
| Roadmap + Kredensial (11-12) | ~5 menit |
| Spec API + Penutup (13-14) | ~3 menit |
| **Subtotal presentasi** | **~37 menit** |
| Q&A | 15–30 menit |
| **Total sesi** | **~55–67 menit** |

Kalau diminta versi ringkas 15 menit: skip slide 6, 12, 13 — fokus pada 1, 2, 3, 4, 7, 8, 9, 14.
