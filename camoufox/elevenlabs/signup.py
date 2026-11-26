#!/usr/bin/env python3
"""
Automasi End-to-End ElevenLabs via Camoufox (Built from scratch):
1. Buka https://dispose.lol/ -> Selalu generate email Outlook baru (tidak pernah memakai ulang email lama).
2. Buka https://elevenlabs.io/app/sign-up -> Input email Outlook baru & password -> Sign up.
3. Ambil link verifikasi dari inbox dispose.lol -> Buka link -> Sign in ulang untuk konfirmasi verifikasi.
4. Lewati 5 langkah onboarding (Platform ElevenCreative -> 18+ checkbox -> Skip Persona -> Skip Interests -> Skip Pricing).
5. Masuk ke halaman Text to Speech -> Tutup modal v4 -> Pilih Voice 'Dany Saputra - Neutral and Clear' & Model 'Eleven v3'.
6. Cek kredit awal -> Input teks narasi -> Generate speech -> Cek sisa kredit -> Download hasil Generation 2 ke folder input/.
"""

import argparse
import concurrent.futures
import json
import re
import secrets
import string
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

# Setup path agar bisa import browser & debugger dari folder camoufox/
CAMOUFOX_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = CAMOUFOX_DIR.parent
if str(CAMOUFOX_DIR) not in sys.path:
    sys.path.insert(0, str(CAMOUFOX_DIR))

from browser import open_camoufox_profile, open_fresh_camoufox
from debugger import CamoufoxDebugger

DISPOSE_URL = "https://dispose.lol/"
SIGNUP_URL = "https://elevenlabs.io/app/sign-up"
TTS_URL = "https://elevenlabs.io/app/speech-synthesis/text-to-speech"

DEFAULT_PROFILE = "jovangithub@gmail.com"
DEFAULT_VOICE = "Dany Saputra"
DEFAULT_MODEL = "Eleven v3"
DEFAULT_TEXT = "Halo semuanya, selamat datang kembali. Hari ini kita akan membahas sesuatu yang sangat menarik."

INPUT_DIR = PROJECT_ROOT / "input"
ACCOUNTS_FILE = Path(__file__).resolve().parent / "accounts.json"


def generate_strong_password() -> str:
    """Membuat password acak yang memenuhi syarat ElevenLabs (8+ chars, huruf besar/kecil, angka, simbol)."""
    token = "".join(secrets.choice(string.ascii_lowercase + string.digits) for _ in range(6))
    return f"Elv!{token.capitalize()}#2026"


def load_used_emails() -> set:
    """Membaca daftar email yang sudah pernah dipakai dari accounts.json agar tidak pernah dipakai ulang."""
    used = set()
    if ACCOUNTS_FILE.exists():
        try:
            records = json.loads(ACCOUNTS_FILE.read_text(encoding="utf-8"))
            for r in records:
                if r.get("email"):
                    used.add(r["email"].strip().lower())
        except Exception:
            pass
    return used


def save_account(email: str, password: str, status: str, extra: Optional[dict] = None):
    """Menyimpan status akun ke accounts.json."""
    records = []
    if ACCOUNTS_FILE.exists():
        try:
            records = json.loads(ACCOUNTS_FILE.read_text(encoding="utf-8"))
        except Exception:
            records = []

    updated = False
    for r in records:
        if r.get("email", "").lower() == email.lower():
            r["status"] = status
            r["updated_at"] = datetime.now().isoformat()
            if extra:
                r.update(extra)
            updated = True
            break

    if not updated:
        item = {
            "email": email,
            "password": password,
            "status": status,
            "created_at": datetime.now().isoformat(),
        }
        if extra:
            item.update(extra)
        records.append(item)

    ACCOUNTS_FILE.write_text(json.dumps(records, indent=2), encoding="utf-8")


def extract_dispose_email(page) -> str:
    """Mengekstrak alamat email yang sedang tampil di halaman utama dispose.lol."""
    try:
        main_text = page.locator("main").inner_text(timeout=5000) or ""
        matches = re.findall(r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+", main_text)
        for m in matches:
            if not m.lower().endswith("dispose.lol"):
                return m.strip()
    except Exception:
        pass
    return ""


def has_elevenlabs_verify_email_in_inbox(page) -> bool:
    """
    Memeriksa apakah di dalam list inbox dispose.lol saat ini sudah ada pesan verifikasi dari ElevenLabs.
    Jika tidak ada pesan verifikasi ElevenLabs, berarti email tersebut masih fresh untuk ElevenLabs.
    """
    try:
        page.get_by_text("Loading inbox").wait_for(state="hidden", timeout=10000)
    except Exception:
        pass

    try:
        refresh_btn = page.get_by_role("button", name="Refresh").first
        if refresh_btn.count() > 0 and refresh_btn.is_visible() and not refresh_btn.is_disabled():
            refresh_btn.click()
            page.wait_for_timeout(1500)
    except Exception:
        pass

    msg_btn = page.locator(
        'button:has-text("Verify your email for ElevenLabs"), '
        'button:has-text("ElevenLabs"), '
        'button[aria-label*="Verify your email for ElevenLabs" i]'
    )
    return msg_btn.count() > 0 and msg_btn.first.is_visible()


def create_fresh_outlook_email(
    page,
    dbg: CamoufoxDebugger,
    max_login_wait: int = 300,
    force_new: bool = False,
) -> str:
    """
    Membuka https://dispose.lol/, menunggu login Google jika diminta,
    mengecek apakah email yang sedang aktif sudah merupakan Outlook dan inbox-nya bersih dari
    email verifikasi ElevenLabs (jika bersih & belum dipakai, langsung dipakai; jika bukan Outlook
    atau sudah ada email verifikasi ElevenLabs, buat email Outlook baru dan cek kembali inbox-nya).
    """
    print("\n" + "=" * 65)
    print("  [1/6] CEK / GENERATE EMAIL OUTLOOK FRESH DI DISPOSE.LOL")
    print("=" * 65)

    page.goto(DISPOSE_URL, wait_until="domcontentloaded")
    page.wait_for_timeout(2000)
    dbg.snapshot(page, "01_dispose_loaded", "Halaman dispose.lol dimuat")

    # Tunggu pengguna login Google jika dispose.lol menampilkan Sign-In Gate ("We're under attack")
    alerted = False
    oauth_clicked = False
    start_wait = time.time()
    while time.time() - start_wait < max_login_wait:
        change_btn = page.get_by_role("button", name="Change")
        create_form = page.locator('button:has-text("Outlook")')
        if (change_btn.count() > 0 and change_btn.first.is_visible()) or (
            create_form.count() > 0 and create_form.first.is_visible()
        ):
            break

        curr_url = page.url.lower()
        body_text = (page.locator("body").inner_text() or "").lower()

        # Jika sedang di halaman Google OAuth chooser, pilih akun profil secara otomatis
        if "accounts.google.com" in curr_url:
            acc_item = page.locator('[data-identifier], [role="link"][data-email]').first
            if acc_item.count() > 0 and acc_item.is_visible():
                print("[*] Memilih akun Google secara otomatis di halaman OAuth...")
                acc_item.click()
                page.wait_for_timeout(3000)
                continue
            cont_btn = page.get_by_role("button", name=re.compile(r"Continue|Lanjutkan|Allow|Izinkan", re.I)).first
            if cont_btn.count() > 0 and cont_btn.is_visible():
                cont_btn.click()
                page.wait_for_timeout(3000)
                continue

        if "sign in to get your inbox" in body_text or "under attack" in body_text or "login to continue" in body_text:
            if not oauth_clicked:
                google_btn = page.get_by_role("button", name=re.compile(r"Continue with Google|Login to continue", re.I)).first
                if google_btn.count() > 0 and google_btn.is_visible():
                    print("[*] Mengklik tombol 'Continue with Google' secara otomatis...")
                    oauth_clicked = True
                    try:
                        google_btn.click(no_wait_after=True, timeout=5000)
                    except Exception:
                        pass
                    page.wait_for_timeout(3000)
                    continue

            if not alerted:
                print("\n[!] Dispose.lol meminta Sign-In Google.")
                print("[!] Silakan selesaikan login Google di tab dispose.lol yang terbuka...")
                dbg.snapshot(page, "01b_dispose_waiting_login", "Menunggu login Google di dispose.lol")
                alerted = True

        page.wait_for_timeout(1500)
    else:
        raise TimeoutError("Timeout menunggu login di dispose.lol.")

    used_emails = load_used_emails()
    current_email = extract_dispose_email(page)

    # 1. Cek terlebih dahulu email yang sedang terbuka di dispose.lol (kecuali diminta force_new)
    if not force_new and current_email and ("@outlook.com" in current_email.lower() or "@hotmail.com" in current_email.lower()):
        print(f"[*] Memeriksa inbox email Outlook yang sedang aktif: {current_email} ...")
        has_el_mail = has_elevenlabs_verify_email_in_inbox(page)
        if not has_el_mail and current_email.lower() not in used_emails:
            print(f"[✓] Inbox '{current_email}' bersih (tidak ada email verify ElevenLabs) -> Email masih FRESH!")
            dbg.snapshot(page, "02_outlook_fresh_reused", f"Email Outlook fresh siap dipakai: {current_email}")
            return current_email
        else:
            reason = "sudah ada email verifikasi ElevenLabs di inbox" if has_el_mail else "sudah tercatat di accounts.json"
            print(f"[*] Email '{current_email}' sudah terpakai ({reason}), mengganti ke Outlook baru...")
            used_emails.add(current_email.lower())
    elif current_email:
        print(f"[*] Mengganti email aktif saat ini ('{current_email}') ke Outlook baru...")
        used_emails.add(current_email.lower())

    # 2. Jika bukan Outlook atau inbox-nya sudah berisi email ElevenLabs, buat Outlook baru & cek inbox-nya
    for attempt in range(1, 6):
        print(f"[*] Membuat email Outlook baru (percobaan {attempt}/5)...")

        change_btn = page.get_by_role("button", name="Change").first
        if change_btn.count() > 0 and change_btn.is_visible():
            change_btn.click()
            page.wait_for_timeout(800)

        outlook_btn = page.get_by_role("button", name="Outlook", exact=True).first
        if outlook_btn.count() > 0 and outlook_btn.is_visible():
            outlook_btn.click()
            page.wait_for_timeout(600)

        create_outlook_btn = page.get_by_role("button", name="Create Outlook").first
        if create_outlook_btn.count() > 0 and create_outlook_btn.is_visible():
            create_outlook_btn.click()

        try:
            page.get_by_role("button", name="Change").first.wait_for(state="visible", timeout=20000)
            page.get_by_text("Loading inbox").wait_for(state="hidden", timeout=15000)
        except Exception:
            pass

        page.wait_for_timeout(1500)
        new_email = extract_dispose_email(page)

        if (
            new_email
            and ("@outlook.com" in new_email.lower() or "@hotmail.com" in new_email.lower())
            and new_email.lower() not in used_emails
        ):
            print(f"[*] Memeriksa list inbox '{new_email}' apakah ada email verifikasi ElevenLabs...")
            if not has_elevenlabs_verify_email_in_inbox(page):
                print(f"[✓] Email Outlook baru & inbox bersih (FRESH): {new_email}")
                dbg.snapshot(page, "02_outlook_created", f"Email Outlook fresh: {new_email}")
                return new_email
            else:
                print(f"[!] Inbox '{new_email}' ternyata sudah berisi email ElevenLabs, cari lagi...")
                used_emails.add(new_email.lower())
                continue

        print(f"[!] Email '{new_email}' belum berubah atau sudah pernah dipakai, mengulang Create Outlook...")
        page.wait_for_timeout(1500)

    raise RuntimeError("Gagal membuat email Outlook baru yang fresh dari dispose.lol.")


class EmailAlreadyRegisteredError(RuntimeError):
    pass


def signup_elevenlabs(el_page, email: str, password: str, dbg: CamoufoxDebugger):
    """
    Membuka halaman Sign-Up ElevenLabs di browser fresh, mengisi Email & Password,
    dan menekan tombol Sign up hingga muncul pesan konfirmasi pengiriman email verifikasi.
    """
    print("\n" + "=" * 65)
    print("  [2/6] SIGN UP AKUN BARU DI ELEVENLABS")
    print("=" * 65)
    print(f"[*] Email    : {email}")
    print(f"[*] Password : {password}")

    el_page.bring_to_front()
    el_page.goto(SIGNUP_URL, wait_until="load")
    el_page.locator("form").first.wait_for(state="visible", timeout=20000)
    el_page.wait_for_timeout(1500)

    email_input = el_page.locator('input[type="email"], input[name="email"]').first
    pass_input = el_page.locator('input[type="password"], input[name="password"]').first
    email_input.wait_for(state="visible", timeout=15000)
    pass_input.wait_for(state="visible", timeout=15000)
    sign_up_btn = el_page.get_by_role("button", name="Sign up", exact=True)

    # Isi Email & Password tanpa .click() koordinat agar aman dari layout shift
    for attempt in range(1, 10):
        if email_input.input_value() != email:
            email_input.fill(email)
            el_page.wait_for_timeout(300)
        if pass_input.input_value() != password:
            pass_input.fill(password)
            el_page.wait_for_timeout(500)
        if not sign_up_btn.is_disabled():
            print("[✓] Tombol 'Sign up' sudah aktif!")
            break
        print(f"[*] Menunggu tombol 'Sign up' aktif ({attempt}/9)...")
        el_page.wait_for_timeout(1500)

    dbg.snapshot(el_page, "03_signup_filled", f"Form sign-up terisi untuk {email}")
    print("[*] Mengklik tombol 'Sign up'...")
    sign_up_btn.click()

    # Tunggu sampai teks "We've sent a verification link" atau tombol Resend muncul
    captcha_alerted = False
    start_time = time.time()
    while time.time() - start_time < 180:
        el_page.wait_for_timeout(1000)
        body_text = (el_page.locator("body").inner_text() or "").lower()
        if "sent a verification link" in body_text or "click resend" in body_text:
            print("[✓] ElevenLabs telah mengirim link verifikasi ke email Outlook!")
            dbg.snapshot(el_page, "04_verification_sent", "Link verifikasi terkirim")
            save_account(email, password, status="verification_sent")
            return
        if "already exists" in body_text or "already registered" in body_text:
            save_account(email, password, status="already_registered")
            raise EmailAlreadyRegisteredError(f"Email {email} sudah terdaftar di ElevenLabs.")

        # Cek jika muncul popup hCaptcha challenge yang membutuhkan klik manual user
        hcaptcha_frame = el_page.locator('iframe[src*="hcaptcha.com"][src*="frame=challenge"]')
        if hcaptcha_frame.count() > 0 and hcaptcha_frame.first.is_visible() and not captcha_alerted:
            print("\n[!] hCaptcha challenge muncul di ElevenLabs! Silakan selesaikan di jendela browser Camoufox...")
            dbg.snapshot(el_page, "03b_hcaptcha_challenge", "Menunggu user menyelesaikan hCaptcha")
            captcha_alerted = True

    raise TimeoutError("Timeout menunggu konfirmasi pengiriman email verifikasi dari ElevenLabs.")


def wait_and_get_verify_url_from_dispose(dispose_page, dbg: CamoufoxDebugger, max_wait: int = 180) -> str:
    """
    Kembali ke tab dispose.lol, menunggu email 'Verify your email for ElevenLabs' masuk,
    membuka detail pesan, dan mengambil URL 'Verify email ->' dari dalam iframe pesan.
    """
    print("\n" + "=" * 65)
    print("  [3/6] MENUNGGU EMAIL VERIFIKASI DI DISPOSE.LOL")
    print("=" * 65)

    dispose_page.bring_to_front()
    start_time = time.time()
    last_refresh = 0

    while time.time() - start_time < max_wait:
        dispose_page.wait_for_timeout(2000)

        # Klik tombol Refresh inbox secara berkala jika tidak sedang loading
        if time.time() - last_refresh > 8:
            try:
                refresh_btn = dispose_page.get_by_role("button", name="Refresh").first
                if refresh_btn.count() > 0 and refresh_btn.is_visible() and not refresh_btn.is_disabled():
                    refresh_btn.click()
            except Exception:
                pass
            last_refresh = time.time()

        # Cek tombol pesan masuk dari ElevenLabs (aria-label: "View Verify your email for ElevenLabs")
        msg_btn = dispose_page.locator(
            'button:has-text("Verify your email for ElevenLabs"), '
            'button[aria-label*="Verify your email for ElevenLabs" i]'
        ).first

        if msg_btn.count() > 0 and msg_btn.is_visible():
            print("[*] Email 'Verify your email for ElevenLabs' masuk! Membuka detail pesan...")
            msg_btn.click()
            dispose_page.wait_for_timeout(2500)
            dbg.snapshot(dispose_page, "05_dispose_email_opened", "Email verifikasi dibuka di dispose.lol")

            # Cari link verifikasi di dalam iframe email maupun halaman utama
            for frame in [dispose_page] + list(dispose_page.frames):
                try:
                    links = frame.locator("a[href]")
                    for i in range(links.count()):
                        href = links.nth(i).get_attribute("href") or ""
                        if "elevenlabs.io" in href and ("mode=verifyEmail" in href or "oobCode=" in href):
                            print(f"[✓] Link verifikasi ditemukan:\n    {href}")
                            return href
                except Exception:
                    pass

            # Fallback regex dari konten HTML iframe
            for frame in [dispose_page] + list(dispose_page.frames):
                try:
                    html = frame.content() or ""
                    m = re.search(
                        r'https?://[^\s"\'<>]+elevenlabs\.io/app/action\?[^\s"\'<>]+',
                        html
                    )
                    if m:
                        verify_url = m.group(0).replace("&amp;", "&")
                        print(f"[✓] Link verifikasi ditemukan (via HTML):\n    {verify_url}")
                        return verify_url
                except Exception:
                    pass

        elapsed = int(time.time() - start_time)
        print(f"[*] Menunggu email verifikasi masuk ({elapsed}/{max_wait}s)...")

    raise TimeoutError("Timeout menunggu email verifikasi ElevenLabs di dispose.lol.")


def verify_and_complete_onboarding(el_page, verify_url: str, email: str, password: str, dbg: CamoufoxDebugger):
    """
    Membuka link verifikasi di tab ElevenLabs, menangani dialog 'Email Verification' (Almost there! -> Continue),
    sign in ulang dengan email & password yang sama, lalu melewati 5 langkah onboarding:
    1. Platform: ElevenCreative -> Continue
    2. Personal Info: Centang checkbox 18+ -> Next
    3. Persona: Skip
    4. Interests: Skip
    5. Pricing: Skip
    """
    print("\n" + "=" * 65)
    print("  [4/6] VERIFIKASI EMAIL, SIGN IN ULANG, & LEWATI ONBOARDING")
    print("=" * 65)

    el_page.bring_to_front()
    el_page.goto(verify_url, wait_until="domcontentloaded")
    el_page.wait_for_timeout(3000)
    dbg.snapshot(el_page, "06_verify_link_opened", "Link verifikasi dibuka")

    # 1. Tunggu redirect ke /sign-in atau /onboarding, tutup dialog "Email Verification" jika muncul, lalu Sign in
    signin_submitted = False
    start_verify = time.time()
    while time.time() - start_verify < 45:
        el_page.wait_for_timeout(1000)
        curr_url = el_page.url

        if "/onboarding" in curr_url or "/speech-synthesis" in curr_url:
            break

        continue_modal_btn = el_page.get_by_role("dialog").get_by_role("button", name="Continue")
        if continue_modal_btn.count() > 0 and continue_modal_btn.first.is_visible():
            print("[*] Menutup dialog 'Email Verification' (klik Continue)...")
            continue_modal_btn.first.click()
            el_page.wait_for_timeout(1000)
            continue

        if "/sign-in" in curr_url and not signin_submitted:
            email_input = el_page.locator('input[type="email"], input[name="email"]').first
            pass_input = el_page.locator('input[type="password"], input[name="password"]').first
            if pass_input.count() > 0 and pass_input.is_visible():
                print("[*] Login ulang di halaman Sign in untuk menyelesaikan verifikasi...")
                if email_input.input_value() != email:
                    email_input.fill(email)
                    el_page.wait_for_timeout(300)
                pass_input.fill(password)
                el_page.wait_for_timeout(800)

                sign_in_btn = (
                    el_page.locator('form button[type="submit"], form button')
                    .filter(has_not_text="Google")
                    .filter(has_not_text="Apple")
                    .last
                )
                if not sign_in_btn.is_disabled():
                    sign_in_btn.click()
                    signin_submitted = True
                    el_page.wait_for_timeout(2000)

    # 2. Loop melewati 5 step onboarding sampai masuk ke /app/speech-synthesis/text-to-speech
    print("[*] Melewati tahapan onboarding...")
    start_ob = time.time()
    while time.time() - start_ob < 90:
        el_page.wait_for_timeout(1200)
        curr_url = el_page.url

        if "/speech-synthesis/text-to-speech" in curr_url:
            print("[✓] Berhasil masuk ke halaman Text to Speech!")
            break

        body_text = (el_page.locator("body").inner_text() or "").lower()

        # Step 1: Choose your platform (ElevenCreative sudah terpilih default -> klik Continue)
        if "choose your platform" in body_text:
            print("    -> Step 1 (Platform): Memilih ElevenCreative & klik Continue...")
            el_page.get_by_role("button", name="Continue").first.click()
            continue

        # Step 2: Help us personalize your experience (Centang checkbox 18+ -> klik Next)
        if "personalize your experience" in body_text or "18 years old" in body_text:
            print("    -> Step 2 (Personal Info): Mencentang checkbox 18+ & klik Next...")
            checkbox = el_page.get_by_role("checkbox").first
            is_checked = checkbox.get_attribute("aria-checked") == "true" or (
                checkbox.evaluate("el => el.tagName === 'INPUT' ? el.checked : false")
            )
            if not is_checked:
                checkbox.click()
                el_page.wait_for_timeout(400)
            el_page.get_by_role("button", name="Next").first.click()
            continue

        # Step 3 (Persona), Step 4 (Interests), Step 5 (Pricing): Klik tombol Skip
        skip_btn = el_page.get_by_role("button", name="Skip", exact=True)
        if skip_btn.count() > 0 and skip_btn.first.is_visible():
            print("    -> Mengklik tombol 'Skip' pada step onboarding...")
            skip_btn.first.click()
            continue

        # Jika sudah selesai splash screen tapi belum di rute TTS
        if "/onboarding" not in curr_url and "/sign-in" not in curr_url:
            el_page.goto(TTS_URL, wait_until="domcontentloaded")
            break

    if "/speech-synthesis/text-to-speech" not in el_page.url:
        el_page.goto(TTS_URL, wait_until="domcontentloaded")
        el_page.wait_for_timeout(2000)

    save_account(email, password, status="active")
    dbg.snapshot(el_page, "07_onboarding_done", "Onboarding selesai dan masuk ke halaman TTS")


def configure_voice_and_model(
    el_page,
    voice_search: str = DEFAULT_VOICE,
    model_name: str = DEFAULT_MODEL,
    dbg: Optional[CamoufoxDebugger] = None,
):
    """
    Di halaman Text to Speech:
    1. Tutup pop-up 'Introducing Eleven v4' ('Got it').
    2. Buka Select voice -> cari 'Dany Saputra' di tab Explore -> hover & klik 'Use' pada 'Dany Saputra - Neutral and Clear'.
    3. Buka Select model -> pilih radio 'Eleven v3'.
    """
    print("\n" + "=" * 65)
    print(f"  [5/6] ATUR VOICE ({voice_search}) & MODEL ({model_name})")
    print("=" * 65)

    el_page.wait_for_timeout(1500)

    # 1. Dismiss modal "Introducing Eleven v4" jika muncul
    got_it_btn = el_page.get_by_role("button", name="Got it")
    if got_it_btn.count() > 0 and got_it_btn.first.is_visible():
        print("[*] Menutup dialog 'Introducing Eleven v4' (klik Got it)...")
        got_it_btn.first.click()
        el_page.wait_for_timeout(1000)

    # 2. Pilih Voice: Dany Saputra - Neutral and Clear
    select_voice_btn = el_page.get_by_role("button", name=re.compile(r"Select voice", re.I)).first
    select_voice_btn.wait_for(state="visible", timeout=15000)
    curr_voice = (select_voice_btn.inner_text() or "").strip()

    if voice_search.lower() not in curr_voice.lower():
        print(f"[*] Membuka pemilih Voice (saat ini: '{curr_voice}')...")
        select_voice_btn.click()
        el_page.wait_for_timeout(1000)

        # Pastikan tab Explore aktif jika belum
        explore_tab = el_page.get_by_role("tab", name="Explore")
        if explore_tab.count() > 0 and explore_tab.first.is_visible():
            explore_tab.first.click()
            el_page.wait_for_timeout(500)

        search_input = el_page.get_by_placeholder("Start typing to search...")
        search_input.wait_for(state="visible", timeout=10000)
        print(f"[*] Mencari voice '{voice_search}'...")
        search_input.fill(voice_search)
        el_page.wait_for_timeout(1800)

        # Hover pada item hasil pencarian agar tombol 'Use' muncul, lalu klik
        voice_text_loc = el_page.get_by_text(re.compile(r"Dany Saputra", re.I)).first
        voice_text_loc.wait_for(state="visible", timeout=10000)
        box = voice_text_loc.bounding_box()
        if box:
            el_page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
            el_page.wait_for_timeout(500)

        use_btn = el_page.get_by_role("dialog").get_by_role("button", name=re.compile(r"^Use$|Select Dany Saputra", re.I))
        if use_btn.count() > 0 and use_btn.first.is_visible():
            print("[*] Mengklik tombol 'Use' pada voice Dany Saputra...")
            use_btn.first.click()
        else:
            voice_text_loc.click(force=True)

        # Tunggu dialog voice tertutup dan tombol Select voice kembali terlihat
        select_voice_btn.wait_for(state="visible", timeout=15000)
        el_page.wait_for_timeout(800)

    updated_voice = (select_voice_btn.inner_text() or "").strip()
    print(f"[✓] Voice aktif: {updated_voice}")

    # 3. Pilih Model: Eleven v3
    select_model_btn = el_page.get_by_role("button", name=re.compile(r"Select model", re.I)).first
    select_model_btn.wait_for(state="visible", timeout=10000)
    curr_model = (select_model_btn.inner_text() or "").strip()

    if model_name.lower() not in curr_model.lower():
        print(f"[*] Membuka pemilih Model (saat ini: '{curr_model}')...")
        select_model_btn.click()
        el_page.wait_for_timeout(800)

        v3_radio = el_page.get_by_role("radio", name=re.compile(r"Eleven v3", re.I)).first
        v3_radio.wait_for(state="visible", timeout=10000)
        print(f"[*] Memilih model '{model_name}'...")
        v3_radio.click()
        el_page.wait_for_timeout(1000)

        if select_model_btn.count() == 0 or not select_model_btn.is_visible():
            back_btn = el_page.get_by_role("button", name="Back")
            if back_btn.count() > 0 and back_btn.first.is_visible():
                back_btn.first.click()
                el_page.wait_for_timeout(500)

    updated_model = (select_model_btn.inner_text() or "").strip()
    print(f"[✓] Model aktif: {updated_model}")
    if dbg:
        dbg.snapshot(el_page, "08_voice_model_set", f"Voice={updated_voice}, Model={updated_model}")


def read_credits(el_page) -> Optional[int]:
    """Membaca angka sisa kredit pada halaman Text to Speech."""
    try:
        main_text = el_page.locator("main").inner_text() or ""
        m = re.search(r"([\d,]+)\s+credits\s+remaining", main_text, re.IGNORECASE)
        if m:
            return int(m.group(1).replace(",", ""))
    except Exception:
        pass
    return None


def generate_and_download_gen2(
    el_page,
    text: str = DEFAULT_TEXT,
    output_dir: Path = INPUT_DIR,
    dbg: Optional[CamoufoxDebugger] = None,
) -> Path:
    """
    1. Mencatat kredit sebelum generate.
    2. Membersihkan teks default ('hallo broooo') di editor TTS dan memasukkan teks baru.
    3. Mengklik 'Generate speech' dan menunggu sampai Generation 1 & Generation 2 selesai dirender.
    4. Mencatat sisa kredit setelah generate.
    5. Mengklik tombol 'Download' khusus untuk Generation 2 (tombol Download kedua di area main)
       dan menyimpannya ke folder input/.
    """
    print("\n" + "=" * 65)
    print("  [6/6] INPUT TEKS, GENERATE SPEECH, & DOWNLOAD GENERATION 2")
    print("=" * 65)

    output_dir.mkdir(parents=True, exist_ok=True)
    credits_before = read_credits(el_page)
    print(f"[*] Kredit sebelum generate : {credits_before:,} credits remaining" if credits_before else "[*] Membaca kredit...")

    # Bersihkan teks yang ada di editor
    clear_btn = el_page.get_by_role("button", name="Clear text")
    if clear_btn.count() > 0 and clear_btn.first.is_visible():
        clear_btn.first.click()
        el_page.wait_for_timeout(400)

    editor = el_page.get_by_test_id("tts-editor").first
    editor.wait_for(state="visible", timeout=15000)
    editor.click()
    el_page.keyboard.press("Control+a")
    el_page.keyboard.press("Backspace")
    el_page.wait_for_timeout(300)

    print(f"[*] Memasukkan teks ({len(text)} karakter): '{text}'")
    el_page.keyboard.insert_text(text)
    el_page.wait_for_timeout(800)

    # Klik tombol Generate speech
    gen_btn = el_page.get_by_role("button", name=re.compile(r"^Generate speech", re.I)).first
    gen_btn.wait_for(state="visible", timeout=10000)
    print("[*] Mengklik tombol 'Generate speech'...")
    gen_btn.click()

    # Tunggu sampai proses generate selesai:
    # Tombol berubah menjadi 'Regenerate speech' dan 2 tombol Download (Generation 1 & Generation 2) muncul di main
    print("[*] Menunggu proses generate audio selesai...")
    start_gen = time.time()
    while time.time() - start_gen < 90:
        el_page.wait_for_timeout(1500)
        regen_btn = el_page.get_by_role("button", name=re.compile(r"Regenerate speech", re.I))
        dl_btns = el_page.locator("main").get_by_role("button", name="Download", exact=True)

        # Pastikan audio player di bawah sudah memuat teks kita
        player_text = ""
        try:
            player_text = el_page.get_by_role("region", name="audio player").inner_text(timeout=1000) or ""
        except Exception:
            pass

        if regen_btn.count() > 0 and dl_btns.count() >= 2 and text[:20].lower() in player_text.lower():
            break
    else:
        raise TimeoutError("Timeout menunggu hasil generate audio Generation 1 & Generation 2.")

    # Buka & tutup menu profil singkat jika diperlukan agar tampilan kredit langsung ter-refresh di UI
    try:
        profile_btn = el_page.get_by_role("button", name="Your profile")
        if profile_btn.count() > 0 and profile_btn.first.is_visible():
            profile_btn.first.click()
            el_page.wait_for_timeout(600)
            el_page.keyboard.press("Escape")
            el_page.wait_for_timeout(500)
    except Exception:
        pass

    credits_after = read_credits(el_page)
    if credits_before is not None and credits_after is not None:
        used = credits_before - credits_after
        print(f"[*] Kredit setelah generate : {credits_after:,} credits remaining (terpakai: {used:,} kredit)")
    elif credits_after is not None:
        print(f"[*] Kredit setelah generate : {credits_after:,} credits remaining")

    # Ambil tombol Download untuk Generation 2 (nth(1) adalah Generation 2; nth(0) adalah Generation 1)
    dl_btns = el_page.locator("main").get_by_role("button", name="Download", exact=True)
    if dl_btns.count() < 2:
        raise RuntimeError(f"Tombol Download Generation 2 tidak ditemukan (hanya ada {dl_btns.count()} tombol).")

    gen2_download_btn = dl_btns.nth(1)
    print("[*] Mengunduh audio khusus untuk GENERATION 2...")

    with el_page.expect_download(timeout=30000) as dl_info:
        gen2_download_btn.click()

    download = dl_info.value
    suggested = download.suggested_filename
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    target_path = output_dir / f"gen2_{timestamp}_{suggested}"
    download.save_as(str(target_path))

    size_bytes = target_path.stat().st_size if target_path.exists() else 0
    print(f"[✓] Audio Generation 2 berhasil disimpan ke folder input!")
    print(f"    -> Path : {target_path}")
    print(f"    -> Size : {size_bytes:,} bytes")

    if dbg:
        dbg.snapshot(el_page, "09_gen2_downloaded", f"Generation 2 tersimpan di {target_path}")

    return target_path


def run_flow(
    profile_email: str = DEFAULT_PROFILE,
    text: str = DEFAULT_TEXT,
    voice: str = DEFAULT_VOICE,
    model: str = DEFAULT_MODEL,
    password: Optional[str] = None,
    output_dir: Path = INPUT_DIR,
    headless: bool = False,
    no_wait_close: bool = False,
):
    pwd = password or generate_strong_password()
    dbg = CamoufoxDebugger(session_name="dispose_elevenlabs_gen2")

    print("=" * 65)
    print("  CAMOUFOX: DISPOSE.LOL OUTLOOK -> ELEVENLABS -> DOWNLOAD GEN 2")
    print("=" * 65)
    print(f"[*] Profil Camoufox : {profile_email}")
    print(f"[*] Voice Target    : {voice}")
    print(f"[*] Model Target    : {model}")
    print(f"[*] Output Folder   : {output_dir}")
    print("=" * 65)

    def _dispose_get_email(force_new: bool = False) -> str:
        def _worker(run_headless: bool) -> str:
            max_wait = 20 if run_headless else 300
            with open_camoufox_profile(
                email=profile_email,
                headless=run_headless,
                humanize=True,
                i_know_what_im_doing=True,
            ) as dispose_ctx:
                dispose_ctx.set_default_timeout(35000)
                d_page = dispose_ctx.pages[0] if dispose_ctx.pages else dispose_ctx.new_page()
                return create_fresh_outlook_email(
                    d_page,
                    dbg=dbg,
                    max_login_wait=max_wait,
                    force_new=force_new,
                )

        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            try:
                return pool.submit(_worker, True).result()
            except TimeoutError:
                if headless:
                    raise
                print("[*] Sesi dispose.lol perlu login ulang, membuka jendela GUI Camoufox...")
                return pool.submit(_worker, False).result()

    def _dispose_get_verify_link() -> str:
        def _worker() -> str:
            with open_camoufox_profile(
                email=profile_email,
                headless=True,
                humanize=True,
                i_know_what_im_doing=True,
            ) as dispose_ctx:
                dispose_ctx.set_default_timeout(35000)
                d_page = dispose_ctx.pages[0] if dispose_ctx.pages else dispose_ctx.new_page()
                d_page.goto(DISPOSE_URL, wait_until="domcontentloaded")
                d_page.wait_for_timeout(2000)
                return wait_and_get_verify_url_from_dispose(d_page, dbg=dbg)

        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            return pool.submit(_worker).result()

    # Langkah 1: Cek/buat email Outlook fresh di profil persistent dispose.lol
    outlook_email = _dispose_get_email(force_new=False)

    # Langkah 2-6: Buka instance Camoufox FRESH untuk ElevenLabs
    with open_fresh_camoufox(
        headless=headless,
        humanize=True,
        i_know_what_im_doing=True,
    ) as el_browser:
        el_context = el_browser.new_context()
        el_context.set_default_timeout(35000)
        el_page = el_context.new_page()

        try:
            for signup_try in range(1, 4):
                try:
                    signup_elevenlabs(el_page, email=outlook_email, password=pwd, dbg=dbg)
                    break
                except EmailAlreadyRegisteredError:
                    print(f"[!] Email '{outlook_email}' sudah terdaftar di ElevenLabs. Mengambil Outlook baru...")
                    if signup_try == 3:
                        raise
                    outlook_email = _dispose_get_email(force_new=True)

            # Ambil link verifikasi dari dispose.lol via worker thread headless
            verify_url = _dispose_get_verify_link()

            # Verifikasi email, sign in ulang, dan lewati onboarding di ElevenLabs
            verify_and_complete_onboarding(el_page, verify_url=verify_url, email=outlook_email, password=pwd, dbg=dbg)

            # Atur Voice ke Dany Saputra & Model ke Eleven v3
            configure_voice_and_model(el_page, voice_search=voice, model_name=model, dbg=dbg)

            # Input teks, perhatikan kredit, generate speech, & download Generation 2 ke folder input/
            saved_audio = generate_and_download_gen2(el_page, text=text, output_dir=output_dir, dbg=dbg)
        except Exception as err:
            dbg.snapshot(el_page, "99_error_state", f"Error saat eksekusi: {err}")
            raise

        print("\n" + "=" * 65)
        print("  [✓✓✓] SELURUH FLOW SELESAI DENGAN SUKSES!")
        print("=" * 65)
        print(f"  Email Outlook Baru : {outlook_email}")
        print(f"  Password           : {pwd}")
        print(f"  File Audio (Gen 2) : {saved_audio}")
        print("=" * 65 + "\n")

        if not headless and not no_wait_close:
            print("Tekan [ENTER] di terminal untuk menutup browser Camoufox...")
            try:
                input()
            except (KeyboardInterrupt, EOFError):
                pass

        return saved_audio


def main():
    parser = argparse.ArgumentParser(
        description="Flow Camoufox: Generate Fresh Outlook di Dispose.lol -> Signup ElevenLabs -> Skip Onboarding -> TTS Dany Saputra v3 -> Download Generation 2 ke input/"
    )
    parser.add_argument(
        "--text",
        type=str,
        default=DEFAULT_TEXT,
        help="Teks narasi yang akan di-generate di halaman TTS",
    )
    parser.add_argument(
        "--voice",
        type=str,
        default=DEFAULT_VOICE,
        help=f"Nama voice yang dicari di Explore library (default: {DEFAULT_VOICE})",
    )
    parser.add_argument(
        "--model",
        type=str,
        default=DEFAULT_MODEL,
        help=f"Nama model TTS (default: {DEFAULT_MODEL})",
    )
    parser.add_argument(
        "--profile",
        type=str,
        default=DEFAULT_PROFILE,
        help=f"Profil Google Camoufox untuk sesi login dispose.lol (default: {DEFAULT_PROFILE})",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default=str(INPUT_DIR),
        help=f"Folder penyimpanan audio Generation 2 (default: {INPUT_DIR})",
    )
    parser.add_argument(
        "--headless",
        action="store_true",
        help="Jalankan Camoufox dalam mode headless",
    )
    parser.add_argument(
        "--no-wait-close",
        action="store_true",
        help="Langsung tutup browser setelah flow selesai tanpa menunggu tombol ENTER",
    )

    args = parser.parse_args()
    run_flow(
        profile_email=args.profile,
        text=args.text,
        voice=args.voice,
        model=args.model,
        output_dir=Path(args.output_dir),
        headless=args.headless,
        no_wait_close=args.no_wait_close,
    )


if __name__ == "__main__":
    main()
