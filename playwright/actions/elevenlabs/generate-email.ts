// playwright/actions/elevenlabs/generate-email.ts

const FIRST_NAMES = [
  'jovan', 'tama', 'aditya', 'bima', 'rizky', 'satria', 'dimas', 'fajar',
  'angga', 'bayu', 'dika', 'reza', 'ilham', 'gilang', 'rendy', 'kevin',
  'alvin', 'david', 'yoga', 'wahyu', 'arief', 'bagas', 'danang', 'ferdy'
];

const LAST_NAMES = [
  'kurnia', 'pratama', 'saputra', 'wijaya', 'santoso', 'hidayat', 'nugroho',
  'putra', 'setiawan', 'kusuma', 'lestari', 'permana', 'gunawan', 'wibowo'
];

const SYLLABLES = [
  'ka', 'ri', 'zo', 'fa', 'ma', 'ne', 'tu', 'li', 'va', 'ze',
  'jo', 'ra', 'de', 'ku', 'sa', 'bi', 'lo', 'tar', 'ven', 'lex'
];

function makePhoneticName(): string {
  const count = Math.floor(2 + Math.random() * 2); // 2-3 syllables
  let result = '';
  for (let i = 0; i < count; i++) {
    result += SYLLABLES[Math.floor(Math.random() * SYLLABLES.length)];
  }
  return result;
}

/**
 * Generates a clean, natural-looking random email ending in @riztama.my.id
 */
export function generateElevenLabsEmail(domain = 'riztama.my.id'): string {
  const mode = Math.random();
  let username = '';

  if (mode < 0.4) {
    // Mode 1: first name + last name + random number
    const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
    const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
    const num = Math.floor(10 + Math.random() * 899);
    username = `${first}.${last}${num}`;
  } else if (mode < 0.7) {
    // Mode 2: phonetic name + random number
    const phonetic = makePhoneticName();
    const num = Math.floor(100 + Math.random() * 900);
    username = `${phonetic}${num}`;
  } else {
    // Mode 3: name + random 4-char alphanumeric tag
    const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
    const tag = Math.random().toString(36).substring(2, 6);
    username = `${first}${tag}`;
  }

  return `${username.toLowerCase()}@${domain}`;
}

export const DEFAULT_PASSWORD = process.env.ELEVENLABS_DEFAULT_PASSWORD || 'Jovan@1224';
