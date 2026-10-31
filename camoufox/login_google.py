#!/usr/bin/env python3
import sys
import argparse
from pathlib import Path
from browser import (
    sanitize_email,
    get_profile_dir,
    list_saved_profiles,
    open_camoufox_profile
)


def main():
    parser = argparse.ArgumentParser(
        description="Login ke Google menggunakan Camoufox dengan profil berbasis nama email."
    )
    parser.add_argument(
        "email",
        nargs="?",
        help="Alamat email Google (contoh: user@gmail.com). Jika kosong, akan ditanyakan.",
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="Tampilkan daftar profil email yang sudah tersimpan",
    )
    args = parser.parse_args()

    saved_profiles = list_saved_profiles()

    if args.list:
        print("\n=== Profil Camoufox Tersimpan ===")
        if not saved_profiles:
            print("(Belum ada profil yang tersimpan)")
        else:
            for idx, p in enumerate(saved_profiles, 1):
                print(f"{idx}. {p}")
        print("=================================\n")
        return

    email = args.email
    if not email:
        print("\n=== Camoufox Google Login Setup ===")
        if saved_profiles:
            print("Profil tersimpan saat ini:")
            for p in saved_profiles:
                print(f" - {p}")
            print()

        try:
            email = input("Masukkan email Google yang ingin digunakan: ").strip()
        except (KeyboardInterrupt, EOFError):
            print("\nDibatalkan.")
            sys.exit(0)

    if not email:
        print("[!] Email tidak boleh kosong.")
        sys.exit(1)

    profile_name = sanitize_email(email)
    profile_dir = get_profile_dir(profile_name)

    print(f"\n[*] Email       : {email}")
    print(f"[*] Folder Profil: {profile_dir}")
    print("[*] Menjalankan Camoufox...")

    try:
        with open_camoufox_profile(profile_name, headless=False, humanize=True) as context:
            # Ambil halaman pertama yang sudah dibuat saat persistent context dibuka
            page = context.pages[0] if context.pages else context.new_page()

            print("[*] Membuka halaman login Google...")
            page.goto("https://accounts.google.com/")

            print("\n" + "=" * 60)
            print(" [PETUNJUK]")
            print(" 1. Silakan login di jendela browser Firefox yang terbuka.")
            print(" 2. Selesaikan pengisian email, password, dan verifikasi 2FA/OTP.")
            print(" 3. Setelah berhasil masuk (misal masuk dashboard Google),")
            print("    KEMBALI ke terminal ini dan tekan [ENTER].")
            print("=" * 60 + "\n")

            try:
                input("Tekan [ENTER] jika sudah selesai login...")
            except (KeyboardInterrupt, EOFError):
                print("\n[!] Menutup browser dan menyimpan sesi...")

            # Beri jeda singkat agar cookies / session tersinkronisasi ke disk
            page.wait_for_timeout(2000)

        print(f"\n[✓] Sukses! Sesi login untuk '{profile_name}' telah tersimpan.")
        print(f"[✓] Data tersimpan di: {profile_dir}\n")

    except Exception as e:
        print(f"\n[X] Terjadi error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
