# Content Auto

FFmpeg-based automated video production workspace and Electron dashboard, focused on **Alur Film (16:9 longform recap)**.

## Directory Structure

```text
content-auto/
├── cli/                        # CLI & FFmpeg video renderers (run via tsx)
│   ├── render-alurfilm.ts      # Main 16:9 Alur Film renderer
│   ├── render-humanologi.ts    # Humanologi slideshow/documentary renderer
│   ├── index.ts                # Legacy vertical (9:16) renderer & validator
│   └── shared/                 # Shared FFmpeg runner & caption helpers
├── lib/                        # Shared domain logic (consumed by CLI & Dashboard)
│   └── alurfilm/               # Script parser, intro engine, character lower-third overlays
├── dashboard/                  # Electron + React + Vite + Tailwind desktop app
│   ├── electron/
│   │   ├── main.cjs            # Electron main entry & IPC registration
│   │   ├── preload.cjs         # Context bridge API
│   │   ├── ipc/                # IPC handler groups (alurfilm, render, file, project, ...)
│   │   ├── services/           # Main-process services (aiClient, alurfilmAudioSplicer)
│   │   └── shared/             # Paths, FFmpeg, media protocol, prompts, Supabase
│   ├── prompts/                # Markdown prompt templates per workflow
│   └── src/                    # React renderer (`@lib/*` aliases to root `lib/*`)
├── extension/                  # Chrome/Brave MV3 extension (unpacked — keep path fixed)
├── camoufox/                   # Python anti-detect browser automation & profiles (keep path fixed)
├── scripts/                    # Database migrations, Supabase sync, local bridge server
├── assets/                     # Static BGM library, fonts, channel logos, intros
├── input/                      # Working runtime media & state (gitignored)
└── output/                     # Rendered MP4 outputs (gitignored)
```

## Common Commands

```bash
npm run dev              # Launch Vite + Electron dashboard
npm run typecheck        # Strict TypeScript check (root CLI/lib + dashboard)
npm run dashboard:build  # Typecheck + production Vite bundle
npm run render:alurfilm  # Run 16:9 Alur Film CLI renderer directly
npm run test:alurfilm    # Run Alur Film character-overlay unit tests
npm run db:migrate       # Run Supabase/Postgres migrations
npm run db:sync          # Sync local project data to Supabase
```

## Alur Film Architecture

1. **Dashboard UI** (`dashboard/src/components/longform/`) drives the pipeline steps (Splitter → Analyze → Audio → Transcript → Mapping → Render → Metadata) and imports shared helpers via `@lib/alurfilm/*`.
2. **Electron IPC** (`dashboard/electron/ipc/alurfilmHandlers.cjs` & `renderHandlers.cjs`) manages local files under `input/alurfilm/`, runs audio splicing/alignment, and spawns `cli/render-alurfilm.ts` or `lib/alurfilm/intro-engine.ts` with `cwd = PROJECT_ROOT`.
3. **Render Engine** (`cli/render-alurfilm.ts` + `lib/alurfilm/`) validates mapping JSON with Zod, generates character name cards (`render-name-card.py`), composites BGM/VO/logo/overlays via FFmpeg, and writes MP4s to `output/`.
4. **Browser Extension** (`extension/`) bridges Google AI Studio / ElevenLabs with Supabase (`autocontent` schema).
