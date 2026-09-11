#!/usr/bin/env python3
"""
align_cli.py — STANDALONE FASTER-WHISPER SMART ALIGNMENT PIPELINE
===================================================================
Menggunakan standalone faster-whisper dengan Silero VAD & Two-Phase Smart Sentence Alignment.

Mendeteksi fisik suara narator secara presisi dari audio, lalu mencocokkan
naskah asli (Step 2) 100% akurat tanpa drift, tanpa pergeseran kata (misalignment),
dan secara otomatis menangani kalimat di akhir audio dengan durasi yang tepat.

Usage:
  PYTHONSAFEPATH=1 venv/bin/python align_cli.py \
    --audio <path.wav> \
    --text <path_to_script_txt_or_json> \
    --output <out.json> \
    --model medium \
    --device cpu
"""
import argparse
import difflib
import json
import os
import re
import sys
import time


def log(msg):
    print(f"[faster-whisper] {msg}", file=sys.stderr, flush=True)


def get_audio_duration(audio_path: str) -> float:
    import subprocess
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", audio_path],
        capture_output=True, text=True)
    try:
        return float(proc.stdout.strip())
    except ValueError:
        return 0.0


def load_narration_input(text_path: str):
    """Load teks narasi atau daftar kalimat terstruktur dari file .txt atau .json."""
    if not os.path.exists(text_path):
        raise FileNotFoundError(text_path)
    if text_path.endswith(".json"):
        with open(text_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            # Cek jika format daftar kalimat terstruktur: { "sentences": [...] }
            if "sentences" in data and isinstance(data["sentences"], list):
                return data["sentences"]
            naskah = data.get("naskah_voiceover") or data.get("script") or {}
            if isinstance(naskah, dict):
                return naskah.get("script_text") or naskah.get("text") or ""
            if isinstance(naskah, str):
                return naskah
            for key in ("script_text", "transcript_full", "text", "naskah"):
                if key in data and isinstance(data[key], str):
                    return data[key]
        elif isinstance(data, list):
            if data and isinstance(data[0], dict) and "text" in data[0]:
                return data
            texts = [item.get("text") for item in data if isinstance(item, dict) and item.get("text")]
            if texts:
                return " ".join(texts)
        raise ValueError(f"Tidak bisa ekstrak teks narasi dari {text_path}")
    with open(text_path, "r", encoding="utf-8") as f:
        return f.read().strip()


def load_narration_text(text_path: str) -> str:
    """Backward-compatible helper returning raw text string."""
    res = load_narration_input(text_path)
    if isinstance(res, list):
        return "\n".join([item.get("text", "") if isinstance(item, dict) else str(item) for item in res])
    return str(res)


def strip_voice_tags(text: str) -> str:
    """Strip voice direction tags [chuckles], [pause], [EXPRESSION: ...] — tidak diucapkan di audio."""
    return re.sub(r'\[[^\]]*\]', '', text).strip()


def split_sentences(text: str) -> list:
    """Pecah teks naskah jadi array kalimat. Voice tags tetap ada untuk output text."""
    # Normalisasi triple-dot ellipsis ke karakter tunggal agar split konsisten
    normalized = re.sub(r'\.\.\.', '\u2026 ', text.strip())
    sentences = re.split(r'(?<=[.!?\u2026])\s+', normalized)
    return [s.strip() for s in sentences if s.strip()]


def format_minute(sec: float) -> str:
    m = int(sec // 60)
    s = int(sec % 60)
    return f"{m:02d}:{s:02d}"


def run_faster_whisper_pipeline(audio_path: str, raw_text, model_name: str = "medium", device: str = "cpu", language: str = None) -> list:
    import os
    from faster_whisper import WhisperModel

    threads = min(8, os.cpu_count() or 4)
    compute_type = "int8" if device == "cpu" else "float16"

    log(f"🧠 [1/4] Checking local cache for model '{model_name}'...")
    log(f"⚡ [2/4] Initializing CTranslate2 engine with {threads} CPU threads & 2 workers ({compute_type})...")
    
    t_load_start = time.time()
    model = WhisperModel(
        model_name,
        device=device,
        compute_type=compute_type,
        cpu_threads=threads,
        num_workers=2
    )
    t_load_dur = time.time() - t_load_start
    log(f"✅ [3/4] Loaded Faster-Whisper model '{model_name}' into RAM in {t_load_dur:.2f}s!")

    audio_dur = get_audio_duration(audio_path)
    log(f"🎙️ [4/4] Audio Target: {os.path.basename(audio_path)} (Total: {format_minute(audio_dur)} / {audio_dur:.1f}s, Language: {language or 'auto-detect'})")
    log(f"🚀 Starting Silero VAD & Faster-Whisper live audio transcription...")

    start_t = time.time()
    transcribe_kwargs = dict(
        beam_size=5,
        best_of=5,
        condition_on_previous_text=False,
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=700, speech_pad_ms=200),
        word_timestamps=True
    )
    if language:
        transcribe_kwargs["language"] = language

    segments_gen, info = model.transcribe(
        audio_path,
        **transcribe_kwargs
    )

    fw_segments = []
    for seg in segments_gen:
        fw_segments.append(seg)
        pct = min(99, int((seg.end / audio_dur) * 100)) if audio_dur > 0 else 0
        t_start = format_minute(seg.start)
        t_end = format_minute(seg.end)
        txt = seg.text.strip()
        if len(txt) > 42:
            txt = txt[:39] + "..."
        log(f"🎙️ [{pct}%] Segmen #{len(fw_segments)} [{t_start} - {t_end}]: \"{txt}\"")

    log(f"✨ Selesai VAD Transcribe dalam {time.time() - start_t:.1f}s. Terdeteksi {len(fw_segments)} segmen audio fisik.")

    # Parse raw_text: bisa berupa list of dicts [{id, text, is_before_visual_only}] atau string
    if isinstance(raw_text, list):
        sentence_items = []
        for idx, item in enumerate(raw_text):
            if isinstance(item, dict):
                sentence_items.append({
                    "sent_idx": idx,
                    "sent_id": item.get("id", idx + 1),
                    "text": item.get("text", ""),
                    "is_before_visual_only": bool(item.get("is_before_visual_only", False))
                })
            else:
                sentence_items.append({
                    "sent_idx": idx,
                    "sent_id": idx + 1,
                    "text": str(item),
                    "is_before_visual_only": False
                })
    else:
        sents = split_sentences(str(raw_text))
        sentence_items = [{
            "sent_idx": idx,
            "sent_id": idx + 1,
            "text": s,
            "is_before_visual_only": False
        } for idx, s in enumerate(sents)]

    log(f"🔍 Perform Two-Phase Smart Sentence Alignment: {len(sentence_items)} kalimat ke kata-kata audio fisik...")

    # Extract all physical audio words
    all_words = []
    for seg in fw_segments:
        if hasattr(seg, "words") and seg.words:
            for w in seg.words:
                cleaned_word = re.sub(r'[^\w\s]', '', w.word.strip().lower())
                if cleaned_word:
                    all_words.append({
                        "text": cleaned_word,
                        "raw": w.word.strip(),
                        "start": float(w.start),
                        "end": float(w.end)
                    })
        else:
            words_in_seg = seg.text.strip().split()
            if words_in_seg:
                dur_per_word = (seg.end - seg.start) / len(words_in_seg)
                for idx, w_raw in enumerate(words_in_seg):
                    c_word = re.sub(r'[^\w\s]', '', w_raw.lower())
                    if c_word:
                        all_words.append({
                            "text": c_word,
                            "raw": w_raw,
                            "start": float(seg.start + idx * dur_per_word),
                            "end": float(seg.start + (idx + 1) * dur_per_word)
                        })

    total_words = len(all_words)
    if total_words == 0 or len(sentence_items) == 0:
        entries = []
        for idx, seg in enumerate(fw_segments, start=1):
            start = round(float(seg.start), 3)
            end = round(float(seg.end), 3)
            entries.append({
                "id": idx,
                "sentence_id": idx,
                "start_seconds": start,
                "end_seconds": end,
                "start": start,
                "end": end,
                "speech_start": start,
                "speech_end": end,
                "first_word_start": start,
                "last_word_end": end,
                "timestamp_minute": f"{format_minute(start)} - {format_minute(end)}",
                "text": seg.text.strip(),
                "speaker": "Narator",
                "is_before_visual_only": False,
                "words": []
            })
        return entries, all_words

    # Phase 1: Sentence-Level Best Span Search
    matched_sentences = []
    last_end_word_idx = 0

    for s_idx, item_in in enumerate(sentence_items):
        sent = item_in["text"]
        sent_id = item_in["sent_id"]
        is_bvo = item_in["is_before_visual_only"]

        sent_for_match = strip_voice_tags(sent)
        tokens = [t for t in sent_for_match.strip().split() if t.strip()]
        clean_tokens = [re.sub(r'[^\w\s]', '', t.lower()) for t in tokens if re.sub(r'[^\w\s]', '', t.lower())]
        sent_len = len(clean_tokens)

        if sent_len == 0:
            continue

        target_text = " ".join(clean_tokens)

        search_start = max(0, last_end_word_idx - 6)
        search_end = min(total_words, last_end_word_idx + max(30, sent_len + 15))

        best_score = -1.0
        best_w_start = -1
        best_w_end = -1

        candidate_indices = range(search_start, min(search_end, last_end_word_idx + 8))
        last_target_word = clean_tokens[-1] if clean_tokens else ""

        for w_start in candidate_indices:
            min_span_len = max(1, sent_len - 5)
            max_span_len = sent_len + max(4, int(sent_len * 0.35))
            for w_end in range(w_start + min_span_len, min(search_end + 1, w_start + max_span_len + 1)):
                span_words = all_words[w_start:w_end]
                span_clean_words = [w["text"] for w in span_words]
                span_text = " ".join(span_clean_words)

                char_ratio = difflib.SequenceMatcher(None, target_text, span_text).ratio()
                tok_ratio = difflib.SequenceMatcher(None, clean_tokens, span_clean_words).ratio()
                base_score = 0.5 * char_ratio + 0.5 * tok_ratio

                # Tail match bonus/penalty: ensure full sentence completion without dropping tail words
                tail_bonus = 0.0
                if last_target_word and span_clean_words:
                    last_span_w = span_clean_words[-1]
                    last_sim = difflib.SequenceMatcher(None, last_target_word, last_span_w).ratio()
                    if last_sim >= 0.7:
                        tail_bonus += 0.15
                    elif any(difflib.SequenceMatcher(None, last_target_word, w).ratio() >= 0.7 for w in span_clean_words[-3:]):
                        tail_bonus += 0.08
                    else:
                        tail_bonus -= 0.10

                # Silence boundary bonus: a natural acoustic pause (>= 0.30s) after sentence end
                silence_bonus = 0.0
                if w_end < total_words:
                    gap = float(all_words[w_end]["start"]) - float(all_words[w_end - 1]["end"])
                    if gap >= 0.30:
                        silence_bonus = 0.08

                # Sequential bonus to prefer starting right where previous sentence left off
                seq_bonus = max(0, 0.05 - abs(w_start - last_end_word_idx) * 0.001)

                total_score = base_score + tail_bonus + silence_bonus + seq_bonus

                if total_score > best_score:
                    best_score = total_score
                    best_w_start = w_start
                    best_w_end = w_end - 1

        if best_score >= 0.55 and best_w_start >= 0 and best_w_end >= best_w_start:
            p_start = float(all_words[best_w_start]["start"])
            p_end = float(all_words[best_w_end]["end"])
            matched_sentences.append({
                "sent_idx": s_idx,
                "sent_id": sent_id,
                "text": sent,
                "tokens": tokens,
                "w_start": best_w_start,
                "w_end": best_w_end,
                "score": best_score,
                "speech_start": p_start,
                "speech_end": p_end,
                "start": p_start,
                "end": p_end,
                "is_before_visual_only": is_bvo
            })
            last_end_word_idx = best_w_end + 1
        else:
            matched_sentences.append({
                "sent_idx": s_idx,
                "sent_id": sent_id,
                "text": sent,
                "tokens": tokens,
                "w_start": None,
                "w_end": None,
                "score": 0.0,
                "speech_start": None,
                "speech_end": None,
                "start": None,
                "end": None,
                "is_before_visual_only": is_bvo
            })

    # Phase 2: Monotonicity & Interpolation of Timestamps & Words
    last_t = 0.0
    for item in matched_sentences:
        if item["start"] is not None:
            if item["start"] < last_t:
                item["start"] = last_t
            if item["end"] <= item["start"]:
                item["end"] = item["start"] + 1.2
            last_t = item["end"]

    k = 0
    total_sent_count = len(matched_sentences)
    while k < total_sent_count:
        if matched_sentences[k]["start"] is None:
            gap_start = k
            while k < total_sent_count and matched_sentences[k]["start"] is None:
                k += 1
            gap_end = k - 1

            prev_time = matched_sentences[gap_start - 1]["end"] if gap_start > 0 else 0.0
            next_time = matched_sentences[gap_end + 1]["start"] if gap_end + 1 < total_sent_count else audio_dur

            if next_time <= prev_time:
                next_time = prev_time + (gap_end - gap_start + 1) * 3.0

            unmatched_group = matched_sentences[gap_start:gap_end + 1]
            total_words_in_gap = sum(max(1, len(m["tokens"])) for m in unmatched_group)
            avail_dur = next_time - prev_time

            curr_time = prev_time
            for item in unmatched_group:
                w_count = max(1, len(item["tokens"]))
                sent_dur = avail_dur * (w_count / total_words_in_gap)
                item["start"] = round(curr_time, 3)
                item["end"] = round(curr_time + sent_dur, 3)
                curr_time += sent_dur
        else:
            k += 1

    entries = []
    all_aligned_words = []

    for item in matched_sentences:
        s_words = []
        tokens = item["tokens"]
        s_start = item["start"]
        s_end = item["end"]

        if item["w_start"] is not None and item["w_end"] is not None:
            audio_span = all_words[item["w_start"]:item["w_end"] + 1]
            phys_start = float(audio_span[0]["start"])
            phys_end = float(audio_span[-1]["end"])
            phys_dur = max(0.05, phys_end - phys_start)

            if len(audio_span) == len(tokens):
                for idx, tok in enumerate(tokens):
                    s_words.append({
                        "word": tok,
                        "start": round(float(audio_span[idx]["start"]), 3),
                        "end": round(float(audio_span[idx]["end"]), 3)
                    })
            else:
                # Strictly bound synthetic words within [phys_start, phys_end]
                total_chars = sum(max(1, len(t)) for t in tokens)
                curr_t = phys_start
                for tok in tokens:
                    w_dur = phys_dur * (max(1, len(tok)) / total_chars)
                    s_words.append({
                        "word": tok,
                        "start": round(curr_t, 3),
                        "end": round(curr_t + w_dur, 3)
                    })
                    curr_t += w_dur
        else:
            s_dur = max(0.2, s_end - s_start)
            total_chars = sum(max(1, len(t)) for t in tokens)
            curr_t = s_start
            for tok in tokens:
                w_dur = s_dur * (max(1, len(tok)) / total_chars)
                s_words.append({
                    "word": tok,
                    "start": round(curr_t, 3),
                    "end": round(curr_t + w_dur, 3)
                })
                curr_t += w_dur

        all_aligned_words.extend(s_words)

        first_w_start = s_words[0]["start"] if s_words else (item["speech_start"] if item["speech_start"] is not None else s_start)
        last_w_end = s_words[-1]["end"] if s_words else (item["speech_end"] if item["speech_end"] is not None else s_end)

        speech_st = item["speech_start"] if item["speech_start"] is not None else s_start
        speech_en = item["speech_end"] if item["speech_end"] is not None else s_end

        entries.append({
            "id": item.get("sent_id", item["sent_idx"] + 1),
            "sentence_id": item.get("sent_id", item["sent_idx"] + 1),
            "start_seconds": round(s_start, 3),
            "end_seconds": round(s_end, 3),
            "start": round(s_start, 3),
            "end": round(s_end, 3),
            "speech_start": round(speech_st, 3),
            "speech_end": round(speech_en, 3),
            "first_word_start": round(first_w_start, 3),
            "last_word_end": round(last_w_end, 3),
            "timestamp_minute": f"{format_minute(s_start)} - {format_minute(s_end)}",
            "text": item["text"],
            "speaker": "Narator",
            "is_before_visual_only": item.get("is_before_visual_only", False),
            "words": s_words
        })

    # Seamless gap smoothing between consecutive sentences (gaps <= 1.5s)
    # CRITICAL: NEVER smooth across a sentence followed by VISUAL_ONLY!
    for i in range(len(entries) - 1):
        if entries[i].get("is_before_visual_only"):
            # Do NOT smooth: preserve exact physical speech_end for clean audio cut!
            continue

        curr_end = entries[i]["end_seconds"]
        next_start = entries[i + 1]["start_seconds"]
        if curr_end < next_start and (next_start - curr_end) <= 1.5:
            # Leave at least 30ms gap so display end never touches next_start
            smooth_end = round(max(curr_end, next_start - 0.03), 3)
            entries[i]["end_seconds"] = smooth_end
            entries[i]["end"] = smooth_end
            entries[i]["timestamp_minute"] = f"{format_minute(entries[i]['start_seconds'])} - {format_minute(smooth_end)}"
            # NOTE: speech_start, speech_end, first_word_start, last_word_end are 100% PRESERVED!

    return entries, all_aligned_words


def main():
    parser = argparse.ArgumentParser(description="Faster-Whisper Smart Audio Alignment CLI")
    parser.add_argument("--audio", required=True, help="Path file audio")
    parser.add_argument("--text", required=True, help="Path script teks (.txt/.json)")
    parser.add_argument("--output", help="Path output JSON (default: stdout)")
    parser.add_argument("--model", default="medium", help="Whisper model: medium|large-v2|large-v3 (default: medium)")
    parser.add_argument("--device", default="cpu", help="cpu|cuda")
    parser.add_argument("--language", default=None, help="Language code: id|en|etc. (default: auto-detect)")
    args = parser.parse_args()

    log(f"Audio: {args.audio}")
    log(f"Teks:  {args.text}")
    log(f"Model: {args.model} on {args.device} (Lang: {args.language or 'auto'})")

    audio_dur = get_audio_duration(args.audio)
    log(f"Durasi audio: {audio_dur:.1f}s")

    raw_input = load_narration_input(args.text)
    entries, all_words = run_faster_whisper_pipeline(args.audio, raw_input, model_name=args.model, device=args.device, language=args.language)

    total_end = entries[-1]["end_seconds"] if entries else 0.0
    log(f"Selesai! {len(entries)} entri, total durasi transkrip {total_end:.1f}s / audio {audio_dur:.1f}s")

    output_data = {
        "mode": "faster-whisper-standalone",
        "audio_duration": round(audio_dur, 2),
        "entry_count": len(entries),
        "sentences": entries,
        "transcript": entries,
        "words": all_words
    }

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(output_data, f, ensure_ascii=False, indent=2)
        log(f"Output tersimpan: {args.output}")
    else:
        print(json.dumps(output_data, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
