// extension/sidepanel/sidepanel.js
// Logika controller untuk Native Side Panel Chrome / Brave
// Memvalidasi keberadaan file di Google Drive Picker tanpa ekstensi & update Supabase

document.addEventListener('DOMContentLoaded', async () => {
  const connStatus = document.getElementById('connStatus');
  const domStatus = document.getElementById('domStatus');
  const sessionSelect = document.getElementById('sessionSelect');
  const sessionPartsCount = document.getElementById('sessionPartsCount');
  const sessionCategory = document.getElementById('sessionCategory');
  const sessionDriveCount = document.getElementById('sessionDriveCount');
  const chunksList = document.getElementById('chunksList');
  const queueCount = document.getElementById('queueCount');
  const btnRefresh = document.getElementById('btnRefresh');
  const btnOpenAIStudio = document.getElementById('btnOpenAIStudio');

  // Navigation tab elements
  const tabBtnAiStudio = document.getElementById('tabBtnAiStudio');
  const tabBtnElevenLabs = document.getElementById('tabBtnElevenLabs');
  const viewAiStudio = document.getElementById('viewAiStudio');
  const viewElevenLabs = document.getElementById('viewElevenLabs');
  const btnOpenElevenLabs = document.getElementById('btnOpenElevenLabs');
  const btnManualSignOutElevenLabs = document.getElementById('btnManualSignOutElevenLabs');

  const inputSignupEmail = document.getElementById('inputSignupEmail');
  const inputSignupPassword = document.getElementById('inputSignupPassword');
  const btnRegenEmail = document.getElementById('btnRegenEmail');
  const btnAutoSignupElevenLabs = document.getElementById('btnAutoSignupElevenLabs');
  const inputManualVerifyUrl = document.getElementById('inputManualVerifyUrl');
  const btnProcessManualVerify = document.getElementById('btnProcessManualVerify');
  const signupSpinner = document.getElementById('signupSpinner');
  const signupBtnText = document.getElementById('signupBtnText');
  const signupLiveStatus = document.getElementById('signupLiveStatus');
  const signupStepLog = document.getElementById('signupStepLog');
  const ttsPartsList = document.getElementById('ttsPartsList');
  const ttsPartsCountBadge = document.getElementById('ttsPartsCountBadge');
  const btnRefreshTtsParts = document.getElementById('btnRefreshTtsParts');
  let isSigningUpElevenLabs = false;

  // Bulk action elements
  const btnUploadAll = document.getElementById('btnUploadAll');
  const bulkSpinner = document.getElementById('bulkSpinner');
  const bulkUploadText = document.getElementById('bulkUploadText');
  const bulkProgressBarContainer = document.getElementById('bulkProgressBarContainer');
  const bulkProgressBar = document.getElementById('bulkProgressBar');
  const bulkStatusText = document.getElementById('bulkStatusText');

  // Script generator elements
  const btnRunScript = document.getElementById('btnRunScript');
  const scriptSpinner = document.getElementById('scriptSpinner');
  const scriptBtnText = document.getElementById('scriptBtnText');
  const btnAutoProgress = document.getElementById('btnAutoProgress');
  const autoProgressText = document.getElementById('autoProgressText');
  const autoProgressIcon = document.getElementById('autoProgressIcon');
  const scriptLiveStatus = document.getElementById('scriptLiveStatus');
  const scriptStepLog = document.getElementById('scriptStepLog');
  const scriptTargetBadge = document.getElementById('scriptTargetBadge');
  let isRunningScript = false;
  let isAutoProgressActive = false;

  // Video Mapping generator elements
  const btnRunMapping = document.getElementById('btnRunMapping');
  const mappingSpinner = document.getElementById('mappingSpinner');
  const mappingBtnText = document.getElementById('mappingBtnText');
  const btnAutoProgressMapping = document.getElementById('btnAutoProgressMapping');
  const autoProgressMappingText = document.getElementById('autoProgressMappingText');
  const autoProgressMappingIcon = document.getElementById('autoProgressMappingIcon');
  const mappingLiveStatus = document.getElementById('mappingLiveStatus');
  const mappingStepLog = document.getElementById('mappingStepLog');
  const mappingTargetBadge = document.getElementById('mappingTargetBadge');
  let isRunningMapping = false;
  let isAutoProgressMappingActive = false;

  let activeSessions = [];
  let currentChunks = [];
  let isValidatingAny = false;

  function setDbStatus(state, text) {
    if (!connStatus) return;
    connStatus.className = `status-badge ${state}`;
    connStatus.querySelector('.status-text').textContent = text;
  }

  function setDomStatus(state, text) {
    if (!domStatus) return;
    domStatus.className = `status-badge ${state}`;
    domStatus.querySelector('.status-text').textContent = text;
  }

  function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  }

  async function initConnection() {
    setDbStatus('connecting', 'DB...');
    try {
      const res = await window.SupabaseBridge.testConnection();
      if (res.connected) {
        setDbStatus('connected', 'DB OK');
        await loadSessions();
      } else {
        setDbStatus('error', 'DB Error');
        chunksList.innerHTML = `<div class="empty-state">Gagal terhubung ke Supabase: ${res.error}</div>`;
      }
    } catch (err) {
      setDbStatus('error', 'Offline');
      chunksList.innerHTML = `<div class="empty-state">Error: ${err.message}</div>`;
    }
  }

  async function safeStorageGet(keys) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        return await chrome.storage.local.get(keys);
      } catch (e) { }
    }
    const res = {};
    keys.forEach(k => { res[k] = localStorage.getItem(k); });
    return res;
  }

  async function safeStorageSet(obj) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        return await chrome.storage.local.set(obj);
      } catch (e) { }
    }
    Object.keys(obj).forEach(k => { localStorage.setItem(k, obj[k]); });
  }

  async function loadSessions() {
    try {
      activeSessions = await window.SupabaseBridge.getSessions();
      sessionSelect.innerHTML = '';

      if (activeSessions.length === 0) {
        sessionSelect.innerHTML = '<option value="">Belum ada session</option>';
        chunksList.innerHTML = '<div class="empty-state">Belum ada session di schema autocontent.</div>';
        btnUploadAll.disabled = true;
        return;
      }

      activeSessions.forEach((s) => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = `${s.id} (${s.total_parts || 0} part)`;
        sessionSelect.appendChild(opt);
      });

      const stored = await safeStorageGet(['selectedContentId']);
      const targetId = stored.selectedContentId && activeSessions.some(s => s.id === stored.selectedContentId)
        ? stored.selectedContentId
        : activeSessions[0].id;

      sessionSelect.value = targetId;
      await onSessionChanged(targetId);
    } catch (err) {
      console.error('[SidePanel] Load sessions error:', err);
      chunksList.innerHTML = `<div class="empty-state">Gagal memuat session: ${err.message}</div>`;
    }
  }

  async function onSessionChanged(contentId) {
    if (!contentId) return;
    await safeStorageSet({ selectedContentId: contentId });

    const session = activeSessions.find(s => s.id === contentId);
    if (session) {
      sessionPartsCount.textContent = `${session.total_parts || 0} Part`;
      sessionCategory.textContent = session.category || 'alurfilm';
    }

    chunksList.innerHTML = '<div class="empty-state">Memuat video chunks...</div>';
    await loadChunks(contentId);
  }

  async function loadChunks(contentId) {
    try {
      currentChunks = await window.SupabaseBridge.getParts(contentId);
      queueCount.textContent = currentChunks.length;

      if (currentChunks.length === 0) {
        chunksList.innerHTML = '<div class="empty-state">Tidak ada chunk untuk session ini.</div>';
        btnUploadAll.disabled = true;
        sessionDriveCount.textContent = '0 di Drive';
        if (btnRunMapping) {
          btnRunMapping.disabled = true;
          btnRunMapping.title = 'Belum ada chunk video.';
          mappingBtnText.textContent = '🔒 Prompt Mapping Belum di-Set';
        }
        if (btnAutoProgressMapping) {
          btnAutoProgressMapping.disabled = true;
          btnAutoProgressMapping.title = 'Belum ada chunk video.';
        }
        renderTtsPartsList();
        return;
      }

      const uploadedCount = currentChunks.filter(c => c.upload_status === 'done' || c.upload_status === 'uploaded').length;
      sessionDriveCount.textContent = `${uploadedCount}/${currentChunks.length} di Drive`;

      const pendingCount = currentChunks.length - uploadedCount;
      if (pendingCount === 0) {
        btnUploadAll.disabled = true;
        bulkUploadText.textContent = `✓ Semua Part (${uploadedCount}) Terkonfirmasi di Drive`;
      } else {
        btnUploadAll.disabled = isValidatingAny;
        bulkUploadText.textContent = `🔍 Validasi Semua Part (${pendingCount} Pending)`;
      }

      // Update status target script generator
      const targetScriptPart = currentChunks.find(c => c.script_status !== 'done' && c.script_status !== 'completed');
      if (scriptTargetBadge && btnRunScript) {
        if (targetScriptPart) {
          scriptTargetBadge.textContent = `Part ${targetScriptPart.part_number}`;
          scriptBtnText.textContent = `🚀 Kirim & Pantau Output (Part ${targetScriptPart.part_number})`;
          btnRunScript.disabled = isRunningScript || isAutoProgressActive;
        } else {
          scriptTargetBadge.textContent = 'Selesai';
          scriptBtnText.textContent = '✓ Semua Script Part Selesai';
          btnRunScript.disabled = true;
        }
      }

      // Update status target video mapping generator
      const targetMappingPart = currentChunks.find(c => c.mapping_status !== 'done' && c.mapping_status !== 'completed');
      if (mappingTargetBadge && btnRunMapping) {
        if (targetMappingPart) {
          const hasTargetPrompt = !!(
            (targetMappingPart.mapping_prompt && targetMappingPart.mapping_prompt.trim().length > 0) ||
            (targetMappingPart.prompt && targetMappingPart.prompt.trim().length > 0)
          );

          if (!hasTargetPrompt) {
            mappingTargetBadge.textContent = `Part ${targetMappingPart.part_number} (Prompt Belum di-Set)`;
            mappingTargetBadge.classList.add('warning-badge');
            mappingBtnText.textContent = `🔒 Prompt Mapping Part ${targetMappingPart.part_number} Belum di-Set`;
            btnRunMapping.disabled = true;
            btnRunMapping.title = `Prompt video mapping Part #${targetMappingPart.part_number} belum diset. Silakan generate/simpan prompt mapping di Dashboard Step 5 terlebih dahulu.`;
            if (btnAutoProgressMapping) {
              btnAutoProgressMapping.disabled = true;
              btnAutoProgressMapping.title = 'Prompt mapping belum diset di dashboard.';
            }
          } else {
            mappingTargetBadge.textContent = `Part ${targetMappingPart.part_number}`;
            mappingTargetBadge.classList.remove('warning-badge');
            mappingBtnText.textContent = `🚀 Kirim & Pantau Mapping (Part ${targetMappingPart.part_number})`;
            btnRunMapping.disabled = isRunningMapping || isAutoProgressMappingActive;
            btnRunMapping.title = '';
            if (btnAutoProgressMapping) {
              btnAutoProgressMapping.disabled = isRunningMapping;
              btnAutoProgressMapping.title = '';
            }
          }
        } else {
          mappingTargetBadge.textContent = 'Selesai';
          mappingTargetBadge.classList.remove('warning-badge');
          mappingBtnText.textContent = '✓ Semua Video Mapping Selesai';
          btnRunMapping.disabled = true;
          btnRunMapping.title = '';
          if (btnAutoProgressMapping) {
            btnAutoProgressMapping.disabled = true;
            btnAutoProgressMapping.title = '';
          }
        }
      }

      try {
        renderChunksList();
      } catch (renderErr) {
        console.warn('[SidePanel] Error renderChunksList:', renderErr);
      }

      try {
        renderTtsPartsList();
      } catch (ttsErr) {
        console.warn('[SidePanel] Error renderTtsPartsList:', ttsErr);
      }
    } catch (err) {
      console.error('[SidePanel] Load chunks error:', err);
      chunksList.innerHTML = `<div class="empty-state">Gagal memuat chunks: ${err.message}</div>`;
    }
  }

  function renderChunksList() {
    chunksList.innerHTML = '';
    currentChunks.forEach((chunk) => {
      const isDone = chunk.upload_status === 'done' || chunk.upload_status === 'uploaded';
      const isChecking = chunk._isChecking;
      const isScriptDone = chunk.script_status === 'done' || chunk.script_status === 'completed';
      const isMappingDone = chunk.mapping_status === 'done' || chunk.mapping_status === 'completed';

      let statusClass = 'pending';
      let statusLabel = 'Pending';
      if (isMappingDone) {
        statusClass = 'uploaded';
        statusLabel = '✓ Map OK';
      } else if (isScriptDone) {
        statusClass = 'uploaded';
        statusLabel = '✓ Script OK';
      } else if (isDone) {
        statusClass = 'uploaded';
        statusLabel = 'Di Drive';
      } else if (isChecking) {
        statusClass = 'uploading';
        statusLabel = 'Mengecek...';
      }

      const durMin = chunk.duration_sec ? (chunk.duration_sec / 60).toFixed(1) + 'm' : '~20m';
      const sizeStr = formatBytes(chunk.size_bytes);
      const cleanBaseName = chunk.filename.replace(/\.[^/.]+$/, '');

      const card = document.createElement('div');
      card.className = `chunk-card ${isChecking ? 'is-uploading' : ''} ${isDone ? 'is-uploaded' : ''}`;
      card.id = `chunk-card-${chunk.part_number}`;

      card.innerHTML = `
        <div class="chunk-top">
          <div style="display: flex; align-items: center; gap: 6px; min-width: 0;">
            <span class="chunk-part">P${chunk.part_number}</span>
            <span class="chunk-name" title="${chunk.filename}">${chunk.filename}</span>
          </div>
          <span class="status-tag ${statusClass}" id="tag-${chunk.part_number}">${statusLabel}</span>
        </div>
        <div class="chunk-details">
          <span>⏱️ ${durMin} • 📦 ${sizeStr} ${isScriptDone ? '• 📄 Script' : ''} ${isMappingDone ? '• 🎯 Map' : ''}</span>
          <div class="chunk-actions">
            <button class="btn-copy btn-copy-name" data-filename="${chunk.filename}" title="Salin nama file">📋 Nama</button>
            <button class="btn-upload-chunk btn-check-drive" id="btn-check-${chunk.part_number}" ${isChecking || isValidatingAny ? 'disabled' : ''}>
              ${isDone ? '🔍 Cek' : isChecking ? '⏳ ...' : '🔍 Drive'}
            </button>
            <button class="btn-generate-chunk" id="btn-run-${chunk.part_number}" ${isRunningScript || isAutoProgressActive ? 'disabled' : ''} title="AI Script Generator">
              ${isScriptDone ? '📋 Script' : '🚀 Script'}
            </button>
            ${(() => {
              const hasChunkPrompt = !!((chunk.mapping_prompt && chunk.mapping_prompt.trim()) || (chunk.prompt && chunk.prompt.trim()));
              const isMapDisabled = isRunningMapping || isAutoProgressMappingActive || (!isMappingDone && !hasChunkPrompt);
              const mapTitle = isMappingDone 
                ? 'Salin Hasil Output Mapping JSON' 
                : hasChunkPrompt 
                  ? 'AI Video Mapping' 
                  : 'Prompt mapping belum diset di Supabase. Set di Dashboard Step 5 terlebih dahulu.';
              return `
                <button class="btn-map-chunk ${isMappingDone ? 'done' : ''}" id="btn-map-${chunk.part_number}" ${isMapDisabled ? 'disabled' : ''} title="${mapTitle}">
                  ${isMappingDone ? '📋 Map' : hasChunkPrompt ? '🎯 Map' : '🔒 Map'}
                </button>
              `;
            })()}
            <button class="btn-toggle-done" id="btn-toggle-${chunk.part_number}" title="${isDone ? 'Tandai Pending' : 'Tandai Selesai Manual'}">
              ${isDone ? '↩️' : '✓'}
            </button>
          </div>
        </div>
      `;

      // Event Copy Nama File
      const btnCopyName = card.querySelector('.btn-copy-name');
      if (btnCopyName) {
        btnCopyName.addEventListener('click', async () => {
          await navigator.clipboard.writeText(chunk.filename);
          btnCopyName.textContent = '✓ Copied';
          setTimeout(() => { btnCopyName.textContent = '📋 Nama'; }, 1500);
        });
      }

      // Event Copy Path Video
      const btnCopyPath = card.querySelector('.btn-copy-path');
      if (btnCopyPath) {
        btnCopyPath.addEventListener('click', async () => {
          await navigator.clipboard.writeText(chunk.video_path || chunk.filename);
          btnCopyPath.textContent = '✓ Copied';
          setTimeout(() => { btnCopyPath.textContent = '📋 Path'; }, 1500);
        });
      }

      // Event Validasi / Cek di Drive
      const btnCheck = card.querySelector('.btn-check-drive');
      if (btnCheck) {
        btnCheck.addEventListener('click', async () => {
          await validateSingleChunk(chunk);
        });
      }

      // Event Toggle Manual Done / Pending
      const btnToggle = card.querySelector('.btn-toggle-done');
      if (btnToggle) {
        btnToggle.addEventListener('click', async () => {
          const nextStatus = isDone ? 'pending' : 'done';
          chunk.upload_status = nextStatus;
          await window.SupabaseBridge.updatePart(chunk.id, {
            upload_status: nextStatus,
            uploaded_at: nextStatus === 'done' ? new Date().toISOString() : null
          }).catch((e) => console.warn('Supabase toggle error:', e));
          await loadChunks(sessionSelect.value);
        });
      }

      // Event Run / View Script JSON
      const btnRun = card.querySelector('.btn-generate-chunk');
      if (btnRun) {
        btnRun.addEventListener('click', async () => {
          if (isScriptDone && chunk.script_output) {
            await navigator.clipboard.writeText(JSON.stringify(chunk.script_output, null, 2));
            btnRun.textContent = '✓ Copied';
            setTimeout(() => { btnRun.textContent = '📋 Script'; }, 1500);
          } else {
            await runScriptGeneration(chunk);
          }
        });
      }

      // Event Run / View Mapping JSON
      const btnMap = card.querySelector('.btn-map-chunk');
      if (btnMap) {
        btnMap.addEventListener('click', async () => {
          if (isMappingDone && chunk.mapping_output) {
            await navigator.clipboard.writeText(JSON.stringify(chunk.mapping_output, null, 2));
            btnMap.textContent = '✓ Copied';
            setTimeout(() => { btnMap.textContent = '📋 Map'; }, 1500);
          } else {
            const hasChunkPrompt = !!((chunk.mapping_prompt && chunk.mapping_prompt.trim()) || (chunk.prompt && chunk.prompt.trim()));
            if (!hasChunkPrompt) {
              alert(`Prompt Video Mapping Part #${chunk.part_number} belum diset. Silakan generate & simpan prompt mapping di Dashboard Step 5 terlebih dahulu.`);
              return;
            }
            await runMappingGeneration(chunk);
          }
        });
      }

      chunksList.appendChild(card);
    });
  }

  async function getAIStudioTab() {
    try {
      const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTabs && activeTabs.length > 0 && activeTabs[0].url && activeTabs[0].url.includes('aistudio.google.com')) {
        return activeTabs[0];
      }
      const allAiTabs = await chrome.tabs.query({ url: 'https://aistudio.google.com/*' });
      if (allAiTabs && allAiTabs.length > 0) {
        await chrome.tabs.update(allAiTabs[0].id, { active: true });
        return allAiTabs[0];
      }
      // Buka otomatis tab New Chat jika belum ada tab AI Studio sama sekali
      const newTab = await chrome.tabs.create({ url: 'https://aistudio.google.com/prompts/new_chat' });
      await new Promise((r) => setTimeout(r, 4500));
      return newTab;
    } catch (e) {
      console.warn('[SidePanel] Query tabs error:', e);
    }
    return null;
  }

  async function validateSingleChunk(chunk) {
    if (isValidatingAny) return;

    isValidatingAny = true;
    chunk._isChecking = true;
    renderChunksList();

    const baseName = chunk.filename.replace(/\.[^/.]+$/, '');
    bulkStatusText.textContent = `Mencari "${baseName}" di Google Drive Picker...`;

    try {
      const targetTab = await getAIStudioTab();
      if (!targetTab || !targetTab.id) {
        throw new Error('Tab Google AI Studio tidak ditemukan.');
      }

      const res = await chrome.runtime.sendMessage({
        action: 'VALIDATE_DRIVE_FILE',
        tabId: targetTab.id,
        filename: chunk.filename
      });

      if (res && res.success && res.found) {
        chunk.upload_status = 'done';
        await window.SupabaseBridge.updatePart(chunk.id, {
          upload_status: 'done',
          uploaded_at: new Date().toISOString()
        }).catch((e) => console.warn('Supabase update error:', e));

        bulkStatusText.innerHTML = `<span style="color: #10b981;">✓ File "${baseName}" ditemukan di Drive & status disimpan!</span>`;
      } else if (res && !res.success) {
        bulkStatusText.innerHTML = `<span style="color: #ef4444;">❌ Gagal validasi: ${res.error}</span>`;
      } else {
        bulkStatusText.innerHTML = `<span style="color: #f59e0b;">⚠️ File "${baseName}" TIDAK ditemukan di Google Drive. Silakan upload terlebih dahulu.</span>`;
      }
    } catch (err) {
      console.error('Error single validation:', err);
      bulkStatusText.innerHTML = `<span style="color: #ef4444;">❌ Error: ${err.message}</span>`;
    } finally {
      chunk._isChecking = false;
      isValidatingAny = false;
      await loadChunks(sessionSelect.value);
    }
  }

  // Bulk Action: Validasi Semua Part Pending di Drive
  btnUploadAll.addEventListener('click', async () => {
    if (isValidatingAny) return;

    const targetTab = await getAIStudioTab();
    if (!targetTab || !targetTab.id) {
      alert('Buka tab Google AI Studio (https://aistudio.google.com/prompts/new_chat) terlebih dahulu!');
      return;
    }

    const pendingChunks = currentChunks.filter((c) => c.upload_status !== 'done');
    if (pendingChunks.length === 0) {
      alert('Semua chunk sudah berstatus "done" di Google Drive!');
      return;
    }

    isValidatingAny = true;
    btnUploadAll.disabled = true;
    bulkSpinner.classList.remove('hidden');
    bulkProgressBarContainer.classList.remove('hidden');
    bulkProgressBar.style.width = '0%';
    let foundCount = 0;

    const total = pendingChunks.length;

    for (let i = 0; i < total; i++) {
      const chunk = pendingChunks[i];
      const percent = Math.round(((i + 1) / total) * 100);
      bulkProgressBar.style.width = `${percent}%`;

      const baseName = chunk.filename.replace(/\.[^/.]+$/, '');
      bulkStatusText.textContent = `[${i + 1}/${total}] Memeriksa "${baseName}" di Drive...`;

      chunk._isChecking = true;
      renderChunksList();

      try {
        const res = await chrome.runtime.sendMessage({
          action: 'VALIDATE_DRIVE_FILE',
          tabId: targetTab.id,
          filename: chunk.filename
        });

        if (res && res.success && res.found) {
          chunk.upload_status = 'done';
          await window.SupabaseBridge.updatePart(chunk.id, {
            upload_status: 'done',
            uploaded_at: new Date().toISOString()
          }).catch(() => { });
          foundCount++;
        } else if (res && !res.success) {
          console.warn(`[SidePanel] Part ${chunk.part_number} validation error:`, res.error);
          bulkStatusText.innerHTML = `<span style="color: #f59e0b;">⚠️ Part #${chunk.part_number} gagal dicek (${res.error}). Melanjutkan...</span>`;
        }
      } catch (err) {
        console.error(`Error validating part ${chunk.part_number}:`, err);
        bulkStatusText.innerHTML = `<span style="color: #ef4444;">❌ Part #${chunk.part_number} gagal dicek: ${err.message}</span>`;
        chunk._isChecking = false;
        renderChunksList();
        break;
      }

      chunk._isChecking = false;
      renderChunksList();
      await new Promise(r => setTimeout(r, 600));
    }

    bulkProgressBar.style.width = '100%';
    bulkSpinner.classList.add('hidden');
    isValidatingAny = false;

    if (foundCount === total) {
      bulkStatusText.innerHTML = `<span style="color: #10b981;">🎉 Selesai! Semua ${total} part terkonfirmasi ada di Google Drive!</span>`;
    } else {
      bulkStatusText.innerHTML = `<span style="color: #38bdf8;">✓ Selesai validasi: ${foundCount}/${total} part ditemukan di Drive. Part yang belum ada silakan diupload manual.</span>`;
    }

    await loadChunks(sessionSelect.value);
  });

  // Action: Kirim & Pantau Output Script via Ekstensi (100% Otomatis End-to-End)
  async function runScriptGeneration(targetChunk) {
    if (isRunningScript) return;
    if (!targetChunk) {
      targetChunk = currentChunks.find((c) => c.script_status !== 'done' && c.script_status !== 'completed');
    }
    if (!targetChunk) {
      alert('Semua part sudah selesai dibuatkan naskah.');
      return;
    }

    isRunningScript = true;
    if (btnRunScript) btnRunScript.disabled = true;
    if (scriptSpinner) scriptSpinner.classList.remove('hidden');
    if (scriptLiveStatus) scriptLiveStatus.classList.remove('hidden');
    if (scriptStepLog) {
      scriptStepLog.className = 'script-step-log';
      scriptStepLog.textContent = `[Part #${targetChunk.part_number}] Menghubungkan ke tab Google AI Studio...`;
    }

    try {
      const tab = await getAIStudioTab();
      if (!tab || !tab.id) {
        throw new Error('Tab Google AI Studio tidak ditemukan. Buka https://aistudio.google.com/prompts/new_chat terlebih dahulu.');
      }

      // Pastikan prompt tersedia atau auto-generate jika belum ada di database
      if (!targetChunk.prompt) {
        const freshParts = await window.SupabaseBridge.getParts(sessionSelect.value);
        const freshTarget = freshParts.find((p) => Number(p.part_number) === Number(targetChunk.part_number));
        if (freshTarget?.prompt) {
          targetChunk = freshTarget;
        } else if (window.PromptGenerator) {
          const currentSession = activeSessions.find((s) => s.id === sessionSelect.value);
          const finishedParts = freshParts.filter(
            (p) => Number(p.part_number) < Number(targetChunk.part_number) && p.script_output
          );
          const genPrompt = window.PromptGenerator.generatePrompt({
            partNumber: targetChunk.part_number,
            totalParts: currentChunks.length,
            movieTitle: currentSession?.title || sessionSelect.value,
            movieYear: currentSession?.year || '',
            durationSec: targetChunk.duration_sec || 1200,
            previousParts: finishedParts,
          });
          targetChunk.prompt = genPrompt;
          await window.SupabaseBridge.updatePart(targetChunk.id, { prompt: genPrompt }).catch(() => {});
        }
      }

      // STEP 1: Cek apakah video chunk sudah terpasang di AI Studio
      if (scriptStepLog) {
        scriptStepLog.textContent = `[Part #${targetChunk.part_number}] Memeriksa video chunk di prompt editor...`;
      }

      let prepRes = null;
      try {
        prepRes = await chrome.tabs.sendMessage(tab.id, {
          module: 'scriptGenerator',
          action: 'SCRIPT_CHECK_PREPARED',
          payload: { filename: targetChunk.filename },
        });
      } catch (connErr) {
        // Coba reinjeksi content scripts jika tab belum siap
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: [
            'lib/supabase.js',
            'lib/prompt-generator.js',
            'content.js',
            'modules/chunk-validator.js',
            'modules/script-generator.js',
            'modules/mapping-generator.js',
          ],
        }).catch(() => {});
        await new Promise((r) => setTimeout(r, 600));
        prepRes = await chrome.tabs.sendMessage(tab.id, {
          module: 'scriptGenerator',
          action: 'SCRIPT_CHECK_PREPARED',
          payload: { filename: targetChunk.filename },
        }).catch(() => null);
      }

      // Cek apakah halaman saat ini sudah memiliki output yang SUDAH SELESAI di-generate
      const existingStatus = await chrome.tabs.sendMessage(tab.id, {
        module: 'scriptGenerator',
        action: 'SCRIPT_CHECK_STATUS',
      }).catch(() => null);

      if (existingStatus?.status === 'completed' && existingStatus?.parsedJson) {
        const parsedPart = Number(existingStatus.parsedJson.chunk_part);
        const currentTargetPart = Number(targetChunk.part_number);

        if (parsedPart === currentTargetPart || !parsedPart) {
          console.log(`[SidePanel] 🎯 Terdeteksi output Part #${currentTargetPart} sudah selesai di halaman ini! Langsung simpan...`);
          if (scriptStepLog) {
            scriptStepLog.textContent = `[Part #${targetChunk.part_number}] 🎯 Output selesai terdeteksi di halaman saat ini! Menyimpan ke database...`;
          }

          const currentSession = activeSessions.find((s) => s.id === sessionSelect.value);
          const movieTitle = currentSession?.title || sessionSelect.value;

          const saveRes = await chrome.tabs.sendMessage(tab.id, {
            module: 'scriptGenerator',
            action: 'SCRIPT_SAVE_AND_CHAIN',
            payload: {
              contentId: sessionSelect.value,
              partNumber: targetChunk.part_number,
              totalParts: currentChunks.length,
              parsedJson: existingStatus.parsedJson,
              movieTitle: movieTitle,
            },
          });

          if (scriptStepLog) {
            scriptStepLog.className = 'script-step-log success';
            if (saveRes?.chainedNext) {
              scriptStepLog.innerHTML = `🎉 <b>Part #${targetChunk.part_number} SUKSES!</b> Raw JSON tersimpan di database & Prompt Part #${saveRes.nextPartNumber} berhasil di-generate (${saveRes.nextPromptLength} karakter)!`;
            } else {
              scriptStepLog.innerHTML = `🎉 <b>Part #${targetChunk.part_number} SUKSES!</b> Full Raw JSON berhasil disimpan di database!`;
            }
          }

          // Requirement 1: Jika sudah tersimpan, buka new chat untuk part berikutnya jika ada part lanjutan
          if (saveRes?.chainedNext) {
            console.log('[SidePanel] 🔄 Membuka New Chat bersih untuk part selanjutnya...');
            if (scriptStepLog) {
              scriptStepLog.innerHTML += `<br><span style="color: #38bdf8;">🔄 Membuka New Chat bersih untuk Part #${saveRes.nextPartNumber}...</span>`;
            }
            await chrome.tabs.update(tab.id, { url: 'https://aistudio.google.com/prompts/new_chat' });
            await new Promise((r) => setTimeout(r, 4000));
          }

          await loadChunks(sessionSelect.value);
          return;
        }
      }

      // Cek apakah halaman sudah memiliki turn percakapan sebelumnya
      let turnsRes = await chrome.tabs.sendMessage(tab.id, {
        module: 'scriptGenerator',
        action: 'SCRIPT_CHECK_TURNS',
      }).catch(() => null);

      // Jika ada chat turn sebelumnya atau bukan di new_chat, buka new chat bersih
      if (turnsRes?.hasTurns || (!tab.url.includes('/prompts/new_chat') && !prepRes?.hasMedia)) {
        if (scriptStepLog) {
          scriptStepLog.textContent = `[Part #${targetChunk.part_number}] Membuka halaman New Chat bersih di Google AI Studio...`;
        }
        if (tab.url.includes('/prompts/new_chat')) {
          await chrome.tabs.reload(tab.id);
        } else {
          await chrome.tabs.update(tab.id, { url: 'https://aistudio.google.com/prompts/new_chat' });
        }
        await new Promise((r) => setTimeout(r, 4500));
        prepRes = null;
      }

      // Jika belum ada media chunk terpasang, sisipkan otomatis dari Drive!
      if (!prepRes?.hasMedia) {
        if (scriptStepLog) {
          scriptStepLog.textContent = `[Part #${targetChunk.part_number}] 🎬 Membuka Drive Picker & menyisipkan "${targetChunk.filename}"...`;
        }

        const insertRes = await chrome.runtime.sendMessage({
          action: 'SELECT_DRIVE_FILE',
          tabId: tab.id,
          filename: targetChunk.filename,
        });

        if (!insertRes || !insertRes.success) {
          throw new Error(insertRes?.error || `Gagal menyisipkan "${targetChunk.filename}" dari Google Drive.`);
        }

        // Tunggu hingga kartu video chunk terpasang di editor (polling hingga 25 detik)
        if (scriptStepLog) {
          scriptStepLog.textContent = `[Part #${targetChunk.part_number}] ⏳ Menunggu kartu video chunk terpasang di prompt editor...`;
        }

        let attached = false;
        for (let i = 0; i < 25; i++) {
          await new Promise((r) => setTimeout(r, 1000));
          const check = await chrome.tabs.sendMessage(tab.id, {
            module: 'scriptGenerator',
            action: 'SCRIPT_CHECK_PREPARED',
            payload: { filename: targetChunk.filename },
          }).catch(() => null);
          if (check?.hasMedia) {
            attached = true;
            break;
          }
        }

        if (!attached) {
          throw new Error(`Timeout: Video chunk "${targetChunk.filename}" tidak kunjung terpasang di prompt editor.`);
        }
      }

      // Tunggu hingga token video selesai dihitung (badge tokens muncul & loading selesai)
      if (scriptStepLog) {
        scriptStepLog.textContent = `[Part #${targetChunk.part_number}] ⏳ Menunggu perhitungan token video selesai di AI Studio...`;
      }
      for (let w = 0; w < 30; w++) {
        const readyCheck = await chrome.tabs.sendMessage(tab.id, {
          module: 'scriptGenerator',
          action: 'SCRIPT_CHECK_PREPARED',
          payload: { filename: targetChunk.filename },
        }).catch(() => null);
        if (readyCheck?.mediaReady) {
          break;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }

      // STEP 2: Masukkan teks prompt Part ini ke dalam editor
      if (scriptStepLog) {
        scriptStepLog.textContent = `[Part #${targetChunk.part_number}] ✍️ Memasukkan prompt (${targetChunk.prompt?.length || 0} karakter) ke editor...`;
      }

      await chrome.tabs.sendMessage(tab.id, {
        module: 'scriptGenerator',
        action: 'SCRIPT_FILL_PROMPT',
        payload: {
          promptText: targetChunk.prompt,
        },
      });
      await new Promise((r) => setTimeout(r, 800));

      // STEP 3: Menunggu token media dihitung & klik Run secara native
      if (scriptStepLog) {
        scriptStepLog.textContent = `[Part #${targetChunk.part_number}] ⏳ Menunggu perhitungan token media selesai & mengklik tombol Run...`;
      }

      const clickRes = await chrome.tabs.sendMessage(tab.id, {
        module: 'scriptGenerator',
        action: 'SCRIPT_CLICK_RUN',
        payload: {
          promptText: targetChunk.prompt,
          filename: targetChunk.filename,
        },
      });

      if (!clickRes || !clickRes.success) {
        throw new Error(clickRes?.error || 'Gagal mengeklik tombol Run di AI Studio.');
      }

      // STEP 4: Memantau proses generasi output AI Studio
      if (scriptStepLog) {
        scriptStepLog.textContent = `[Part #${targetChunk.part_number}] 🚀 Model mulai memproses! Memantau hasil output...`;
      }

      let pollRes = null;
      const pollStart = Date.now();
      const maxPollSec = 360;

      while ((Date.now() - pollStart) / 1000 < maxPollSec) {
        await new Promise((r) => setTimeout(r, 4000));
        const elapsedSec = Math.round((Date.now() - pollStart) / 1000);

        try {
          const statusRes = await chrome.tabs.sendMessage(tab.id, {
            module: 'scriptGenerator',
            action: 'SCRIPT_CHECK_STATUS',
          });

          if (statusRes?.status === 'error') {
            pollRes = { hasError: true, errorMessage: statusRes.errorMessage };
            break;
          }

          if (statusRes?.status === 'completed') {
            pollRes = {
              hasError: false,
              rawText: statusRes.rawText,
              cleanedJson: statusRes.cleanedJson,
              parsedJson: statusRes.parsedJson,
              elapsedSec,
            };
            break;
          }

          if (scriptStepLog) {
            scriptStepLog.textContent = `[Part #${targetChunk.part_number}] ⏳ Sedang men-generate naskah... (Detik ke-${elapsedSec})`;
          }
        } catch (tabErr) {
          // Abaikan micro context switch saat AI Studio redirect URL
        }
      }

      if (!pollRes) {
        throw new Error('Timeout: Pemantauan naskah melebihi 6 menit.');
      }

      if (pollRes.hasError) {
        if (scriptStepLog) {
          scriptStepLog.className = 'script-step-log error';
          scriptStepLog.innerHTML = `⚠️ <b>Error AI Studio:</b> "${pollRes.errorMessage}".<br><span style="color: #94a3b8;">Merefresh dan membuka New Chat bersih...</span>`;
        }

        // Requirement 3: Jika terdeteksi error, refresh dan buka New Chat
        try {
          await chrome.tabs.update(tab.id, { url: 'https://aistudio.google.com/prompts/new_chat' });
          await new Promise((r) => setTimeout(r, 4000));
        } catch {}

        throw new Error(`AI Studio error: "${pollRes.errorMessage}". Halaman telah di-reset ke New Chat.`);
      }

      // STEP 5: Simpan ke Supabase & Auto-generate prompt Part berikutnya
      if (scriptStepLog) {
        scriptStepLog.textContent = `[Part #${targetChunk.part_number}] 🎉 Output valid diterima! Menyimpan Full Raw JSON ke Supabase...`;
      }

      const currentSession = activeSessions.find((s) => s.id === sessionSelect.value);
      const movieTitle = currentSession?.title || sessionSelect.value;

      const saveRes = await chrome.tabs.sendMessage(tab.id, {
        module: 'scriptGenerator',
        action: 'SCRIPT_SAVE_AND_CHAIN',
        payload: {
          contentId: sessionSelect.value,
          partNumber: targetChunk.part_number,
          totalParts: currentChunks.length,
          parsedJson: pollRes.parsedJson,
          movieTitle: movieTitle,
        },
      });

      if (scriptStepLog) {
        scriptStepLog.className = 'script-step-log success';
        if (saveRes?.chainedNext) {
          scriptStepLog.innerHTML = `🎉 <b>Part #${targetChunk.part_number} SUKSES!</b> Raw JSON tersimpan di database & Prompt Part #${saveRes.nextPartNumber} berhasil di-generate (${saveRes.nextPromptLength} karakter)!`;
        } else {
          scriptStepLog.innerHTML = `🎉 <b>Part #${targetChunk.part_number} SUKSES!</b> Full Raw JSON berhasil disimpan di database!`;
        }
      }

      // Requirement 1: Jika sudah tersimpan, buka new chat untuk part berikutnya jika ada part lanjutan
      if (saveRes?.chainedNext) {
        console.log('[SidePanel] 🔄 Membuka New Chat bersih untuk part selanjutnya...');
        if (scriptStepLog) {
          scriptStepLog.innerHTML += `<br><span style="color: #38bdf8;">🔄 Membuka New Chat bersih untuk Part #${saveRes.nextPartNumber}...</span>`;
        }
        await chrome.tabs.update(tab.id, { url: 'https://aistudio.google.com/prompts/new_chat' });
        await new Promise((r) => setTimeout(r, 4000));
      }

      await loadChunks(sessionSelect.value);
    } catch (err) {
      console.error('[SidePanel] Script generation error:', err);
      if (scriptStepLog) {
        scriptStepLog.className = 'script-step-log error';
        scriptStepLog.textContent = `❌ Gagal: ${err.message}`;
      }

      // Requirement 3: Jika error eksekusi atau AI Studio, pastikan tab di-reset ke New Chat
      try {
        const [curTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (curTab && curTab.id) {
          await chrome.tabs.update(curTab.id, { url: 'https://aistudio.google.com/prompts/new_chat' }).catch(() => {});
        }
      } catch {}

      throw err;
    } finally {
      isRunningScript = false;
      if (btnRunScript) btnRunScript.disabled = isAutoProgressActive;
      if (scriptSpinner) scriptSpinner.classList.add('hidden');
      await loadChunks(sessionSelect.value);
    }
  }

  // Update tampilan tombol Auto Progress
  function updateAutoProgressUI() {
    if (!btnAutoProgress) return;
    if (isAutoProgressActive) {
      btnAutoProgress.classList.add('active');
      if (autoProgressIcon) autoProgressIcon.textContent = '⏹️';
      if (autoProgressText) autoProgressText.textContent = 'Hentikan Auto Progress';
      if (btnRunScript) btnRunScript.disabled = true;
    } else {
      btnAutoProgress.classList.remove('active');
      if (autoProgressIcon) autoProgressIcon.textContent = '⚡';
      if (autoProgressText) autoProgressText.textContent = 'Auto Progress (Jalankan Semua Part Otomatis)';
      if (btnRunScript) btnRunScript.disabled = isRunningScript;
    }
  }

  // Action: Auto Progress - Menjalankan semua part satu per satu secara otomatis
  async function toggleAutoProgress() {
    if (isAutoProgressActive) {
      isAutoProgressActive = false;
      updateAutoProgressUI();
      if (scriptStepLog) {
        scriptStepLog.className = 'script-step-log warn';
        scriptStepLog.textContent = '⏸️ Auto Progress dihentikan oleh pengguna.';
      }
      return;
    }

    if (isRunningScript) {
      alert('Proses pembuatan naskah saat ini sedang berjalan.');
      return;
    }

    if (!sessionSelect.value) {
      alert('Silakan pilih Active Session terlebih dahulu.');
      return;
    }

    isAutoProgressActive = true;
    updateAutoProgressUI();
    if (scriptLiveStatus) scriptLiveStatus.classList.remove('hidden');

    console.log('[AutoProgress] ⚡ Memulai loop Auto Progress untuk session:', sessionSelect.value);

    while (isAutoProgressActive) {
      // 1. Refresh list part dari Supabase
      const parts = await window.SupabaseBridge.getParts(sessionSelect.value);
      currentChunks = (parts || []).sort((a, b) => Number(a.part_number) - Number(b.part_number));
      renderChunksList();

      // 2. Cari part pertama yang belum selesai (script_status !== 'done')
      const nextPending = currentChunks.find((p) => p.script_status !== 'done' && p.script_status !== 'completed');
      if (!nextPending) {
        if (scriptStepLog) {
          scriptStepLog.className = 'script-step-log success';
          scriptStepLog.innerHTML = `🎉 <b>SELURUH PART SELESAI!</b> Semua naskah (${currentChunks.length} part) telah selesai di-generate & tersimpan di database.`;
        }
        isAutoProgressActive = false;
        updateAutoProgressUI();
        break;
      }

      console.log(`[AutoProgress] 🚀 Memulai Part #${nextPending.part_number}...`);
      if (scriptStepLog) {
        scriptStepLog.className = 'script-step-log';
        scriptStepLog.textContent = `[Auto Progress] 🚀 Menjalankan Part #${nextPending.part_number} (${nextPending.filename})...`;
      }

      let succeeded = false;
      try {
        await runScriptGeneration(nextPending);
        succeeded = true;
      } catch (err) {
        console.error(`[AutoProgress] ⚠️ Kendala di Part #${nextPending.part_number}:`, err);
        if (scriptStepLog) {
          scriptStepLog.className = 'script-step-log warn';
          scriptStepLog.innerHTML = `⚠️ <b>Kendala di Part #${nextPending.part_number}:</b> ${err.message}.<br><span style="color: #94a3b8;">Halaman di-reset ke New Chat, mencoba ulang dalam 6 detik...</span>`;
        }
        // Requirement 3: Refresh & New Chat jika error
        try {
          const tab = await getAIStudioTab();
          if (tab && tab.id) {
            await chrome.tabs.update(tab.id, { url: 'https://aistudio.google.com/prompts/new_chat' });
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 6000));
      }

      if (!isAutoProgressActive) break;

      // Jeda antar-part (3.5 detik) agar tab siap
      if (succeeded) {
        await new Promise((r) => setTimeout(r, 3500));
      }
    }

    isAutoProgressActive = false;
    updateAutoProgressUI();
  }

  if (btnRunScript) {
    btnRunScript.addEventListener('click', async () => {
      await runScriptGeneration();
    });
  }

  if (btnAutoProgress) {
    btnAutoProgress.addEventListener('click', async () => {
      await toggleAutoProgress();
    });
  }

  // ==========================================
  // Video Mapping Automation Controller
  // ==========================================

  // Action: Kirim & Pantau Output Video Mapping via Ekstensi (100% Otomatis)
  async function runMappingGeneration(targetChunk) {
    if (isRunningMapping) return;
    if (!targetChunk) {
      targetChunk = currentChunks.find((c) => c.mapping_status !== 'done' && c.mapping_status !== 'completed');
    }
    if (!targetChunk) {
      alert('Semua part sudah selesai dibuatkan video mapping.');
      return;
    }

    // Safety guard: pastikan mapping prompt sudah diset sebelum mengeksekusi AI Studio
    let hasPrompt = !!(
      (targetChunk.mapping_prompt && targetChunk.mapping_prompt.trim()) ||
      (targetChunk.prompt && targetChunk.prompt.trim())
    );
    if (!hasPrompt) {
      try {
        const freshParts = await window.SupabaseBridge.getParts(sessionSelect.value);
        const freshTarget = freshParts.find((p) => Number(p.part_number) === Number(targetChunk.part_number));
        if (freshTarget?.mapping_prompt?.trim() || freshTarget?.prompt?.trim()) {
          targetChunk = freshTarget;
          hasPrompt = true;
        }
      } catch {}
    }

    if (!hasPrompt) {
      alert(
        `Prompt Video Mapping Part #${targetChunk.part_number} belum ada di Supabase database. Silakan klik tombol "Generate & Simpan Prompt Mapping" di Dashboard Step 5 terlebih dahulu.`
      );
      return;
    }

    isRunningMapping = true;
    if (btnRunMapping) btnRunMapping.disabled = true;
    if (btnAutoProgressMapping) btnAutoProgressMapping.disabled = true;
    if (mappingSpinner) mappingSpinner.classList.remove('hidden');
    if (mappingLiveStatus) mappingLiveStatus.classList.remove('hidden');
    if (mappingStepLog) {
      mappingStepLog.className = 'mapping-step-log';
      mappingStepLog.textContent = `[Part #${targetChunk.part_number}] Menghubungkan ke tab Google AI Studio...`;
    }

    try {
      const tab = await getAIStudioTab();
      if (!tab || !tab.id) {
        throw new Error('Tab Google AI Studio tidak ditemukan. Buka https://aistudio.google.com/prompts/new_chat terlebih dahulu.');
      }

      // Pastikan video mapping prompt tersedia
      let mappingPrompt = targetChunk.mapping_prompt || targetChunk.prompt;
      if (!mappingPrompt) {
        const freshParts = await window.SupabaseBridge.getParts(sessionSelect.value);
        const freshTarget = freshParts.find((p) => Number(p.part_number) === Number(targetChunk.part_number));
        if (freshTarget?.mapping_prompt || freshTarget?.prompt) {
          targetChunk = freshTarget;
          mappingPrompt = freshTarget.mapping_prompt || freshTarget.prompt;
        }
      }

      if (!mappingPrompt) {
        throw new Error(
          `Prompt Video Mapping Part #${targetChunk.part_number} belum ada di Supabase database. Silakan klik tombol "Generate & Simpan Prompt Mapping" di Dashboard Step 5 terlebih dahulu.`
        );
      }

      // STEP 1: Cek apakah video chunk sudah terpasang di AI Studio
      if (mappingStepLog) {
        mappingStepLog.textContent = `[Part #${targetChunk.part_number}] Memeriksa video chunk di prompt editor...`;
      }

      let prepRes = null;
      try {
        prepRes = await chrome.tabs.sendMessage(tab.id, {
          module: 'mappingGenerator',
          action: 'MAPPING_CHECK_PREPARED',
          payload: { filename: targetChunk.filename },
        });
      } catch (connErr) {
        // Coba reinjeksi content scripts jika tab belum siap
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: [
            'lib/supabase.js',
            'lib/prompt-generator.js',
            'content.js',
            'modules/chunk-validator.js',
            'modules/script-generator.js',
            'modules/mapping-generator.js',
          ],
        }).catch(() => {});
        await new Promise((r) => setTimeout(r, 600));
        prepRes = await chrome.tabs.sendMessage(tab.id, {
          module: 'mappingGenerator',
          action: 'MAPPING_CHECK_PREPARED',
          payload: { filename: targetChunk.filename },
        }).catch(() => null);
      }

      // Cek apakah halaman saat ini sudah memiliki output mapping yang SUDAH SELESAI di-generate
      const existingStatus = await chrome.tabs.sendMessage(tab.id, {
        module: 'mappingGenerator',
        action: 'MAPPING_CHECK_STATUS',
      }).catch(() => null);

      if (existingStatus?.status === 'completed' && existingStatus?.parsedJson) {
        const parsedPart = Number(existingStatus.parsedJson.chunk_part);
        const currentTargetPart = Number(targetChunk.part_number);

        if (parsedPart === currentTargetPart || !parsedPart) {
          console.log(`[SidePanel] 🎯 Terdeteksi output Video Mapping Part #${currentTargetPart} sudah selesai di halaman ini! Langsung simpan...`);
          if (mappingStepLog) {
            mappingStepLog.textContent = `[Part #${targetChunk.part_number}] 🎯 Output mapping selesai terdeteksi di halaman saat ini! Menyimpan ke database...`;
          }

          const saveRes = await chrome.tabs.sendMessage(tab.id, {
            module: 'mappingGenerator',
            action: 'MAPPING_SAVE_OUTPUT',
            payload: {
              contentId: sessionSelect.value,
              partNumber: targetChunk.part_number,
              parsedJson: existingStatus.parsedJson,
            },
          });

          if (mappingStepLog) {
            mappingStepLog.className = 'mapping-step-log success';
            mappingStepLog.innerHTML = `🎉 <b>Video Mapping Part #${targetChunk.part_number} SUKSES!</b> ${saveRes?.itemCount || 0} visual mapping tersimpan di Supabase!`;
          }

          // Buka new chat bersih untuk part berikutnya
          console.log('[SidePanel] 🔄 Membuka New Chat bersih untuk part selanjutnya...');
          await chrome.tabs.update(tab.id, { url: 'https://aistudio.google.com/prompts/new_chat' });
          await new Promise((r) => setTimeout(r, 4000));

          await loadChunks(sessionSelect.value);
          return;
        }
      }

      // Cek apakah halaman sudah memiliki turn percakapan sebelumnya
      let turnsRes = await chrome.tabs.sendMessage(tab.id, {
        module: 'mappingGenerator',
        action: 'MAPPING_CHECK_TURNS',
      }).catch(() => null);

      // Jika ada chat turn sebelumnya atau bukan di new_chat, buka new chat bersih
      if (turnsRes?.hasTurns || (!tab.url.includes('/prompts/new_chat') && !prepRes?.hasMedia)) {
        if (mappingStepLog) {
          mappingStepLog.textContent = `[Part #${targetChunk.part_number}] Membuka halaman New Chat bersih di Google AI Studio...`;
        }
        if (tab.url.includes('/prompts/new_chat')) {
          await chrome.tabs.reload(tab.id);
        } else {
          await chrome.tabs.update(tab.id, { url: 'https://aistudio.google.com/prompts/new_chat' });
        }
        await new Promise((r) => setTimeout(r, 4500));
        prepRes = null;
      }

      // Jika belum ada media chunk terpasang, sisipkan otomatis dari Drive!
      if (!prepRes?.hasMedia) {
        if (mappingStepLog) {
          mappingStepLog.textContent = `[Part #${targetChunk.part_number}] 🎬 Membuka Drive Picker & menyisipkan "${targetChunk.filename}"...`;
        }

        const insertRes = await chrome.runtime.sendMessage({
          action: 'SELECT_DRIVE_FILE',
          tabId: tab.id,
          filename: targetChunk.filename,
        });

        if (!insertRes || !insertRes.success) {
          throw new Error(insertRes?.error || `Gagal menyisipkan "${targetChunk.filename}" dari Google Drive.`);
        }

        if (mappingStepLog) {
          mappingStepLog.textContent = `[Part #${targetChunk.part_number}] ⏳ Menunggu kartu video chunk terpasang di prompt editor...`;
        }

        let attached = false;
        for (let i = 0; i < 25; i++) {
          await new Promise((r) => setTimeout(r, 1000));
          const check = await chrome.tabs.sendMessage(tab.id, {
            module: 'mappingGenerator',
            action: 'MAPPING_CHECK_PREPARED',
            payload: { filename: targetChunk.filename },
          }).catch(() => null);
          if (check?.hasMedia) {
            attached = true;
            break;
          }
        }

        if (!attached) {
          throw new Error(`Timeout: Video chunk "${targetChunk.filename}" tidak kunjung terpasang di prompt editor.`);
        }
      }

      // Tunggu hingga token video selesai dihitung (badge tokens muncul & loading selesai)
      if (mappingStepLog) {
        mappingStepLog.textContent = `[Part #${targetChunk.part_number}] ⏳ Menunggu perhitungan token video selesai di AI Studio...`;
      }
      for (let w = 0; w < 30; w++) {
        const readyCheck = await chrome.tabs.sendMessage(tab.id, {
          module: 'mappingGenerator',
          action: 'MAPPING_CHECK_PREPARED',
          payload: { filename: targetChunk.filename },
        }).catch(() => null);
        if (readyCheck?.mediaReady) {
          break;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }

      // STEP 2: Masukkan teks Video Mapping Prompt ke dalam editor
      if (mappingStepLog) {
        mappingStepLog.textContent = `[Part #${targetChunk.part_number}] ✍️ Memasukkan Video Mapping prompt (${mappingPrompt.length} karakter) ke editor...`;
      }

      await chrome.tabs.sendMessage(tab.id, {
        module: 'mappingGenerator',
        action: 'MAPPING_FILL_PROMPT',
        payload: {
          promptText: mappingPrompt,
        },
      });
      await new Promise((r) => setTimeout(r, 800));

      // STEP 3: Menunggu token media dihitung & klik Run secara native
      if (mappingStepLog) {
        mappingStepLog.textContent = `[Part #${targetChunk.part_number}] ⏳ Menunggu tombol Run & mengklik tombol Run...`;
      }

      const clickRes = await chrome.tabs.sendMessage(tab.id, {
        module: 'mappingGenerator',
        action: 'MAPPING_CLICK_RUN',
        payload: {
          promptText: mappingPrompt,
          filename: targetChunk.filename,
        },
      });

      if (!clickRes || !clickRes.success) {
        throw new Error(clickRes?.error || 'Gagal mengeklik tombol Run di AI Studio.');
      }

      // STEP 4: Memantau proses generasi output Video Mapping AI Studio
      if (mappingStepLog) {
        mappingStepLog.textContent = `[Part #${targetChunk.part_number}] 🚀 Model mulai memproses Video Mapping! Memantau hasil output...`;
      }

      let pollRes = null;
      const pollStart = Date.now();
      const maxPollSec = 360;

      while ((Date.now() - pollStart) / 1000 < maxPollSec) {
        await new Promise((r) => setTimeout(r, 4000));
        const elapsedSec = Math.round((Date.now() - pollStart) / 1000);

        try {
          const statusRes = await chrome.tabs.sendMessage(tab.id, {
            module: 'mappingGenerator',
            action: 'MAPPING_CHECK_STATUS',
          });

          if (statusRes?.status === 'error') {
            pollRes = { hasError: true, errorMessage: statusRes.errorMessage };
            break;
          }

          if (statusRes?.status === 'completed') {
            pollRes = {
              hasError: false,
              rawText: statusRes.rawText,
              cleanedJson: statusRes.cleanedJson,
              parsedJson: statusRes.parsedJson,
              elapsedSec,
            };
            break;
          }

          if (mappingStepLog) {
            mappingStepLog.textContent = `[Part #${targetChunk.part_number}] ⏳ Sedang menganalisa & memetakan adegan video... (Detik ke-${elapsedSec})`;
          }
        } catch (tabErr) {
          // Abaikan micro context switch
        }
      }

      if (!pollRes) {
        throw new Error('Timeout: Pemantauan video mapping melebihi 6 menit.');
      }

      if (pollRes.hasError) {
        if (mappingStepLog) {
          mappingStepLog.className = 'mapping-step-log error';
          mappingStepLog.innerHTML = `⚠️ <b>Error AI Studio:</b> "${pollRes.errorMessage}".<br><span style="color: #94a3b8;">Merefresh dan membuka New Chat bersih...</span>`;
        }

        try {
          await chrome.tabs.update(tab.id, { url: 'https://aistudio.google.com/prompts/new_chat' });
          await new Promise((r) => setTimeout(r, 4000));
        } catch {}

        throw new Error(`AI Studio error: "${pollRes.errorMessage}". Halaman telah di-reset ke New Chat.`);
      }

      // STEP 5: Simpan ke Supabase
      if (mappingStepLog) {
        mappingStepLog.textContent = `[Part #${targetChunk.part_number}] 🎉 Output mapping valid! Menyimpan ke Supabase...`;
      }

      const saveRes = await chrome.tabs.sendMessage(tab.id, {
        module: 'mappingGenerator',
        action: 'MAPPING_SAVE_OUTPUT',
        payload: {
          contentId: sessionSelect.value,
          partNumber: targetChunk.part_number,
          parsedJson: pollRes.parsedJson,
        },
      });

      if (mappingStepLog) {
        mappingStepLog.className = 'mapping-step-log success';
        mappingStepLog.innerHTML = `🎉 <b>Video Mapping Part #${targetChunk.part_number} SUKSES!</b> ${saveRes?.itemCount || 0} visual mapping tersimpan di Supabase!`;
      }

      // Reset tab ke New Chat untuk part berikutnya
      try {
        console.log('[SidePanel] 🔄 Membuka New Chat bersih untuk mapping selanjutnya...');
        await chrome.tabs.update(tab.id, { url: 'https://aistudio.google.com/prompts/new_chat' });
        await new Promise((r) => setTimeout(r, 4000));
      } catch {}

      await loadChunks(sessionSelect.value);
    } catch (err) {
      console.error('[SidePanel] Video mapping generation error:', err);
      if (mappingStepLog) {
        mappingStepLog.className = 'mapping-step-log error';
        mappingStepLog.textContent = `❌ Gagal: ${err.message}`;
      }

      try {
        const [curTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (curTab && curTab.id) {
          await chrome.tabs.update(curTab.id, { url: 'https://aistudio.google.com/prompts/new_chat' }).catch(() => {});
        }
      } catch {}

      throw err;
    } finally {
      isRunningMapping = false;
      if (btnRunMapping) btnRunMapping.disabled = isAutoProgressMappingActive;
      if (mappingSpinner) mappingSpinner.classList.add('hidden');
      await loadChunks(sessionSelect.value);
    }
  }

  // Update tampilan tombol Auto Progress Video Mapping
  function updateAutoProgressMappingUI() {
    if (!btnAutoProgressMapping) return;
    if (isAutoProgressMappingActive) {
      btnAutoProgressMapping.classList.add('active');
      if (autoProgressMappingIcon) autoProgressMappingIcon.textContent = '⏹️';
      if (autoProgressMappingText) autoProgressMappingText.textContent = 'Hentikan Auto Progress Mapping';
      if (btnRunMapping) btnRunMapping.disabled = true;
    } else {
      btnAutoProgressMapping.classList.remove('active');
      if (autoProgressMappingIcon) autoProgressMappingIcon.textContent = '⚡';
      if (autoProgressMappingText) autoProgressMappingText.textContent = 'Auto Progress Mapping (Semua Part)';

      const targetMappingPart = currentChunks.find(c => c.mapping_status !== 'done' && c.mapping_status !== 'completed');
      const hasTargetPrompt = !!(
        targetMappingPart &&
        ((targetMappingPart.mapping_prompt && targetMappingPart.mapping_prompt.trim().length > 0) ||
         (targetMappingPart.prompt && targetMappingPart.prompt.trim().length > 0))
      );

      if (btnRunMapping) {
        btnRunMapping.disabled = isRunningMapping || !hasTargetPrompt || !targetMappingPart;
      }
      if (btnAutoProgressMapping) {
        btnAutoProgressMapping.disabled = isRunningMapping || !hasTargetPrompt || !targetMappingPart;
        if (!hasTargetPrompt && targetMappingPart) {
          btnAutoProgressMapping.title = `Prompt Video Mapping Part #${targetMappingPart.part_number} belum diset.`;
        } else {
          btnAutoProgressMapping.title = '';
        }
      }
    }
  }

  // Action: Auto Progress Video Mapping (Jalankan semua part secara berurutan)
  async function toggleAutoProgressMapping() {
    if (isAutoProgressMappingActive) {
      isAutoProgressMappingActive = false;
      updateAutoProgressMappingUI();
      if (mappingStepLog) {
        mappingStepLog.className = 'mapping-step-log warn';
        mappingStepLog.textContent = '⏸️ Auto Progress Video Mapping dihentikan pengguna.';
      }
      return;
    }

    if (isRunningMapping) {
      alert('Proses Video Mapping saat ini sedang berjalan.');
      return;
    }

    if (!sessionSelect.value) {
      alert('Silakan pilih Active Session terlebih dahulu.');
      return;
    }

    const targetPending = currentChunks.find((p) => p.mapping_status !== 'done' && p.mapping_status !== 'completed');
    if (!targetPending) {
      alert('Semua part sudah selesai dibuatkan video mapping.');
      return;
    }

    const hasInitialPrompt = !!(
      (targetPending.mapping_prompt && targetPending.mapping_prompt.trim()) ||
      (targetPending.prompt && targetPending.prompt.trim())
    );
    if (!hasInitialPrompt) {
      alert(`Prompt Video Mapping Part #${targetPending.part_number} belum diset di Supabase. Silakan set/simpan prompt mapping di Dashboard Step 5 terlebih dahulu.`);
      return;
    }

    isAutoProgressMappingActive = true;
    updateAutoProgressMappingUI();
    if (mappingLiveStatus) mappingLiveStatus.classList.remove('hidden');

    console.log('[AutoProgressMapping] ⚡ Memulai loop Auto Progress Video Mapping:', sessionSelect.value);

    while (isAutoProgressMappingActive) {
      const parts = await window.SupabaseBridge.getParts(sessionSelect.value);
      currentChunks = (parts || []).sort((a, b) => Number(a.part_number) - Number(b.part_number));
      renderChunksList();

      const nextPending = currentChunks.find((p) => p.mapping_status !== 'done' && p.mapping_status !== 'completed');
      if (!nextPending) {
        if (mappingStepLog) {
          mappingStepLog.className = 'mapping-step-log success';
          mappingStepLog.innerHTML = `🎉 <b>SELURUH VIDEO MAPPING SELESAI!</b> Semua part (${currentChunks.length} part) telah selesai dipetakan & tersimpan di database.`;
        }
        isAutoProgressMappingActive = false;
        updateAutoProgressMappingUI();
        break;
      }

      const hasLoopPrompt = !!(
        (nextPending.mapping_prompt && nextPending.mapping_prompt.trim()) ||
        (nextPending.prompt && nextPending.prompt.trim())
      );
      if (!hasLoopPrompt) {
        if (mappingStepLog) {
          mappingStepLog.className = 'mapping-step-log warn';
          mappingStepLog.innerHTML = `⚠️ <b>Auto Progress Terhenti:</b> Prompt Video Mapping Part #${nextPending.part_number} belum diset. Silakan generate & simpan prompt mapping di Dashboard Step 5.`;
        }
        isAutoProgressMappingActive = false;
        updateAutoProgressMappingUI();
        break;
      }

      console.log(`[AutoProgressMapping] 🚀 Memulai Part #${nextPending.part_number}...`);
      if (mappingStepLog) {
        mappingStepLog.className = 'mapping-step-log';
        mappingStepLog.textContent = `[Auto Progress Mapping] 🚀 Menjalankan Part #${nextPending.part_number} (${nextPending.filename})...`;
      }

      let succeeded = false;
      try {
        await runMappingGeneration(nextPending);
        succeeded = true;
      } catch (err) {
        console.error(`[AutoProgressMapping] ⚠️ Kendala di Part #${nextPending.part_number}:`, err);
        if (mappingStepLog) {
          mappingStepLog.className = 'mapping-step-log warn';
          mappingStepLog.innerHTML = `⚠️ <b>Kendala di Part #${nextPending.part_number}:</b> ${err.message}.<br><span style="color: #94a3b8;">Halaman di-reset ke New Chat, mencoba ulang dalam 6 detik...</span>`;
        }
        try {
          const tab = await getAIStudioTab();
          if (tab && tab.id) {
            await chrome.tabs.update(tab.id, { url: 'https://aistudio.google.com/prompts/new_chat' });
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 6000));
      }

      if (!isAutoProgressMappingActive) break;

      if (succeeded) {
        await new Promise((r) => setTimeout(r, 3500));
      }
    }

    isAutoProgressMappingActive = false;
    updateAutoProgressMappingUI();
  }

  if (btnRunMapping) {
    btnRunMapping.addEventListener('click', async () => {
      await runMappingGeneration();
    });
  }

  if (btnAutoProgressMapping) {
    btnAutoProgressMapping.addEventListener('click', async () => {
      await toggleAutoProgressMapping();
    });
  }

  sessionSelect.addEventListener('change', (e) => {
    onSessionChanged(e.target.value);
  });

  btnRefresh.addEventListener('click', async () => {
    await initConnection();
  });

  btnOpenAIStudio.addEventListener('click', () => {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url: 'https://aistudio.google.com/prompts/new_chat' });
    } else {
      window.open('https://aistudio.google.com/prompts/new_chat', '_blank');
    }
  });

  // Tab Navigation Handling
  function switchTab(tabName) {
    if (tabName === 'elevenlabs') {
      tabBtnAiStudio?.classList.remove('active');
      tabBtnAiStudio?.setAttribute('aria-selected', 'false');
      tabBtnElevenLabs?.classList.add('active');
      tabBtnElevenLabs?.setAttribute('aria-selected', 'true');

      viewAiStudio?.classList.add('hidden');
      viewElevenLabs?.classList.remove('hidden');

      if ((!currentChunks || currentChunks.length === 0) && sessionSelect?.value) {
        loadChunks(sessionSelect.value);
      } else {
        renderTtsPartsList();
      }
    } else {
      tabBtnElevenLabs?.classList.remove('active');
      tabBtnElevenLabs?.setAttribute('aria-selected', 'false');
      tabBtnAiStudio?.classList.add('active');
      tabBtnAiStudio?.setAttribute('aria-selected', 'true');

      viewElevenLabs?.classList.add('hidden');
      viewAiStudio?.classList.remove('hidden');
    }

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ extensionActiveTab: tabName }).catch(() => {});
    } else {
      try { localStorage.setItem('extensionActiveTab', tabName); } catch (e) {}
    }
  }

  tabBtnAiStudio?.addEventListener('click', () => switchTab('aistudio'));
  tabBtnElevenLabs?.addEventListener('click', () => switchTab('elevenlabs'));

  if (btnOpenElevenLabs) {
    btnOpenElevenLabs.addEventListener('click', async () => {
      const url = 'https://elevenlabs.io/app/speech-synthesis';
      if (typeof chrome !== 'undefined' && chrome.tabs) {
        try {
          const tabs = await chrome.tabs.query({});
          const existing = tabs.find((t) => t.url && t.url.toLowerCase().includes('elevenlabs.io'));
          if (existing && existing.id) {
            await chrome.tabs.update(existing.id, { active: true });
            if (existing.windowId) {
              await chrome.windows.update(existing.windowId, { focused: true }).catch(() => {});
            }
            return;
          }
          await chrome.tabs.create({ url });
        } catch (e) {
          window.open(url, '_blank');
        }
      } else {
        window.open(url, '_blank');
      }
    });
  }

  if (btnManualSignOutElevenLabs) {
    btnManualSignOutElevenLabs.addEventListener('click', async () => {
      btnManualSignOutElevenLabs.disabled = true;
      btnManualSignOutElevenLabs.textContent = '⏳ Logout...';
      setSignupStatus('🚪 Mengirim perintah logout UI ke tab ElevenLabs aktif...', 'warn');
      try {
        const res = await chrome.runtime.sendMessage({ action: 'SIGN_OUT_ELEVENLABS' });
        if (res && res.success) {
          setSignupStatus('✅ Berhasil Logout dari UI ElevenLabs! Sesi akun ditutup.', 'success');
        } else {
          setSignupStatus(`⚠️ Selesai: ${res?.error || 'Tab mungkin sudah di /sign-in'}`, 'warn');
        }
      } catch (err) {
        setSignupStatus(`❌ Gagal Logout: ${err.message}`, 'error');
      } finally {
        btnManualSignOutElevenLabs.disabled = false;
        btnManualSignOutElevenLabs.innerHTML = '<span>🚪 Logout UI</span>';
      }
    });
  }

  // --- ElevenLabs Auto-Signup & Account Management Logic ---
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function generateRandomEmail() {
    const roots = [
      'jovan', 'tama', 'rizky', 'bima', 'satria', 'fajar', 'bayu', 'indra',
      'aditya', 'reza', 'arya', 'vito', 'denis', 'putra', 'kresna', 'daffa',
      'naufal', 'fauzan', 'alvin', 'dimas', 'gilang', 'hafiz', 'zaki', 'zidan',
      'kenzo', 'miko', 'raffi', 'rio', 'kevin', 'adrian', 'farhan', 'rendi',
      'aldo', 'surya', 'angga', 'arief', 'dani', 'ihsan', 'ilham', 'teguh',
      'wahyu', 'yogi', 'andi', 'bagus', 'dika', 'eko', 'firman', 'galih',
      'hadi', 'irwan', 'kurnia', 'lukman', 'maulana', 'nur', 'panji', 'radit',
      'sandy', 'taufik', 'wawan', 'yuda', 'aril', 'bastian', 'candra', 'derry'
    ];

    const tags = ['dev', 'pro', 'id', 'hub', 'box', 'tech', 'net', 'vox', 'flow', 'byte', 'core', 'one', 'cast', 'lab', 'work', 'cloud'];

    const consonants = ['b', 'c', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'w', 'z'];
    const vowels = ['a', 'e', 'i', 'o', 'u'];

    function makePhoneticName() {
      const syllableCount = Math.floor(Math.random() * 2) + 2; // 2 or 3 suku kata
      let res = '';
      for (let i = 0; i < syllableCount; i++) {
        res += consonants[Math.floor(Math.random() * consonants.length)];
        res += vowels[Math.floor(Math.random() * vowels.length)];
      }
      if (Math.random() > 0.4) {
        res += consonants[Math.floor(Math.random() * consonants.length)];
      }
      return res;
    }

    const mode = Math.random();
    let username = '';

    if (mode < 0.35) {
      // Pola 1: Root + angka dinamis (e.g. jovan496, tama821, alvin732)
      const root = roots[Math.floor(Math.random() * roots.length)];
      const num = Math.floor(100 + Math.random() * 900);
      username = root + num;
    } else if (mode < 0.65) {
      // Pola 2: Root + Tag teknis + angka dinamis (e.g. tamadev82, jovanpro91, rizkyvox44)
      const root = roots[Math.floor(Math.random() * roots.length)];
      const tag = tags[Math.floor(Math.random() * tags.length)];
      const num = Math.floor(10 + Math.random() * 990);
      username = root + tag + num;
    } else if (mode < 0.85) {
      // Pola 3: Dynamic Phonetic Syllables + angka (e.g. kelvan72, ravix839, tonik613)
      const phonetic = makePhoneticName();
      const num = Math.floor(100 + Math.random() * 900);
      username = phonetic + num;
    } else {
      // Pola 4: Kombinasi dua kata natural + angka (e.g. jovan.kurnia48, tama.satria912)
      const r1 = roots[Math.floor(Math.random() * roots.length)];
      const r2 = roots[Math.floor(Math.random() * roots.length)];
      const num = Math.floor(10 + Math.random() * 990);
      username = (r1 !== r2) ? (r1 + '.' + r2 + num) : (r1 + num);
    }

    return `${username.toLowerCase()}@riztama.my.id`;
  }

  function setSignupStatus(text, type = 'normal') {
    if (!signupLiveStatus || !signupStepLog) return;
    signupLiveStatus.classList.remove('hidden');
    signupStepLog.className = 'signup-step-log';
    if (type === 'success') signupStepLog.classList.add('success');
    if (type === 'error') signupStepLog.classList.add('error');
    if (type === 'warn') signupStepLog.classList.add('warn');
    signupStepLog.textContent = text;
  }

  /**
   * Konversi semua tag kurung siku [...] (seperti [VISUAL_ONLY], [pause], dll) menjadi [pauses]
   * Persis seperti yang ada di aplikasi Electron (convertToElevenLabsTtsScript)
   */
  function convertTagsToElevenLabsPauses(rawScript) {
    if (!rawScript || typeof rawScript !== 'string') return '';

    let result = rawScript;

    // 1. Ubah semua tag [VISUAL_ONLY...] menjadi [pauses]
    result = result.replace(/\[VISUAL_ONLY[^\]]*\]/gi, '[pauses]');

    // 2. Ubah semua tag dalam kurung siku [...] lainnya menjadi [pauses]
    result = result.replace(/\[[^\]]+\]/g, '[pauses]');

    // 3. Bersihkan tag HTML/SSML (misal <break time="..."/>) jika ada
    result = result.replace(/<[^>]+>/g, '');

    // 4. Gabungkan duplikasi jeda [pauses] yang berurutan agar rapi dengan format paragraf
    result = result.replace(/(\s*\[pauses\]\s*)+/gi, '\n\n[pauses]\n\n');

    // 5. Rapikan spasi berlebih
    result = result
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n\s*\n+/g, '\n\n')
      .trim();

    return result;
  }

  /**
   * Ekstraksi teks naskah narasi voiceover dari output JSON Gemini AI Studio
   */
  function extractScriptText(scriptOutput) {
    if (!scriptOutput) return '';
    let parsed = scriptOutput;
    if (typeof scriptOutput === 'string') {
      try {
        parsed = JSON.parse(scriptOutput);
      } catch (e) {
        return convertTagsToElevenLabsPauses(scriptOutput.trim());
      }
    }

    let raw = '';
    if (parsed.naskah_voiceover) {
      const nv = parsed.naskah_voiceover;
      if (typeof nv === 'string') raw = nv.trim();
      else if (Array.isArray(nv)) {
        raw = nv.map((s) => s.narasi || s.text || s.script_text || s.dialog || '').filter(Boolean).join(' ').trim();
      } else if (typeof nv === 'object') {
        if (nv.script_text && typeof nv.script_text === 'string') raw = nv.script_text.trim();
        else if (nv.narasi && typeof nv.narasi === 'string') raw = nv.narasi.trim();
        else if (nv.text && typeof nv.text === 'string') raw = nv.text.trim();
      }
    }

    if (!raw && parsed.script_text && typeof parsed.script_text === 'string') {
      raw = parsed.script_text.trim();
    }
    if (!raw && parsed.narasi && typeof parsed.narasi === 'string') {
      raw = parsed.narasi.trim();
    }
    if (!raw && parsed.voiceover && typeof parsed.voiceover === 'string') {
      raw = parsed.voiceover.trim();
    }
    if (!raw && parsed.naskah && typeof parsed.naskah === 'string') {
      raw = parsed.naskah.trim();
    }

    if (!raw && (Array.isArray(parsed.scenes) || Array.isArray(parsed.segments))) {
      const arr = parsed.scenes || parsed.segments;
      raw = arr.map((s) => s.narasi || s.voiceover || s.text || s.script_text || '').filter(Boolean).join(' ').trim();
    }

    return convertTagsToElevenLabsPauses(raw);
  }

  /**
   * Sesuai request: List yang dibawah HANYA list narasi aja yang siap copy biar lebih mudah.
   */
  function renderTtsPartsList() {
    if (!ttsPartsList) return;
    ttsPartsList.innerHTML = '';

    if (!currentChunks || currentChunks.length === 0) {
      if (ttsPartsCountBadge) ttsPartsCountBadge.textContent = '0 Part';
      ttsPartsList.innerHTML = `
        <div class="empty-state">
          <span>Belum ada chunk part untuk session ini. Pilih session di tab AI Studio terlebih dahulu.</span>
        </div>`;
      return;
    }

    const readyCount = currentChunks.filter((c) => !!extractScriptText(c.script_output)).length;
    if (ttsPartsCountBadge) {
      ttsPartsCountBadge.textContent = `${readyCount}/${currentChunks.length} Script Ready`;
    }

    currentChunks.forEach((chunk) => {
      const scriptText = extractScriptText(chunk.script_output);
      const hasScript = scriptText.length > 0;
      const charCount = scriptText.length;
      const wordCount = hasScript ? scriptText.split(/\s+/).filter(Boolean).length : 0;
      const snippet = hasScript
        ? (scriptText.length > 150 ? scriptText.slice(0, 150) + '...' : scriptText)
        : 'Script narasi belum digenerate di AI Studio. Buka tab AI Studio lalu klik Generate Script.';

      const card = document.createElement('div');
      card.className = `chunk-card ${hasScript ? 'is-uploaded' : ''}`;
      card.id = `tts-chunk-card-${chunk.part_number}`;

      const statusTagClass = hasScript ? 'uploaded' : 'pending';
      const statusTagText = hasScript ? `✓ ${charCount} Karakter` : '⏳ Belum Ada Script';

      card.innerHTML = `
        <div class="chunk-top">
          <div style="display: flex; align-items: center; gap: 6px; min-width: 0;">
            <span class="chunk-part">Part #${chunk.part_number}</span>
            <span class="chunk-name" title="${chunk.filename}">${chunk.filename}</span>
          </div>
          <span class="status-tag ${statusTagClass}">${statusTagText}</span>
        </div>
        <div class="tts-script-snippet" style="font-size: 11px; line-height: 1.4; color: ${hasScript ? '#cbd5e1' : '#64748b'}; background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 6px; padding: 6px 8px; margin: 4px 0; max-height: 70px; overflow-y: auto;">
          ${snippet}
        </div>
        <div class="chunk-details" style="margin-top: 4px; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 10px; color: #94a3b8;">${hasScript ? `📝 ${wordCount} kata` : 'Generate di Tab AI Studio'}</span>
          <div class="chunk-actions">
            ${hasScript ? `
              <button class="btn-copy btn-tts-copy" data-part="${chunk.part_number}" style="padding: 4px 12px; font-size: 11px; font-weight: 600; background: rgba(59, 130, 246, 0.2); border: 1px solid rgba(59, 130, 246, 0.5); color: #93c5fd; border-radius: 5px; cursor: pointer;" title="Salin naskah narasi ([pauses] formatted) ke clipboard">📋 Salin Narasi</button>
            ` : `
              <span style="font-size: 10px; color: #64748b;">(Belum ada script)</span>
            `}
          </div>
        </div>
      `;

      // Event listener: Copy Naskah langsung siap paste
      const btnCopy = card.querySelector('.btn-tts-copy');
      if (btnCopy) {
        btnCopy.addEventListener('click', async () => {
          await navigator.clipboard.writeText(scriptText);
          btnCopy.textContent = '✓ Tersalin!';
          btnCopy.style.background = 'rgba(16, 185, 129, 0.25)';
          btnCopy.style.color = '#6ee7b7';
          btnCopy.style.borderColor = 'rgba(16, 185, 129, 0.6)';
          setTimeout(() => {
            btnCopy.textContent = '📋 Salin Narasi';
            btnCopy.style.background = 'rgba(59, 130, 246, 0.2)';
            btnCopy.style.color = '#93c5fd';
            btnCopy.style.borderColor = 'rgba(59, 130, 246, 0.5)';
          }, 1800);
        });
      }

      ttsPartsList.appendChild(card);
    });
  }

  /**
   * Helper untuk mendengarkan progress real-time dan menunggu tab ElevenLabs mencapai Dashboard
   */
  function waitForDashboardCompletion(email, timeoutMs = 85000) {
    return new Promise((resolve) => {
      let timeoutId;

      function listener(msg) {
        if (msg.action === 'ELEVENLABS_FLOW_STEP') {
          const { step, message } = msg.payload || {};
          if (message) {
            setSignupStatus(`[${(step || 'FLOW').toUpperCase()}] ${message}`, 'warn');
          }
        }
        if (msg.action === 'ELEVENLABS_ONBOARDING_COMPLETED') {
          if (!email || !msg.payload?.email || msg.payload.email === email) {
            cleanup();
            resolve({ success: true, ...msg.payload });
          }
        }
      }

      function cleanup() {
        clearTimeout(timeoutId);
        if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
          chrome.runtime.onMessage.removeListener(listener);
        }
      }

      timeoutId = setTimeout(() => {
        cleanup();
        resolve({ success: false, timeout: true });
      }, timeoutMs);

      if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.addListener(listener);
      }
    });
  }

  /**
   * Alur jelas & stabil pendaftaran akun ElevenLabs:
   * Signup ➜ Kirim verify link ➜ Ambil link nya ➜ Login/Aktivasi ➜ Lewati Onboarding ➜ Setup Voice Setting
   * "Dah itu aja nggak usah yang aneh aneh"
   */
  async function handleAutoSignupElevenLabs() {
    if (isSigningUpElevenLabs) return;

    let email = (inputSignupEmail?.value || '').trim();
    if (!email || !email.includes('@')) {
      email = generateRandomEmail();
      if (inputSignupEmail) inputSignupEmail.value = email;
    }
    const password = (inputSignupPassword?.value || '').trim() || 'Jovan@1224';

    isSigningUpElevenLabs = true;
    if (btnAutoSignupElevenLabs) btnAutoSignupElevenLabs.disabled = true;
    if (signupSpinner) signupSpinner.classList.remove('hidden');
    if (signupBtnText) signupBtnText.textContent = '1/5 Menyimpan ke DB...';
    setSignupStatus(`1/5 Menyimpan kredensial ${email} ke Supabase Cloud...`, 'warn');

    try {
      // 1. Simpan ke Supabase (pending_verification)
      try {
        await window.SupabaseBridge.saveElevenLabsAccount({
          email,
          password,
          status: 'pending_verification',
          credits_remaining: 10000,
        });
        setSignupStatus(`1/5 Kredensial tersimpan di Supabase! Membuka form pendaftaran...`, 'warn');
      } catch (dbErr) {
        console.warn('[ElevenLabs] Warning saat simpan ke Supabase:', dbErr);
        setSignupStatus(`⚠️ Gagal simpan DB (${dbErr.message}), tetap lanjut registrasi...`, 'warn');
      }

      // 2. Buka tab & form sign up ElevenLabs
      if (signupBtnText) signupBtnText.textContent = '2/5 Mendaftar di form...';
      setSignupStatus(`2/5 Mengisi form & mendaftar di https://elevenlabs.io/app/sign-up...`, 'warn');

      const signupRes = await chrome.runtime.sendMessage({
        action: 'OPEN_AND_SIGNUP_ELEVENLABS',
        payload: { email, password },
      });

      if (!signupRes || !signupRes.success) {
        if (signupRes?.alreadyExists) {
          setSignupStatus(`ℹ️ Akun ${email} sudah terdaftar. Melakukan login otomatis...`, 'warn');
          await chrome.runtime.sendMessage({
            action: 'NAVIGATE_ELEVENLABS_TAB',
            payload: { tabId: signupRes.tabId, url: 'https://elevenlabs.io/app/sign-in' },
          });
          await sleep(2500);
          await chrome.runtime.sendMessage({
            action: 'EXECUTE_ELEVENLABS_SIGNIN',
            payload: { email, password, tabId: signupRes.tabId },
          });
          await sleep(2500);
        } else {
          throw new Error(signupRes?.error || 'Gagal mengeksekusi pendaftaran akun di tab ElevenLabs.');
        }
      }

      // 3. Ambil link verifikasi dari inbox Gmail
      if (signupBtnText) signupBtnText.textContent = '3/5 Mengambil link verifikasi...';
      setSignupStatus(`3/5 Form terkirim! Membuka Gmail untuk mengambil link verifikasi...`, 'warn');

      if (!window.ElevenLabsVerify) {
        throw new Error('Modul ElevenLabsVerify belum terpasang.');
      }

      const verifyRes = await window.ElevenLabsVerify.pollForVerifyUrl(email, {
        initialDelayMs: 2500,
        maxWaitSeconds: 120,
        pollIntervalMs: 3500,
        onProgress: (msg) => setSignupStatus(`3/5 ${msg}`, 'warn'),
      });

      if (!verifyRes || !verifyRes.verifyUrl) {
        throw new Error('Link verifikasi tidak ditemukan di inbox.');
      }

      // Simpan link verifikasi ke Supabase
      await window.SupabaseBridge.updateElevenLabsAccount(email, {
        verification_link: verifyRes.verifyUrl,
      });

      // 4. Buka link verifikasi, login, & lewati onboarding sampai Dashboard
      if (signupBtnText) signupBtnText.textContent = '4/5 Verifikasi & lewati onboarding...';
      setSignupStatus(`4/5 Membuka link verifikasi, login, & melewati onboarding sampai Dashboard...`, 'warn');

      const dashboardPromise = waitForDashboardCompletion(email, 85000);

      await chrome.runtime.sendMessage({
        action: 'VERIFY_ELEVENLABS_ACCOUNT',
        payload: {
          verifyUrl: verifyRes.verifyUrl,
          tabId: signupRes?.tabId,
          email,
          password,
        },
      });

      const dashboardResult = await dashboardPromise;
      if (!dashboardResult || !dashboardResult.success) {
        console.warn('[ElevenLabs] Dashboard completion timeout/manual check.');
      }

      // Pastikan tab berada di halaman Text-to-Speech
      let reachedTts = false;
      for (let wait = 0; wait < 25; wait++) {
        const tabCheck = await chrome.runtime.sendMessage({ action: 'GET_ELEVENLABS_STATUS' });
        if (tabCheck?.status === 'DASHBOARD_TTS') {
          reachedTts = true;
          break;
        }
        if (tabCheck?.status === 'DASHBOARD_HOME') {
          setSignupStatus('Mengarahkan ke halaman Text-to-Speech...', 'warn');
          await chrome.runtime.sendMessage({
            action: 'NAVIGATE_ELEVENLABS_TAB',
            payload: { tabId: tabCheck.tabId, url: 'https://elevenlabs.io/app/speech-synthesis/text-to-speech' }
          });
          await sleep(2500);
          reachedTts = true;
          break;
        }
        if (tabCheck?.status === 'ONBOARDING') {
          setSignupStatus(`Menyelesaikan langkah onboarding ElevenLabs (${wait}s)...`, 'warn');
          await chrome.runtime.sendMessage({
            action: 'EXECUTE_POST_VERIFY_ONBOARDING',
            payload: { tabId: tabCheck.tabId }
          }).catch(() => {});
        }
        await sleep(1200);
      }

      if (!reachedTts) {
        await chrome.runtime.sendMessage({
          action: 'NAVIGATE_ELEVENLABS_TAB',
          payload: { url: 'https://elevenlabs.io/app/speech-synthesis/text-to-speech' }
        });
        await sleep(3000);
      }

      // 5. Setup voice setting: Dany Saputra, Eleven v3, Robust
      if (signupBtnText) signupBtnText.textContent = '5/5 Setup voice setting...';
      setSignupStatus(`5/5 Mengonfigurasi Voice Setting (Dany Saputra, Eleven v3, Robust)...`, 'warn');
      await sleep(2000);

      try {
        await chrome.runtime.sendMessage({
          action: 'CONFIGURE_ELEVENLABS_TTS',
          payload: {
            voiceName: 'Dany Saputra',
            modelName: 'Eleven v3',
            stability: 'robust',
          },
        });
      } catch (cfgErr) {
        console.warn('[ElevenLabs] Voice setting warning:', cfgErr.message);
      }

      // Update akun aktif di Supabase
      await window.SupabaseBridge.updateElevenLabsAccount(email, {
        status: 'active',
      });

      setSignupStatus(
        `🎉 SELESAI! Akun ${email} aktif, onboarding dilewati, dan Voice Setting (Dany Saputra + Eleven v3 + Robust) telah siap! Silakan salin naskah narasi di bawah.`,
        'success'
      );

      // Buat email acak baru untuk pendaftaran berikutnya
      if (inputSignupEmail) {
        inputSignupEmail.value = generateRandomEmail();
      }
    } catch (err) {
      console.error('[ElevenLabs Flow Error]', err);
      setSignupStatus(`❌ Gagal: ${err.message}`, 'error');
    } finally {
      isSigningUpElevenLabs = false;
      if (btnAutoSignupElevenLabs) btnAutoSignupElevenLabs.disabled = false;
      if (signupSpinner) signupSpinner.classList.add('hidden');
      if (signupBtnText) signupBtnText.textContent = '🚀 Mulai Proses Otomasi (Signup ➔ Setup Voice)';
    }
  }

  // Setup ElevenLabs listeners & default values
  if (inputSignupEmail && !inputSignupEmail.value) {
    inputSignupEmail.value = generateRandomEmail();
  }

  btnRegenEmail?.addEventListener('click', () => {
    if (inputSignupEmail) {
      inputSignupEmail.value = generateRandomEmail();
    }
  });

  btnAutoSignupElevenLabs?.addEventListener('click', async () => {
    await handleAutoSignupElevenLabs();
  });

  async function handleDirectVerifyUrl() {
    const url = (inputManualVerifyUrl?.value || '').trim();
    if (!url || !url.startsWith('http')) {
      setSignupStatus('Format URL verifikasi tidak valid. Salin tautan lengkap dari tombol "Verify email" di Gmail.', 'error');
      return;
    }
    const targetEmail = (inputSignupEmail?.value || '').trim();
    if (btnProcessManualVerify) btnProcessManualVerify.disabled = true;
    setSignupStatus(`1/3 Memproses verifikasi manual...`, 'warn');

    try {
      if (targetEmail) {
        await window.SupabaseBridge.updateElevenLabsAccount(targetEmail, {
          verification_link: url,
        });
      }

      const dashboardPromise = waitForDashboardCompletion(targetEmail, 85000);
      setSignupStatus(`2/3 Membuka tab verifikasi, konfirmasi akun, login & lewati onboarding...`, 'warn');

      await chrome.runtime.sendMessage({
        action: 'VERIFY_ELEVENLABS_ACCOUNT',
        payload: {
          verifyUrl: url,
          email: targetEmail,
          password: (inputSignupPassword?.value || '').trim() || 'Jovan@1224',
        },
      });

      const res = await dashboardPromise;

      // Setup Voice Setting: Dany Saputra, Eleven v3, Robust
      setSignupStatus(`3/3 Menyiapkan Voice Setting (Dany Saputra, Eleven v3, Robust)...`, 'warn');
      await sleep(2000);
      try {
        await chrome.runtime.sendMessage({
          action: 'CONFIGURE_ELEVENLABS_TTS',
          payload: {
            voiceName: 'Dany Saputra',
            modelName: 'Eleven v3',
            stability: 'robust',
          },
        });
      } catch (cfgErr) {
        console.warn('[DirectVerify] Voice setting warning:', cfgErr.message);
      }

      if (targetEmail) {
        await window.SupabaseBridge.updateElevenLabsAccount(targetEmail, {
          status: 'active',
        });
      }

      setSignupStatus(`🎉 BERHASIL TOTAL! Akun ${targetEmail || ''} terverifikasi & Voice Setting telah siap!`, 'success');
      if (inputManualVerifyUrl) inputManualVerifyUrl.value = '';
    } catch (err) {
      console.error('[DirectVerify Error]', err);
      setSignupStatus(`❌ Gagal: ${err.message}`, 'error');
    } finally {
      if (btnProcessManualVerify) btnProcessManualVerify.disabled = false;
    }
  }

  btnProcessManualVerify?.addEventListener('click', async () => {
    await handleDirectVerifyUrl();
  });

  inputManualVerifyUrl?.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      await handleDirectVerifyUrl();
    }
  });

  btnRefreshTtsParts?.addEventListener('click', async () => {
    const targetSession = sessionSelect?.value || (activeSessions?.[0]?.id);
    if (targetSession) {
      setSignupStatus('Memperbarui daftar narasi dari Supabase...', 'warn');
      await loadChunks(targetSession);
      setSignupStatus('Daftar narasi berhasil diperbarui!', 'success');
    } else {
      await loadSessions();
    }
  });

  btnOpenElevenLabs?.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://elevenlabs.io/app/speech-synthesis' });
  });

  btnManualSignOutElevenLabs?.addEventListener('click', async () => {
    setSignupStatus('Memproses Sign Out akun ElevenLabs...', 'warn');
    try {
      await chrome.runtime.sendMessage({ action: 'SIGN_OUT_ELEVENLABS' });
      setSignupStatus('Berhasil Sign Out dari ElevenLabs.', 'success');
    } catch (e) {
      setSignupStatus(`Gagal Sign Out: ${e.message}`, 'error');
    }
  });

  // Initial connection
  await initConnection();

  // Restore saved active tab after initial data is loaded
  try {
    const saved = await safeStorageGet(['extensionActiveTab']);
    if (saved?.extensionActiveTab === 'elevenlabs') {
      switchTab('elevenlabs');
    }
  } catch (e) {}

  // Listener notifikasi jika tab ElevenLabs telah berhasil menyelesaikan auto-skip onboarding & sampai di dashboard
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.action === 'ELEVENLABS_ONBOARDING_COMPLETED') {
        const { email } = msg.payload || {};
        setSignupStatus(`🎉 DASHBOARD TERCAPAI! Akun ${email || ''} telah siap digunakan di ElevenLabs!`, 'success');
      }
    });
  }
});

