// lib/alurfilm/character-overlay.test.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  isProperCharacterName,
  normalizeCharacterKey,
  loadCharacterContext,
  planCharacterOverlays,
  generateCharacterOverlayCards,
  appendCharacterOverlayFilters,
  type TimelineSentenceSpan,
} from './character-overlay.js';

async function main() {
  // 1. Proper name filter: real person names pass, generic descriptors rejected
  const shouldPass = ['Singh', 'Rin', 'Mink', 'Buddy', 'Pak Vasu', 'Purich', 'Ann', 'Dr. Park', 'John Wick'];
  const shouldReject = [
    'Rekan Singh',
    'Tangan kanan Pak Vasu',
    'Direktur Rumah Sakit',
    'Satpam Rumah Sakit',
    'Jenderal Militer',
    'Pria di Kamar Rawat',
    'Tim Alfa',
    'Komandan Tim Alfa',
    'Prajurit Penyelamat',
    'Pak',
    'A',
    '',
  ];

  for (const name of shouldPass) {
    assert.equal(isProperCharacterName(name), true, `Expected proper name to pass: "${name}"`);
  }
  for (const name of shouldReject) {
    assert.equal(isProperCharacterName(name), false, `Expected generic label to be rejected: "${name}"`);
  }

  // 2. Dedup normalization strips leading honorifics
  assert.equal(normalizeCharacterKey('Pak Vasu'), 'vasu');
  assert.equal(normalizeCharacterKey('Dr. Rin'), 'rin');
  assert.equal(normalizeCharacterKey('Singh'), 'singh');

  // 3. Anti-collision staggering when two new characters appear in one sentence
  const sentences: TimelineSentenceSpan[] = [
    { sentenceIndex: 0, text: 'Kita kenalan sama Singh yang kuat.', start: 10.0, end: 14.0, isVisualOnly: false },
    { sentenceIndex: 1, text: 'Singh pergi bareng temannya, Mink, dan anaknya bernama Buddy.', start: 20.0, end: 25.0, isVisualOnly: false },
    { sentenceIndex: 2, text: '[VISUAL_ONLY] Singh bertarung', start: 25.0, end: 31.0, isVisualOnly: true },
  ];
  const planned = planCharacterOverlays(
    sentences,
    [
      { assigned_name: 'Singh', role: 'Mantan Petarung Muay Thai' },
      { assigned_name: 'Rekan Singh', role: 'Sopir' },
      { assigned_name: 'Mink' },
      { assigned_name: 'Buddy', role: 'Anak Mink' },
    ],
    new Set(),
    40.0,
  );
  assert.deepEqual(planned.map((p) => p.name), ['Singh', 'Mink', 'Buddy']);
  assert.equal(planned[0].role, 'Mantan Petarung Muay Thai');
  assert.equal(planned[1].role, ''); // fallback name-only
  // Verify Mink & Buddy do not overlap
  assert.ok(
    planned[1].startSec + planned[1].durationSec < planned[2].startSec,
    `Expected staggered non-overlapping timings: Mink ends at ${planned[1].startSec + planned[1].durationSec}, Buddy starts at ${planned[2].startSec}`,
  );

  // 4. Explicit mapping-driven character_overlay mode (mixed per-character positions + role fallback + dedup)
  const mappingDrivenSentences: TimelineSentenceSpan[] = [
    {
      sentenceIndex: 0,
      text: 'Kita kenalan sama Singh, mantan petarung.',
      start: 22.38,
      end: 26.04,
      isVisualOnly: false,
      characterOverlay: { name: 'Singh', role: 'Mantan Petarung Muay Thai', position: 'left' },
    },
    {
      sentenceIndex: 1,
      text: 'Singh lalu menemui pacarnya, Rin.',
      start: 34.86,
      end: 38.48,
      isVisualOnly: false,
      characterOverlay: { name: 'Rin', position: 'right' }, // role omitted -> falls back to registry
    },
    {
      sentenceIndex: 2,
      text: 'Singh kembali bertarung.',
      start: 40.0,
      end: 44.0,
      isVisualOnly: false,
      characterOverlay: { name: 'Singh', role: 'Duplikat', position: 'center' }, // duplicate -> skipped
    },
    {
      sentenceIndex: 3,
      text: 'Satpam menjaga pintu.',
      start: 45.0,
      end: 48.0,
      isVisualOnly: false,
      characterOverlay: { name: 'Satpam Rumah Sakit', role: 'Penjaga', position: 'center' }, // generic -> skipped
    },
  ];
  const explicitPlan = planCharacterOverlays(
    mappingDrivenSentences,
    [{ assigned_name: 'Rin', role: 'Dokter • Pacar Singh' }],
    new Set(),
    60.0,
    'center',
  );
  assert.deepEqual(explicitPlan.map((p) => p.name), ['Singh', 'Rin']);
  assert.equal(explicitPlan[0].position, 'left');
  assert.equal(explicitPlan[0].role, 'Mantan Petarung Muay Thai');
  assert.equal(explicitPlan[1].position, 'right');
  assert.equal(explicitPlan[1].role, 'Dokter • Pacar Singh');

  // 5. Cross-part 1x-per-film dedup on real project fixtures if present
  const part1Analysis = path.resolve('input/alurfilm/WV-FILM-20261121-01UK_analysis_part_01.json');
  const part2Analysis = path.resolve('input/alurfilm/WV-FILM-20261121-01UK_analysis_part_02.json');
  const part4Analysis = path.resolve('input/alurfilm/WV-FILM-20261121-01UK_analysis_part_04.json');
  if (fs.existsSync(part1Analysis) && fs.existsSync(part2Analysis) && fs.existsSync(part4Analysis)) {
    const ctx2 = loadCharacterContext(part2Analysis);
    assert.ok(ctx2.priorIntroduced.has('singh'), 'Part 2 should know Singh was introduced in Part 1');
    assert.ok(ctx2.priorIntroduced.has('rin'), 'Part 2 should know Rin was introduced in Part 1');
    assert.ok(ctx2.priorIntroduced.has('vasu'), 'Part 2 should know Pak Vasu was introduced in Part 1');
    assert.ok(!ctx2.priorIntroduced.has('purich'), 'Part 2 should treat Purich as new');

    const ctx4 = loadCharacterContext(part4Analysis);
    assert.ok(ctx4.priorIntroduced.has('purich'), 'Part 4 should know Purich was introduced in Part 2');
    assert.ok(!ctx4.priorIntroduced.has('ann'), 'Part 4 should treat Ann as new');
  }

  // 6. Single-batch mixed-position PNG card generation (left, center, right) + FFmpeg filter graph
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'char-ov-test-'));
  try {
    const mixedBatch = [
      { ...planned[0], position: 'left' as const },
      { ...planned[0], name: 'Rin', role: '', position: 'center' as const },
      { ...planned[0], name: 'Pak Vasu', role: 'Pengusaha', position: 'right' as const },
    ];
    const cards = await generateCharacterOverlayCards(mixedBatch, tmpDir, process.cwd());

    assert.equal(cards.length, 3);
    assert.equal(cards[0].position, 'left');
    assert.equal(cards[0].x, 62);

    assert.equal(cards[1].position, 'center');
    assert.ok(cards[1].x > 400 && cards[1].x < 900, `Center x out of expected range: ${cards[1].x}`);

    assert.equal(cards[2].position, 'right');
    assert.ok(cards[2].x > 900, `Right x should be on right half of 1920px frame: ${cards[2].x}`);

    for (const c of cards) {
      assert.ok(fs.existsSync(c.cardPath), `Card PNG missing: ${c.cardPath}`);
      assert.ok(fs.statSync(c.cardPath).size > 2000, `Card PNG unexpectedly tiny: ${c.cardPath}`);
      assert.ok(c.y > 700 && c.y < 1050, `Unexpected y coordinate: ${c.y}`);
    }

    const filterParts: string[] = [];
    const outLabel = appendCharacterOverlayFilters(
      cards.map((c, idx) => ({ ...c, streamIndex: idx + 1 })),
      '0:v',
      filterParts,
    );
    assert.equal(outLabel, '[v_char_2]');
    assert.equal(filterParts.length, 6);
    assert.ok(filterParts[1].startsWith('[0:v][char_ov_0]overlay=') && filterParts[1].includes('-28*'), 'Left must slide from left');
    assert.ok(filterParts[3].includes('+18*'), 'Center must rise from bottom');
    assert.ok(filterParts[5].includes('+28*'), 'Right must slide from right');
    assert.ok(filterParts[1].includes('eof_action=pass'), 'Must use eof_action=pass');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log('✅ All character-overlay assertions passed!');
}

main().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
