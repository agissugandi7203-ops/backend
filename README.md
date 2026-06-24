# Genesis.id Backend Service (NestJS + Fastify)

[![NestJS Version](https://img.shields.io/npm/v/@nestjs/core.svg)](#)
[![License](https://img.shields.io/npm/l/@nestjs/core.svg)](#)
[![Performance](https://img.shields.io/badge/performance-Fastify%20~45.000%20req/s-brightgreen)](#)
[![Security](https://img.shields.io/badge/security-Supabase%20JWT%20%7C%20RBAC-blue)](#)

Mesin backend **Genesis.id** dibangun di atas framework **NestJS** dengan adapter **Fastify** untuk memproses unggahan berkas, sensor gambar PII, geo-deduplikasi spasial PostGIS, integrasi Google Vertex AI (Gemini), serta pencarian vektor RAG secara concurrency tinggi.

---

## 1. Fitur Utama Backend
1.  **Otentikasi & RBAC Guard**: Mengintegrasikan Supabase JWT Auth Guard dan Roles Guard kustom (`admin` vs `citizen`) untuk mengunci API sensitif.
2.  **Profiles & Onboarding**: Mengelola profil warga, pendaftaran wilayah tetap (Kabupaten/Kota), kalkulasi streak harian, dan lencana.
3.  **Leaderboard Engine**: Menyediakan data peringkat global (warga teraktif) dan peringkat kota (wilayah terbersih) secara real-time berbasis PostgreSQL views.
4.  **Badges Management**: Menyediakan katalog lencana dinamis dan kemampuan bagi admin untuk memberikan (*award*) atau mencabut (*revoke*) lencana secara manual.

---

## 2. Struktur Proyek Backend
```
backend/src/
├── auth/               # JWT Guard, Roles Decorator & Guard, get-user decorator
├── profiles/           # Onboarding, Profile CRUD, & Admin override endpoints
├── badges/             # Katalog lencana & sistem award/revoke lencana
├── leaderboard/        # Endpoint peringkat global & kabupaten/kota
└── supabase/           # Layanan global Supabase Client (Service Role Key)
```

---

## 3. Prasyarat & Setup

### A. Prasyarat
*   Node.js (v18+) dan npm.
*   Proyek Supabase aktif dengan ekstensi `postgis` dan `vector` terpasang.

### B. Langkah Instalasi
1.  Jalankan install npm package:
    ```bash
    npm install
    ```
2.  Salin berkas `.env.example` menjadi `.env` di root folder backend:
    ```bash
     cp .env.example .env
     ```
3.  Konfigurasikan nilai URL Supabase, Service Role Key (untuk admin bypass RLS), OpenRouter API Key, dan RAG parameters (`RAG_CHUNK_SIZE` & `RAG_CHUNK_OVERLAP`) di dalam berkas `.env`.

### C. Menjalankan Server
```bash
# Mode development (watch mode)
npm run start:dev

# Mode production (build & run)
npm run build
npm run start:prod
```

### D. Verifikasi & Pengujian
```bash
# Menjalankan Linter
npm run lint

# Menjalankan Build
npm run build
```

---

## 4. Pengelolaan Basis Pengetahuan RAG (Knowledge Base)

Backend ini menyediakan modul penyerapan peraturan daerah dan hukum nasional secara otomatis menggunakan text chunking kustom dan model embeddings OpenRouter (`google/gemini-embedding-2` dengan dimensi vektor 768).

### A. Endpoint Admin Pengelolaan
*   `POST /knowledge-base` : Menerima judul, teks isi hukum, dan metadata opsional. Dokumen dipotong-potong menjadi chunk berukuran dinamis, dikonversi menjadi embedding vektor via OpenRouter, dan disimpan di tabel `knowledge_base` Supabase.
*   `GET /knowledge-base` : Mengambil daftar seluruh regulasi yang tersimpan di basis data (mengecualikan kolom vektor `embedding` untuk menghemat bandwidth data).
*   `DELETE /knowledge-base/:id` : Menghapus dokumen regulasi atau chunk berdasarkan ID dari basis data.

### B. Otomatisasi Unggah Massal (Bulk Upload)
Anda dapat mengunggah kumpulan berkas peraturan lokal `.txt` atau `.md` sekaligus ke database menggunakan skrip pembantu:
```bash
npx ts-node scripts/bulk-upload-knowledge.ts ../docs/regulations "<supabase_service_role_key>" "http://localhost:3000"
```

### C. JDIH Scraper & Importer (`scrape-and-import-jdih.ts`)
Kami menyediakan skrip khusus untuk mensimulasikan pencarian hukum ke portal **api.jdihn.go.id** (Jaringan Dokumentasi dan Informasi Hukum Nasional), mengambil berkas hukum nasional terbaru (PP No. 22/2021, Permen LHK No. 6/2021, UU No. 18/2013), lalu langsung memotong (chunk), mem-vektorisasi (embed), dan menyimpannya di database Supabase:
```bash
npx ts-node scripts/scrape-and-import-jdih.ts "<supabase_service_role_key>" "http://localhost:3000"
```

---

## 5. Dinamis Model AI Selector & SSE Streaming
*   **Routing Model Dinamis**: API `/chat` dan `/chat/stream` menerima parameter `model` dari aplikasi mobile. Sistem akan meneruskannya secara otomatis ke OpenRouter. Model yang didukung secara default:
    *   `google/gemini-2.5-flash` (⚡ Geni-Flash)
    *   `google/gemini-2.5-pro` (💎 Geni-Pro)
    *   `deepseek/deepseek-chat` (🤖 DeepSeek-Chat)
*   **SSE Streaming**: Chat response dikirim secara chunk demi chunk menggunakan adapter Fastify SSE dengan tipe content `text/event-stream` untuk visualisasi respons mengetik dinamis di sisi Flutter client.

---

## 6. Dokumentasi API Lengkap
Untuk detail katalog API, skema request/response, dan alur otorisasi, silakan baca berkas dokumentasi resmi:
👉 **[BACKEND_ARCHITECTURE.md (Arsitektur Backend)](file:///d:/PROJECT%20ARIEF/LKS%20Dikdasmen/docs/BACKEND_ARCHITECTURE.md)**
👉 **[KNOWLEDGE_BASE_GUIDE.md (Panduan RAG)](file:///d:/PROJECT%20ARIEF/LKS%20Dikdasmen/docs/KNOWLEDGE_BASE_GUIDE.md)**


