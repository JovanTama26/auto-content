// extension/popup/popup.js
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

  const BRIDGE_URL = 'http://127.0.0.1:4545';

  let activeSessions = [];
  let currentChunks = [];
  let isBridgeOnline = false;
  let isUploadingAny = false;

  // Set Supabase status badge
  function setDbStatus(state, text) {
    connStatus.className = `status-badge ${state}`;
    connStatus.querySelector('.status-text').textContent = text;
  }

  // Set DOM status badge
  function setDomStatus(state, text) {
    if (!domStatus) return;
    domStatus.className = `status-badge ${state}`;
    domStatus.querySelector('.status-text').textContent = text;
  }

  // Format bytes helper
  function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  }

  // Check optional Local Bridge Server connection (tanpa memblokir otomasi browser)
  async function checkBridge() {
    try {
      const res = await fetch(`${BRIDGE_URL}/health`, { method: 'GET' });
      if (res.ok) {
        isBridgeOnline = true;
        setDomStatus('connected', 'DOM + Bridge');
        return true;
      }
    } catch {
      // offline
    }
    isBridgeOnline = false;
    setDomStatus('connected', 'Direct DOM');
    return false;
  }

  // Check Supabase connection
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

  // Safe storage helper (works in extension context and standalone/testing)
  async function safeStorageGet(keys) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        return await chrome.storage.local.get(keys);
      } catch (e) {
        // fallback
      }
    }
    const res = {};
    keys.forEach(k => { res[k] = localStorage.getItem(k); });
    return res;
  }

  async function safeStorageSet(obj) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        return await chrome.storage.local.set(obj);
      } catch (e) {
        // fallback
      }
    }
    Object.keys(obj).forEach(k => { localStorage.setItem(k, obj[k]); });
  }

  // Load Sessions
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
      console.error('[Popup] Load sessions error:', err);
      chunksList.innerHTML = `<div class="empty-state">Gagal memuat session: ${err.message}</div>`;
    }
  }

  // Handle Session Change
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

  // Load Chunks
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

      // Update bulk button
      const pendingCount = currentChunks.length - uploadedCount;
      if (pendingCount === 0) {
        btnUploadAll.disabled = true;
        bulkUploadText.textContent = `✓ Semua Part (${uploadedCount}) Tersimpan di Drive`;
      } else {
        btnUploadAll.disabled = isUploadingAny;
        bulkUploadText.textContent = `⚡ Upload Serentak (${pendingCount} Part ke Drive)`;
      }

      renderChunksList();
    } catch (err) {
      console.error('[Popup] Load chunks error:', err);
      chunksList.innerHTML = `<div class="empty-state">Gagal memuat chunks: ${err.message}</div>`;
    }
  }

  // Render Chunks Cards
  function renderChunksList() {
    chunksList.innerHTML = '';
    currentChunks.forEach((chunk) => {
      const isDone = chunk.upload_status === 'done' || chunk.upload_status === 'uploaded';
      const isUploading = chunk._isUploading;

      let statusClass = 'pending';
      let statusLabel = 'Pending';
      if (isDone) {
        statusClass = 'uploaded';
        statusLabel = 'Di Drive';
      } else if (isUploading) {
        statusClass = 'uploading';
        statusLabel = 'Uploading...';
      }

      const durMin = chunk.duration_sec ? (chunk.duration_sec / 60).toFixed(1) + 'm' : '~20m';
      const sizeStr = formatBytes(chunk.size_bytes);

      const card = document.createElement('div');
      card.className = `chunk-card ${isUploading ? 'is-uploading' : ''} ${isDone ? 'is-uploaded' : ''}`;
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
            <button class="btn-copy" data-path="${chunk.video_path}" title="Salin path video lokal">📋 Path</button>
            <button class="btn-upload-chunk" id="btn-upload-${chunk.part_number}" ${isDone || isUploading || isUploadingAny ? 'disabled' : ''}>
              ${isDone ? '✓ Drive' : isUploading ? '🔄 Uploading...' : '📤 Upload ke Drive'}
            </button>
          </div>
        </div>
      `;

      // Event Tombol Copy Path
      const btnCopy = card.querySelector('.btn-copy');
      btnCopy.addEventListener('click', async () => {
        await navigator.clipboard.writeText(chunk.video_path);
        btnCopy.textContent = '✓ Copied';
        setTimeout(() => { btnCopy.textContent = '📋 Path'; }, 1500);
      });

      // Event Tombol 1: Upload Sendiri (Per Part)
      const btnUpload = card.querySelector('.btn-upload-chunk');
      btnUpload.addEventListener('click', async () => {
        await uploadSingleChunk(chunk);
      });

      chunksList.appendChild(card);
    });
  }

  async function getAIStudioTab() {
    try {
      // 1. Cek tab aktif saat ini
      const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTabs && activeTabs.length > 0 && activeTabs[0].url && activeTabs[0].url.includes('aistudio.google.com')) {
        return activeTabs[0];
      }
      // 2. Fallback: Cari tab lain yang membuka aistudio.google.com
      const allAiTabs = await chrome.tabs.query({ url: 'https://aistudio.google.com/*' });
      if (allAiTabs && allAiTabs.length > 0) {
        await chrome.tabs.update(allAiTabs[0].id, { active: true });
        return allAiTabs[0];
      }
    } catch (e) {
      console.warn('[Popup] Query tabs error:', e);
    }
    return null;
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Upload Single Chunk to Google Drive via DOM + CDP tab aktif
  async function uploadSingleChunk(chunk) {
    if (isUploadingAny) return;

    isUploadingAny = true;
    chunk._isUploading = true;
    renderChunksList();
    bulkStatusText.textContent = `Memulai upload Part #${chunk.part_number} (${chunk.filename})...`;

    try {
      // 1. Dapatkan tab AI Studio aktif
      const targetTab = await getAIStudioTab();
      if (!targetTab || !targetTab.id) {
        throw new Error('Tab Google AI Studio tidak ditemukan. Buka https://aistudio.google.com/prompts/new_chat terlebih dahulu.');
      }

      // 2. Salin path video lokal ke clipboard untuk kemudahan user
      if (navigator.clipboard && chunk.video_path) {
        await navigator.clipboard.writeText(chunk.video_path).catch(() => {});
      }

      bulkStatusText.textContent = `Beralih ke tab Upload & menyuntikkan video Part #${chunk.part_number} via CDP...`;

      // 3. Jalankan pipeline in-browser upload melalui background service worker (CDP)
      const res = await chrome.runtime.sendMessage({
        action: 'RUN_IN_BROWSER_UPLOAD',
        tabId: targetTab.id,
        chunk
      });

      if (!res || !res.success) {
        throw new Error(res?.error || 'Gagal menyuntikkan file ke Google Drive Picker.');
      }

      // 4. Pantau proses upload nyata di Google Drive (maksimal 3 menit)
      bulkStatusText.innerHTML = `<span style="color: #38bdf8;">⏳ File video berhasil masuk ke Drive Picker! Menunggu proses upload Google Drive selesai...</span>`;

      let uploadFinished = false;
      const startTime = Date.now();
      const maxWaitMs = 180000; // 3 menit

      while (Date.now() - startTime < maxWaitMs) {
        await sleep(2000);
        const elapsedSec = Math.round((Date.now() - startTime) / 1000);

        const status = await chrome.tabs.sendMessage(targetTab.id, {
          action: 'CHECK_ATTACHMENT_STATUS',
          filename: chunk.filename
        }).catch(() => null);

        // Jika video pill terdeteksi di prompt editor ATAU modal picker sudah tertutup setelah upload berjalan beberapa detik
        if (status && (status.isAttached || (!status.isPickerOpen && elapsedSec >= 6))) {
          uploadFinished = true;
          break;
        }

        bulkStatusText.innerHTML = `<span style="color: #f59e0b;">⏳ Sedang mengupload Part #${chunk.part_number} (${elapsedSec} detik)... Mohon jangan tutup browser.</span>`;
      }

      if (!uploadFinished) {
        throw new Error('Timeout: Upload ke Google Drive belum selesai setelah 3 menit.');
      }

      // 5. Tandai selesai di lokal dan Supabase HANYA setelah benar-benar ter-upload
      chunk.upload_status = 'done';
      await window.SupabaseBridge.updatePart(chunk.id, {
        upload_status: 'done',
        uploaded_at: new Date().toISOString(),
      }).catch(e => console.warn('Supabase update warning:', e));

      bulkStatusText.innerHTML = `<span style="color: #10b981;">🎉 SUKSES! Part #${chunk.part_number} (${chunk.filename}) berhasil ter-upload & terpasang di AI Studio!</span>`;
    } catch (err) {
      console.error('[Popup] Upload chunk error:', err);
      bulkStatusText.innerHTML = `<span style="color: #ef4444;">❌ Part #${chunk.part_number} gagal: ${err.message}</span>`;
    } finally {
      chunk._isUploading = false;
      isUploadingAny = false;
      renderChunksList();
      await loadChunks(sessionSelect.value);
    }
  }

  // Event Tombol 2: Upload Serentak (Semua Part ke Drive via DOM + CDP tab aktif)
  btnUploadAll.addEventListener('click', async () => {
    if (isUploadingAny) return;

    const pendingChunks = currentChunks.filter(c => c.upload_status !== 'done' && c.upload_status !== 'uploaded');
    if (pendingChunks.length === 0) {
      bulkStatusText.textContent = 'Semua part sudah selesai diupload.';
      return;
    }

    const targetTab = await getAIStudioTab();
    if (!targetTab || !targetTab.id) {
      bulkStatusText.innerHTML = `<span style="color: #ef4444;">⚠️ Buka tab Google AI Studio (https://aistudio.google.com/prompts/new_chat) terlebih dahulu.</span>`;
      return;
    }

    isUploadingAny = true;
    btnUploadAll.disabled = true;
    bulkSpinner.classList.remove('hidden');
    bulkProgressBarContainer.classList.remove('hidden');
    bulkProgressBar.style.width = '0%';

    let successCount = 0;
    const total = pendingChunks.length;

    for (let i = 0; i < total; i++) {
      const chunk = pendingChunks[i];
      const percent = Math.round(((i + 1) / total) * 100);
      bulkProgressBar.style.width = `${percent}%`;
      bulkStatusText.textContent = `[${i + 1}/${total}] Memulai Part #${chunk.part_number} (${chunk.filename})...`;

      chunk._isUploading = true;
      renderChunksList();

      try {
        if (navigator.clipboard && chunk.video_path) {
          await navigator.clipboard.writeText(chunk.video_path).catch(() => {});
        }

        const res = await chrome.runtime.sendMessage({
          action: 'RUN_IN_BROWSER_UPLOAD',
          tabId: targetTab.id,
          chunk
        });

        if (!res || !res.success) {
          throw new Error(res?.error || 'Gagal mengirim file ke picker');
        }

        // Tunggu proses upload selesai
        let uploadFinished = false;
        const startTime = Date.now();
        while (Date.now() - startTime < 180000) {
          await sleep(2000);
          const elapsedSec = Math.round((Date.now() - startTime) / 1000);
          const status = await chrome.tabs.sendMessage(targetTab.id, {
            action: 'CHECK_ATTACHMENT_STATUS',
            filename: chunk.filename
          }).catch(() => null);

          if (status && (status.isAttached || (!status.isPickerOpen && elapsedSec >= 6))) {
            uploadFinished = true;
            break;
          }
          bulkStatusText.innerHTML = `<span style="color: #f59e0b;">[${i + 1}/${total}] Mengupload Part #${chunk.part_number} (${elapsedSec}d)...</span>`;
        }

        if (uploadFinished) {
          chunk.upload_status = 'done';
          await window.SupabaseBridge.updatePart(chunk.id, {
            upload_status: 'done',
            uploaded_at: new Date().toISOString(),
          }).catch(() => {});
          successCount++;
        } else {
          throw new Error(`Upload Part #${chunk.part_number} timeout (>3 menit)`);
        }
      } catch (err) {
        console.error(`Error processing part ${chunk.part_number}:`, err);
        bulkStatusText.innerHTML = `<span style="color: #ef4444;">❌ Part #${chunk.part_number} gagal: ${err.message}</span>`;
      }

      chunk._isUploading = false;
      renderChunksList();
    }

    bulkProgressBar.style.width = '100%';
    bulkSpinner.classList.add('hidden');
    isUploadingAny = false;

    if (successCount === total) {
      bulkStatusText.innerHTML = `<span style="color: #10b981;">🎉 Sukses! Semua ${total} video chunk berhasil di-upload ke Drive!</span>`;
    } else {
      bulkStatusText.innerHTML += ` (${successCount}/${total} berhasil)`;
    }

    await loadChunks(sessionSelect.value);
  });

  // Listeners
  sessionSelect.addEventListener('change', (e) => {
    onSessionChanged(e.target.value);
  });

  btnRefresh.addEventListener('click', async () => {
    await checkBridge();
    await initConnection();
  });

  btnOpenAIStudio.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://aistudio.google.com/prompts/new_chat' });
  });

  // Initial checks
  await checkBridge();
  await initConnection();
});
