#!/usr/bin/env python3
import sys
import argparse
from browser import (
    sanitize_email,
    get_profile_dir,
    list_saved_profiles,
    open_camoufox_profile
)


def main():
    parser = argparse.ArgumentParser(
        description="Periksa apakah profil email masih dalam keadaan login ke Google."
    )
    parser.add_argument(
        "email",
        nargs="?",
        help="Alamat email Google yang ingin diuji",
    )
    parser.add_argument(
        "--headless",
        action="store_true",
        help="Jalankan di background tanpa menampilkan jendela browser",
    )
    args = parser.parse_args()

    email = args.email
    saved_profiles = list_saved_profiles()

    if not email:
        if not saved_profiles:
            print("[!] Belum ada profil yang tersimpan. Silakan login terlebih dahulu dengan:")
            print("    python3 camoufox/login_google.py your_email@gmail.com")
            sys.exit(1)

        print("\n=== Profil Tersimpan ===")
        for idx, p in enumerate(saved_profiles, 1):
            print(f"{idx}. {p}")
        try:
            choice = input("\nPilih nomor profil atau ketik email: ").strip()
            if choice.isdigit() and 1 <= int(choice) <= len(saved_profiles):
                email = saved_profiles[int(choice) - 1]
            else:
                email = choice
        except (KeyboardInterrupt, EOFError):
            print("\nDibatalkan.")
            sys.exit(0)

    profile_name = sanitize_email(email)
    print(f"\n[*] Menguji sesi untuk: {profile_name}")
    print(f"[*] Mode: {'Headless (Background)' if args.headless else 'GUI (Jendela Terlihat)'}")

    try:
        with open_camoufox_profile(profile_name, headless=args.headless, humanize=True) as context:
            page = context.pages[0] if context.pages else context.new_page()
            print("[*] Mengunjungi https://myaccount.google.com/ ...")
            page.goto("https://myaccount.google.com/", wait_until="networkidle")

            current_url = page.url
            title = page.title()

            print(f"[*] Halaman aktif: {title} ({current_url})")

            # Jika dialihkan ke /signin, artinya belum login
            if "signin" in current_url or "ServiceLogin" in current_url:
                print(f"\n[!] Status: BELUM LOGIN atau sesi telah kedaluwarsa untuk '{profile_name}'.")
                print("    Silakan jalankan: python3 camoufox/login_google.py " + profile_name)
            else:
                print(f"\n[✓] Status: LOGIN AKTIF! Akun '{profile_name}' berhasil tersimpan dan siap digunakan.")

            if not args.headless:
                print("\nTekan [ENTER] di terminal untuk menutup browser...")
                try:
                    input()
                except (KeyboardInterrupt, EOFError):
                    pass

    except Exception as e:
        print(f"\n[X] Terjadi error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
