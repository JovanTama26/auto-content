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

  // Bulk action elements
  const btnUploadAll = document.getElementById('btnUploadAll');
  const bulkSpinner = document.getElementById('bulkSpinner');
  const bulkUploadText = document.getElementById('bulkUploadText');
  const bulkProgressBarContainer = document.getElementById('bulkProgressBarContainer');
  const bulkProgressBar = document.getElementById('bulkProgressBar');
  const bulkStatusText = document.getElementById('bulkStatusText');

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
      } catch (e) {}
    }
    const res = {};
    keys.forEach(k => { res[k] = localStorage.getItem(k); });
    return res;
  }

  async function safeStorageSet(obj) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        return await chrome.storage.local.set(obj);
      } catch (e) {}
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

      renderChunksList();
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

      let statusClass = 'pending';
      let statusLabel = 'Pending';
      if (isDone) {
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
          <span>⏱️ ${durMin} • 📦 ${sizeStr}</span>
          <div class="chunk-actions">
            <button class="btn-copy btn-copy-name" data-filename="${chunk.filename}" title="Salin nama file untuk upload manual">📋 Nama</button>
            <button class="btn-copy btn-copy-path" data-path="${chunk.video_path}" title="Salin path video lokal">📋 Path</button>
            <button class="btn-upload-chunk btn-check-drive" id="btn-check-${chunk.part_number}" ${isChecking || isValidatingAny ? 'disabled' : ''}>
              ${isDone ? '🔍 Cek Ulang' : isChecking ? '⏳ Mengecek...' : '🔍 Cek Drive'}
            </button>
            <button class="btn-toggle-done" id="btn-toggle-${chunk.part_number}" title="${isDone ? 'Tandai Pending' : 'Tandai Selesai Manual'}">
              ${isDone ? '↩️' : '✓'}
            </button>
          </div>
        </div>
      `;

      // Event Copy Nama File
      const btnCopyName = card.querySelector('.btn-copy-name');
      btnCopyName.addEventListener('click', async () => {
        await navigator.clipboard.writeText(chunk.filename);
        btnCopyName.textContent = '✓ Copied';
        setTimeout(() => { btnCopyName.textContent = '📋 Nama'; }, 1500);
      });

      // Event Copy Path Video
      const btnCopyPath = card.querySelector('.btn-copy-path');
      btnCopyPath.addEventListener('click', async () => {
        await navigator.clipboard.writeText(chunk.video_path);
        btnCopyPath.textContent = '✓ Copied';
        setTimeout(() => { btnCopyPath.textContent = '📋 Path'; }, 1500);
      });

      // Event Validasi / Cek di Drive
      const btnCheck = card.querySelector('.btn-check-drive');
      btnCheck.addEventListener('click', async () => {
        await validateSingleChunk(chunk);
      });

      // Event Toggle Manual Done / Pending
      const btnToggle = card.querySelector('.btn-toggle-done');
      btnToggle.addEventListener('click', async () => {
        const nextStatus = isDone ? 'pending' : 'done';
        chunk.upload_status = nextStatus;
        await window.SupabaseBridge.updatePart(chunk.id, {
          upload_status: nextStatus,
          uploaded_at: nextStatus === 'done' ? new Date().toISOString() : null
        }).catch((e) => console.warn('Supabase toggle error:', e));
        await loadChunks(sessionSelect.value);
      });

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
        throw new Error('Tab Google AI Studio tidak ditemukan. Buka https://aistudio.google.com/prompts/new_chat.');
      }

      const res = await chrome.runtime.sendMessage({
        action: 'VALIDATE_DRIVE_FILE',
        tabId: targetTab.id,
        filename: chunk.filename
      });

      if (!res || !res.success) {
        throw new Error(res?.error || 'Gagal memvalidasi file di Google Drive Picker.');
      }

      if (res.found) {
        chunk.upload_status = 'done';
        await window.SupabaseBridge.updatePart(chunk.id, {
          upload_status: 'done',
          uploaded_at: new Date().toISOString()
        }).catch((e) => console.warn('Supabase update warning:', e));

        bulkStatusText.innerHTML = `<span style="color: #10b981;">🎉 Part #${chunk.part_number} (${chunk.filename}) DITEMUKAN di Drive & ditandai Selesai!</span>`;
      } else {
        bulkStatusText.innerHTML = `<span style="color: #f59e0b;">ℹ️ Part #${chunk.part_number} ("${baseName}") BELUM ditemukan di Drive. Silakan upload file terlebih dahulu.</span>`;
      }
    } catch (err) {
      console.error('[SidePanel] Validate chunk error:', err);
      bulkStatusText.innerHTML = `<span style="color: #ef4444;">❌ Part #${chunk.part_number} gagal dicek: ${err.message}</span>`;
    } finally {
      chunk._isChecking = false;
      isValidatingAny = false;
      renderChunksList();
      await loadChunks(sessionSelect.value);
    }
  }

  // Bulk Action: Validasi Semua Part Pending di Drive
  btnUploadAll.addEventListener('click', async () => {
    if (isValidatingAny) return;

    const pendingChunks = currentChunks.filter(c => c.upload_status !== 'done' && c.upload_status !== 'uploaded');
    if (pendingChunks.length === 0) {
      bulkStatusText.textContent = 'Semua part sudah selesai divalidasi.';
      return;
    }

    const targetTab = await getAIStudioTab();
    if (!targetTab || !targetTab.id) {
      bulkStatusText.innerHTML = `<span style="color: #ef4444;">⚠️ Buka tab Google AI Studio (https://aistudio.google.com/prompts/new_chat) terlebih dahulu.</span>`;
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
          }).catch(() => {});
          foundCount++;
        }
      } catch (err) {
        console.error(`Error validating part ${chunk.part_number}:`, err);
      }

      chunk._isChecking = false;
      renderChunksList();
      await new Promise(r => setTimeout(r, 1000));
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

  // Initial connection
  await initConnection();
});
