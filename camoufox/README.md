# Camoufox Google Account Manager

Modul ini mengelola sesi login Google secara persisten menggunakan browser anti-detect **Camoufox**. Sesi disimpan dalam folder profil terpisah dengan penamaan berbasis **alamat email**.

## Struktur Direktori

```
camoufox/
├── browser.py            # Modul utama untuk membuka browser dengan profil email tertentu
├── login_google.py       # Script CLI interaktif untuk login pertama kali
├── check_session.py      # Script untuk memeriksa apakah sesi login masih aktif
├── profiles/             # Folder tempat data profil & cookies tersimpan
│   ├── .gitkeep
│   ├── contoh.email1@gmail.com/
│   └── contoh.email2@gmail.com/
└── README.md
```

---

## 1. Login Akun Google Baru (Disimpan ke Folder Email)

Jalankan script `login_google.py` dengan menyertakan alamat email:

```bash
python3 camoufox/login_google.py emailpertama@gmail.com
```

Atau jalankan tanpa argumen, Anda akan diminta mengetikkan email:

```bash
python3 camoufox/login_google.py
```

**Langkah-langkah:**
1. Jendela browser Firefox (Camoufox) akan terbuka di halaman login Google.
2. Masukkan password dan selesaikan verifikasi 2FA/OTP langsung di browser.
3. Setelah berhasil masuk ke akun Google, kembali ke terminal dan tekan **[ENTER]**.
4. Profil otomatis tersimpan di `camoufox/profiles/emailpertama@gmail.com/`.

Lakukan hal yang sama untuk email kedua:
```bash
python3 camoufox/login_google.py emailkedua@gmail.com
```

---

## 2. Melihat Daftar Profil yang Tersimpan

```bash
python3 camoufox/login_google.py --list
```

---

## 3. Menguji Sesi Login

Periksa apakah akun masih tersimpan dan aktif:

```bash
# Mode GUI (jendela terbuka)
python3 camoufox/check_session.py emailpertama@gmail.com

# Mode Headless (berjalan cepat di latar belakang)
python3 camoufox/check_session.py emailpertama@gmail.com --headless
```

---

## 4. Cara Memakai di Script Automasi Anda

Gunakan fungsi `open_camoufox_profile` dari `camoufox.browser`:

```python
from camoufox.browser import open_camoufox_profile

email = "emailpertama@gmail.com"

# Buka browser dengan profil email yang sudah login
with open_camoufox_profile(email, headless=True) as context:
    page = context.pages[0] if context.pages else context.new_page()
    page.goto("https://myaccount.google.com")
    print(page.title())
    # Lakukan automasi selanjutnya...
```
