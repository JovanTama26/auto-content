#!/usr/bin/env python3
"""
aistudio.py - Google AI Studio Drive Video Upload, Prompt Execution & JSON Extraction via Camoufox

Flow yang diobservasi langsung dari DOM Google AI Studio v3 & Google Drive Picker v2:
1. Buka https://aistudio.google.com/prompts/new_chat?model=<model>
2. Klik tombol '+' (button[data-test-id="add-media-button"] / aria-label="Insert images, videos, audio, or files")
3. Klik menu item 'Drive' (button.drive-file-menu-item / role="menuitem"[aria-label="Drive"])
4. Masuk ke iframe Google Drive Picker: div.google-picker iframe[src*="docs.google.com/picker"]
5. Pilih tab 'Upload' (role="tab" name="Upload") -> klik tombol 'Browse' -> set file via expect_file_chooser()
   (atau cari & pilih file yang sudah ada di tab 'My Drive' bila --reuse-drive aktif)
6. Tunggu upload Drive selesai & modal tertutup + verifikasi token video selesai dihitung.
7. Isi prompt ke textarea[formcontrolname="promptText"][aria-label="Enter a prompt"].
8. Klik tombol Run (ms-run-button button), pantau status streaming ('Stop' / span.spin),
   dan tunggu hingga selesai (kembali ke 'Run' + turn jawaban model stabil).
9. Ekstrak teks jawaban dari ms-chat-turn:not(.thought-activity-host) [data-turn-role="Model"]
   (mengabaikan ms-thought-chunk), parse & validasi JSON (minified single-line JSON).
"""

import re
import sys
import time
import json
import argparse
from pathlib import Path
from typing import Optional, Dict, Any

CURRENT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = CURRENT_DIR.parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

from browser import open_camoufox_profile
from debugger import CamoufoxDebugger


DEFAULT_MODEL = "gemini-4-hydrogen"


def clean_and_parse_json(raw_text: str) -> Dict[str, Any]:
    """
    Membersihkan output teks dari AI Studio (code fences, thought headers, whitespace)
    dan mem-parse menjadi dict JSON valid.
    """
    if not raw_text or not raw_text.strip():
        raise ValueError("Output teks dari AI Studio kosong.")

    cleaned = raw_text.strip()

    # 1. Jika dibungkus markdown code block ```json ... ```
    code_blocks = re.findall(r"```(?:json)?\s*([\s\S]*?)```", cleaned, flags=re.IGNORECASE)
    for block in reversed(code_blocks):
        b = block.strip()
        if "{" in b and "}" in b:
            cleaned = b
            break

    # 2. Potong tepat dari '{' pertama ke '}' terakhir
    start_idx = cleaned.find("{")
    end_idx = cleaned.rfind("}")
    if start_idx == -1 or end_idx == -1 or end_idx <= start_idx:
        raise ValueError(f"Tidak ditemukan objek JSON {{...}} pada output: {cleaned[:200]!r}")

    candidate = cleaned[start_idx : end_idx + 1].strip()

    # Level 1: Direct json.loads
    try:
        return json.loads(candidate)
    except Exception as err1:
        # Level 2: Perbaiki unescaped newline/tab di dalam string literal & trailing comma
        try:
            in_string = False
            escaped = False
            out_chars = []
            for ch in candidate:
                if ch == '"' and not escaped:
                    in_string = not in_string
                    out_chars.append(ch)
                elif in_string and ch in ("\n", "\r"):
                    out_chars.append("\\n" if ch == "\n" else "")
                elif in_string and ch == "\t":
                    out_chars.append("\\t")
                else:
                    out_chars.append(ch)

                if ch == "\\" and not escaped:
                    escaped = True
                else:
                    escaped = False

            repaired = "".join(out_chars)
            repaired = re.sub(r",\s*([\]}])", r"\1", repaired)
            repaired = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", repaired)
            return json.loads(repaired)
        except Exception as err2:
            raise ValueError(
                f"Gagal parse JSON dari output AI Studio: {err1} (fallback: {err2})"
            ) from err2


class AIStudioAutomator:
    def __init__(
        self,
        email: str = "jovangithub@gmail.com",
        model: Optional[str] = DEFAULT_MODEL,
        headless: bool = False,
        disable_grounding: bool = True,
    ):
        self.email = email
        self.model = model
        self.headless = headless
        self.disable_grounding = disable_grounding
        self.dbg = CamoufoxDebugger("aistudio_flow")
        _orig_log = self.dbg.log

        def _stream_log(message: str, level: str = "INFO", data: Optional[Dict[str, Any]] = None):
            print(f"[CAMOUFOX][{level.upper()}] {message}", flush=True)
            return _orig_log(message, level=level, data=data)

        self.dbg.log = _stream_log

    def open_new_chat(self, page) -> str:
        if self.model and self.model.lower() not in ("default", "auto", "none"):
            url = f"https://aistudio.google.com/prompts/new_chat?model={self.model}"
        else:
            url = "https://aistudio.google.com/prompts/new_chat"
        self.dbg.log(f"Membuka Google AI Studio: {url}")
        page.goto(url, wait_until="domcontentloaded", timeout=60000)

        # Pastikan tidak terlempar ke halaman login Google
        if "accounts.google.com" in page.url or "ServiceLogin" in page.url:
            self.dbg.snapshot(page, "error_not_logged_in", "Sesi Google belum login")
            raise RuntimeError(
                f"Profil '{self.email}' belum login ke Google AI Studio. "
                f"Jalankan: python3 camoufox/login_google.py {self.email}"
            )

        # Tunggu tombol '+' add-media-button & textarea prompt siap
        add_btn_sel = (
            'button[data-test-id="add-media-button"], '
            'button[data-test="selectMediaMenu"], '
            'button[aria-label="Insert images, videos, audio, or files"]'
        )
        self.dbg.log("Menunggu workspace editor & tombol '+' siap...")
        page.wait_for_selector(add_btn_sel, state="visible", timeout=45000)
        page.wait_for_selector(
            'textarea[aria-label="Enter a prompt"], textarea[formcontrolname="promptText"]',
            state="visible",
            timeout=30000,
        )
        time.sleep(1.5)

        # Opsional: matikan chip Grounding with Google Search jika aktif
        if self.disable_grounding:
            try:
                grounding_close = page.locator(
                    'button[aria-label="Remove Grounding with Google Search"]'
                ).first
                if grounding_close.is_visible(timeout=1500):
                    grounding_close.click()
                    self.dbg.log("Chip 'Grounding with Google Search' dinonaktifkan.")
                    time.sleep(0.5)
            except Exception:
                pass

        self.dbg.capture_screenshot(page, "01_new_chat_ready")
        return page.url

    def open_drive_picker(self, page):
        """
        Klik tombol '+' -> klik menu item 'Drive' -> tunggu iframe Google Drive Picker terbuka.
        """
        add_btn = page.locator(
            'button[data-test-id="add-media-button"], '
            'button[data-test="selectMediaMenu"], '
            'button[aria-label="Insert images, videos, audio, or files"]'
        ).first

        self.dbg.log("Klik tombol '+' (add-media-button)...")
        add_btn.click()

        # Tunggu menu item 'Drive' di .cdk-overlay-container
        drive_item = page.locator(
            'button.drive-file-menu-item, '
            'button[role="menuitem"][aria-label="Drive"], '
            'button[role="menuitem"]:has-text("Drive")'
        ).first
        drive_item.wait_for(state="visible", timeout=10000)
        self.dbg.capture_screenshot(page, "02_add_media_menu_open")

        self.dbg.log("Klik menu item 'Drive'...")
        drive_item.click()

        # Tunggu dialog & iframe Google Drive Picker muncul
        iframe_sel = 'div.google-picker iframe[src*="docs.google.com/picker"], iframe[src*="docs.google.com/picker"]'
        self.dbg.log("Menunggu modal Google Drive Picker (iframe docs.google.com/picker)...")
        page.wait_for_selector(iframe_sel, state="visible", timeout=30000)
        time.sleep(1.5)
        self.dbg.capture_screenshot(page, "03_drive_picker_modal_open")

        return page.frame_locator(iframe_sel).first

    def _try_select_existing_in_drive(self, page, picker, filename: str) -> bool:
        """
        Cari nama file di tab My Drive / Recent / Search box. Jika sudah ada, pilih dan klik Insert.
        """
        try:
            self.dbg.log(f"Mengecek apakah '{filename}' sudah ada di Google Drive...")
            # Tunggu daftar file di dalam Drive Picker selesai dimuat (spinner hilang)
            try:
                picker.locator('[role="listbox"], [role="option"]').first.wait_for(
                    state="visible", timeout=10000
                )
            except Exception:
                pass

            option_row = picker.locator(f'[role="option"]:has-text("{filename}")').first

            # 1. Cek langsung di tab My Drive (default)
            if not option_row.is_visible(timeout=2000):
                # 2. Cek di tab Recent (file yang baru di-upload di Step Analyze selalu muncul paling atas di Recent)
                try:
                    recent_tab = picker.get_by_role("tab", name="Recent").first
                    if recent_tab.is_visible(timeout=2000):
                        recent_tab.click()
                        time.sleep(2.5)
                        try:
                            picker.locator('[role="listbox"], [role="option"]').first.wait_for(
                                state="visible", timeout=8000
                            )
                        except Exception:
                            pass
                except Exception:
                    pass

            if not option_row.is_visible(timeout=2000):
                # 3. Gunakan Search box di dalam iframe
                search_input = picker.locator(
                    '[role="combobox"][aria-label*="Search in Drive" i], '
                    'input[aria-label*="Search in Drive" i], '
                    'input[placeholder*="Search in Drive" i]'
                ).first
                if search_input.is_visible(timeout=3000):
                    search_input.click()
                    search_input.fill(filename)
                    search_input.press("Enter")
                    time.sleep(2.5)

            if not option_row.is_visible(timeout=3000):
                self.dbg.log(f"File '{filename}' belum ditemukan di Drive, lanjut upload baru.")
                return False

            self.dbg.log(f"File '{filename}' ditemukan di Drive! Memilih file...")
            option_row.click()
            time.sleep(1.0)

            insert_btn = picker.locator(
                'button[aria-label*="Insert" i], button:has-text("Insert")'
            ).first
            insert_btn.wait_for(state="visible", timeout=8000)
            insert_btn.click()
            self.dbg.log("Tombol 'Insert' diklik untuk file Drive yang sudah ada.")
            return True
        except Exception as e:
            self.dbg.log(f"Skip reuse check Drive: {e}", level="DEBUG")
            return False

    def upload_file_via_drive_picker(
        self,
        page,
        file_path: Path,
        reuse_existing: bool = False,
        upload_timeout_sec: int = 360,
    ) -> Dict[str, Any]:
        """
        Upload file video lokal melalui modal Google Drive Picker -> tab 'Upload' -> 'Browse'.
        """
        resolved_path = file_path.resolve()
        if not resolved_path.exists():
            raise FileNotFoundError(f"File video tidak ditemukan: {resolved_path}")

        filename = resolved_path.name
        size_mb = round(resolved_path.stat().st_size / (1024 * 1024), 2)
        self.dbg.log(f"Memulai Drive Upload untuk '{filename}' ({size_mb} MB)...")

        picker = self.open_drive_picker(page)

        used_existing = False
        if reuse_existing:
            used_existing = self._try_select_existing_in_drive(page, picker, filename)

        if not used_existing:
            # Jika sebelumnya sempat masuk ke tampilan Search Results, tab 'Upload' tersembunyi di balik tombol Back
            upload_tab = picker.get_by_role("tab", name="Upload").first
            if not upload_tab.is_visible(timeout=2000):
                try:
                    back_btn = picker.locator(
                        'button[aria-label*="Back" i], button[aria-label*="Exit" i], button[aria-label*="Clear" i]'
                    ).first
                    if back_btn.is_visible(timeout=2000):
                        back_btn.click()
                        time.sleep(1.0)
                except Exception:
                    pass
            if not upload_tab.is_visible(timeout=2000):
                # Fallback: tutup & buka ulang modal Drive Picker
                page.keyboard.press("Escape")
                time.sleep(1.0)
                picker = self.open_drive_picker(page)
                upload_tab = picker.get_by_role("tab", name="Upload").first

            # 1. Klik tab 'Upload' di dalam iframe Drive Picker
            self.dbg.log("Berpindah ke tab 'Upload' di Google Drive Picker...")
            upload_tab.wait_for(state="visible", timeout=15000)
            upload_tab.click()
            time.sleep(1.0)
            self.dbg.capture_screenshot(page, "04_drive_picker_upload_tab")

            # 2. Klik tombol 'Browse' dan tangkap file chooser
            browse_btn = picker.locator(
                'button:has-text("Browse"), [role="button"]:has-text("Browse")'
            ).first
            browse_btn.wait_for(state="visible", timeout=15000)

            self.dbg.log(f"Klik 'Browse' & menyuplai file lokal: {resolved_path}")
            file_supplied = False
            try:
                with page.expect_file_chooser(timeout=12000) as fc_info:
                    browse_btn.click()
                file_chooser = fc_info.value
                file_chooser.set_files(str(resolved_path))
                file_supplied = True
                self.dbg.log("File berhasil disuplai via native file_chooser.")
            except Exception as fc_err:
                self.dbg.log(
                    f"expect_file_chooser fallback ({fc_err}), mencoba input[type='file'] di dalam iframe...",
                    level="WARN",
                )
                file_input = picker.locator('input[type="file"]').first
                file_input.set_input_files(str(resolved_path))
                file_supplied = True
                self.dbg.log("File berhasil disuplai via iframe input[type='file'].")

            if not file_supplied:
                raise RuntimeError("Gagal menyuplai file ke Google Drive Picker.")

            time.sleep(1.5)
            self.dbg.capture_screenshot(page, "05_drive_upload_in_progress")

        # 3. Tunggu proses upload di Drive Picker selesai & modal tertutup
        self.dbg.log(f"Menunggu upload Drive selesai (timeout {upload_timeout_sec}s)...")
        start_wait = time.time()
        dialog_locator = page.locator("div.google-picker.modal-dialog")

        while time.time() - start_wait < upload_timeout_sec:
            if not dialog_locator.is_visible():
                self.dbg.log("Modal Google Drive Picker sudah tertutup otomatis (file ter-insert).")
                break

            try:
                insert_btn = picker.locator(
                    'button[aria-label*="Insert" i], button:has-text("Insert")'
                ).first
                if insert_btn.is_visible(timeout=500) and insert_btn.is_enabled():
                    self.dbg.log("Tombol 'Insert' aktif di Drive Picker, mengklik Insert...")
                    insert_btn.click()
                    time.sleep(1.5)
            except Exception:
                pass

            time.sleep(1.5)
        else:
            self.dbg.snapshot(page, "error_drive_upload_timeout", "Timeout menunggu Drive Picker selesai upload")
            raise TimeoutError(
                f"Timeout ({upload_timeout_sec}s): Upload '{filename}' di Google Drive Picker belum selesai."
            )

        self.dbg.capture_screenshot(page, "06_after_picker_closed")

        # 4. Verifikasi media chunk masuk ke editor AI Studio & tunggu ekstraksi token selesai
        media_info = self.wait_for_media_ready(page, filename=filename, timeout_sec=180)
        self.dbg.capture_screenshot(page, "07_media_chunk_ready")

        return {
            "success": True,
            "filename": filename,
            "file_path": str(resolved_path),
            "size_mb": size_mb,
            "reused_from_drive": used_existing,
            "media_info": media_info,
        }

    def wait_for_media_ready(
        self, page, filename: str = "", timeout_sec: int = 180
    ) -> Dict[str, Any]:
        """
        Tunggu hingga kartu media chunk tampil di prompt editor AI Studio
        dan proses ekstraksi/perhitungan token video selesai (tidak ada spinner).
        """
        self.dbg.log(f"Menunggu media chunk '{filename}' siap & token selesai dihitung di AI Studio...")
        start_time = time.time()
        base_name = Path(filename).stem.lower() if filename else ""
        stable_ready_ticks = 0

        while time.time() - start_time < timeout_sec:
            # Tutup tooltip onboarding 'Video settings -> Got it' jika muncul
            try:
                got_it_btn = page.locator('button:has-text("Got it")').first
                if got_it_btn.is_visible(timeout=300):
                    got_it_btn.click()
            except Exception:
                pass

            state = page.evaluate(
                """(baseName) => {
                const promptArea = document.querySelector(
                    'ms-prompt-editor, ms-chat-prompt-box, ms-prompt-bar, ms-prompt-input-wrapper, .prompt-box-container, [role="main"]'
                ) || document.body;

                const mediaCards = Array.from(document.querySelectorAll(
                    'ms-prompt-media, [data-test-id="prompt-media-container"], .prompt-media-item-container, ' +
                    'ms-media-chunk, ms-file-chunk, ms-prompt-chunk, ms-chunk, ms-file-pill, ms-attachment, ' +
                    '.file-chunk, .media-chunk, .file-pill, [data-test-id="media-chunk"], [data-test-id="attached-file"]'
                ));

                const cardTexts = mediaCards
                    .filter(el => el.offsetWidth > 0 && el.offsetHeight > 0)
                    .map(el => (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' '));

                const areaText = (promptArea.innerText || promptArea.textContent || '').toLowerCase();
                const hasFilenameMatch = baseName ? areaText.includes(baseName) : cardTexts.length > 0;
                const hasMediaCard = cardTexts.length > 0 || hasFilenameMatch;

                const spinners = Array.from(promptArea.querySelectorAll(
                    'mat-spinner, mat-progress-spinner, mat-progress-bar, [role="progressbar"], .loading-indicator, .spin'
                )).filter(el => el.offsetWidth > 0 && el.offsetHeight > 0);

                const hasLoadingText = cardTexts.some(t => /loading|processing|uploading/i.test(t));
                const hasTokenError = cardTexts.some(t => /token count failed|link a paid api key/i.test(t));
                const tokenMatch = cardTexts.join(' ').match(/([0-9][0-9,.]*)\\s*tokens?/i) || areaText.match(/([0-9][0-9,.]*)\\s*tokens?/i);

                return {
                    hasMediaCard,
                    hasFilenameMatch,
                    cardCount: cardTexts.length,
                    cardTexts: cardTexts.slice(0, 5),
                    spinnerCount: spinners.length,
                    hasLoadingText,
                    hasTokenError,
                    tokenText: tokenMatch ? tokenMatch[0] : null,
                };
            }""",
                base_name,
            )

            if state.get("hasTokenError"):
                self.dbg.snapshot(
                    page,
                    "error_token_count_failed",
                    f"Token count gagal pada model '{self.model}': {state.get('cardTexts')}",
                )
                raise RuntimeError(
                    f"Media '{filename}' berhasil masuk ke AI Studio, tetapi gagal hitung token "
                    f"({state.get('cardTexts')}). Pastikan model '{self.model}' tersedia untuk akun '{self.email}'."
                )

            if state.get("hasMediaCard") and state.get("spinnerCount", 0) == 0 and not state.get("hasLoadingText"):
                stable_ready_ticks += 1
                if stable_ready_ticks >= 2:
                    self.dbg.log(
                        f"Media chunk siap! cards={state.get('cardTexts')} tokens={state.get('tokenText')}"
                    )
                    return state
            else:
                stable_ready_ticks = 0

            time.sleep(1.5)

        self.dbg.snapshot(page, "error_media_token_timeout", f"Timeout menunggu media '{filename}' siap")
        raise TimeoutError(
            f"Timeout ({timeout_sec}s): Media chunk '{filename}' belum selesai diproses di editor AI Studio."
        )

    def enter_prompt(self, page, prompt_text: str) -> None:
        """
        Isi teks prompt ke dalam <textarea formcontrolname="promptText" aria-label="Enter a prompt">
        dan pastikan tombol Run (ms-run-button button) berubah menjadi aria-disabled="false".
        """
        if not prompt_text or not prompt_text.strip():
            raise ValueError("Teks prompt tidak boleh kosong.")

        textarea = page.locator(
            'textarea[aria-label="Enter a prompt"], '
            'textarea[formcontrolname="promptText"], '
            'textarea[placeholder*="Start typing a prompt" i]'
        ).first
        textarea.wait_for(state="visible", timeout=20000)

        self.dbg.log(f"Mengisi prompt ke textarea ({len(prompt_text)} karakter)...")
        textarea.click()
        textarea.fill(prompt_text)

        # Trigger Angular FormControl input/change event agar ms-run-button aktif
        page.evaluate(
            """() => {
            const ta = document.querySelector('textarea[aria-label="Enter a prompt"], textarea[formcontrolname="promptText"]');
            if (ta) {
                ta.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                ta.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
            }
        }"""
        )
        time.sleep(0.8)
        self.dbg.capture_screenshot(page, "08_prompt_entered")

    def run_and_extract_response(
        self,
        page,
        prompt_text: str,
        expect_json: bool = True,
        generation_timeout_sec: int = 420,
    ) -> Dict[str, Any]:
        """
        Isi prompt -> klik tombol Run (ms-run-button button) -> pantau state 'Stop' / streaming ->
        ekstrak teks bersih dari ms-chat-turn:not(.thought-activity-host) [data-turn-role="Model"].
        """
        # Hitung jumlah turn jawaban model sebelum Run
        initial_answer_count = page.locator(
            'ms-chat-turn:not(.thought-activity-host) [data-turn-role="Model"]'
        ).count()

        self.enter_prompt(page, prompt_text)

        # Tunggu tombol Run di dalam ms-run-button siap (aria-disabled="false")
        run_btn = page.locator("ms-run-button button").first
        run_btn.wait_for(state="visible", timeout=20000)

        start_wait_btn = time.time()
        while time.time() - start_wait_btn < 30:
            aria_disabled = run_btn.get_attribute("aria-disabled")
            is_disabled = run_btn.is_disabled() or aria_disabled == "true"
            if not is_disabled:
                break
            time.sleep(0.5)
        else:
            self.dbg.snapshot(page, "error_run_button_disabled", "Tombol Run masih disabled")
            raise RuntimeError("Tombol Run (ms-run-button button) tetap disabled setelah mengisi prompt.")

        self.dbg.log("Mengklik tombol Run (ms-run-button button)...")
        run_btn.click()

        # Tunggu generasi dimulai (tombol berubah menjadi 'Stop' / ada span.spin atau turn baru muncul)
        self.dbg.log("Menunggu AI Studio memulai streaming response...")
        start_gen = time.time()
        saw_generating = False
        while time.time() - start_gen < 15:
            btn_text = (run_btn.inner_text() or "").strip().lower()
            current_turns = page.locator("ms-chat-turn").count()
            if "stop" in btn_text or current_turns > initial_answer_count:
                saw_generating = True
                break
            time.sleep(0.4)

        self.dbg.log(f"Streaming dimulai (saw_generating={saw_generating}). Menunggu selesai...")
        self.dbg.capture_screenshot(page, "09_streaming_started")

        # Pantau hingga streaming selesai:
        # 1. ms-run-button button sudah kembali ke 'Run' (tidak mengandung 'Stop' dan tidak ada .spin)
        # 2. Turn jawaban model (ms-chat-turn:not(.thought-activity-host) [data-turn-role="Model"]) sudah muncul
        # 3. Teks jawaban tidak kosong dan panjangnya stabil selama 2 pengecekan berturut-turut
        stable_ticks = 0
        last_raw_text = ""

        while time.time() - start_gen < generation_timeout_sec:
            status = page.evaluate(
                """(initialCount) => {
                const runBtn = document.querySelector('ms-run-button button');
                const btnText = runBtn ? (runBtn.innerText || runBtn.textContent || '').trim() : '';
                const hasSpin = !!(runBtn && runBtn.querySelector('.spin'));
                const isStillGenerating = /\\bstop\\b/i.test(btnText) || hasSpin;

                // Cek banner error fatal jika tidak sedang generating
                let fatalError = null;
                if (!isStillGenerating) {
                    const errBanners = Array.from(document.querySelectorAll(
                        'ms-banner[variant="error"], .banner-error, .error-banner, .mat-mdc-snack-bar-container, .turn-error'
                    ));
                    for (const b of errBanners) {
                        if (b.offsetWidth > 0 && b.offsetHeight > 0) {
                            const t = (b.innerText || b.textContent || '').trim();
                            if (/(?:quota exceeded|resource has been exhausted|internal error|failed to generate|rate limit|blocked by safety|http response at 400 or 500)/i.test(t)) {
                                fatalError = t;
                                break;
                            }
                        }
                    }
                }

                // Ambil semua turn model yang BUKAN thought-activity-host
                const answerTurns = Array.from(
                    document.querySelectorAll('ms-chat-turn:not(.thought-activity-host)')
                ).filter(turn => {
                    return !!(
                        turn.querySelector('[data-turn-role="Model"], .chat-turn-container.model') &&
                        !turn.querySelector('ms-thought-chunk')
                    );
                });

                let latestText = '';
                let hasThumbUp = false;
                if (answerTurns.length > initialCount) {
                    const targetTurn = answerTurns[answerTurns.length - 1];
                    hasThumbUp = !!targetTurn.querySelector('button.response-feedback-button[aria-label="Good response"]');

                    // Kloning konten teks jawaban (ms-prompt-chunk.text-chunk / ms-text-chunk / ms-cmark-node)
                    const contentRoot =
                        targetTurn.querySelector('ms-prompt-chunk.text-chunk ms-text-chunk') ||
                        targetTurn.querySelector('.turn-content ms-cmark-node.cmark-node') ||
                        targetTurn.querySelector('.turn-content') ||
                        targetTurn;

                    const clone = contentRoot.cloneNode(true);
                    clone.querySelectorAll(
                        'ms-thought-chunk, .author-label, .actions-container, .turn-footer, .turn-information, button'
                    ).forEach(el => el.remove());

                    latestText = (clone.innerText || clone.textContent || '').trim();
                }

                return {
                    isStillGenerating,
                    btnText,
                    answerTurnCount: answerTurns.length,
                    hasThumbUp,
                    latestText,
                    fatalError,
                };
            }""",
                initial_answer_count,
            )

            if status.get("fatalError"):
                self.dbg.snapshot(page, "error_ai_studio_fatal", status["fatalError"])
                raise RuntimeError(f"AI Studio mengembalikan error: {status['fatalError']}")

            latest_text = status.get("latestText") or ""
            is_generating = status.get("isStillGenerating", False)
            answer_count = status.get("answerTurnCount", 0)

            if not is_generating and answer_count > initial_answer_count and len(latest_text) > 0:
                if latest_text == last_raw_text:
                    stable_ticks += 1
                    if stable_ticks >= 2:
                        self.dbg.log(
                            f"Response model selesai & stabil ({len(latest_text)} karakter, elapsed={round(time.time() - start_gen, 1)}s)."
                        )
                        break
                else:
                    last_raw_text = latest_text
                    stable_ticks = 1
            else:
                if latest_text:
                    last_raw_text = latest_text
                stable_ticks = 0

            time.sleep(1.2)
        else:
            self.dbg.snapshot(page, "error_generation_timeout", "Timeout menunggu response AI Studio selesai")
            raise TimeoutError(
                f"Timeout ({generation_timeout_sec}s): Response AI Studio belum selesai."
            )

        self.dbg.capture_screenshot(page, "10_response_completed")

        result: Dict[str, Any] = {
            "raw_text": last_raw_text,
            "elapsed_sec": round(time.time() - start_gen, 2),
        }

        if expect_json:
            parsed = clean_and_parse_json(last_raw_text)
            minified = json.dumps(parsed, ensure_ascii=False, separators=(",", ":"))
            result["parsed_json"] = parsed
            result["minified_json"] = minified
            self.dbg.log(f"JSON berhasil di-parse & di-minify ({len(minified)} karakter).")

        return result


def main():
    parser = argparse.ArgumentParser(
        description="Upload video part via Drive Picker, jalankan prompt analisis, dan ekstrak output JSON di Google AI Studio (Camoufox)."
    )
    parser.add_argument(
        "--file",
        "-f",
        help="Path ke file video (.mp4) yang akan di-upload via Drive Picker (opsional bila hanya tes prompt)",
    )
    parser.add_argument(
        "--prompt",
        "-p",
        help="Teks prompt langsung yang akan dikirim ke AI Studio",
    )
    parser.add_argument(
        "--prompt-file",
        help="Path ke file .txt/.md yang berisi teks prompt",
    )
    parser.add_argument(
        "--output",
        "-o",
        help="Path file output .json untuk menyimpan hasil ekstraksi JSON",
    )
    parser.add_argument(
        "--email",
        "-e",
        default="jovangithub@gmail.com",
        help="Profil email Camoufox (default: jovangithub@gmail.com)",
    )
    parser.add_argument(
        "--model",
        "-m",
        default=DEFAULT_MODEL,
        help=f"Model Google AI Studio (default: {DEFAULT_MODEL})",
    )
    parser.add_argument(
        "--reuse-drive",
        action="store_true",
        help="Cari dan gunakan file di My Drive jika nama file sudah pernah di-upload",
    )
    parser.add_argument(
        "--raw-text",
        action="store_true",
        help="Jangan paksa parse output sebagai JSON",
    )
    parser.add_argument(
        "--headless",
        action="store_true",
        help="Jalankan Camoufox dalam mode headless",
    )
    parser.add_argument(
        "--keep-open",
        type=int,
        default=0,
        help="Tahan browser tetap terbuka selama N detik setelah selesai",
    )
    args = parser.parse_args()

    prompt_text: Optional[str] = args.prompt
    if args.prompt_file:
        pf = Path(args.prompt_file)
        if not pf.is_absolute():
            pf = PROJECT_ROOT / pf
        prompt_text = pf.read_text(encoding="utf-8")

    if not args.file and not prompt_text:
        parser.error("Harap berikan minimal --file dan/atau --prompt (--prompt-file).")

    automator = AIStudioAutomator(
        email=args.email,
        model=args.model,
        headless=args.headless,
    )

    print(f"[*] Membuka Camoufox dengan profil: {args.email} (headless={args.headless})")
    with open_camoufox_profile(args.email, headless=args.headless, humanize=True) as context:
        page = context.pages[0] if context.pages else context.new_page()
        automator.open_new_chat(page)

        summary: Dict[str, Any] = {"success": True, "model": args.model, "email": args.email}

        if args.file:
            video_path = Path(args.file)
            if not video_path.is_absolute():
                video_path = PROJECT_ROOT / video_path
            upload_res = automator.upload_file_via_drive_picker(
                page,
                file_path=video_path,
                reuse_existing=args.reuse_drive,
            )
            summary["upload"] = upload_res

        if prompt_text:
            gen_res = automator.run_and_extract_response(
                page,
                prompt_text=prompt_text,
                expect_json=not args.raw_text,
            )
            summary["generation"] = {
                "elapsed_sec": gen_res["elapsed_sec"],
                "raw_length": len(gen_res["raw_text"]),
                "minified_json": gen_res.get("minified_json"),
                "parsed_json": gen_res.get("parsed_json"),
            }

            if args.output:
                out_path = Path(args.output)
                if not out_path.is_absolute():
                    out_path = PROJECT_ROOT / out_path
                out_path.parent.mkdir(parents=True, exist_ok=True)
                if "minified_json" in gen_res:
                    out_path.write_text(gen_res["minified_json"], encoding="utf-8")
                else:
                    out_path.write_text(gen_res["raw_text"], encoding="utf-8")
                summary["saved_output"] = str(out_path)

        print("\n=== HASIL AUTOMASI GOOGLE AI STUDIO ===")
        print(json.dumps(summary, indent=2, ensure_ascii=False))

        if args.keep_open > 0 and not args.headless:
            print(f"[*] Menahan jendela browser selama {args.keep_open} detik...")
            time.sleep(args.keep_open)


if __name__ == "__main__":
    main()
