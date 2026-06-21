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
3.  Konfigurasikan nilai URL Supabase dan Service Role Key di dalam berkas `.env`.

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

## 4. Dokumentasi API Lengkap
Untuk detail katalog API, skema request/response, dan alur otorisasi, silakan baca berkas dokumentasi resmi:
👉 **[BACKEND_ARCHITECTURE.md (Dokumentasi Arsitektur)](file:///d:/PROJECT%20ARIEF/LKS%20Dikdasmen/docs/BACKEND_ARCHITECTURE.md)**
