#!/usr/bin/env python3
import argparse
import concurrent.futures
import json
import random
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Optional
from urllib.parse import parse_qs, urlparse

# Setup path agar bisa import dari folder camoufox/
CAMOUFOX_DIR = Path(__file__).resolve().parent.parent
if str(CAMOUFOX_DIR) not in sys.path:
    sys.path.insert(0, str(CAMOUFOX_DIR))

from browser import open_camoufox_profile
from debugger import CamoufoxDebugger
from camoufox.sync_api import Camoufox
from configure_tts import (
    configure_tts_dashboard,
    input_and_generate_speech,
    TTS_URL,
    DEFAULT_MODEL,
    DEFAULT_VOICE,
    safe_goto,
)

# List nama untuk penggabungan nama random realistis
FIRST_NAMES = [
    "adrian", "budi", "dimas", "kevin", "arif", "hendra", "rizky", "satria",
    "fajar", "bayu", "dani", "reza", "taufik", "wahyu", "indra", "gilang",
    "bagas", "ilham", "rio", "alif", "farhan", "yoga", "rendy", "angga",
    "marcus", "alex", "david", "ryan", "jason", "leo", "nathan", "felix",
    "alvin", "hafiz", "deni", "yusuf", "ihsan", "zaki", "firman", "rehan"
]

LAST_NAMES = [
    "pratama", "wijaya", "santoso", "gunawan", "saputra", "kurniawan", "hidayat",
    "setiawan", "ramadhan", "kusuma", "firmansyah", "putra", "wibowo", "nugroho",
    "syahputra", "lestari", "wardhana", "permada", "darman", "utama", "sanjaya",
    "mahendra", "wicaksono", "prakoso", "subagyo", "hermawan", "sulistyo"
]

DOMAIN = "riztama.my.id"
DEFAULT_PASSWORD = "Jovan@1224"
DEFAULT_PROFILE = "jovangithub@gmail.com"
SIGNUP_URL = "https://elevenlabs.io/sign-up"
EMAILONDECK_URL = "https://www.emailondeck.com"
GMAIL_URL = "https://mail.google.com/mail/u/0/#inbox"
ACCOUNTS_FILE = Path(__file__).resolve().parent / "accounts.json"
USED_CODES_FILE = Path(__file__).resolve().parent / ".used_verification_codes.json"


def get_used_codes() -> set:
    """Mengambil kumpulan oobCode verifikasi yang sudah pernah digunakan agar tidak terambil kembali."""
    codes = set()
    if USED_CODES_FILE.exists():
        try:
            codes.update(json.loads(USED_CODES_FILE.read_text(encoding="utf-8")))
        except Exception:
            pass
    if ACCOUNTS_FILE.exists():
        try:
            accs = json.loads(ACCOUNTS_FILE.read_text(encoding="utf-8"))
            for acc in accs:
                v_url = acc.get("verify_url", "")
                if "oobCode=" in v_url:
                    query_params = parse_qs(urlparse(v_url).query)
                    code = query_params.get("oobCode", [""])[0]
                    if code:
                        codes.add(code)
        except Exception:
            pass
    return codes


def mark_code_used(code: str):
    """Menandai kode verifikasi oobCode sebagai telah terpakai."""
    if not code:
        return
    codes = get_used_codes()
    codes.add(code)
    try:
        USED_CODES_FILE.write_text(json.dumps(list(codes), indent=2), encoding="utf-8")
    except Exception:
        pass


def parse_proxy(proxy_str: Optional[str]) -> Optional[dict]:
    """Mengubah format proxy string (http://user:pass@ip:port atau ip:port:user:pass) ke dictionary Playwright."""
    if not proxy_str:
        return None
    proxy_str = proxy_str.strip()
    if not proxy_str:
        return None

    # Format: ip:port:user:pass
    parts = proxy_str.split(":")
    if len(parts) == 4 and not proxy_str.startswith(("http://", "https://", "socks5://", "socks4://")):
        ip, port, user, pwd = parts
        return {
            "server": f"http://{ip}:{port}",
            "username": user,
            "password": pwd
        }

    # Format URL: scheme://user:pass@host:port
    if "://" in proxy_str:
        parsed = urlparse(proxy_str)
        server = f"{parsed.scheme}://{parsed.hostname}:{parsed.port}"
        res = {"server": server}
        if parsed.username:
            res["username"] = parsed.username
        if parsed.password:
            res["password"] = parsed.password
        return res

    # Format: ip:port
    if len(parts) == 2 and not proxy_str.startswith(("http://", "https://")):
        return {"server": f"http://{proxy_str}"}

    return {"server": proxy_str}


def generate_random_email(domain: str = DOMAIN) -> str:
    """Menghasilkan email random [randomnamemerger]@riztama.my.id"""
    first = random.choice(FIRST_NAMES)
    last = random.choice(LAST_NAMES)
    digits = random.randint(10, 999)
    return f"{first}{last}{digits}@{domain}"


def save_account_record(email: str, password: str, status: str = "verification_sent", extra_data: dict = None):
    """Simpan atau perbarui data akun ke accounts.json"""
    records = []
    if ACCOUNTS_FILE.exists():
        try:
            with open(ACCOUNTS_FILE, "r", encoding="utf-8") as f:
                records = json.load(f)
        except Exception:
            records = []

    # Update jika email sudah ada, atau tambahkan jika baru
    found = False
    for r in records:
        if r.get("email") == email:
            r["status"] = status
            r["updated_at"] = datetime.now().isoformat()
            if extra_data:
                r.update(extra_data)
            found = True
            break

    if not found:
        new_entry = {
            "email": email,
            "password": password,
            "status": status,
            "created_at": datetime.now().isoformat()
        }
        if extra_data:
            new_entry.update(extra_data)
        records.append(new_entry)

    with open(ACCOUNTS_FILE, "w", encoding="utf-8") as f:
        json.dump(records, f, indent=2)


def get_latest_active_account():
    """Mengambil email dan password dari akun aktif terakhir di accounts.json"""
    if ACCOUNTS_FILE.exists():
        try:
            with open(ACCOUNTS_FILE, "r", encoding="utf-8") as f:
                records = json.load(f)
            for r in reversed(records):
                if r.get("status") == "active" and r.get("email") and r.get("password"):
                    return r.get("email"), r.get("password")
        except Exception:
            pass
    return None, None


def is_captcha_active(page) -> bool:
    """Memeriksa apakah modal/tantangan hCaptcha, Turnstile, atau reCAPTCHA sedang aktif di layar."""
    try:
        challenge_frames = page.locator(
            'iframe[src*="hcaptcha.com"][src*="frame=challenge"], '
            'iframe[title*="hCaptcha challenge" i], '
            'iframe[title*="challenge" i], '
            'iframe[src*="challenges.cloudflare.com"], '
            'iframe[src*="google.com/recaptcha"], '
            'iframe[src*="recaptcha"]'
        )
        for i in range(challenge_frames.count()):
            f = challenge_frames.nth(i)
            if f.is_visible():
                return True

        content = (page.content() or "").lower()
        if (
            "please drag one of the shapes" in content
            or "please click each image" in content
            or ("hcaptcha" in content and "challenge" in content)
            or "verify you are human" in content
            or "verifying you are human" in content
        ):
            return True
    except Exception:
        pass
    return False


def is_verification_screen(page) -> bool:
    """
    Memeriksa apakah halaman sudah RESMI berubah ke layar 'Check your email'.
    """
    try:
        body = (page.inner_text("body") or "").lower()
        has_check_email = "check your email" in body
        has_sent_link = (
            "sent a verification link" in body
            or "verification link to" in body
            or page.locator('button:has-text("Resend")').count() > 0
        )
        pass_inputs = page.locator('input[type="password"]')
        form_gone = pass_inputs.count() == 0 or not pass_inputs.first.is_visible()

        return has_check_email and has_sent_link and form_gone
    except Exception:
        return False


def _extract_eod_email(page) -> str:
    """Mengekstrak email yang sedang aktif di halaman eod.php EmailOnDeck."""
    try:
        inp = page.locator("#yne_input").first
        if inp.count() > 0:
            val = (inp.input_value() or "").strip()
            if val and "@" in val:
                return val
    except Exception:
        pass

    try:
        mob = page.locator("#yne_mobile").first
        if mob.count() > 0:
            val = (mob.inner_text() or "").strip()
            if val and "@" in val:
                return val
    except Exception:
        pass

    try:
        js_email = page.evaluate("() => (typeof email !== 'undefined' ? email : '')")
        if js_email and "@" in js_email:
            return js_email.strip()
    except Exception:
        pass

    try:
        content = page.content() or ""
        matches = re.findall(r'[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+', content)
        for m in matches:
            if not any(excluded in m.lower() for excluded in ["emailondeck", "google", "sentry", "cloudflare", "example"]):
                return m.strip()
    except Exception:
        pass

    return ""


def get_email_from_emailondeck(page, dbg: Optional[CamoufoxDebugger] = None, max_captcha_wait: int = 300) -> str:
    """
    Buka EmailOnDeck, deteksi hCaptcha, tunggu penyelesaian manual oleh pengguna jika ada,
    klik tombol 'Get Email', dan ekstrak alamat email sementara yang dihasilkan.
    """
    print("\n" + "=" * 65)
    print("  [EMAILONDECK] MENGAMBIL EMAIL SEMENTARA DARI EMAILONDECK")
    print("=" * 65)
    print("[*] Menavigasi ke https://www.emailondeck.com ...")

    page.goto(EMAILONDECK_URL, wait_until="load")
    page.wait_for_timeout(2000)
    if dbg:
        dbg.snapshot(page, "eod_01_loaded", "Halaman EmailOnDeck selesai dimuat")

    # Cek apakah sudah langsung berada di eod.php (misal session aktif)
    if "/eod.php" in page.url.lower():
        email = _extract_eod_email(page)
        if email:
            print(f"[✓] Ditemukan sesi EmailOnDeck aktif dengan email: {email}")
            return email

    # Trigger hover/focus pada form agar script hCaptcha termuat
    try:
        page.evaluate('''() => {
            const form = document.getElementById("mainform");
            if (form) {
                form.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
                form.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
            }
        }''')
    except Exception:
        pass

    page.wait_for_timeout(1500)

    # Deteksi dan tunggu penyelesaian hCaptcha
    print("[*] Memeriksa status captcha di EmailOnDeck...")

    def _is_hcaptcha_solved() -> bool:
        try:
            token = page.evaluate('''() => {
                const el = document.querySelector('textarea[name="h-captcha-response"], input[name="h-captcha-response"]');
                if (el && el.value && el.value.length > 20) return el.value;
                if (window.hcaptcha && typeof window.hcaptcha.getResponse === 'function') {
                    const r = window.hcaptcha.getResponse();
                    if (r && r.length > 20) return r;
                }
                return "";
            }''')
            return bool(token)
        except Exception:
            return False

    captcha_alerted = False
    start_time = time.time()

    while time.time() - start_time < max_captcha_wait:
        # Cek apakah sudah beralih ke eod.php atau email input sudah muncul
        if "/eod.php" in page.url.lower() or page.locator("#yne_input, #yne_mobile").count() > 0:
            print("[✓] EmailOnDeck telah beralih ke halaman inbox!")
            break

        if _is_hcaptcha_solved():
            print("[✓] Captcha EmailOnDeck berhasil diselesaikan!")
            if dbg:
                dbg.snapshot(page, "eod_02_captcha_solved", "Captcha EmailOnDeck terpecahkan")
            break

        if not captcha_alerted:
            print("\n" + "!" * 65)
            print("  [!] CAPTCHA TERDETEKSI DI EMAILONDECK (hCaptcha)!")
            print("  [!] Silakan klik centang 'I am human' / selesaikan tantangan di browser.")
            print("  [!] Script sedang MENUNGGU Anda menyelesaikan captcha...")
            print("!" * 65 + "\n")
            if dbg:
                dbg.snapshot(page, "eod_02_waiting_captcha", "Menunggu user menyelesaikan captcha EmailOnDeck")
            captcha_alerted = True

        page.wait_for_timeout(1000)
    else:
        raise TimeoutError("Waktu tunggu penyelesaian captcha di EmailOnDeck telah habis (timeout 5 menit).")

    # Jika belum di eod.php, klik tombol 'Get Email'
    if "/eod.php" not in page.url.lower() and page.locator("#yne_input").count() == 0:
        print("[*] Mengklik tombol 'Get Email'...")
        page.wait_for_timeout(1000)
        get_btn = page.locator("#get_email_btn, button:has-text('Get Email')").first
        if get_btn.count() > 0 and get_btn.is_visible():
            get_btn.scroll_into_view_if_needed()
            get_btn.click(force=True)

    # Tunggu halaman email tergenerate (eod.php)
    print("[*] Menunggu alamat email digenerate...")
    page.wait_for_selector("#yne_input, #yne_mobile", timeout=25000)
    page.wait_for_timeout(1500)

    email = _extract_eod_email(page)
    if not email:
        raise RuntimeError("Gagal mengekstrak alamat email dari EmailOnDeck.")

    if dbg:
        dbg.snapshot(page, "eod_03_email_ready", f"Email berhasil didapatkan: {email}")

    print("\n" + "=" * 65)
    print(f"  [✓] EMAIL BERHASIL DIDAPATKAN DARI EMAILONDECK: {email}")
    print("=" * 65 + "\n")
    return email


def fetch_verification_link_from_emailondeck(page, dbg: Optional[CamoufoxDebugger] = None, max_wait_seconds: int = 180) -> str:
    """
    Menunggu email masuk dari ElevenLabs di halaman EmailOnDeck (eod.php),
    membuka pesan tersebut, dan mengekstrak tautan verifikasi akun.
    """
    print("\n" + "=" * 65)
    print("  [EMAILONDECK] MENCARI PESAN MASUK & LINK VERIFIKASI ELEVENLABS")
    print("=" * 65)
    print(f"[*] Waktu tunggu maksimal: {max_wait_seconds} detik")

    page.bring_to_front()
    used_codes = get_used_codes()

    start_time = time.time()
    last_refresh_trigger = 0

    while time.time() - start_time < max_wait_seconds:
        page.wait_for_timeout(2500)

        # Trigger refresh inbox setiap 5 detik agar pesan cepat terupdate
        now = time.time()
        if now - last_refresh_trigger > 5:
            try:
                page.evaluate('''() => {
                    if (typeof $ !== "undefined") {
                        if ($("#refresh_inbox").length) {
                            $("#refresh_inbox").click();
                        } else {
                            $.post("../ajax/messages.php").done(function(e){
                                e = e.split("|<|>|");
                                if (parseInt(e[0]) > 0) {
                                    document.title = "(" + e[0] + ") Inbox - EmailOnDeck";
                                }
                                $("#email_rows").html(e[1]);
                            });
                        }
                    }
                }''')
            except Exception:
                pass
            last_refresh_trigger = now

        # Cek apakah ada tautan pesan (.msglink atau row dalam #email_rows)
        msg_links = page.locator(".msglink, #email_rows tr a, #email_rows a")
        msg_count = msg_links.count()

        if msg_count > 0:
            print(f"[*] Ditemukan {msg_count} baris pesan di EmailOnDeck. Membuka pesan...")
            # Klik pesan teratas (pesan terbaru)
            try:
                first_msg = msg_links.first
                first_msg.scroll_into_view_if_needed()
                first_msg.click(force=True)
            except Exception as e:
                print(f"[!] Warning saat klik pesan: {e}")
                try:
                    msg_id = first_msg.get_attribute("name") or ""
                    if msg_id:
                        page.goto(f"https://www.emailondeck.com/email.php?msg_id={msg_id}")
                except Exception:
                    pass

            page.wait_for_timeout(3000)
            if dbg:
                dbg.snapshot(page, "eod_message_opened", "Membuka pesan email di EmailOnDeck")

            # Ekstrak semua URL dari halaman email.php (termasuk iframe jika ada)
            verify_link = None
            found_code = None

            # 1. Cari dari tag <a> di page utama
            anchors = page.locator("a[href]")
            for i in range(anchors.count()):
                href = anchors.nth(i).get_attribute("href") or ""
                text = (anchors.nth(i).inner_text() or "").lower()
                if (
                    ("elevenlabs.io" in href or "auth.elevenlabs.io" in href)
                    and ("verify" in href or "action" in href or "oobCode" in href or "ticket" in href or "verify" in text)
                ):
                    q = parse_qs(urlparse(href).query)
                    code = q.get("oobCode", [""])[0] or q.get("ticket", [""])[0] or q.get("token", [""])[0]
                    if not (code and code in used_codes):
                        verify_link = href
                        found_code = code
                        break

            # 2. Cari dari frame-frame jika konten email berada di dalam iframe
            if not verify_link:
                for frame in page.frames:
                    try:
                        f_anchors = frame.locator("a[href]")
                        for i in range(f_anchors.count()):
                            href = f_anchors.nth(i).get_attribute("href") or ""
                            text = (f_anchors.nth(i).inner_text() or "").lower()
                            if (
                                ("elevenlabs.io" in href or "auth.elevenlabs.io" in href)
                                and ("verify" in href or "action" in href or "oobCode" in href or "ticket" in href or "verify" in text)
                            ):
                                q = parse_qs(urlparse(href).query)
                                code = q.get("oobCode", [""])[0] or q.get("ticket", [""])[0] or q.get("token", [""])[0]
                                if not (code and code in used_codes):
                                    verify_link = href
                                    found_code = code
                                    break
                    except Exception:
                        pass
                    if verify_link:
                        break

            # 3. Regex fallback dari seluruh konten HTML
            if not verify_link:
                content = page.content() or ""
                matches = re.findall(r'https?://[^\s"\'<>]+(?:elevenlabs\.io|auth\.elevenlabs\.io)[^\s"\'<>]+(?:verify|action|oobCode|ticket)[^\s"\'<>]*', content)
                for m in matches:
                    q = parse_qs(urlparse(m).query)
                    code = q.get("oobCode", [""])[0] or q.get("ticket", [""])[0] or q.get("token", [""])[0]
                    if not (code and code in used_codes):
                        verify_link = m
                        found_code = code
                        break

            if verify_link:
                if found_code:
                    mark_code_used(found_code)
                print("\n" + "=" * 65)
                print(f"  [✓] LINK VERIFIKASI ELEVENLABS BERHASIL DITEMUKAN!")
                print(f"  URL: {verify_link}")
                print("=" * 65 + "\n")
                if dbg:
                    dbg.snapshot(page, "eod_verify_link_found", f"Link verifikasi: {verify_link}")
                return verify_link
            else:
                print("[!] Pesan terbuka tetapi link verifikasi belum ditemukan. Kembali ke inbox...")
                page.goto("https://www.emailondeck.com/eod.php")
                page.wait_for_timeout(2000)

        elapsed = int(time.time() - start_time)
        print(f"[*] Menunggu email verifikasi masuk ({elapsed}/{max_wait_seconds}s)...")

    raise TimeoutError("Waktu tunggu email verifikasi di EmailOnDeck telah habis.")


def _fetch_gmail_worker(profile_email: str, target_email: str, dbg: CamoufoxDebugger, max_wait_seconds: int = 75) -> str:
    """Worker fungsi yang dijalankan di background thread terpisah."""
    used_codes = get_used_codes()
    print(f"[*] Jumlah kode verifikasi yang sudah terpakai sebelumnya: {len(used_codes)}")

    with open_camoufox_profile(
        email=profile_email,
        headless=True,
        humanize=True,
        geoip=False,
        proxy=None,
        
        enable_cache=False,
        i_know_what_im_doing=True
    ) as gmail_context:
        page = gmail_context.pages[0] if gmail_context.pages else gmail_context.new_page()
        page.set_default_timeout(30000)

        print("[*] Menavigasi ke Gmail Inbox...")
        page.goto(GMAIL_URL, wait_until="domcontentloaded")

        # Tunggu sampai loading Gmail selesai dan row email muncul
        try:
            page.wait_for_selector('tr.zA, [role="row"].zA', timeout=30000)
            print("[*] Gmail Inbox siap.")
        except Exception:
            print("[!] Menunggu elemen tabel Gmail tambahan...")
            page.wait_for_timeout(4000)

        # Cari input search Gmail
        search_box = page.locator(
            'input[name="q"], input[aria-label*="Search" i], input[aria-label*="Telusuri" i]'
        ).first
        search_box.wait_for(state="visible", timeout=10000)

        email_prefix = target_email.split("@")[0].lower()
        # Cari secara spesifik email yang ditujukan ke target_email untuk menghindari email lama
        search_query = f'"{target_email}"'
        print(f"[*] Mengetik pencarian presisi di Gmail: {search_query}")
        search_box.click()
        search_box.fill(search_query)
        page.keyboard.press("Enter")

        dbg.snapshot(page, "gmail_searched", f"Mencari query: {search_query}")

        start_time = time.time()
        while time.time() - start_time < max_wait_seconds:
            page.wait_for_timeout(3500)

            # Cek baris email hasil pencarian
            rows = page.locator('tr.zA, [role="row"].zA')
            count = rows.count()

            # Jika dengan query "{target_email}" belum ada hasil, coba query fallback setelah 15 detik
            if count == 0 and (time.time() - start_time > 15):
                fallback_query = f"ElevenLabs {email_prefix}"
                print(f"[*] Mencoba pencarian alternatif: '{fallback_query}'...")
                search_box.click()
                search_box.fill(fallback_query)
                page.keyboard.press("Enter")
                page.wait_for_timeout(3000)
                rows = page.locator('tr.zA, [role="row"].zA')
                count = rows.count()

            print(f"[*] Baris email ditemukan: {count}")

            if count > 0:
                # Periksa baris email yang cocok
                for row_idx in range(min(count, 3)):
                    row = rows.nth(row_idx)
                    row_text = (row.inner_text() or "").lower()

                    # Klik baris email
                    inner_click_target = row.locator('.bog, .y6, [role="link"]').first
                    if inner_click_target.is_visible():
                        inner_click_target.click()
                    else:
                        row.click(force=True)

                    page.wait_for_timeout(3000)
                    print("[*] Membuka pesan email...")

                    # Buka collapsible/ekspander jika pesan bertumpuk di thread
                    try:
                        expanders = page.locator(
                            'div[role="listitem"] [aria-expanded="false"], span[aria-label*="Expand" i], div[aria-label*="Show trimmed" i], div[aria-label*="konten yang dipangkas" i]'
                        )
                        for exp_i in range(expanders.count()):
                            exp = expanders.nth(exp_i)
                            if exp.is_visible():
                                exp.click(force=True)
                                page.wait_for_timeout(500)
                    except Exception:
                        pass

                    # Ambil semua link dari badan email
                    anchors = page.locator('a[href]')
                    verify_candidates = []

                    for idx in range(anchors.count()):
                        a = anchors.nth(idx)
                        href = a.get_attribute("href") or ""
                        text = (a.inner_text() or "").strip().lower()

                        if (
                            ("elevenlabs.io" in href or "auth.elevenlabs.io" in href)
                            and ("verify" in href or "action" in href or "oobCode" in href or "ticket" in href or "verify" in text)
                        ):
                            # Ekstrak oobCode
                            code = ""
                            try:
                                q = parse_qs(urlparse(href).query)
                                code = q.get("oobCode", [""])[0] or q.get("ticket", [""])[0] or q.get("token", [""])[0]
                            except Exception:
                                pass

                            is_used = (code in used_codes) if code else False
                            verify_candidates.append({"href": href, "code": code, "is_used": is_used})

                    # Cari kandidat fresh dari bawah ke atas (pesan terbaru dalam thread)
                    fresh_link = None
                    fresh_code = None
                    for cand in reversed(verify_candidates):
                        if cand["code"] and not cand["is_used"]:
                            fresh_link = cand["href"]
                            fresh_code = cand["code"]
                            break

                    if fresh_link:
                        mark_code_used(fresh_code)
                        dbg.snapshot(page, "gmail_verify_link_extracted", f"Fresh Link: {fresh_link}")
                        print(f"\n[✓] Link Verifikasi FRESH Berhasil Ditemukan (Code: {fresh_code[:12]}...):\n{fresh_link}\n")
                        return fresh_link
                    else:
                        print(f"[!] Email pada baris #{row_idx + 1} hanya memuat link lama/terpakai. Kembali ke daftar...")
                        # Klik tombol Back di Gmail
                        back_btn = page.locator('div[aria-label*="Back" i], div[aria-label*="Kembali" i], div[data-tooltip*="Back" i]').first
                        if back_btn.is_visible():
                            back_btn.click()
                            page.wait_for_timeout(2000)

            print("[*] Email verifikasi baru belum masuk, menyegarkan Gmail...")
            refresh_btn = page.locator(
                'div[aria-label*="Refresh" i], div[data-tooltip*="Refresh" i], div[aria-label*="Segarkan" i], div[data-tooltip*="Segarkan" i]'
            ).first
            if refresh_btn.is_visible():
                refresh_btn.click()
            else:
                page.reload()

        raise TimeoutError("Waktu tunggu email verifikasi di Gmail telah habis.")


def fetch_verification_link_from_gmail(profile_email: str, target_email: str, dbg: CamoufoxDebugger, max_wait_seconds: int = 75) -> str:
    """
    Membuka browser Camoufox terpisah secara headless di thread independen dengan profil Google (profile_email),
    menavigasi ke Gmail Inbox, mencari email verifikasi ElevenLabs,
    dan mengekstrak URL verifikasinya.
    """
    print("\n" + "=" * 65)
    print("  [GMAIL] MENCARI LINK VERIFIKASI ELEVENLABS DI GMAIL (HEADLESS)")
    print("=" * 65)
    print(f"[*] Profil Gmail     : {profile_email} (Persistent Google Session - Headless)")
    print(f"[*] Target Email     : {target_email}")
    print(f"[*] Timeout Maksimal : {max_wait_seconds} detik")

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(
            _fetch_gmail_worker,
            profile_email=profile_email,
            target_email=target_email,
            dbg=dbg,
            max_wait_seconds=max_wait_seconds
        )
        return future.result()


def fetch_verification_link_from_vps(target_email: str, dbg: Optional[CamoufoxDebugger] = None, max_wait_seconds: int = 75) -> str:
    """
    Mengambil tautan verifikasi ElevenLabs langsung dari server VPS penangkap email (port 8888).
    Tanpa perlu membuka Gmail & tanpa captcha!
    """
    print("\n" + "=" * 65)
    print("  [VPS SERVER] MENGAMBIL LINK VERIFIKASI DARI VPS SERVER (PORT 8888)")
    print("=" * 65)
    print(f"[*] Target Email     : {target_email}")
    print(f"[*] Endpoint API     : http://43.129.43.29:8888/api/get-link")
    print(f"[*] Timeout Maksimal : {max_wait_seconds} detik")

    import urllib.request
    import json
    
    used_codes = get_used_codes()
    start_time = time.time()
    api_url = f"http://43.129.43.29:8888/api/get-link?email={target_email}"

    while time.time() - start_time < max_wait_seconds:
        elapsed = int(time.time() - start_time)
        try:
            req = urllib.request.Request(api_url, headers={"User-Agent": "Camoufox/1.0"})
            with urllib.request.urlopen(req, timeout=5) as response:
                if response.status == 200:
                    data = json.loads(response.read().decode("utf-8"))
                    if data.get("status") == "found" and data.get("verify_url"):
                        v_url = data["verify_url"]
                        q = parse_qs(urlparse(v_url).query)
                        code = q.get("oobCode", [""])[0] or q.get("ticket", [""])[0] or q.get("token", [""])[0]
                        if code and code in used_codes:
                            print(f"[*] Link lama terdeteksi ({code[:10]}...), menunggu link baru...")
                        else:
                            if code:
                                mark_code_used(code)
                            print(f"\n[✓] Link Verifikasi FRESH Berhasil Didapatkan dari VPS:\n{v_url}\n")
                            if dbg:
                                dbg.log(f"Link verifikasi didapat dari VPS: {v_url}")
                            return v_url
        except Exception:
            pass

        print(f"[*] Menunggu email verifikasi masuk di VPS ({elapsed}/{max_wait_seconds}s)...")
        time.sleep(2)

    raise TimeoutError("Waktu tunggu email verifikasi di server VPS telah habis.")


def is_dashboard_reached(page) -> bool:
    """
    Memeriksa secara ketat apakah browser sudah mencapai Dashboard utama ElevenLabs.
    PENTING: Jangan return True jika masih di /sign-in, /sign-up, /action, /onboarding,
    atau jika masih ada modal 'Email Verification' / input password.
    """
    try:
        parsed = urlparse(page.url)
        path = parsed.path.lower()

        # Jangan pernah anggap dashboard jika masih berada di halaman autentikasi/onboarding
        if any(auth_path in path for auth_path in ['/sign-in', '/sign-up', '/login', '/action', '/onboarding']):
            return False

        body = (page.inner_text("body") or "").lower()

        # Jika dialog modal email verification atau form sign in masih ada
        if "email verification" in body or "welcome back" in body or "almost there" in body:
            return False

        # Jika masih ada input password yang terlihat
        pass_inputs = page.locator('input[type="password"]')
        for i in range(pass_inputs.count()):
            if pass_inputs.nth(i).is_visible():
                return False

        # Rute dashboard ElevenLabs yang sah
        dashboard_paths = [
            "/app/speech-synthesis",
            "/app/text-to-speech",
            "/app/voices",
            "/app/voice-lab",
            "/app/overview",
            "/app/home",
            "/app/projects"
        ]

        matches_path = any(path.startswith(dp) for dp in dashboard_paths) or path == "/app" or path == "/app/"
        has_user_menu = page.locator('button[data-testid="user-menu-button"], button[aria-label*="profile" i]').count() > 0
        has_tts_editor = page.locator('textarea, [contenteditable="true"], [data-testid="tts-editor"]').count() > 0
        has_heading = "what would you like to create" in body

        return matches_path and (has_user_menu or has_tts_editor or has_heading)
    except Exception:
        return False


def handle_onboarding_and_signin(page, email: str, password: str, dbg: CamoufoxDebugger, max_duration_seconds: int = 90) -> bool:
    """
    Menangani proses lengkap setelah URL verifikasi dibuka:
    1. Menutup dialog modal pop-up "Email Verification" (Almost there!...) dengan klik "Continue"
    2. Mengisi password di form Sign In ("Welcome back") & mengklik Sign In spesifik
    3. Platform Selection ("ElevenCreative" / Text-to-Speech)
    4. Konfirmasi Umur 18+ ("Help us personalize your experience")
    5. Melewati (Skip / Explore on my own) survei opsional hingga mencapai dashboard Text-to-Speech.
    """
    print("\n" + "=" * 65)
    print("  [ONBOARDING] MENYELESAIKAN ONBOARDING & SIGN IN ELEVENLABS")
    print("=" * 65)

    start_time = time.time()
    while time.time() - start_time < max_duration_seconds:
        page.wait_for_timeout(1500)

        # 0. Cek apakah sudah resmi mendarat di dashboard
        if is_dashboard_reached(page):
            dbg.snapshot(page, "onboarding_dashboard_reached", "Dashboard utama berhasil dicapai!")
            print("[✓] DASHBOARD UTAMA ELEVENLABS BERHASIL DICAPAI!")
            return True

        body_text = (page.inner_text("body") or "").lower()
        current_url = page.url.lower()
        parsed_path = urlparse(page.url).path.lower()

        # 1. Cek dialog modal pop-up "Email Verification" ("Almost there! Please sign in once more...")
        # Persis seperti yang tampil pada screenshot pengguna
        if "almost there" in body_text or "email verification" in body_text:
            modal_continue = page.locator(
                'div[role="dialog"] button:has-text("Continue"), div[aria-modal="true"] button:has-text("Continue"), button:has-text("Continue")'
            ).first
            if modal_continue.is_visible():
                print("[*] Modal dialog 'Email Verification' terdeteksi! Mengklik tombol Continue...")
                dbg.snapshot(page, "modal_email_verification", "Klik Continue pada modal Email Verification")
                modal_continue.click()
                page.wait_for_timeout(1500)
                continue

            # Tutup jika ada tombol X / Close
            modal_close = page.locator('div[role="dialog"] button[aria-label*="close" i], button[aria-label*="close" i]').first
            if modal_close.is_visible():
                modal_close.click()
                page.wait_for_timeout(1000)
                continue

        # 2. Cek apakah ada form Sign In / Password ("Welcome back")
        pass_inputs = page.locator('input[type="password"]')
        if pass_inputs.count() > 0 and pass_inputs.first.is_visible():
            print("[*] Form Sign in ('Welcome back') terdeteksi...")
            dbg.snapshot(page, "onboarding_signin_form", "Layar sign in terdeteksi")

            email_inputs = page.locator('input[type="email"], input[name="email"]')
            if email_inputs.count() > 0 and email_inputs.first.is_visible():
                current_email_val = email_inputs.first.input_value()
                if not current_email_val or (email and current_email_val != email):
                    email_inputs.first.fill(email)
                    page.wait_for_timeout(300)

            pass_inputs.first.fill(password)
            page.wait_for_timeout(300)

            # Cari tombol Sign In spesifik (Bukan login Google atau Apple)
            sign_in_btn = page.locator(
                'button[type="submit"]'
            ).filter(has_text="Sign in").filter(has_not_text="Google").filter(has_not_text="Apple").first

            if not sign_in_btn.is_visible():
                sign_in_btn = page.locator(
                    'button:has-text("Sign in"), button:has-text("Log in")'
                ).filter(has_not_text="Google").filter(has_not_text="Apple").first

            if sign_in_btn.is_visible() and not sign_in_btn.is_disabled():
                print("[*] Mengklik tombol Sign In...")
                try:
                    sign_in_btn.click(timeout=8000)
                except Exception:
                    pass
                page.wait_for_timeout(2000)
                continue

        # 3. Cek Layar Onboarding: "Choose your platform"
        if "choose your platform" in body_text or "switch between platforms" in body_text:
            print("[*] Layar 'Choose your platform' terdeteksi! Memilih ElevenCreative...")
            dbg.snapshot(page, "onboarding_platform_choice", "Layar pemilihan platform")
            creative_card = page.locator('text="ElevenCreative"').first
            if creative_card.is_visible():
                creative_card.click()
                page.wait_for_timeout(500)

            continue_btn = page.locator('button:has-text("Continue"), [role="button"]:has-text("Continue")').first
            if continue_btn.is_visible():
                continue_btn.click()
                page.wait_for_timeout(2000)
                continue

        # 4. Cek Layar Onboarding: "Help us personalize your experience" (Konfirmasi Umur 18+)
        if (
            "personalize your experience" in body_text
            or "18 years old" in body_text
            or "reached the age of 18" in body_text
            or page.locator('input[name="adult"]').count() > 0
        ):
            print("[*] Layar konfirmasi umur 18 tahun terdeteksi! Mencentang checkbox...")
            dbg.snapshot(page, "onboarding_age_check", "Layar konfirmasi umur 18+")

            # Centang checkbox
            adult_input = page.locator('input[name="adult"]').first
            if adult_input.count() > 0:
                try:
                    adult_input.check(force=True)
                except Exception:
                    pass

            adult_btn = page.locator('button[role="checkbox"], [role="checkbox"]').first
            if adult_btn.is_visible():
                aria_checked = adult_btn.get_attribute("aria-checked")
                if aria_checked != "true":
                    adult_btn.click()
                    page.wait_for_timeout(400)

            next_btn = page.locator('button[type="submit"], button:has-text("Next")').filter(has_not_text="Google").first
            if next_btn.is_visible():
                next_btn.click()
                page.wait_for_timeout(2000)
                continue

        # 5. Cek jika onboarding mengharuskan memilih opsi kuesioner pertama
        survey_options = page.locator(
            'main [data-state="unchecked"], main [aria-pressed="false"], main [role="radio"][aria-checked="false"], main input[type="radio"]:not(:checked)'
        ).first
        if survey_options.is_visible():
            print("[*] Memilih opsi kuesioner pertama untuk melanjutkan...")
            survey_options.click()
            page.wait_for_timeout(500)

        # 6. Cek Tombol "Skip" / "Explore on my own" / "Maybe later"
        skip_selectors = [
            'button:has-text("Skip")',
            'button:has-text("Skip for now")',
            'button:has-text("Explore on my own")',
            'button:has-text("Maybe later")',
            'button:has-text("Not now")',
            'button:has-text("Got it")',
            'button:has-text("Continue with free")',
            'button:has-text("Start with free")'
        ]
        skip_clicked = False
        for sel in skip_selectors:
            btn = page.locator(sel).first
            if btn.is_visible():
                btn_txt = btn.inner_text().strip()
                print(f"[*] Mengklik tombol lewati: {btn_txt}...")
                dbg.snapshot(page, "onboarding_skip_clicked", f"Klik skip: {btn_txt}")
                btn.click()
                page.wait_for_timeout(1500)
                skip_clicked = True
                break

        if skip_clicked:
            continue

        # 7. Cek Tombol "Continue" / "Next" umum jika aktif
        generic_continue = page.locator('button:has-text("Continue"), button:has-text("Next")').filter(has_not_text="Google").first
        if generic_continue.is_visible() and not generic_continue.is_disabled():
            btn_txt = generic_continue.inner_text().strip().lower()
            if btn_txt in ["continue", "next", "done", "finish", "get started"]:
                print(f"[*] Mengklik tombol lanjut: '{btn_txt}'...")
                generic_continue.click()
                page.wait_for_timeout(2000)
                continue

    return is_dashboard_reached(page)


def login_elevenlabs(page, email: str, password: str, dbg: CamoufoxDebugger) -> bool:
    """Melakukan login langsung ke ElevenLabs via halaman sign-in."""
    print(f"\n[*] Mengunjungi halaman Sign In ElevenLabs (https://elevenlabs.io/sign-in)...")
    safe_goto(page, "https://elevenlabs.io/sign-in", wait_until="domcontentloaded")
    page.wait_for_timeout(2000)

    email_input = page.locator('input[type="email"], input[name="email"]').first
    email_input.wait_for(state="visible", timeout=15000)

    pass_input = page.locator('input[type="password"], input[name="password"]').first
    pass_input.wait_for(state="visible", timeout=10000)

    submit_btn = page.locator('button[type="submit"]').filter(has_not_text="Google").filter(has_not_text="Apple").first
    if not submit_btn.is_visible():
        submit_btn = page.locator('button:has-text("Sign in"), button:has-text("Log in")').filter(has_not_text="Google").filter(has_not_text="Apple").first

    # Tunggu hidrasi & isi berulang hingga form benar-benar terisi dan tombol aktif (bebas React reset)
    max_fill = 6
    for attempt in range(1, max_fill + 1):
        print(f"[*] Mengisi form login (percobaan {attempt}/{max_fill})...")
        email_input.click()
        email_input.fill(email)
        page.wait_for_timeout(300)

        pass_input.click()
        pass_input.fill(password)
        page.wait_for_timeout(400)

        curr_e = email_input.input_value()
        curr_p = pass_input.input_value()
        is_disabled = submit_btn.is_disabled()

        print(f"[*] Verifikasi login: email='{curr_e}', pass_len={len(curr_p)}, tombol_disabled={is_disabled}")
        if curr_e == email and curr_p == password and not is_disabled:
            print("[✓] Form login terisi sempurna dan tombol Sign In telah aktif!")
            break
        page.wait_for_timeout(1000)

    print("[*] Mengklik tombol Sign In...")
    try:
        submit_btn.click(force=True, timeout=5000)
    except Exception:
        pass

    try:
        pass_input.focus()
        pass_input.press("Enter")
    except Exception:
        pass

    try:
        page.evaluate('() => { const f = document.querySelector("form"); if (f) f.requestSubmit(); }')
    except Exception:
        pass

    # Tunggu proses login dan navigasi
    print("[*] Menunggu proses autentikasi akun...")
    wait_start = time.time()
    while time.time() - wait_start < 25:
        page.wait_for_timeout(1000)
        curr_url = page.url.lower()

        # Cek tantangan captcha jika muncul
        if is_captcha_active(page):
            print("\n[!] CAPTCHA TERDETEKSI PADA LOGIN! Silakan selesaikan di jendela browser...")
            while is_captcha_active(page):
                page.wait_for_timeout(1500)

        # Cek jika dialihkan ke onboarding
        if "/onboarding" in curr_url or "/action" in curr_url:
            handle_onboarding_and_signin(page, email=email, password=password, dbg=dbg, max_duration_seconds=15)
            curr_url = page.url.lower()

        # Cek apakah sudah berhasil masuk ke rute /app atau dashboard
        if "/sign-in" not in curr_url and "/login" not in curr_url and ("/app" in curr_url or is_dashboard_reached(page)):
            print(f"[✓] Berhasil masuk ke akun ElevenLabs! Halaman saat ini: {page.url}")
            page.wait_for_timeout(2000)
            return True

    print("[X] Login belum berhasil masuk ke dashboard.")
    return False


def run_full_flow(
    email: Optional[str] = None,
    password: str = DEFAULT_PASSWORD,
    profile_email: str = DEFAULT_PROFILE,
    headless: bool = False,
    login_only: bool = False,
    narration_text: Optional[str] = None,
    do_generate: bool = True,
    manual_verify: bool = False,
    verify_url: Optional[str] = None,
    use_emailondeck: bool = True,
    proxy: Optional[str] = None
):
    proxy_str = proxy or os.environ.get("CAMOUFOX_PROXY") or os.environ.get("PROXY")
    proxy_file = Path(__file__).resolve().parent / "proxy.txt"
    if not proxy_str and proxy_file.exists():
        try:
            proxy_str = proxy_file.read_text(encoding="utf-8").strip()
        except Exception:
            pass

    proxy_dict = parse_proxy(proxy_str)

    dbg = CamoufoxDebugger(session_name="elevenlabs_signup")
    dbg.log("Memulai sesi pendaftaran ElevenLabs", data={
        "profile": profile_email,
        "email": email or "(auto-emailondeck)",
        "headless": headless,
        "use_emailondeck": use_emailondeck,
        "proxy": proxy_dict.get("server") if proxy_dict else None
    })

    print("=" * 65)
    print("  ELEVENLABS FULL AUTO SIGNUP & ONBOARDING (CAMOUFOX)")
    print("=" * 65)
    print(f"[*] Provider Email    : {'EmailOnDeck (Auto Temp Mail)' if (use_emailondeck and not email) else ('Gmail' if not manual_verify else 'Manual')}")
    print(f"[*] Target Email      : {email or 'Auto-generate dari EmailOnDeck'}")
    print(f"[*] Password          : {password}")
    print(f"[*] Proxy             : {proxy_dict.get('server') if proxy_dict else 'None (Direct Connection)'}")
    print(f"[*] Mode Browser      : {'Headless (Background)' if headless else 'GUI (Browser Terbuka)'}")
    print(f"[*] Debug Folder      : camoufox/debug/ (Logs, Screenshots, DOM)")
    print("=" * 65)

    print(f"\n[*] Membuka browser Camoufox fresh untuk ElevenLabs & Email...")

    try:
        with Camoufox(
            headless=headless,
            humanize=True,
            geoip=True if proxy_dict else False,
            proxy=proxy_dict,
            enable_cache=False,
            i_know_what_im_doing=True
        ) as browser:
            context = browser.new_context()
            context.set_default_timeout(35000)

            # Jika mode login langsung (untuk developing)
            if login_only:
                page = context.new_page()
                page.set_default_timeout(30000)
                print("\n[DEVELOPING] Melakukan login langsung dengan akun aktif terdaftar...")
                login_ok = login_elevenlabs(page, email=email, password=password, dbg=dbg)
                if not login_ok:
                    print("[X] Gagal login ke akun. Proses konfigurasi TTS dihentikan.")
                    return False

                # Konfigurasi Text-to-Speech (fungsi ini otomatis menavigasi ke TTS_URL secara aman)
                print("\n[*] Mengonfigurasi model & voice di Text-to-Speech...")
                tts_ok = configure_tts_dashboard(page, model_name=DEFAULT_MODEL, voice_name=DEFAULT_VOICE, dbg=dbg)

                # Pastikan halaman terakhir tetap di https://elevenlabs.io/app/speech-synthesis/text-to-speech
                if "/speech-synthesis/text-to-speech" not in page.url.lower():
                    safe_goto(page, TTS_URL, wait_until="domcontentloaded")
                    page.wait_for_timeout(2000)

                # Jalankan input teks & generate audio jika diminta
                if do_generate:
                    sample_text = narration_text or (
                        "Halo semuanya! Selamat datang kembali. Pada video kali ini, "
                        "kita akan membahas perkembangan teknologi kecerdasan buatan terbaru yang sangat menarik untuk disimak. "
                        "Jangan lupa like dan subscribe!"
                    )
                    input_and_generate_speech(page, text=sample_text, dbg=dbg)

                print("\n" + "=" * 65)
                print("  [✓✓✓] PENGATURAN & GENERASI TTS SELESAI - HALAMAN UTAMA AKTIF!")
                print("=" * 65)
                print(f"  Akun Email   : {email}")
                print(f"  Halaman Akhir: {page.url}")
                print(f"  Model        : {DEFAULT_MODEL}")
                print(f"  Voice        : {DEFAULT_VOICE}")
                print(f"  Stability    : Default (Balanced - Di Tengah)")
                print("=" * 65 + "\n")

                if not headless:
                    print("\nTekan [ENTER] di terminal jika ingin menutup browser...")
                    try:
                        input()
                    except (KeyboardInterrupt, EOFError):
                        pass

                return True

            email_page = None

            if not verify_url:
                # ---------------------------------------------------------
                # LANGKAH 0: AMBIL EMAIL DARI EMAILONDECK JIKA AKTIF
                # ---------------------------------------------------------
                if use_emailondeck and not email:
                    print("\n[0/4] Membuka tab EmailOnDeck untuk mengambil alamat email sementara...")
                    email_page = context.new_page()
                    email_page.set_default_timeout(35000)
                    email = get_email_from_emailondeck(email_page, dbg=dbg)
                    print(f"[✓] Email sementara siap didaftarkan: {email}")
                elif not email:
                    email = generate_random_email()
                    print(f"[*] Generated Email (@{DOMAIN}): {email}")

                # ---------------------------------------------------------
                # LANGKAH 1: SIGNUP DI ELEVENLABS (TAB BARU)
                # ---------------------------------------------------------
                print(f"\n[1/4] Membuka tab baru untuk ElevenLabs signup: {SIGNUP_URL} ...")
                page = context.new_page()
                page.set_default_timeout(35000)
                page.bring_to_front()
                t_start = time.time()
                page.goto(SIGNUP_URL, wait_until="load")
                print(f"[*] Halaman & aset Next.js termuat dalam {time.time() - t_start:.2f} detik.")

                dbg.snapshot(page, "01_page_loaded", "Halaman sign up selesai dimuat")

                print("[*] Menunggu hidrasi form pendaftaran...")
                page.wait_for_timeout(1500)

                email_input = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]').first
                email_input.wait_for(state="visible", timeout=15000)

                password_input = page.locator('input[type="password"], input[name="password"], input[placeholder*="password" i]').first
                password_input.wait_for(state="visible", timeout=10000)

                submit_btn = page.locator('button[type="submit"]').filter(has_text="Sign up").filter(has_not_text="Google").first
                submit_btn.wait_for(state="visible", timeout=5000)

                # Pengisian form dengan verifikasi ganda agar terbebas dari bug React reset
                max_fill_attempts = 6
                for attempt in range(1, max_fill_attempts + 1):
                    print(f"[*] Mengisi form signup (percobaan {attempt}/{max_fill_attempts})...")

                    email_input.click()
                    email_input.fill(email)
                    page.wait_for_timeout(300)

                    password_input.click()
                    password_input.fill(password)
                    page.wait_for_timeout(400)

                    curr_email = email_input.input_value()
                    curr_pass = password_input.input_value()
                    is_btn_disabled = submit_btn.is_disabled()

                    print(f"[*] Verifikasi form: email='{curr_email}', pass_len={len(curr_pass)}, tombol_disabled={is_btn_disabled}")

                    if curr_email == email and curr_pass == password and not is_btn_disabled:
                        print("[✓] Form terisi sempurna dan tombol Sign up telah aktif!")
                        break

                    print("[!] React masih memuat atau mereset nilai, mencoba mengisi kembali...")
                    page.wait_for_timeout(1500)

                print("[*] Mengklik tombol Sign up & submit form...")
                submit_btn = page.locator('button[type="submit"]').filter(has_not_text="Google").first
                try:
                    submit_btn.scroll_into_view_if_needed()
                    submit_btn.click(force=True)
                except Exception as e:
                    print(f"[!] Warning saat klik submit: {e}")

                try:
                    password_input.focus()
                    password_input.press("Enter")
                except Exception:
                    pass

                try:
                    page.evaluate('() => { const f = document.querySelector("form"); if (f) f.requestSubmit(); }')
                except Exception:
                    pass

                dbg.snapshot(page, "03_signup_clicked", "Form signup disubmit")

                print("[*] Menunggu konfirmasi email terkirim...")
                verification_reached = False
                captcha_alerted = False
                wait_start = time.time()
                max_wait_seconds = 180
                last_retry = time.time()

                while time.time() - wait_start < max_wait_seconds:
                    page.wait_for_timeout(1000)

                    if is_verification_screen(page):
                        verification_reached = True
                        print("[✓] Layar 'Check your email' terdeteksi secara valid!")
                        dbg.snapshot(page, "04_verification_screen", "Layar Check your email terdeteksi")
                        break

                    if is_captcha_active(page):
                        if not captcha_alerted:
                            print("\n" + "!" * 65)
                            print("  [!] CAPTCHA TERDETEKSI DI ELEVENLABS!")
                            print("  [!] Silakan selesaikan tantangan captcha di jendela browser.")
                            print("  [!] Script sedang MENUNGGU Anda menyelesaikan captcha...")
                            print("!" * 65 + "\n")
                            dbg.snapshot(page, "04_captcha_challenge", "Tantangan captcha aktif")
                            captcha_alerted = True
                    else:
                        if captcha_alerted:
                            print("[✓] Captcha ElevenLabs selesai diinput! Memeriksa respon form...")
                            captcha_alerted = False

                    if not captcha_alerted and time.time() - last_retry > 5:
                        if password_input.is_visible():
                            print("[*] Belum ada respon form, mencoba trigger submit ulang via Enter & requestSubmit...")
                            try:
                                password_input.focus()
                                password_input.press("Enter")
                                page.evaluate('() => { const f = document.querySelector("form"); if (f) f.requestSubmit(); }')
                            except Exception:
                                pass
                        last_retry = time.time()

                    error_alerts = page.locator('[role="alert"], .text-red-500, .text-danger, .error-message')
                    if error_alerts.count() > 0:
                        for idx in range(error_alerts.count()):
                            err = error_alerts.nth(idx)
                            if err.is_visible():
                                err_text = err.inner_text().strip()
                                if err_text:
                                    print(f"[!] Respon: {err_text}")
                                    dbg.log(f"Respon error dari ElevenLabs: {err_text}", level="WARN")
                                    if "already exists" in err_text.lower() or "already registered" in err_text.lower():
                                        print("[!] Email sudah terdaftar sebelumnya.")
                                        save_account_record(email, password, status="already_registered")
                                        return False

                if not verification_reached:
                    print("[X] Waktu tunggu verifikasi signup habis.")
                    dbg.snapshot(page, "04_signup_timeout", "Timeout menunggu konfirmasi pendaftaran")
                    save_account_record(email, password, status="signup_timeout")
                    return False

                save_account_record(email, password, status="verification_sent")

                # ---------------------------------------------------------
                # LANGKAH 2: AMBIL / INPUT LINK VERIFIKASI
                # ---------------------------------------------------------
                if use_emailondeck and email_page:
                    print("\n[2/4] Mengambil tautan verifikasi dari EmailOnDeck...")
                    email_page.bring_to_front()
                    verify_url = fetch_verification_link_from_emailondeck(email_page, dbg=dbg)
                    if not verify_url:
                        print("[X] Gagal mendapatkan tautan verifikasi dari EmailOnDeck.")
                        return False
                    page.bring_to_front()
                elif manual_verify or (not email.lower().endswith(f"@{DOMAIN}")):
                    print("\n" + "=" * 65)
                    print("  [VERIFIKASI MANUAL] TAUTAN VERIFIKASI EMAIL")
                    print("=" * 65)
                    print(f"[*] ElevenLabs telah mengirimkan email verifikasi ke: {email}")
                    print("[*] Silakan periksa inbox / spam di akun email tersebut.")
                    print("[*] Salin (copy link address) tombol 'Verify Email' di pesan.")
                    print("=" * 65)

                    verify_url = ""
                    while not verify_url:
                        try:
                            verify_url = input("\n[?] Tempel (PASTE) link verifikasi di sini lalu tekan [ENTER]: ").strip()
                        except (KeyboardInterrupt, EOFError):
                            print("\n[!] Dibatalkan oleh pengguna.")
                            return False
                        if not verify_url:
                            print("[!] Link verifikasi tidak boleh kosong.")
                        elif not ("elevenlabs.io" in verify_url or "action" in verify_url or "oobCode" in verify_url or "ticket" in verify_url):
                            print("[!] Format link tidak valid (harus tautan verifikasi ElevenLabs). Coba lagi.")
                            verify_url = ""
                else:
                    print(f"\n[2/4] Mengambil link verifikasi secara instan dari server VPS ({email})...")
                    try:
                        verify_url = fetch_verification_link_from_vps(target_email=email, dbg=dbg)
                    except Exception as vps_err:
                        print(f"[!] Gagal mengambil dari VPS ({vps_err}), fallback ke Gmail profil '{profile_email}'...")
                        verify_url = fetch_verification_link_from_gmail(profile_email=profile_email, target_email=email, dbg=dbg)

                    if not verify_url:
                        print("[X] Gagal mendapatkan tautan verifikasi.")
                        return False

                save_account_record(email, password, status="verification_link_retrieved", extra_data={"verify_url": verify_url})
            else:
                print(f"\n[*] Menggunakan tautan verifikasi langsung yang diberikan:\n{verify_url}")
                page = context.new_page()
                page.set_default_timeout(35000)

            # ---------------------------------------------------------
            # LANGKAH 3: BUKA LINK VERIFIKASI
            # ---------------------------------------------------------
            print(f"\n[3/4] Membuka URL verifikasi di ElevenLabs:\n{verify_url}")
            page.goto(verify_url, wait_until="load")
            page.wait_for_timeout(3000)
            dbg.snapshot(page, "05_verify_url_opened", f"Membuka URL: {verify_url}")

            # ---------------------------------------------------------
            # LANGKAH 4: PROSES ONBOARDING & SIGN IN MENUJU DASHBOARD
            # ---------------------------------------------------------
            print("\n[4/4] Memproses sign in dan melewati onboarding ElevenLabs...")
            completed = handle_onboarding_and_signin(page, email=email, password=password, dbg=dbg)

            if completed:
                dbg.snapshot(page, "06_completed_success", "Proses onboarding selesai sempurna!")
                print("\n" + "=" * 65)
                print("  [✓✓✓] ONBOARDING SUKSES - MEMULAI KONFIGURASI TTS!")
                print("=" * 65)
                print(f"  Akun Email   : {email}")
                print(f"  Password     : {password}")
                print(f"  Status       : ACTIVE (Onboarding Selesai)")
                print(f"  Disimpan di  : {ACCOUNTS_FILE}")
                print("=" * 65 + "\n")
                save_account_record(email, password, status="active", extra_data={"dashboard_url": page.url})

                # ---------------------------------------------------------
                # LANGKAH 5: KONFIGURASI TEXT-TO-SPEECH (TTS)
                # ---------------------------------------------------------
                print("\n[5/5] Mengonfigurasi model & voice di Text-to-Speech...")
                tts_ok = configure_tts_dashboard(page, model_name=DEFAULT_MODEL, voice_name=DEFAULT_VOICE, dbg=dbg)

                # Pastikan halaman terakhir mendarat di https://elevenlabs.io/app/speech-synthesis/text-to-speech
                if "/speech-synthesis/text-to-speech" not in page.url.lower():
                    safe_goto(page, TTS_URL, wait_until="domcontentloaded")
                    page.wait_for_timeout(2000)

                # Jalankan input teks & generate audio jika diminta
                if do_generate:
                    sample_text = narration_text or (
                        "Halo semuanya! Selamat datang kembali. Pada video kali ini, "
                        "kita akan membahas perkembangan teknologi kecerdasan buatan terbaru yang sangat menarik untuk disimak. "
                        "Jangan lupa like dan subscribe!"
                    )
                    input_and_generate_speech(page, text=sample_text, dbg=dbg)

                print("\n" + "=" * 65)
                print("  [✓✓✓] SELURUH ALUR SUKSES (SIGNUP -> ONBOARDING -> TTS AKTIF & TERGENERATE)!")
                print("=" * 65)
                print(f"  Akun Email    : {email}")
                print(f"  Halaman Akhir : {page.url}")
                print(f"  Model         : {DEFAULT_MODEL}")
                print(f"  Voice         : {DEFAULT_VOICE}")
                print(f"  Stability     : Default (Balanced - Di Tengah)")
                print(f"  Debug Data    : {dbg.log_file}")
                print("=" * 65 + "\n")
            else:
                dbg.snapshot(page, "06_onboarding_incomplete", "Onboarding belum selesai otomatis")
                print("\n[!] Onboarding belum selesai sepenuhnya atau memerlukan navigasi manual.")
                save_account_record(email, password, status="verified_onboarding_pending")

            if not headless:
                print("\nTekan [ENTER] di terminal jika ingin menutup browser...")
                try:
                    input()
                except (KeyboardInterrupt, EOFError):
                    pass

            return completed

    except Exception as e:
        # Jika browser ditutup manual oleh pengguna saat menunggu enter
        if "closed" in str(e).lower():
            print(f"\n[*] Browser ditutup atau dihentikan: {e}")
            return True
        raise e


def main():
    parser = argparse.ArgumentParser(
        description="Automasi Lengkap Signup ElevenLabs dengan EmailOnDeck & Konfigurasi TTS via Camoufox"
    )
    parser.add_argument(
        "--email",
        type=str,
        default=None,
        help="Target email. Jika kosong, otomatis mengambil email baru dari EmailOnDeck"
    )
    parser.add_argument(
        "--password",
        type=str,
        default=DEFAULT_PASSWORD,
        help=f"Password (default: {DEFAULT_PASSWORD})"
    )
    parser.add_argument(
        "--gmail",
        action="store_true",
        help="Gunakan Gmail (@riztama.my.id) alih-alih EmailOnDeck"
    )
    parser.add_argument(
        "--manual-verify", "-m",
        action="store_true",
        help="Flag jika link verifikasi akan di-paste manual di terminal"
    )
    parser.add_argument(
        "--verify-url",
        type=str,
        default=None,
        help="Tautan verifikasi langsung (melewati langkah sign up)"
    )
    parser.add_argument(
        "--profile",
        type=str,
        default=DEFAULT_PROFILE,
        help=f"Profil Google/Gmail yang digunakan jika mode Gmail (default: {DEFAULT_PROFILE})"
    )
    parser.add_argument(
        "--login",
        action="store_true",
        help="Login dengan akun yang sudah ada lalu langsung konfigurasi TTS"
    )
    parser.add_argument(
        "--headless",
        action="store_true",
        help="Jalankan di background tanpa GUI (catatan: jika muncul captcha disarankan tanpa headless agar bisa diselesaikan)"
    )
    parser.add_argument(
        "--generate-only",
        action="store_true",
        help="Hanya buat dan tampilkan email random"
    )
    parser.add_argument(
        "--text",
        type=str,
        default=None,
        help="Teks narasi yang akan diinput dan digenerate di Text-to-Speech"
    )
    parser.add_argument(
        "--no-generate",
        action="store_true",
        help="Hanya konfigurasi TTS tanpa generate audio"
    )
    parser.add_argument(
        "--proxy",
        type=str,
        default=None,
        help="Proxy server (misal: http://user:pass@ip:port atau ip:port:user:pass)"
    )

    args = parser.parse_args()

    target_email = args.email
    target_password = args.password
    manual_verify_mode = args.manual_verify
    use_eod = not args.gmail

    if args.verify_url:
        target_email = args.email or "verified_account"
        print(f"[*] Mode Direct Verify URL: Langsung memproses tautan verifikasi:\n    {args.verify_url}")
    elif args.login:
        if args.email:
            target_email = args.email
            target_password = args.password
        else:
            acc_email, acc_pass = get_latest_active_account()
            if not acc_email:
                print("[X] Tidak ditemukan akun aktif di accounts.json. Silakan tentukan --email.")
                return
            target_email = acc_email
            target_password = acc_pass
            print(f"[*] Mode Login: Menggunakan akun aktif terakhir: {target_email}")
    elif args.generate_only:
        target_email = args.email or generate_random_email()
        print(f"Generated Email: {target_email}")
        print(f"Password       : {target_password}")
        return
    else:
        # Jika tidak ada email dan tidak ada flag --gmail, secara default gunakan EmailOnDeck
        if not target_email and not args.gmail:
            use_eod = True
            print("\n" + "=" * 65)
            print("  ELEVENLABS SIGNUP - MODE EMAILONDECK")
            print("=" * 65)
            print("[*] Email akan diambil secara otomatis dari EmailOnDeck.")
            print("[*] Captcha (jika muncul) dapat Anda selesaikan langsung di browser.")
            print("=" * 65)
        elif not target_email and args.gmail:
            target_email = generate_random_email()
            use_eod = False

        if target_email and not target_email.lower().endswith(f"@{DOMAIN}"):
            manual_verify_mode = True

    try:
        run_full_flow(
            email=target_email,
            password=target_password,
            profile_email=args.profile,
            headless=args.headless,
            login_only=args.login,
            narration_text=args.text,
            do_generate=(not args.no_generate),
            manual_verify=manual_verify_mode,
            verify_url=args.verify_url,
            use_emailondeck=use_eod,
            proxy=args.proxy
        )
    except KeyboardInterrupt:
        print("\n[!] Dihentikan oleh pengguna.")
    except Exception as e:
        print(f"\n[X] Terjadi error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
