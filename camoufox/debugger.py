import json
import logging
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

# Base directories
DEBUG_DIR = Path(__file__).resolve().parent / "debug"
SCREENSHOTS_DIR = DEBUG_DIR / "screenshots"
DOM_DIR = DEBUG_DIR / "dom"
LOGS_DIR = DEBUG_DIR / "logs"

for d in [DEBUG_DIR, SCREENSHOTS_DIR, DOM_DIR, LOGS_DIR]:
    d.mkdir(parents=True, exist_ok=True)


class CamoufoxDebugger:
    """
    Sistem pencatatan dan debugging komprehensif untuk Camoufox:
    - Rekam log aktivitas & event
    - Simpan screenshot pada setiap langkah krusial / error / captcha
    - Dump struktur DOM / HTML untuk analisis selektor
    - Rekam input, output, dan metadata elemen
    """

    def __init__(self, session_name: str = "signup"):
        self.timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.session_id = f"{session_name}_{self.timestamp}"
        
        # File log sesi
        self.log_file = LOGS_DIR / f"{self.session_id}.log"
        self.data_file = LOGS_DIR / f"{self.session_id}_data.json"
        
        self.events = []
        self._setup_logger()

    def _setup_logger(self):
        self.logger = logging.getLogger(self.session_id)
        self.logger.setLevel(logging.DEBUG)
        
        # File handler
        fh = logging.FileHandler(self.log_file, encoding="utf-8")
        fh.setLevel(logging.DEBUG)
        formatter = logging.Formatter("[%(asctime)s] [%(levelname)s] %(message)s", datefmt="%H:%M:%S")
        fh.setFormatter(formatter)
        
        if not self.logger.handlers:
            self.logger.addHandler(fh)

    def log(self, message: str, level: str = "INFO", data: Optional[Dict[str, Any]] = None):
        """Catat log teks dan simpan ke rekaman data event."""
        log_func = getattr(self.logger, level.lower(), self.logger.info)
        log_func(message)
        
        entry = {
            "time": datetime.now().isoformat(),
            "level": level,
            "message": message,
        }
        if data:
            entry["data"] = data
        self.events.append(entry)
        
        # Perbarui data JSON secara berkala
        try:
            with open(self.data_file, "w", encoding="utf-8") as f:
                json.dump(self.events, f, indent=2, ensure_ascii=False)
        except Exception:
            pass

    def capture_screenshot(self, page, step_name: str) -> Optional[Path]:
        """Ambil tangkapan layar dan simpan ke folder screenshots/."""
        clean_step = "".join(c if c.isalnum() or c in "-_" else "_" for c in step_name)
        filename = f"{self.session_id}_{clean_step}.png"
        filepath = SCREENSHOTS_DIR / filename
        try:
            page.screenshot(path=str(filepath), full_page=False)
            self.log(f"Screenshot tersimpan: {filepath.name}", level="DEBUG", data={"path": str(filepath)})
            return filepath
        except Exception as e:
            self.log(f"Gagal mengambil screenshot ({step_name}): {e}", level="WARN")
            return None

    def dump_dom(self, page, step_name: str) -> Optional[Path]:
        """Simpan salinan lengkap HTML DOM ke folder dom/ untuk inspeksi elemen."""
        clean_step = "".join(c if c.isalnum() or c in "-_" else "_" for c in step_name)
        filename = f"{self.session_id}_{clean_step}.html"
        filepath = DOM_DIR / filename
        try:
            html = page.content() or ""
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(html)
            self.log(f"DOM dump tersimpan: {filepath.name}", level="DEBUG", data={"path": str(filepath), "bytes": len(html)})
            return filepath
        except Exception as e:
            self.log(f"Gagal dump DOM ({step_name}): {e}", level="WARN")
            return None

    def inspect_form_elements(self, page) -> Dict[str, Any]:
        """Inspeksi status input, button, dan form di halaman saat ini."""
        try:
            return page.evaluate("""() => {
                const inputs = Array.from(document.querySelectorAll('input')).map(inp => ({
                    type: inp.type,
                    name: inp.name,
                    id: inp.id,
                    placeholder: inp.placeholder,
                    value: inp.type === 'password' ? '*'.repeat(inp.value.length) : inp.value,
                    visible: inp.offsetWidth > 0 && inp.offsetHeight > 0,
                    disabled: inp.disabled,
                    readonly: inp.readOnly
                }));
                const buttons = Array.from(document.querySelectorAll('button')).map(btn => ({
                    text: (btn.innerText || btn.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 50),
                    type: btn.type,
                    disabled: btn.disabled,
                    ariaDisabled: btn.getAttribute('aria-disabled'),
                    visible: btn.offsetWidth > 0 && btn.offsetHeight > 0
                }));
                const iframes = Array.from(document.querySelectorAll('iframe')).map(f => ({
                    src: (f.src || '').slice(0, 100),
                    title: f.title || '',
                    visible: f.offsetWidth > 0 && f.offsetHeight > 0
                }));
                return {
                    url: window.location.href,
                    title: document.title,
                    readyState: document.readyState,
                    inputs,
                    buttons,
                    iframes
                };
            }""")
        except Exception as e:
            return {"error": str(e)}

    def snapshot(self, page, step_name: str, message: str = "", extra_data: Optional[Dict[str, Any]] = None):
        """
        Snapshot lengkap: catat log, ambil screenshot, dump status elemen form,
        dan dump DOM jika ada error.
        """
        clean_msg = message or f"Snapshot pada tahap: {step_name}"
        elements_info = self.inspect_form_elements(page)
        
        info = {
            "step": step_name,
            "page_url": elements_info.get("url", ""),
            "page_title": elements_info.get("title", ""),
            "elements": elements_info
        }
        if extra_data:
            info["extra"] = extra_data

        self.log(clean_msg, level="INFO", data=info)
        img_path = self.capture_screenshot(page, step_name)
        
        # Simpan DOM jika step berkaitan dengan error, captcha, atau verifikasi
        if "error" in step_name.lower() or "captcha" in step_name.lower() or "fail" in step_name.lower():
            self.dump_dom(page, step_name)

        return {
            "image": str(img_path) if img_path else None,
            "info": info
        }
