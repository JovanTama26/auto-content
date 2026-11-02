#!/usr/bin/env python3
"""
flow_generator.py - Google Flow Image Generation Automation with Camoufox

Automates image generation on Google Flow (https://flow.google.com/) using
persistent Camoufox profiles. Downloads generated high-resolution images
and maps them to project scenes.
"""

import sys
import os
import re
import json
import time
import argparse
import urllib.request
from pathlib import Path
from typing import List, Dict, Any, Optional

# Ensure camoufox directory is in path
CURRENT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = CURRENT_DIR.parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

from browser import open_camoufox_profile, list_saved_profiles
from debugger import CamoufoxDebugger


class GoogleFlowGenerator:
    """
    Camoufox automation client for Google Flow (https://flow.google.com/).
    """

    def __init__(
        self,
        email: str = "jovangithub@gmail.com",
        project_url: Optional[str] = None,
        headless: bool = True,
        output_dir: str = "input/faceless/images",
        ratio: str = "16:9",
        count: int = 1,
        model_name: str = "Nano Banana 2.1",
        timeout_per_image: int = 90,
    ):
        self.email = email
        self.project_url = project_url
        self.headless = headless
        out_p = Path(output_dir)
        if not out_p.is_absolute():
            out_p = PROJECT_ROOT / out_p
        self.output_dir = out_p
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.ratio = ratio
        self.count = count
        self.model_name = model_name
        self.timeout_per_image = timeout_per_image
        self.dbg = CamoufoxDebugger("flow_generator")

    def _ensure_project(self, page, force_new: bool = False) -> str:
        """
        Ensure we are on a valid Flow project workspace.
        If project_url is given and not force_new, open it.
        Otherwise, open https://flow.google.com/ and either open the latest project or click '+ Project baru'.
        """
        if self.project_url and not force_new:
            self.dbg.log(f"Navigating directly to project: {self.project_url}")
            page.goto(self.project_url, wait_until="domcontentloaded", timeout=60000)
        else:
            self.dbg.log("Opening Flow landing page to find or create project...")
            page.goto("https://flow.google.com/", wait_until="domcontentloaded", timeout=60000)
            
            # Wait for Angular shell to mount
            try:
                page.wait_for_selector("flow-project-card, button.new-project-button, button:has-text('Project baru'), button:has-text('New project')", timeout=30000)
            except Exception:
                time.sleep(4)

            if not force_new:
                # Check if there's an existing project card to reuse
                cards = page.query_selector_all("flow-project-card a[href*='/project/']")
                if cards:
                    href = cards[0].get_attribute("href")
                    if href:
                        target_url = f"https://flow.google.com{href}" if href.startswith("/") else href
                        self.dbg.log(f"Reusing latest existing project: {target_url}")
                        page.goto(target_url, wait_until="domcontentloaded", timeout=60000)
                        self.project_url = target_url
            
            if force_new or not self.project_url:
                # Create a new project
                self.dbg.log("Creating new project with '+ Project baru' button...")
                new_btn = page.query_selector("button.new-project-button, button:has-text('Project baru'), button:has-text('New project')")
                if new_btn:
                    new_btn.click()
                    page.wait_for_url("**/project/**", timeout=30000)
                    self.dbg.log(f"New project created: {page.url}")
                else:
                    raise RuntimeError("Gagal menemukan tombol buat project baru di Google Flow.")

        # Wait for ProseMirror textbox in project workspace
        self.dbg.log("Waiting for workspace editor (div.ProseMirror) to mount...")
        page.wait_for_selector("div.ProseMirror", timeout=40000)
        time.sleep(1.5)
        return page.url

    def _configure_settings(self, page):
        """
        Configure Flow settings (Aspect Ratio 16:9, Count x1, Model).
        """
        pill = page.query_selector("button[aria-label='Pemicu setelan']")
        if not pill:
            self.dbg.log("Pill settings trigger not found, using current default.", level="WARN")
            return

        pill_text = (pill.text_content() or "").lower()
        needs_ratio = "16_9" not in pill_text and "16:9" not in pill_text
        needs_count = f"x{self.count}" not in pill_text

        if not needs_ratio and not needs_count:
            self.dbg.log(f"Settings already matched: {pill_text.strip()}")
            return

        self.dbg.log(f"Configuring settings: ratio={self.ratio}, count=x{self.count}...")
        pill.click()
        time.sleep(1.5)

        try:
            # Aspect ratio
            if needs_ratio:
                ratio_btn = page.query_selector(f"button:has-text('{self.ratio}')")
                if ratio_btn:
                    ratio_btn.click()
                    time.sleep(0.5)

            # Count
            count_btn = page.query_selector(f"button:has-text('x{self.count}')")
            if count_btn:
                count_btn.click()
                time.sleep(0.5)
        except Exception as e:
            self.dbg.log(f"Error configuring popover buttons: {e}", level="WARN")
        finally:
            page.keyboard.press("Escape")
            time.sleep(1)

    def _download_image(self, context, image_url: str, dest_path: Path) -> bool:
        """
        Download high-res image using context request or signed URL.
        """
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        
        # 1. First try direct urllib request (works great for flow-content.google signed URLs)
        if "flow-content.google" in image_url or "Signature=" in image_url:
            try:
                req = urllib.request.Request(
                    image_url,
                    headers={
                        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                        "Referer": "https://flow.google.com/",
                    },
                )
                with urllib.request.urlopen(req, timeout=30) as resp:
                    data = resp.read()
                    if len(data) > 1000:
                        with open(dest_path, "wb") as f:
                            f.write(data)
                        self.dbg.log(f"Downloaded via signed URL ({len(data)} bytes) to {dest_path}")
                        return True
            except Exception as e:
                self.dbg.log(f"Direct signed download failed: {e}, falling back to context.request", level="DEBUG")

        # 2. Fallback to Camoufox context.request (attaches session cookies for /asb/ URLs)
        try:
            resp = context.request.get(image_url)
            if resp.status == 200 and len(resp.body()) > 1000:
                with open(dest_path, "wb") as f:
                    f.write(resp.body())
                self.dbg.log(f"Downloaded via context.request ({len(resp.body())} bytes) to {dest_path}")
                return True
            else:
                self.dbg.log(f"context.request returned status {resp.status}", level="WARN")
        except Exception as e:
            self.dbg.log(f"context.request error: {e}", level="ERROR")

        return False

    def generate_single_prompt(
        self,
        context,
        page,
        prompt_text: str,
        dest_filename: str,
        scene_id: int = 1,
    ) -> Optional[Dict[str, Any]]:
        """
        Generate a single prompt and download the resulting image.
        """
        print(f"[ITEM_START] {scene_id}", flush=True)
        print(f"[ITEM_PROMPT] {scene_id} | {prompt_text[:120]}...", flush=True)
        self.dbg.log(f"Generating scene #{scene_id}...")

        dest_path = self.output_dir / dest_filename
        
        # Collect existing image URLs currently in the workspace to differentiate the new one
        existing_urls = set()
        for t in page.query_selector_all("flow-image-tile"):
            img = t.query_selector("img")
            if img:
                src = img.get_attribute("src")
                if src:
                    existing_urls.add(src)

        initial_tile_count = len(page.query_selector_all("flow-image-tile"))

        # Find and focus textbox
        textbox = page.query_selector("div.ProseMirror")
        if not textbox:
            print(f"[ITEM_ERROR] {scene_id} | Textbox div.ProseMirror tidak ditemukan", flush=True)
            return None

        textbox.click()
        time.sleep(0.3)

        # Clear existing text
        page.keyboard.press("Control+A")
        page.keyboard.press("Backspace")
        time.sleep(0.3)

        # Type new prompt
        page.keyboard.insert_text(prompt_text)
        time.sleep(0.8)

        # Click submit button
        submit_btn = page.query_selector("button[aria-label='Mulai pembuatan']")
        if submit_btn:
            submit_btn.click()
        else:
            page.keyboard.press("Enter")

        print(f"[ITEM_GENERATING] {scene_id}", flush=True)
        self.dbg.log(f"Scene #{scene_id} prompt submitted. Waiting for generation...")

        # Poll for new image tile and loaded image URL
        new_img_url = None
        start_time = time.time()

        while time.time() - start_time < self.timeout_per_image:
            time.sleep(2.5)
            tiles = page.query_selector_all("flow-image-tile")

            for t in tiles:
                img = t.query_selector("img.image, img[src*='flow-content'], img[src*='/asb/']")
                if img:
                    src = img.get_attribute("src") or ""
                    # Check if valid image URL and not seen before
                    if (
                        src
                        and ("flow-content.google" in src or "/asb/" in src)
                        and "blob:" not in src
                        and src not in existing_urls
                    ):
                        new_img_url = src
                        break

            if new_img_url:
                break

        if not new_img_url:
            msg = f"Timeout ({self.timeout_per_image}s) menunggu hasil gambar dari Google Flow."
            self.dbg.log(msg, level="ERROR")
            print(f"[ITEM_ERROR] {scene_id} | {msg}", flush=True)
            return None

        self.dbg.log(f"Scene #{scene_id} generated image URL: {new_img_url}")

        # Download image
        success = self._download_image(context, new_img_url, dest_path)
        if not success:
            msg = "Gagal mengunduh file gambar dari URL Google Flow."
            print(f"[ITEM_ERROR] {scene_id} | {msg}", flush=True)
            return None

        file_size = dest_path.stat().st_size
        print(f"[ITEM_SUCCESS] {scene_id} | {new_img_url} | {dest_path.resolve()}", flush=True)
        self.dbg.log(f"Scene #{scene_id} SUCCESS saved ({file_size} bytes)")

        return {
            "scene_number": scene_id,
            "prompt": prompt_text,
            "image_url": new_img_url,
            "image_path": str(dest_path.resolve()),
            "file_size": file_size,
        }

    def run_batch(
        self,
        prompts_file: str = "input/faceless/visual_prompts.json",
        scenes_filter: Optional[List[int]] = None,
        overwrite: bool = False,
        concurrency: int = 5,
    ) -> List[Dict[str, Any]]:
        """
        Run generation for a batch of prompts loaded from JSON with multi-tab concurrency.
        """
        prompts_path = Path(prompts_file)
        if not prompts_path.is_absolute() and not prompts_path.exists():
            prompts_path = PROJECT_ROOT / prompts_path
        if not prompts_path.exists():
            raise FileNotFoundError(f"File prompt tidak ditemukan: {prompts_file}")

        with open(prompts_path, "r", encoding="utf-8") as f:
            items = json.load(f)

        if not isinstance(items, list):
            raise ValueError(f"Isi file {prompts_file} harus berupa array JSON.")

        # Filter items
        filtered_items = []
        for it in items:
            idx = it.get("index") or it.get("scene_number") or it.get("id")
            try:
                idx_num = int(idx)
            except:
                idx_num = len(filtered_items) + 1

            if scenes_filter and idx_num not in scenes_filter:
                continue

            filtered_items.append({
                "index": idx_num,
                "prompt": it.get("finalPrompt") or it.get("prompt") or it.get("image_prompt") or "",
                "timecode": it.get("timecode", ""),
                "narration": it.get("narration", ""),
            })

        if not filtered_items:
            print("[INFO] Tidak ada scene yang perlu diproses.", flush=True)
            return []

        # Separate items needing generation vs cached
        results = []
        to_process = []
        for item in filtered_items:
            scene_num = item["index"]
            dest_filename = f"scene_{int(scene_num):03d}.jpg"
            dest_path = self.output_dir / dest_filename

            if not overwrite and dest_path.exists() and dest_path.stat().st_size > 5000:
                print(f"[ITEM_SKIP] {scene_num} | Gambar sudah ada di disk ({dest_path.name})", flush=True)
                results.append({
                    "scene_number": scene_num,
                    "image_path": str(dest_path.resolve()),
                    "status": "cached",
                })
            elif item["prompt"].strip():
                to_process.append((item, dest_path, dest_filename))
            else:
                print(f"[ITEM_ERROR] {scene_num} | Teks prompt kosong", flush=True)

        if not to_process:
            print(f"[BATCH_COMPLETE] Semua {len(results)} adegan sudah memiliki gambar di disk.", flush=True)
            return results

        num_workers = max(1, min(concurrency, len(to_process), 5))
        print(
            f"[BATCH_START] Memulai automasi Google Flow untuk {len(to_process)} adegan ({num_workers} tab paralel / konkuren)...",
            flush=True,
        )

        with open_camoufox_profile(self.email, headless=self.headless, humanize=True) as context:
            # Initialize worker tabs
            tabs = []
            for w_idx in range(num_workers):
                page = context.pages[0] if (w_idx == 0 and context.pages) else context.new_page()
                print(f"[TAB_SETUP] Menyiapkan Tab {w_idx + 1}/{num_workers} di Google Flow...", flush=True)
                self._ensure_project(page, force_new=(w_idx > 0))
                self._configure_settings(page)
                tabs.append({
                    "id": w_idx + 1,
                    "page": page,
                    "busy": False,
                    "current_item": None,
                    "dest_path": None,
                    "existing_urls": set(),
                    "start_time": 0,
                })

            queue_items = list(to_process)
            total_count = len(filtered_items)
            completed_count = len(results)

            while queue_items or any(tab["busy"] for tab in tabs):
                # 1. Assign next items to any idle tabs
                for tab in tabs:
                    if not tab["busy"] and queue_items:
                        item, dest_path, dest_filename = queue_items.pop(0)
                        page = tab["page"]
                        scene_num = item["index"]
                        prompt_text = item["prompt"]

                        print(f"[ITEM_START] {scene_num}", flush=True)
                        print(f"[ITEM_PROMPT] {scene_num} | [Tab {tab['id']}] {prompt_text[:120]}...", flush=True)
                        self.dbg.log(f"[Tab {tab['id']}] Generating scene #{scene_num}...")

                        # Collect existing image URLs on this tab's canvas
                        existing_urls = set()
                        for t in page.query_selector_all("flow-image-tile img"):
                            src = t.get_attribute("src") or ""
                            if src:
                                existing_urls.add(src)

                        # Focus and type prompt
                        textbox = page.query_selector("div.ProseMirror")
                        if textbox:
                            textbox.click()
                            page.keyboard.press("Control+A")
                            page.keyboard.press("Backspace")
                            time.sleep(0.2)
                            page.keyboard.insert_text(prompt_text)
                            time.sleep(0.4)
                            submit_btn = page.query_selector("button[aria-label='Mulai pembuatan']")
                            if submit_btn:
                                submit_btn.click()
                            else:
                                page.keyboard.press("Enter")

                            print(f"[ITEM_GENERATING] {scene_num}", flush=True)
                            tab["busy"] = True
                            tab["current_item"] = item
                            tab["dest_path"] = dest_path
                            tab["existing_urls"] = existing_urls
                            tab["start_time"] = time.time()
                            time.sleep(1.0)
                        else:
                            print(
                                f"[ITEM_ERROR] {scene_num} | Textbox div.ProseMirror tidak ditemukan di Tab {tab['id']}",
                                flush=True,
                            )

                # 2. Check busy tabs for finished images
                for tab in tabs:
                    if tab["busy"]:
                        page = tab["page"]
                        item = tab["current_item"]
                        dest_path = tab["dest_path"]
                        scene_num = item["index"]
                        new_img_url = None

                        for t in page.query_selector_all("flow-image-tile"):
                            img = t.query_selector("img.image, img[src*='flow-content'], img[src*='/asb/']")
                            if img:
                                src = img.get_attribute("src") or ""
                                if (
                                    src
                                    and ("flow-content.google" in src or "/asb/" in src)
                                    and "blob:" not in src
                                    and src not in tab["existing_urls"]
                                ):
                                    new_img_url = src
                                    break

                        if new_img_url:
                            elapsed = int(time.time() - tab["start_time"])
                            self.dbg.log(
                                f"[Tab {tab['id']}] Scene #{scene_num} finished in {elapsed}s: {new_img_url}"
                            )
                            success = self._download_image(context, new_img_url, dest_path)
                            if success:
                                file_size = dest_path.stat().st_size
                                print(
                                    f"[ITEM_SUCCESS] {scene_num} | {new_img_url} | {dest_path.resolve()}",
                                    flush=True,
                                )
                                res_entry = {
                                    "scene_number": scene_num,
                                    "prompt": item["prompt"],
                                    "image_url": new_img_url,
                                    "image_path": str(dest_path.resolve()),
                                    "file_size": file_size,
                                }
                                results.append(res_entry)
                                self._update_json_record(
                                    prompts_path, scene_num, res_entry["image_path"], res_entry["image_url"]
                                )
                            else:
                                print(f"[ITEM_ERROR] {scene_num} | Gagal mengunduh file gambar", flush=True)

                            completed_count += 1
                            percent = int((completed_count / total_count) * 100)
                            print(f"[PROGRESS] {completed_count}/{total_count} ({percent}%)", flush=True)

                            # Free tab to accept next item
                            tab["busy"] = False
                            tab["current_item"] = None
                            tab["dest_path"] = None

                        elif time.time() - tab["start_time"] > self.timeout_per_image:
                            msg = f"Timeout ({self.timeout_per_image}s) menunggu hasil adegan #{scene_num}"
                            print(f"[ITEM_ERROR] {scene_num} | {msg}", flush=True)
                            completed_count += 1
                            percent = int((completed_count / total_count) * 100)
                            print(f"[PROGRESS] {completed_count}/{total_count} ({percent}%)", flush=True)

                            tab["busy"] = False
                            tab["current_item"] = None
                            tab["dest_path"] = None

                time.sleep(2)

        print(
            f"[BATCH_COMPLETE] Selesai! Berhasil memproses {len(results)}/{len(filtered_items)} gambar.",
            flush=True,
        )
        return results

    def _update_json_record(self, json_path: Path, scene_index: int, image_path: str, image_url: str):
        """Update scene record in visual_prompts.json with the generated image path."""
        try:
            p_resolved = json_path if json_path.is_absolute() else (PROJECT_ROOT / json_path)
            with open(p_resolved, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, list):
                for item in data:
                    idx = item.get("index") or item.get("scene_number")
                    if idx == scene_index:
                        item["image_path"] = str(image_path)
                        item["image_url"] = str(image_url)
                with open(p_resolved, "w", encoding="utf-8") as f:
                    json.dump(data, f, indent=2, ensure_ascii=False)
        except Exception as e:
            self.dbg.log(f"Warning updating json record: {e}", level="WARN")


def main():
    parser = argparse.ArgumentParser(
        description="Google Flow (Nano Banana 2.1) Image Generation Automation via Camoufox."
    )
    parser.add_argument("--email", default="jovangithub@gmail.com", help="Google profile email to use")
    parser.add_argument("--project-url", default=None, help="Direct Flow project URL (optional)")
    parser.add_argument("--prompt", default=None, help="Generate single image with this prompt")
    parser.add_argument("--scene-id", type=int, default=None, help="Scene index number for single prompt or filtering")
    parser.add_argument("--output", default="input/faceless/images/single_test.jpg", help="Output file for single prompt")
    parser.add_argument("--input-json", default="input/faceless/visual_prompts.json", help="Path to visual_prompts.json")
    parser.add_argument("--output-dir", default="input/faceless/images", help="Directory to save downloaded images")
    parser.add_argument("--range", default=None, help="Range of scenes to process (e.g. 1-5 or 1,2,3)")
    parser.add_argument("--concurrency", "--batch-processes", type=int, default=5, dest="concurrency", help="Number of concurrent worker tabs (default 5, up to 5)")
    parser.add_argument("--headless", action="store_true", default=True, help="Run headless (default True)")
    parser.add_argument("--headed", action="store_false", dest="headless", help="Run headed (show browser window)")
    parser.add_argument("--overwrite", action="store_true", help="Overwrite existing images")

    args = parser.parse_args()

    # Parse scene numbers
    scenes_filter = None
    if args.scene_id is not None:
        scenes_filter = [args.scene_id]
    elif args.range:
        scenes_filter = []
        for part in args.range.split(","):
            part = part.strip()
            if "-" in part:
                s, e = part.split("-")
                scenes_filter.extend(range(int(s), int(e) + 1))
            elif part.isdigit():
                scenes_filter.append(int(part))

    generator = GoogleFlowGenerator(
        email=args.email,
        project_url=args.project_url,
        headless=args.headless,
        output_dir=args.output_dir,
    )

    if args.prompt:
        # Single prompt test
        sid = args.scene_id or 1
        out_name = f"scene_{sid:03d}.jpg" if args.scene_id else Path(args.output).name
        print(f"[*] Menjalankan test single prompt adegan #{sid} dengan akun {args.email}...")
        with open_camoufox_profile(args.email, headless=args.headless, humanize=True) as context:
            page = context.pages[0] if context.pages else context.new_page()
            generator._ensure_project(page)
            generator._configure_settings(page)
            res = generator.generate_single_prompt(
                context=context,
                page=page,
                prompt_text=args.prompt,
                dest_filename=out_name,
                scene_id=sid,
            )
            if res:
                print(f"[✓] Berhasil! Gambar tersimpan di: {res['image_path']}")
                if args.input_json:
                    generator._update_json_record(Path(args.input_json), sid, res["image_path"], res["image_url"])
            else:
                sys.exit(1)
    else:
        # Batch from JSON with multi-tab concurrency
        print(f"[*] Menjalankan batch runner dari: {args.input_json} (konkurensi: {args.concurrency} tab)...")
        results = generator.run_batch(
            prompts_file=args.input_json,
            scenes_filter=scenes_filter,
            overwrite=args.overwrite,
            concurrency=args.concurrency,
        )
        print(f"[✓] Selesai memproses {len(results)} gambar.")


if __name__ == "__main__":
    main()
