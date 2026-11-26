import os
import re
from pathlib import Path
from typing import Any, List, Optional

PROFILES_BASE_DIR = Path(__file__).resolve().parent / "profiles"


def sanitize_email(email: str) -> str:
    """Bersihkan input email untuk digunakan sebagai nama folder profil yang valid."""
    cleaned = email.strip().lower()
    # Pastikan karakter aman untuk folder di sistem berkas
    cleaned = re.sub(r'[\\/*?:"<>| ]', '_', cleaned)
    return cleaned


def get_profile_dir(email: str) -> Path:
    """Mendapatkan path folder profil berdasarkan nama email."""
    folder_name = sanitize_email(email)
    profile_path = PROFILES_BASE_DIR / folder_name
    profile_path.mkdir(parents=True, exist_ok=True)
    return profile_path


def list_saved_profiles() -> List[str]:
    """Mengembalikan daftar email profil yang sudah tersimpan."""
    if not PROFILES_BASE_DIR.exists():
        return []
    
    profiles = []
    for item in PROFILES_BASE_DIR.iterdir():
        if item.is_dir() and not item.name.startswith("."):
            profiles.append(item.name)
    return sorted(profiles)


def _get_camoufox_cls() -> Any:
    import sys
    local_dir = str(Path(__file__).resolve().parent)
    project_root = str(Path(__file__).resolve().parent.parent)
    removed = []
    for p in (local_dir, project_root, ""):
        while p in sys.path:
            sys.path.remove(p)
            removed.append(p)
    try:
        from camoufox.sync_api import Camoufox
        return Camoufox
    finally:
        for p in reversed(removed):
            sys.path.insert(0, p)


def open_camoufox_profile(
    email: str,
    headless: bool = False,
    humanize: bool = True,
    **kwargs
) -> Any:
    """
    Context manager untuk membuka Camoufox dengan persistent profile sesuai nama email.
    """
    Camoufox = _get_camoufox_cls()
    profile_dir = get_profile_dir(email)
    return Camoufox(
        persistent_context=True,
        user_data_dir=str(profile_dir),
        headless=headless,
        humanize=humanize,
        **kwargs
    )


def open_fresh_camoufox(
    headless: bool = False,
    humanize: bool = True,
    **kwargs
) -> Any:
    """
    Context manager untuk membuka instance Camoufox fresh (tanpa cookie/storage lama).
    """
    Camoufox = _get_camoufox_cls()
    return Camoufox(
        headless=headless,
        humanize=humanize,
        enable_cache=False,
        **kwargs
    )
