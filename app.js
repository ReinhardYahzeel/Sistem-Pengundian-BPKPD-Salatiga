(function () {
  "use strict";

  var STORAGE_KEY = "bpkpd-spin-undian-v2";

  /* ---------------- State ---------------- */

  var state = {
    participants: [],   // {id, plate, address, won}
    prizes: [],          // {id, qty, name}
    prizeBatches: [],    // konfigurasi hadiah yang sudah diundi
    winners: [],          // {no, id, plate, address, prize, timestamp, status}
    lastBatch: [],        // ids of winners from the most recent draw
    rounds: 0,
    sampleLoaded: false
  };

  var uidCounter = 1;
  var participantPage = 0;
  var participantPageSize = 25;
  function nextUid() { return (Date.now().toString(36) + (uidCounter++).toString(36)); }

  /* ---------------- Persistence ---------------- */

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      showToast("Gagal menyimpan data (localStorage penuh?)", "danger");
    }
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        state = Object.assign(state, parsed);
        state.winners = (state.winners || []).map(function (winner) {
          if (!winner.status) winner.status = "Pemenang";
          return winner;
        });
        state.prizes = state.prizes || [];
        state.prizeBatches = state.prizeBatches || [];
      }
    } catch (e) {
      console.warn("Gagal memuat data tersimpan", e);
    }
  }

  /* ---------------- Secure random ---------------- */

  function secureRandomInt(maxExclusive) {
    if (maxExclusive <= 0) return 0;
    var maxUint32 = 0xFFFFFFFF;
    var limit = maxUint32 - (maxUint32 % maxExclusive);
    var buf = new Uint32Array(1);
    var rand;
    do {
      crypto.getRandomValues(buf);
      rand = buf[0];
    } while (rand >= limit);
    return rand % maxExclusive;
  }

  /* ---------------- Utility ---------------- */

  function $(id) { return document.getElementById(id); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function escapeHtml(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  function activeParticipants() {
    return state.participants.filter(function (p) { return !p.won; });
  }

  function formatDateTime(d) {
    var opts = { weekday: "long", day: "2-digit", month: "short", year: "numeric" };
    var dateStr = d.toLocaleDateString("id-ID", opts);
    var timeStr = d.toLocaleTimeString("id-ID", { hour12: false });
    return { dateStr: dateStr, timeStr: timeStr };
  }

  var toastTimer = null;
  function showToast(msg, kind) {
    var t = $("toast");
    t.textContent = msg;
    t.className = "toast show" + (kind ? " " + kind : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 3200);
  }

  /* ---------------- Clock ---------------- */

  function tickClock() {
    var now = new Date();
    var f = formatDateTime(now);
    var timeStr = [now.getHours(), now.getMinutes(), now.getSeconds()].map(function (value) {
      return String(value).padStart(2, "0");
    }).join(":");
    $("clockDisplay").innerHTML =
      '<span class="clock-icon" aria-hidden="true">◷</span>' +
      '<span class="clock-content"><strong class="clock-time">' + timeStr +
      '</strong><span class="clock-date">' + f.dateStr + '</span></span>';
  }

  /* ---------------- Navigation ---------------- */

  function switchView(name) {
    qsa(".view").forEach(function (v) { v.classList.remove("active"); });
    qsa(".nav-link").forEach(function (n) { n.classList.remove("active"); });
    var view = $("view-" + name);
    if (view) view.classList.add("active");
    qsa(".nav-link").forEach(function (n) {
      if (n.dataset.view === name) n.classList.add("active");
    });
    $("mainNav").classList.remove("open");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ---------------- CSV Import ---------------- */

  var PLATE_KEYS = ["plat", "plat nomor", "platnomor", "nopol", "no plat", "plat no", "no polisi", "nomor polisi", "nomer polisi", "plate", "nomor plat", "nomer plat"];
  var ID_KEYS = ["id", "nik", "kode"];
  var ADDRESS_KEYS = ["alamat", "address"];

  function parseCsvLine(line) {
    // simple CSV split (handles plain comma-separated values without embedded commas)
    return line.split(",").map(function (s) { return s.trim().replace(/^"|"$/g, ""); });
  }

  function importCsvText(text) {
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim().length > 0; });
    if (lines.length < 2) {
      showToast("File CSV kosong atau tidak valid", "danger");
      return;
    }
    var header = parseCsvLine(lines[0]).map(function (h) { return h.toLowerCase(); });

    function findCol(keys) {
      for (var i = 0; i < header.length; i++) {
        if (keys.indexOf(header[i]) !== -1) return i;
      }
      return -1;
    }

    var plateIdx = findCol(PLATE_KEYS);
    var idIdx = findCol(ID_KEYS);
    var addressIdx = findCol(ADDRESS_KEYS);

    var existingKeys = {};
    state.participants.forEach(function (p) {
      existingKeys[p.id + "|" + p.plate] = true;
    });

    var added = 0, skipped = 0;
    for (var i = 1; i < lines.length; i++) {
      var cols = parseCsvLine(lines[i]);
      if (cols.length === 1 && cols[0] === "") continue;
      var plate = plateIdx !== -1 ? cols[plateIdx] : cols[0];
      var id = idIdx !== -1 ? cols[idIdx] : ("ROW-" + i);
      var address = addressIdx !== -1 ? cols[addressIdx] : (cols[1] || "-");
      if (!plate) { skipped++; continue; }
      var key = id + "|" + plate;
      if (existingKeys[key]) { skipped++; continue; }
      existingKeys[key] = true;
      state.participants.push({ id: id, plate: plate, address: address || "-", won: false });
      added++;
    }

    saveState();
    renderAll();
    showToast(added + " peserta berhasil diimpor" + (skipped ? ", " + skipped + " dilewati (duplikat)" : ""), "success");
  }

  function handleCsvFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (e) { importCsvText(e.target.result); };
    reader.onerror = function () { showToast("Gagal membaca file CSV", "danger"); };
    reader.readAsText(file);
  }

  /* ---------------- Sample data ---------------- */

  var PLATE_ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  // Wilayah plat H (Semarang Raya): Kota Semarang, Kab. Semarang, Kota Salatiga
  var PLATE_AREAS = [
    { single: "AFGH", combo: "AFGHPQRSWXYZ" },     // Kota Semarang
    { single: "CILV", combo: "CILV" },              // Kab. Semarang
    { single: "BK",   combo: "BKOT" }               // Kota Salatiga
  ];
  var ADDRESS_AREAS = [
    {
      name: "Kota Semarang",
      streets: ["Pandanaran", "Pahlawan", "Imam Bonjol", "Pemuda", "Jend. Sudirman", "MT Haryono", "Gajah Mada", "Veteran", "Soekarno Hatta", "Majapahit", "Mataram", "Teuku Umar", "Sultan Agung", "Simongan", "Katamso", "Karonsih"],
      kecamatan: ["Semarang Tengah", "Semarang Selatan", "Semarang Utara", "Semarang Barat", "Semarang Timur", "Pedurungan", "Banyumanik", "Ngaliyan", "Tembalang", "Gunungpati", "Genuk", "Gayamsari", "Candisari", "Gajahmungkur"]
    },
    {
      name: "Kab. Semarang",
      streets: ["Raya Ungaran", "Raya Ambarawa", "Raya Bawen", "Raya Salatiga", "Gatot Subroto", "K.H. Wahid Hasyim", "Letjend. Soeprapto", "Pemuda", "Raya Banyubiru", "Raya Bringin"],
      kecamatan: ["Ungaran Barat", "Ungaran Timur", "Ambarawa", "Bawen", "Bergas", "Bringin", "Banyubiru", "Kaliwungu", "Pabelan", "Tengaran"]
    },
    {
      name: "Kota Salatiga",
      streets: ["Jend. Sudirman", "Diponegoro", "Ahmad Yani", "Osamaliki", "Sukowati", "Kemiri", "Monginsidi", "Tentara Pelajar", "Pattimura", "Hasanudin", "Jambu", "Setia Budi", "Bima", "Kutilang"],
      kecamatan: ["Sidorejo", "Tingkir", "Argomulyo", "Sidomukti"]
    }
  ];

  function makeRandomPlate() {
    var area = PLATE_AREAS[secureRandomInt(PLATE_AREAS.length)];
    var number = 1000 + secureRandomInt(9000);
    var suffix;
    if (secureRandomInt(3) === 0) {
      suffix = area.single.charAt(secureRandomInt(area.single.length));
    } else {
      suffix = area.combo.charAt(secureRandomInt(area.combo.length)) +
        PLATE_ALPHA.charAt(secureRandomInt(PLATE_ALPHA.length));
    }
    return "H " + number + " " + suffix;
  }

  function makeRandomAddress() {
    var area = ADDRESS_AREAS[secureRandomInt(ADDRESS_AREAS.length)];
    var street = area.streets[secureRandomInt(area.streets.length)];
    var kecamatan = area.kecamatan[secureRandomInt(area.kecamatan.length)];
    var no = 1 + secureRandomInt(300);
    return "Jl. " + street + " No. " + no + ", Kec. " + kecamatan + ", " + area.name;
  }

  function loadSampleData() {
    if (state.sampleLoaded) {
      showToast("Data contoh sudah dimuat sebelumnya", "danger");
      return;
    }
    var count = 15000;
    var batch = [];
    for (var i = 1; i <= count; i++) {
      var id = "BPKPD-" + String(i).padStart(5, "0");
      batch.push({ id: id, plate: makeRandomPlate(), address: makeRandomAddress(), won: false });
    }
    state.participants = state.participants.concat(batch);
    state.sampleLoaded = true;
    saveState();
    renderAll();
    showToast("15.000 data contoh berhasil dimuat", "success");
  }

  /* ---------------- Prizes ---------------- */

  function addPrize(qty, name) {
    qty = parseInt(qty, 10);
    name = (name || "").trim().toLocaleUpperCase("id-ID");
    if (!name) { showToast("Nama hadiah tidak boleh kosong", "danger"); return; }
    if (!qty || qty < 1) { showToast("Jumlah pemenang minimal 1", "danger"); return; }
    state.prizes.push({ id: nextUid(), qty: qty, name: name });
    saveState();
    renderAll();
  }

  function removePrize(id) {
    state.prizes = state.prizes.filter(function (p) { return p.id !== id; });
    saveState();
    renderAll();
  }

  function totalPrizeSlots() {
    return state.prizes.reduce(function (sum, p) { return sum + p.qty; }, 0);
  }

  /* ---------------- Draw engine ---------------- */

  var isSpinning = false;

  function runDraw() {
    if (isSpinning) return;

    var active = activeParticipants();
    if (active.length === 0) {
      showToast("Tidak ada peserta aktif untuk diundi", "danger");
      return;
    }
    if (state.prizes.length === 0) {
      showToast("Atur hadiah terlebih dahulu sebelum mengundi", "danger");
      return;
    }
    var needed = totalPrizeSlots();
    if (needed > active.length) {
      showToast("Jumlah pemenang (" + needed + ") melebihi peserta aktif (" + active.length + ")", "danger");
      return;
    }

    isSpinning = true;
    $("spinBtn").disabled = true;
    $("cancelLastBtn").disabled = true;
    var reel = $("reel");
    reel.classList.add("spinning");
    reel.classList.remove("won");
    $("drawStatus").classList.add("live");
    $("drawStatus").innerHTML = '<span class="pulse"></span> Mengundi...';

    var spinPool = active.slice();
    var spinInterval = setInterval(function () {
      var idx = secureRandomInt(spinPool.length);
      $("reelName").textContent = spinPool[idx].plate;
    }, 70);

    setTimeout(function () {
      clearInterval(spinInterval);
      performDraw();
    }, 1800);
  }

  function performDraw() {
    var pool = activeParticipants().slice(); // working copy of references
    var batchWinners = [];
    var now = new Date();
    var f = formatDateTime(now);
    var prizeSnapshot = state.prizes.map(function (prize) {
      return { id: prize.id, qty: prize.qty, name: prize.name };
    });
    var prizeBatchId = nextUid();

    prizeSnapshot.forEach(function (prize) {
      for (var i = 0; i < prize.qty; i++) {
        if (pool.length === 0) return;
        var idx = secureRandomInt(pool.length);
        var picked = pool[idx];
        pool.splice(idx, 1);

        picked.won = true;
        var record = {
          no: state.winners.length + 1,
          id: picked.id,
          plate: picked.plate,
          address: picked.address,
          prize: prize.name,
          dateStr: f.dateStr,
          timeStr: f.timeStr,
          timestamp: now.getTime(),
          prizeBatchId: prizeBatchId,
          status: "Pemenang"
        };
        state.winners.push(record);
        batchWinners.push(record);
      }
    });

    state.lastBatch = batchWinners.map(function (w) { return w.no; });
    state.rounds += 1;
    state.prizeBatches.unshift({
      id: prizeBatchId,
      round: state.rounds,
      prizes: prizeSnapshot,
      winnerCount: batchWinners.length,
      dateStr: f.dateStr,
      timeStr: f.timeStr,
      timestamp: now.getTime(),
      status: "Sudah diundi"
    });
    state.prizes = [];

    saveState();

    var reel = $("reel");
    reel.classList.remove("spinning");
    reel.classList.add("won");
    $("reelName").textContent = batchWinners.length === 1 ? batchWinners[0].plate : batchWinners.length + " pemenang terpilih";
    $("drawStatus").classList.remove("live");
    $("drawStatus").innerHTML = '<span class="pulse"></span> Undian selesai';

    isSpinning = false;
    $("spinBtn").disabled = false;
    $("cancelLastBtn").disabled = batchWinners.length === 0;

    renderAll();
    showResultModal(batchWinners);
  }

  function cancelLastDraw() {
    if (!state.lastBatch || state.lastBatch.length === 0) {
      showToast("Tidak ada undian terakhir untuk dibatalkan", "danger");
      return;
    }
    var batchNos = state.lastBatch;
    var cancelled = state.winners.filter(function (w) {
      return batchNos.indexOf(w.no) !== -1 && w.status === "Pemenang";
    });

    cancelled.forEach(function (w) {
      var participant = state.participants.find(function (p) { return p.id === w.id && p.plate === w.plate; });
      if (participant) participant.won = false;
      w.status = "Dibatalkan";
      w.cancelledTimestamp = Date.now();
    });

    state.lastBatch = [];

    if (cancelled.length && cancelled[0].prizeBatchId) {
      state.prizeBatches.forEach(function (batch) {
        if (batch.id === cancelled[0].prizeBatchId) {
          batch.status = "Dibatalkan";
          batch.cancelledTimestamp = Date.now();
        }
      });
    }

    saveState();
    renderAll();
    showToast(cancelled.length + " pemenang terakhir dibatalkan dan dikembalikan ke pool", "success");

    var reel = $("reel");
    reel.classList.remove("won", "spinning");
    $("reelName").textContent = "Tekan Putar Sekarang";
    $("drawStatus").innerHTML = '<span class="pulse"></span> Siap diundi';
  }

  /* ---------------- Result Modal ---------------- */

  function showResultModal(winners) {
    var list = $("modalWinnerList");
    list.innerHTML = winners.map(function (w) {
      return '<div class="winner-row">' +
        '<div class="num">#' + w.no + '</div>' +
        '<div class="info"><strong>' + escapeHtml(w.plate) + '</strong><span>' + escapeHtml(w.id) + ' &middot; ' + escapeHtml(w.address) + '</span></div>' +
        '<div class="prize-tag">' + escapeHtml(w.prize) + '</div>' +
        '</div>';
    }).join("");
    $("modalSub").textContent = winners.length + " peserta terpilih pada undian ini.";
    $("resultModal").classList.add("open");
  }

  function closeModal() {
    $("resultModal").classList.remove("open");
  }

  /* ---------------- Export Excel with status colors ---------------- */

  function exportWinnersCsv() {
    if (state.winners.length === 0) {
      showToast("Belum ada pemenang untuk diekspor", "danger");
      return;
    }
    var header = ["No", "ID Peserta", "Plat Nomor", "Alamat", "Kategori Hadiah", "Tanggal Undian", "Jam Undian", "Status"];
    var rows = state.winners.map(function (w) {
      var isCancelled = w.status === "Dibatalkan";
      var color = isCancelled ? "#ffd9de" : "#d9f7e5";
      var textColor = isCancelled ? "#b42332" : "#167346";
      var cells = [w.no, w.id, w.plate, w.address, w.prize, w.dateStr, w.timeStr, w.status];
      return '<tr style="background-color:' + color + ';color:' + textColor + ';">' +
        cells.map(function (cell) {
          return "<td>" + escapeHtml(cell) + "</td>";
        }).join("") + "</tr>";
    }).join("");
    var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' +
      'body{font-family:Arial,sans-serif;color:#24152f}table{border-collapse:collapse;width:100%}' +
      'th,td{border:1px solid #d8c6e5;padding:8px 10px;text-align:left}' +
      'th{background:#3b2354;color:#fff;font-weight:700}' +
      '</style></head><body><table><thead><tr>' +
      header.map(function (cell) { return "<th>" + escapeHtml(cell) + "</th>"; }).join("") +
      "</tr></thead><tbody>" + rows + "</tbody></table></body></html>";

    var blob = new Blob(["\ufeff", html], { type: "application/vnd.ms-excel;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    var d = new Date();
    var dateSlug = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    a.href = url;
    a.download = "download-excel-" + dateSlug + ".xls";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("File Excel berhasil diunduh", "success");
  }

  /* ---------------- Reset ---------------- */

  function resetData() {
    if (!confirm("Yakin ingin menghapus seluruh data peserta dan riwayat pemenang? Tindakan ini tidak dapat dibatalkan.")) return;
    state = { participants: [], prizes: [], prizeBatches: [], winners: [], lastBatch: [], rounds: 0, sampleLoaded: false };
    localStorage.removeItem(STORAGE_KEY);
    var reel = $("reel");
    reel.classList.remove("won", "spinning");
    $("reelName").textContent = "Tekan Putar Sekarang";
    $("drawStatus").innerHTML = '<span class="pulse"></span> Siap diundi';
    renderAll();
    showToast("Seluruh data berhasil direset", "success");
  }

  /* ---------------- Rendering ---------------- */

  function renderAll() {
    var total = state.participants.length;
    var won = state.participants.filter(function (p) { return p.won; }).length;
    var active = total - won;
    var pct = total > 0 ? Math.round((won / total) * 100) : 0;

    $("statActive").textContent = active.toLocaleString("id-ID");
    $("statWinners").textContent = won.toLocaleString("id-ID");
    $("statRemaining").textContent = active.toLocaleString("id-ID");
    $("statTotal").textContent = total.toLocaleString("id-ID");

    $("dashProgressFill").style.width = pct + "%";
    $("dashProgressPct").textContent = pct + "%";
    $("dashProgressLeft").textContent = active.toLocaleString("id-ID") + " di pool";
    $("dashProgressRight").textContent = total.toLocaleString("id-ID") + " total";

    $("undianProgressFill").style.width = pct + "%";
    $("undianProgressPct").textContent = pct + "%";
    $("undianProgressLeft").textContent = active.toLocaleString("id-ID") + " di pool";
    $("undianProgressRight").textContent = total.toLocaleString("id-ID") + " total";

    $("pesertaTotal").textContent = total.toLocaleString("id-ID");
    $("pesertaActive").textContent = active.toLocaleString("id-ID");
    $("pesertaWon").textContent = won.toLocaleString("id-ID");

    $("undianActiveCount").textContent = active.toLocaleString("id-ID") + " aktif";
    $("metaNeeded").textContent = totalPrizeSlots();
    $("metaActive").textContent = active.toLocaleString("id-ID");
    $("metaRounds").textContent = state.rounds;

    $("cancelLastBtn").disabled = !state.lastBatch || state.lastBatch.length === 0;

    renderParticipantsTable();
    renderPrizeList();
    renderPrizeHistory();
    renderDashPrizeList();
    renderUndianWinners();
    renderArchiveTable();
  }

  function renderParticipantsTable() {
    var body = $("participantsTableBody");
    var note = $("participantsTableNote");
    var search = ($("participantSearch").value || "").trim().toLowerCase();
    var dept = $("participantDeptFilter").value;
    var status = $("participantStatusFilter").value;
    var filtered = state.participants.filter(function (p) {
      var matchesSearch = !search ||
        String(p.plate).toLowerCase().indexOf(search) !== -1 ||
        String(p.id).toLowerCase().indexOf(search) !== -1 ||
        String(p.address).toLowerCase().indexOf(search) !== -1;
      var matchesDept = !dept || p.address === dept;
      var matchesStatus = !status || (status === "won" ? p.won : !p.won);
      return matchesSearch && matchesDept && matchesStatus;
    });
    var totalPages = Math.max(1, Math.ceil(filtered.length / participantPageSize));
    if (participantPage >= totalPages) participantPage = totalPages - 1;
    var start = participantPage * participantPageSize;
    var subset = filtered.slice(start, start + participantPageSize);

    renderParticipantAddressOptions();
    if (filtered.length === 0) {
      body.innerHTML = "";
      note.textContent = state.participants.length === 0
        ? "Belum ada peserta. Impor CSV atau muat data contoh."
        : "Tidak ada peserta yang cocok dengan filter.";
      updateParticipantPagination(0, 1);
      return;
    }
    body.innerHTML = subset.map(function (p) {
      var statusBadge = p.won
        ? '<span class="badge badge-success">Menang</span>'
        : '<span class="badge" style="color:var(--text-muted);background:rgba(255,255,255,0.06);">Aktif</span>';
      return "<tr><td>" + escapeHtml(p.id) + "</td><td>" + escapeHtml(p.plate) + "</td><td>" + escapeHtml(p.address) + "</td><td>" + statusBadge + "</td></tr>";
    }).join("");
    note.textContent = "Menampilkan " + (start + 1) + "–" + (start + subset.length) +
      " dari " + filtered.length.toLocaleString("id-ID") + " peserta yang cocok.";
    updateParticipantPagination(filtered.length, totalPages);
  }

  function renderParticipantAddressOptions() {
    var select = $("participantDeptFilter");
    var current = select.value;
    var addresses = {};
    state.participants.forEach(function (p) { if (p.address) addresses[p.address] = true; });
    var values = Object.keys(addresses).sort(function (a, b) { return a.localeCompare(b, "id"); });
    select.innerHTML = '<option value="">Semua alamat</option>' + values.map(function (value) {
      return '<option value="' + escapeHtml(value) + '">' + escapeHtml(value) + '</option>';
    }).join("");
    if (values.indexOf(current) !== -1) select.value = current;
  }

  function updateParticipantPagination(total, totalPages) {
    $("participantsPageInfo").textContent = total === 0 ? "Tidak ada hasil" :
      "Halaman " + (participantPage + 1) + " dari " + totalPages;
    $("participantsPrev").disabled = participantPage === 0 || total === 0;
    $("participantsNext").disabled = participantPage >= totalPages - 1 || total === 0;
  }

  function renderPrizeList() {
    var list = $("prizeList");
    if (state.prizes.length === 0) {
      list.innerHTML = '<p class="empty-note">Belum ada hadiah. Tambahkan kategori di atas.</p>';
      return;
    }
    list.innerHTML = state.prizes.map(function (p) {
      return '<div class="prize-item">' +
        '<span class="qty">' + p.qty + '&times;</span>' +
        '<span class="name">' + escapeHtml(p.name) + '</span>' +
        '<button data-remove-prize="' + p.id + '" aria-label="Hapus hadiah">✕</button>' +
        '</div>';
    }).join("");
  }

  function renderPrizeHistory() {
    var list = $("prizeHistoryList");
    var batches = state.prizeBatches || [];
    if (batches.length === 0) {
      list.innerHTML = '<p class="empty-note">Belum ada pengaturan yang selesai diundi.</p>';
      return;
    }

    list.innerHTML = batches.map(function (batch) {
      var isCancelled = batch.status === "Dibatalkan";
      var badgeClass = isCancelled ? "badge-danger" : "badge-success";
      var prizeText = (batch.prizes || []).map(function (prize) {
        return prize.qty + "&times; " + escapeHtml(prize.name);
      }).join(" &middot; ");
      return '<div class="prize-history-item">' +
        '<div class="prize-history-head"><strong>Pengaturan undian #' + batch.round + '</strong>' +
        '<span class="badge ' + badgeClass + '">' + escapeHtml(batch.status || "Sudah diundi") + '</span></div>' +
        '<div class="prize-history-prizes">' + prizeText + '</div>' +
        '<div class="prize-history-meta">' + escapeHtml(batch.dateStr || "") + ' ' + escapeHtml(batch.timeStr || "") +
          ' &middot; ' + (batch.winnerCount || 0) + ' pemenang</div>' +
        '</div>';
    }).join("");
  }

  function renderDashPrizeList() {
    var list = $("dashPrizeList");
    $("dashPrizeCount").textContent = state.prizes.length + " kategori";
    if (state.prizes.length === 0) {
      list.innerHTML = '<p class="empty-note">Belum ada hadiah diatur. Buka tab Undian &amp; Hadiah.</p>';
      return;
    }
    list.innerHTML = state.prizes.map(function (p) {
      return '<div class="prize-item"><span class="qty">' + p.qty + '&times;</span><span class="name">' + escapeHtml(p.name) + '</span></div>';
    }).join("");
  }

  function renderUndianWinners() {
    var list = $("undianWinnerList");
    var activeWinners = state.winners.filter(function (w) { return w.status === "Pemenang"; });
    $("undianWinnerCount").textContent = activeWinners.length.toLocaleString("id-ID") + " pemenang";

    if (activeWinners.length === 0) {
      list.innerHTML = '<p class="empty-note">Belum ada pemenang. Jalankan undian untuk melihat hasilnya di sini.</p>';
      return;
    }

    activeWinners.sort(function (a, b) { return b.timestamp - a.timestamp; });
    list.innerHTML = activeWinners.map(function (w) {
      return '<div class="winner-summary-row">' +
        '<div class="winner-summary-number">#' + w.no + '</div>' +
        '<div class="winner-summary-info"><strong>' + escapeHtml(w.plate) + '</strong><span>' +
          escapeHtml(w.id) + ' &middot; ' + escapeHtml(w.address) + '</span></div>' +
        '<span class="prize-tag">' + escapeHtml(w.prize) + '</span>' +
        '</div>';
    }).join("");
  }

  function renderArchiveTable() {
    var body = $("archiveTableBody");
    var note = $("archiveTableNote");
    var search = ($("archiveSearch").value || "").trim().toLowerCase();
    var dept = $("archiveDeptFilter").value;
    var sortMode = $("archiveSort").value;
    renderArchiveAddressOptions();

    if (state.winners.length === 0) {
      body.innerHTML = "";
      note.textContent = "Belum ada pemenang.";
      return;
    }

    var filtered = state.winners.filter(function (w) {
      var haystack = [w.no, w.id, w.plate, w.address].join(" ").toLowerCase();
      return (!search || haystack.indexOf(search) !== -1) && (!dept || w.address === dept);
    });

    var sorted = filtered.slice().sort(function (a, b) {
      if (sortMode === "department") {
        return String(a.address).localeCompare(String(b.address), "id") || Number(a.no) - Number(b.no);
      }
      if (sortMode === "name") {
        return String(a.plate).localeCompare(String(b.plate), "id") || Number(a.no) - Number(b.no);
      }
      if (sortMode === "latest") return b.timestamp - a.timestamp;
      return Number(a.no) - Number(b.no);
    });

    if (sorted.length === 0) {
      body.innerHTML = "";
      note.textContent = "Tidak ada arsip yang cocok dengan filter.";
      return;
    }

    body.innerHTML = sorted.map(function (w) {
      var badgeClass = w.status === "Dibatalkan" ? "badge-danger" : "badge-success";
      return "<tr><td>" + w.no + "</td><td>" + escapeHtml(w.id) + "</td><td>" + escapeHtml(w.plate) + "</td><td>" + escapeHtml(w.address) +
        "</td><td>" + escapeHtml(w.prize) + "</td><td>" + w.dateStr + " " + w.timeStr + "</td><td><span class=\"badge " + badgeClass + "\">" + escapeHtml(w.status || "Pemenang") + "</span></td></tr>";
    }).join("");
    note.textContent = "Menampilkan " + sorted.length.toLocaleString("id-ID") + " dari " +
      state.winners.length.toLocaleString("id-ID") + " riwayat undian.";
  }

  function renderArchiveAddressOptions() {
    var select = $("archiveDeptFilter");
    var current = select.value;
    var addresses = {};
    state.winners.forEach(function (w) {
      if (w.address) addresses[w.address] = true;
    });
    var values = Object.keys(addresses).sort(function (a, b) {
      return a.localeCompare(b, "id");
    });
    select.innerHTML = '<option value="">Semua alamat</option>' + values.map(function (value) {
      return '<option value="' + escapeHtml(value) + '">' + escapeHtml(value) + '</option>';
    }).join("");
    if (values.indexOf(current) !== -1) select.value = current;
  }

  /* ---------------- Event wiring ---------------- */

  function wireEvents() {
    $("brandHomeBtn").addEventListener("click", function () {
      switchView("dashboard");
    });

    qsa(".nav-link").forEach(function (btn) {
      btn.addEventListener("click", function () { switchView(btn.dataset.view); });
    });
    qsa("[data-goto]").forEach(function (btn) {
      btn.addEventListener("click", function () { switchView(btn.dataset.goto); });
    });

    $("menuToggle").addEventListener("click", function () {
      $("mainNav").classList.toggle("open");
    });

    window.addEventListener("scroll", function () {
      $("mainNav").classList.remove("open");
    }, { passive: true });

    document.addEventListener("click", function (e) {
      var header = document.querySelector(".site-header");
      if (!$("mainNav").contains(e.target) && !$("menuToggle").contains(e.target) && !header.contains(e.target)) {
        $("mainNav").classList.remove("open");
      }
    });

    $("resetBtn").addEventListener("click", resetData);

    $("csvInput").addEventListener("change", function (e) { handleCsvFile(e.target.files[0]); e.target.value = ""; });
    $("csvInput2").addEventListener("change", function (e) { handleCsvFile(e.target.files[0]); e.target.value = ""; });
    $("loadSampleBtn").addEventListener("click", loadSampleData);
    $("loadSampleBtn2").addEventListener("click", loadSampleData);
    $("participantSearch").addEventListener("input", function () {
      participantPage = 0;
      renderParticipantsTable();
    });
    $("participantDeptFilter").addEventListener("change", function () {
      participantPage = 0;
      renderParticipantsTable();
    });
    $("participantStatusFilter").addEventListener("change", function () {
      participantPage = 0;
      renderParticipantsTable();
    });
    $("resetParticipantFilter").addEventListener("click", function () {
      $("participantSearch").value = "";
      $("participantDeptFilter").value = "";
      $("participantStatusFilter").value = "";
      participantPage = 0;
      renderParticipantsTable();
    });
    $("archiveSearch").addEventListener("input", renderArchiveTable);
    $("archiveDeptFilter").addEventListener("change", renderArchiveTable);
    $("archiveSort").addEventListener("change", renderArchiveTable);
    $("resetArchiveFilter").addEventListener("click", function () {
      $("archiveSearch").value = "";
      $("archiveDeptFilter").value = "";
      $("archiveSort").value = "number";
      renderArchiveTable();
    });
    $("participantsPrev").addEventListener("click", function () {
      if (participantPage > 0) {
        participantPage -= 1;
        renderParticipantsTable();
      }
    });
    $("participantsNext").addEventListener("click", function () {
      participantPage += 1;
      renderParticipantsTable();
    });

    $("addPrizeBtn").addEventListener("click", function () {
      addPrize($("prizeQty").value, $("prizeName").value);
      $("prizeName").value = "";
      $("prizeQty").value = "1";
      $("prizeName").focus();
    });
    $("prizeName").addEventListener("keydown", function (e) {
      if (e.key === "Enter") $("addPrizeBtn").click();
    });
    $("prizeName").addEventListener("input", function (e) {
      var field = e.target;
      var upperName = field.value.toLocaleUpperCase("id-ID");
      if (field.value !== upperName) field.value = upperName;
    });

    $("prizeList").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-remove-prize]");
      if (btn) removePrize(btn.getAttribute("data-remove-prize"));
    });

    $("spinBtn").addEventListener("click", runDraw);
    $("cancelLastBtn").addEventListener("click", cancelLastDraw);
    $("exportCsvBtn").addEventListener("click", exportWinnersCsv);

    $("modalCloseBtn").addEventListener("click", closeModal);
    $("resultModal").addEventListener("click", function (e) {
      if (e.target === $("resultModal")) closeModal();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeModal();
    });
  }

  /* ---------------- Init ---------------- */

  function init() {
    loadState();
    wireEvents();
    renderAll();
    tickClock();
    setInterval(tickClock, 1000);
    setTimeout(function () {
      var splash = $("splashScreen");
      if (!splash) return;
      splash.classList.add("is-exiting");
      setTimeout(function () {
        splash.classList.add("is-hidden");
      }, 120);
    }, 2400);
  }

  document.addEventListener("DOMContentLoaded", init);
})();