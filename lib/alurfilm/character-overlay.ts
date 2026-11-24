// lib/alurfilm/character-overlay.ts
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

export type CharacterOverlayPosition = 'left' | 'center' | 'right';

export interface CharacterOverlaySpec {
  name: string;
  role?: string;
  position?: CharacterOverlayPosition;
}

export interface CharacterRegistryItem {
  assigned_name: string;
  role?: string;
  visual_description?: string;
}

export interface TimelineSentenceSpan {
  sentenceIndex: number;
  text: string;
  start: number;
  end: number;
  isVisualOnly: boolean;
  characterOverlay?: CharacterOverlaySpec | null;
}

export interface PlannedNameOverlay {
  name: string;
  role: string;
  position: CharacterOverlayPosition;
  startSec: number;
  durationSec: number;
  sentenceIndex: number;
}

export interface RenderedNameOverlay extends PlannedNameOverlay {
  cardPath: string;
  x: number;
  y: number;
}

export function normalizeOverlayPosition(pos?: unknown): CharacterOverlayPosition {
  return pos === 'center' || pos === 'right' ? pos : 'left';
}

const HONORIFIC_PREFIXES = new Set([
  'pak', 'bapak', 'bu', 'ibu', 'tuan', 'nyonya', 'nona', 'bang', 'kak', 'mas', 'mbak', 'om', 'tante',
  'dokter', 'dr', 'prof', 'profesor', 'detektif', 'inspektur', 'kapten', 'letnan', 'kolonel',
  'mayor', 'sersan', 'agen', 'agent', 'mr', 'mrs', 'ms', 'miss', 'sir', 'lady', 'lord',
]);

const GENERIC_TOKENS = new Set([
  // Connectors & articles
  'di', 'yang', 'dari', 'ke', 'dan', 'atau', 'para', 'sang', 'si', 'the', 'of', 'in', 'with', 'at', 'on',
  // Generic person/gender nouns
  'pria', 'wanita', 'lelaki', 'perempuan', 'orang', 'anak', 'bocah', 'pemuda', 'pemudi', 'kakek', 'nenek',
  'bayi', 'sosok', 'tokoh', 'man', 'woman', 'boy', 'girl', 'guy', 'stranger', 'person', 'unknown', 'unnamed',
  // Relational descriptors
  'rekan', 'teman', 'sahabat', 'pacar', 'istri', 'suami', 'ayah', 'ibu', 'kakak', 'adik', 'anaknya',
  'ibunya', 'ayahnya', 'istrinya', 'suaminya', 'bos', 'majikan', 'bawahan', 'tangan', 'kanan', 'buah',
  'supir', 'sopir', 'pengawal', 'bodyguard', 'asisten', 'sekretaris', 'tetangga', 'keluarga', 'saudara',
  // Unnamed roles, occupations & groups
  'satpam', 'penjaga', 'polisi', 'tentara', 'prajurit', 'militer', 'pasukan', 'tim', 'regu', 'kelompok',
  'geng', 'kawanan', 'perampok', 'penjahat', 'pencuri', 'pembunuh', 'teroris', 'zombie', 'monster',
  'makhluk', 'korban', 'pasien', 'saksi', 'tersangka', 'perawat', 'suster', 'direktur', 'pimpinan',
  'ketua', 'kepala', 'komandan', 'pemimpin', 'penyelamat', 'pelayan', 'petugas', 'karyawan', 'pekerja',
  'pegawai', 'pedagang', 'penjual', 'pembeli', 'guru', 'murid', 'siswa', 'mahasiswa', 'wartawan',
  'reporter', 'hakim', 'jaksa', 'pengacara', 'ilmuwan', 'peneliti', 'pendeta', 'pastor', 'biksu',
  'raja', 'ratu', 'pangeran', 'putri', 'presiden', 'menteri', 'gubernur', 'walikota', 'warga',
  'penduduk', 'penumpang', 'tamu', 'investor', 'pengusaha', 'narator', 'rumah', 'sakit', 'kamar', 'rawat',
  'jenderal',
]);

function stripPunctuation(token: string): string {
  return token.replace(/^[.,;:!?()"'[\]]+|[.,;:!?()"'[\]]+$/g, '');
}

/**
 * Keep only actual personal character names (e.g. "Singh", "Rin", "Pak Vasu", "Dr. Park").
 * Reject generic descriptions/roles like "Satpam Rumah Sakit", "Rekan Singh", "Pria di Kamar Rawat".
 */
export function isProperCharacterName(rawName: string): boolean {
  const cleaned = rawName.trim().replace(/\s+/g, ' ');
  if (cleaned.length < 2 || cleaned.length > 32) return false;
  if (/[/:()[\]|]/.test(cleaned)) return false;

  const words = cleaned.split(' ').map(stripPunctuation).filter(Boolean);
  if (words.length === 0 || words.length > 3) return false;

  const lowerWords = words.map((w) => w.toLowerCase());

  // Strip optional leading honorific (e.g. "Pak Vasu" -> ["vasu"])
  let coreStart = 0;
  if (words.length >= 2 && HONORIFIC_PREFIXES.has(lowerWords[0])) {
    coreStart = 1;
  }

  const coreWords = words.slice(coreStart);
  const coreLower = lowerWords.slice(coreStart);
  if (coreWords.length === 0) return false;

  if (coreLower.every((w) => HONORIFIC_PREFIXES.has(w))) return false;

  for (let i = coreStart; i < lowerWords.length; i++) {
    if (GENERIC_TOKENS.has(lowerWords[i])) return false;
  }

  if (coreWords.every((w) => /^\d+$/.test(w) || w.length < 2)) return false;

  return true;
}

/**
 * Normalize character name for cross-part deduplication ("Pak Vasu" and "Vasu" map to "vasu").
 */
export function normalizeCharacterKey(rawName: string): string {
  const words = rawName.trim().split(/\s+/).map(stripPunctuation).filter(Boolean);
  const lower = words.map((w) => w.toLowerCase());
  const start = lower.length >= 2 && HONORIFIC_PREFIXES.has(lower[0]) ? 1 : 0;
  return lower.slice(start).join(' ');
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findNameMentionIndex(text: string, assignedName: string): number {
  const full = assignedName.trim();
  if (!full) return -1;
  const fullRe = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegex(full)}(?![\\p{L}\\p{N}_])`, 'iu');
  const mFull = fullRe.exec(text);
  if (mFull) return mFull.index;

  const core = normalizeCharacterKey(full);
  if (core && core !== full.toLowerCase() && core.length >= 3) {
    const coreRe = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegex(core)}(?![\\p{L}\\p{N}_])`, 'iu');
    const mCore = coreRe.exec(text);
    if (mCore) return mCore.index;
  }
  return -1;
}

/**
 * Resolve the matching analysis_part_XX.json file either from explicit path
 * or auto-inferred from the mapping or video chunk path.
 */
export function resolveAnalysisPath(opts: {
  explicitPath?: string;
  mappingPath: string;
  videoPath: string;
  cwd: string;
}): string | null {
  if (opts.explicitPath) {
    const resolved = path.isAbsolute(opts.explicitPath)
      ? opts.explicitPath
      : path.resolve(opts.cwd, opts.explicitPath);
    if (fs.existsSync(resolved)) return resolved;
  }

  const mapBase = path.basename(opts.mappingPath);
  const mapMatch = mapBase.match(/^(.+?)_mapping_part_(\d+)\.json$/i);
  if (mapMatch) {
    const candidate = path.join(path.dirname(opts.mappingPath), `${mapMatch[1]}_analysis_part_${mapMatch[2]}.json`);
    if (fs.existsSync(candidate)) return candidate;
  }

  const vidBase = path.basename(opts.videoPath);
  const vidMatch = vidBase.match(/^(.+?)_part_(\d+)\.[^.]+$/i);
  if (vidMatch) {
    const partStr = vidMatch[2].padStart(2, '0');
    const candidates = [
      path.join(opts.cwd, 'input', 'alurfilm', `${vidMatch[1]}_analysis_part_${partStr}.json`),
      path.join(path.dirname(opts.videoPath), '..', `${vidMatch[1]}_analysis_part_${partStr}.json`),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return path.resolve(c);
    }
  }

  return null;
}

/**
 * Load character registry for the current part and collect character keys
 * already introduced in earlier parts (1..N-1) from both sibling analyses and mappings.
 */
export function loadCharacterContext(
  analysisPath: string | null,
  mappingPath?: string,
): {
  characters: CharacterRegistryItem[];
  priorIntroduced: Set<string>;
} {
  let characters: CharacterRegistryItem[] = [];
  const priorIntroduced = new Set<string>();

  if (analysisPath && fs.existsSync(analysisPath)) {
    const raw = JSON.parse(fs.readFileSync(analysisPath, 'utf-8'));
    if (Array.isArray(raw?.character_registry)) {
      characters = raw.character_registry.filter((c: any) => c && typeof c.assigned_name === 'string');
    }
  }

  // Determine prefix, directory, and current part number from analysisPath or mappingPath
  const refPath = analysisPath || mappingPath;
  if (refPath) {
    const dir = path.dirname(refPath);
    const base = path.basename(refPath);
    const partMatch = base.match(/^(.+?)_(?:analysis|mapping)_part_(\d+)\.json$/i);

    if (partMatch) {
      const prefix = partMatch[1];
      const currentPart = parseInt(partMatch[2], 10);
      const padLen = partMatch[2].length;

      for (let p = 1; p < currentPart; p++) {
        const pStr = String(p).padStart(padLen, '0');

        // 1. Check prior part's mapping JSON for explicit character_overlay entries
        const prevMapPath = path.join(dir, `${prefix}_mapping_part_${pStr}.json`);
        if (fs.existsSync(prevMapPath)) {
          try {
            const prevMap = JSON.parse(fs.readFileSync(prevMapPath, 'utf-8'));
            if (Array.isArray(prevMap?.mappings)) {
              for (const m of prevMap.mappings) {
                const ovName = m?.character_overlay?.name;
                if (typeof ovName === 'string' && ovName.trim()) {
                  priorIntroduced.add(normalizeCharacterKey(ovName));
                }
              }
            }
          } catch { }
        }

        // 2. Check prior part's analysis JSON for narrated proper names
        const prevAnalysisPath = path.join(dir, `${prefix}_analysis_part_${pStr}.json`);
        if (fs.existsSync(prevAnalysisPath)) {
          try {
            const prev = JSON.parse(fs.readFileSync(prevAnalysisPath, 'utf-8'));
            const prevChars: CharacterRegistryItem[] = Array.isArray(prev?.character_registry) ? prev.character_registry : [];
            const prevScript: string = typeof prev?.naskah_voiceover?.script_text === 'string'
              ? prev.naskah_voiceover.script_text
              : '';

            for (const ch of prevChars) {
              if (!ch?.assigned_name || !isProperCharacterName(ch.assigned_name)) continue;
              if (!prevScript || findNameMentionIndex(prevScript, ch.assigned_name) !== -1) {
                priorIntroduced.add(normalizeCharacterKey(ch.assigned_name));
              }
            }
          } catch { }
        }
      }
    }
  }

  return { characters, priorIntroduced };
}

function pushScheduledOverlay(
  planned: PlannedNameOverlay[],
  opts: {
    name: string;
    role: string;
    position: CharacterOverlayPosition;
    sent: TimelineSentenceSpan;
    mentionRatio: number;
    singleHitInSentence: boolean;
    totalDur: number;
  },
): void {
  const { name, role, position, sent, mentionRatio, singleHitInSentence, totalDur } = opts;
  const sentDur = Math.max(0.2, sent.end - sent.start);
  const mentionSec = sent.start + mentionRatio * sentDur;

  // Pull overlay earlier when name falls near end of sentence so it stays on the character's shot
  let startSec = singleHitInSentence && mentionSec + 2.4 > sent.end
    ? Math.max(sent.start + 0.35, sent.end - 2.6)
    : Math.max(sent.start, mentionSec - 0.15);
  const defaultDur = 3.0;

  // Anti-collision stagger if previous overlay is still on screen
  if (planned.length > 0) {
    const prev = planned[planned.length - 1];
    const prevEnd = prev.startSec + prev.durationSec;
    if (startSec < prevEnd + 0.15) {
      const trimmedPrevDur = Math.max(1.7, Math.min(prev.durationSec, startSec - prev.startSec - 0.15));
      prev.durationSec = Number(trimmedPrevDur.toFixed(2));
      startSec = Math.max(startSec, prev.startSec + prev.durationSec + 0.15);
    }
  }

  const maxRemaining = totalDur - startSec - 0.2;
  if (maxRemaining < 1.2) return;

  const durationSec = Number(Math.min(defaultDur, maxRemaining).toFixed(2));
  planned.push({
    name,
    role,
    position,
    startSec: Number(startSec.toFixed(2)),
    durationSec,
    sentenceIndex: sent.sentenceIndex,
  });
}

/**
 * Schedule 1x-per-film overlays:
 *  - Priority 1: Explicit `character_overlay` fields authored in visual mapping JSON (per-character position/role).
 *  - Fallback: Auto-detect first mentions from `analysis_part_XX.json` character_registry using `defaultPosition`.
 */
export function planCharacterOverlays(
  sentences: TimelineSentenceSpan[],
  characters: CharacterRegistryItem[],
  priorIntroduced: Set<string>,
  totalDur: number,
  defaultPosition: CharacterOverlayPosition = 'left',
): PlannedNameOverlay[] {
  const roleByKey = new Map<string, string>();
  for (const ch of characters) {
    if (!ch?.assigned_name) continue;
    const key = normalizeCharacterKey(ch.assigned_name);
    if (key && typeof ch.role === 'string' && ch.role.trim() && !roleByKey.has(key)) {
      roleByKey.set(key, ch.role.trim());
    }
  }

  const hasExplicitMappingOverlays = sentences.some(
    (s) => !s.isVisualOnly && s.characterOverlay && typeof s.characterOverlay.name === 'string' && s.characterOverlay.name.trim().length > 0,
  );

  const introducedHere = new Set<string>();
  const planned: PlannedNameOverlay[] = [];

  if (hasExplicitMappingOverlays) {
    for (const sent of sentences) {
      if (sent.isVisualOnly || !sent.characterOverlay?.name) continue;
      const name = sent.characterOverlay.name.trim();
      if (!isProperCharacterName(name)) continue;

      const key = normalizeCharacterKey(name);
      if (!key || priorIntroduced.has(key) || introducedHere.has(key)) continue;
      introducedHere.add(key);

      const role = (sent.characterOverlay.role || '').trim() || roleByKey.get(key) || '';
      const position = sent.characterOverlay.position
        ? normalizeOverlayPosition(sent.characterOverlay.position)
        : normalizeOverlayPosition(defaultPosition);
      const idx = sent.text ? findNameMentionIndex(sent.text, name) : -1;
      const ratio = idx !== -1 && sent.text ? idx / Math.max(1, sent.text.length) : 0.15;

      pushScheduledOverlay(planned, {
        name,
        role,
        position,
        sent,
        mentionRatio: ratio,
        singleHitInSentence: true,
        totalDur,
      });
    }
    return planned;
  }

  // Fallback mode: auto-detect proper names from character_registry
  const eligible: Array<{ key: string; name: string; role: string }> = [];
  const seenEligible = new Set<string>();

  for (const ch of characters) {
    const name = (ch.assigned_name || '').trim();
    if (!isProperCharacterName(name)) continue;
    const key = normalizeCharacterKey(name);
    if (!key || priorIntroduced.has(key) || seenEligible.has(key)) continue;
    seenEligible.add(key);
    eligible.push({
      key,
      name,
      role: typeof ch.role === 'string' ? ch.role.trim() : '',
    });
  }

  if (eligible.length === 0) return [];

  const resolvedDefaultPos = normalizeOverlayPosition(defaultPosition);

  for (const sent of sentences) {
    if (sent.isVisualOnly || !sent.text) continue;

    const hits: Array<{ char: typeof eligible[number]; idx: number }> = [];
    for (const char of eligible) {
      if (introducedHere.has(char.key)) continue;
      const idx = findNameMentionIndex(sent.text, char.name);
      if (idx !== -1) hits.push({ char, idx });
    }
    hits.sort((a, b) => a.idx - b.idx);

    for (const hit of hits) {
      introducedHere.add(hit.char.key);
      const ratio = hit.idx / Math.max(1, sent.text.length);
      pushScheduledOverlay(planned, {
        name: hit.char.name,
        role: hit.char.role,
        position: resolvedDefaultPos,
        sent,
        mentionRatio: ratio,
        singleHitInSentence: hits.length === 1,
        totalDur,
      });
    }
  }

  return planned;
}

/**
 * Render transparent Style-1 PNG cards in a single Python/Pillow batch invocation.
 * Each overlay card uses its own planned position (left, center, or right).
 */
export function generateCharacterOverlayCards(
  planned: PlannedNameOverlay[],
  outDir: string,
  cwd: string,
  fallbackPosition: CharacterOverlayPosition = 'left',
): Promise<RenderedNameOverlay[]> {
  if (planned.length === 0) return Promise.resolve([]);

  fs.mkdirSync(outDir, { recursive: true });
  const scriptPath = path.join(cwd, 'lib', 'alurfilm', 'render-name-card.py');
  const payload = planned.map((item, idx) => ({
    name: item.name,
    role: item.role,
    position: normalizeOverlayPosition(item.position ?? fallbackPosition),
    output_path: path.join(outDir, `char_${String(idx).padStart(3, '0')}.png`),
  }));

  return new Promise((resolve, reject) => {
    const child = spawn('python3', [scriptPath], { cwd });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', (err) => reject(new Error(`Failed to spawn render-name-card.py: ${err.message}`)));
    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`render-name-card.py exited ${code}: ${stderr.trim()}`));
      }
      try {
        const rendered = JSON.parse(stdout) as Array<{
          output_path: string;
          x: number;
          y: number;
          position?: CharacterOverlayPosition;
        }>;
        resolve(planned.map((item, idx) => ({
          ...item,
          cardPath: rendered[idx].output_path,
          x: rendered[idx].x,
          y: rendered[idx].y,
          position: normalizeOverlayPosition(rendered[idx].position ?? item.position ?? fallbackPosition),
        })));
      } catch (e: any) {
        reject(new Error(`Invalid JSON from render-name-card.py: ${e.message}`));
      }
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

/**
 * Append FFmpeg filter_complex nodes for Style-1 directional slide/rise + alpha fade overlays.
 */
export function appendCharacterOverlayFilters(
  overlays: Array<RenderedNameOverlay & { streamIndex: number }>,
  initialVideoLabel: string,
  filterParts: string[],
): string {
  let currentLabel = initialVideoLabel.startsWith('[') ? initialVideoLabel : `[${initialVideoLabel}]`;

  overlays.forEach((ov, idx) => {
    const dIn = 0.36;
    const dOut = 0.36;
    const tIn = ov.startSec;
    const tEnd = Number((ov.startSec + ov.durationSec).toFixed(2));
    const localFadeOutStart = Number(Math.max(dIn, ov.durationSec - dOut).toFixed(2));
    const easeOut = `pow(1-min(1,max(0,(t-${tIn.toFixed(2)})/${dIn.toFixed(2)})),3)`;

    const ovTag = `char_ov_${idx}`;
    const nextLabel = `v_char_${idx}`;

    let xExpr = String(ov.x);
    let yExpr = String(ov.y);
    if (ov.position === 'right') {
      xExpr = `${ov.x}+28*${easeOut}`;
    } else if (ov.position === 'center') {
      yExpr = `${ov.y}+18*${easeOut}`;
    } else {
      xExpr = `${ov.x}-28*${easeOut}`;
    }

    filterParts.push(
      `[${ov.streamIndex}:v]format=rgba,` +
      `fade=t=in:st=0:d=${dIn.toFixed(2)}:alpha=1,` +
      `fade=t=out:st=${localFadeOutStart.toFixed(2)}:d=${dOut.toFixed(2)}:alpha=1,` +
      `setpts=PTS+${tIn.toFixed(2)}/TB[${ovTag}]`
    );
    filterParts.push(
      `${currentLabel}[${ovTag}]overlay=x='${xExpr}':y='${yExpr}':` +
      `eof_action=pass:enable='between(t,${tIn.toFixed(2)},${tEnd.toFixed(2)})'[${nextLabel}]`
    );
    currentLabel = `[${nextLabel}]`;
  });

  return currentLabel;
}
