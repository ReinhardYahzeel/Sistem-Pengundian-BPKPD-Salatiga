(function () {
  "use strict";

  var STORAGE_KEY = "bpkpd-pajak-undian-v4";

  /* ==========================================================================
     STATE  (model data internal)
     Participant : { id, npwpd, namaOp, jenisPajak, sourceFile, sourceSheet, won }
     Winner      : { winnerId, no, npwpd, namaOp, jenisPajak, prize,
                     sourceFile, drawnAt, dateStr, timeStr, timestamp,
                     prizeBatchId, status }
     ========================================================================== */

  var DEFAULT_TAX_LIST = ["Pajak Parkir", "Pajak Hotel", "Pajak Restoran", "Pajak Hiburan", "Pajak Reklame", "PBB-P2", "BPHTB", "Pajak Air Tanah", "Pajak Penerangan Jalan", "Pajak Sarang Burung Walet"];

  var state = {
    participants: [],
    prizes: [],
    prizeBatches: [],
    winners: [],
    lastBatch: [],
    rounds: 0,
    sampleLoaded: false,
    jenisPajakList: DEFAULT_TAX_LIST.slice()
  };

  var uidCounter = 1;
  var participantPage = 0;
  var participantPageSize = 25;
  function nextUid() { return (Date.now().toString(36) + (uidCounter++).toString(36)); }

  /* ==========================================================================
     PERSISTENCE  (Storage layer — data disimpan di localStorage browser, bukan server)
     ========================================================================== */

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
      if (!raw) return;
      var parsed = JSON.parse(raw);
      state = Object.assign({}, state, parsed);

      state.jenisPajakList = Array.isArray(state.jenisPajakList) && state.jenisPajakList.length
        ? state.jenisPajakList.slice()
        : DEFAULT_TAX_LIST.slice();

      state.participants = (state.participants || []).map(function (p) {
        return {
          id: p.id || nextUid(),
          npwpd: p.npwpd != null ? p.npwpd : (p.id || "-"),
          namaOp: p.namaOp != null ? p.namaOp : (p.name != null ? p.name : (p.plate || "-")),
          jenisPajak: p.jenisPajak != null ? p.jenisPajak : (p.address || "-"),
          sourceFile: p.sourceFile != null ? p.sourceFile : "-",
          sourceSheet: p.sourceSheet != null ? p.sourceSheet : "-",
          won: !!p.won
        };
      });

      state.winners = (state.winners || []).map(function (w) {
        return {
          winnerId: w.winnerId || nextUid(),
          no: w.no,
          npwpd: w.npwpd != null ? w.npwpd : (w.id || "-"),
          namaOp: w.namaOp != null ? w.namaOp : (w.name != null ? w.name : (w.plate || "-")),
          jenisPajak: w.jenisPajak != null ? w.jenisPajak : (w.address || "-"),
          prize: w.prize,
          sourceFile: w.sourceFile != null ? w.sourceFile : "-",
          drawnAt: w.drawnAt || (w.timestamp ? new Date(w.timestamp).toISOString() : "-"),
          dateStr: w.dateStr || "",
          timeStr: w.timeStr || "",
          timestamp: w.timestamp || Date.now(),
          prizeId: w.prizeId || null,
          prizeQty: w.prizeQty || null,
          prizeBatchId: w.prizeBatchId || null,
          status: w.status || "Pemenang"
        };
      });

      state.prizes = (state.prizes || []).map(function (p) {
        return {
          id: p.id || nextUid(),
          qty: p.qty || 1,
          name: p.name || "-",
          sourceSheet: p.sourceSheet || "-",
          drawn: Number(p.drawn) || 0
        };
      });
      state.prizeBatches = state.prizeBatches || [];
      state.lastBatch = state.lastBatch || [];
    } catch (e) {
      console.warn("Gagal memuat data tersimpan", e);
    }
  }

  /* ==========================================================================
     UTIL  (secure random & UI helpers)
     ========================================================================== */

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

  function $(id) { return document.getElementById(id); }
  function stringField(id) { return ($(id) && $(id).value != null ? String($(id).value) : "").trim(); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function escapeHtml(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  function activeParticipants() {
    return state.participants.filter(function (p) { return !p.won; });
  }

  function collectTaxTypes(list) {
    var map = {};
    (list || []).forEach(function (item) {
      var tax = item.jenisPajak || "-";
      map[tax] = true;
    });
    return Object.keys(map).sort(function (a, b) { return a.localeCompare(b, "id"); });
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

  /* ==========================================================================
     CONFIRM MODAL  (konfirmasi Ya/Tidak untuk aksi penting)
     ========================================================================== */

  var confirmCallback = null;

  function openConfirm(title, message, yesLabel, cb) {
    $("confirmTitle").textContent = title;
    $("confirmMessage").innerHTML = message;
    $("confirmYesBtn").textContent = yesLabel || "Ya";
    confirmCallback = cb || null;
    $("confirmModal").classList.add("open");
  }

  function closeConfirm() {
    confirmCallback = null;
    $("confirmModal").classList.remove("open");
  }

  /* ==========================================================================
     CLOCK & NAVIGATION
     ========================================================================== */

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

  /* ==========================================================================
     PARSER  (CSV & XLSX → baris mentah)
     ========================================================================== */

  function detectDelimiter(text) {
    var head = text.split(/\r?\n/, 1)[0] || "";
    if (head.charAt(0) === "\uFEFF") head = head.slice(1);
    var counts = { ",": 0, ";": 0, "\t": 0 };
    for (var i = 0; i < head.length; i++) {
      var ch = head.charAt(i);
      if (ch in counts) counts[ch]++;
    }
    var best = ",";
    if (counts[";"] > counts[best]) best = ";";
    if (counts["\t"] > counts[best]) best = "\t";
    return best;
  }

  function parseCsvRows(text, delim) {
    text = String(text == null ? "" : text).replace(/^\uFEFF/, "");
    delim = delim || detectDelimiter(text);
    var rows = [];
    var row = [];
    var field = "";
    var inQuotes = false;
    var i = 0;
    var c;
    while (i < text.length) {
      c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i += 1; continue;
        }
        field += c; i += 1; continue;
      }
      if (c === '"') { inQuotes = true; i += 1; continue; }
      if (c === delim) { row.push(field); field = ""; i += 1; continue; }
      if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i += 1; continue; }
      if (c === "\r") { i += 1; continue; }
      field += c; i += 1;
    }
    if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
    return rows;
  }

  /* Membaca file → { sheets: [{ sheetName, rows }], sheetName, rows } dengan semua sel dinormalkan jadi string. */
  function extractRows(file) {
    return new Promise(function (resolve, reject) {
      var lower = (file.name || "").toLowerCase();
      if (/\.csv$/.test(lower) || /\.txt$/.test(lower)) {
        var r1 = new FileReader();
        r1.onload = function () {
          resolve(makeSheets(["CSV"], [parseCsvRows(r1.result || "")]));
        };
        r1.onerror = function () { reject(new Error("Gagal membaca file " + file.name)); };
        r1.readAsText(file, "utf-8");
      } else if (/\.(xlsx|xls)$/.test(lower)) {
        var r2 = new FileReader();
        r2.onload = function () {
          try {
            var wb = XLSX.read(r2.result, { type: "array" });
            var names = wb.SheetNames || [];
            var arrays = names.map(function (sn) {
              return XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: false, defval: "" });
            });
            resolve(makeSheets(names, arrays));
          } catch (err) { reject(err); }
        };
        r2.onerror = function () { reject(new Error("Gagal membaca file " + file.name)); };
        r2.readAsArrayBuffer(file);
      } else {
        reject(new Error("Format tidak didukung: " + file.name));
      }
    });
  }

  /* Menyusun hasil multi-sheet; "rows"/"sheetName" diset sheet pertama agar pemanggil lama tetap bekerja. */
  function makeSheets(sheetNames, rowArrays) {
    var sheets = sheetNames.map(function (sn, i) {
      return { sheetName: sn, rows: normalizeRows(rowArrays[i] || []) };
    });
    return { sheets: sheets, sheetName: sheets[0].sheetName, rows: sheets[0].rows };
  }

  function normalizeRows(rows) {
    return (rows || []).map(function (r) {
      return (r || []).map(function (cell) { return cell == null ? "" : String(cell); });
    });
  }

  /* ==========================================================================
     COLUMN MAPPER  (deteksi kolom NPWPD / Nama OP / Jenis Pajak antar-format)
     ========================================================================== */

  var NPWPD_KEYS = ["npwpd", "no npwpd", "nomor npwpd", "no.npwpd", "npwpd no", "npwp", "no npwp", "nomor npwp", "nomor pokok wajib pajak daerah", "nomor pokok wajib pajak", "id peserta", "kode peserta", "no peserta", "idpiutang", "kode piutang"];
  var NAMA_KEYS = ["nama", "name", "nama op", "nama wajib pajak", "nama wp", "nama wajib pajak daerah", "wajib pajak", "pemilik", "nama pemilik", "nama usaha", "nama wpd", "wajib pajak daerah", "nama pemenang", "nama peserta"];
  var JENIS_KEYS = ["jenis", "jenis pajak", "tipe pajak", "kategori pajak", "nama jenis pajak", "kategori"];

  /* kunci khusus yang boleh cocok sebagai substring — berupa bentuk ternormalisasi (tanpa spasi/titik). */
  var NPWPD_CONTAINS = { npwpd: true, npwp: true, idpeserta: true, kodepeserta: true, nopeserta: true, idpiutang: true, kodepiutang: true };
  var NAMA_CONTAINS = { nama: true, name: true, pemilik: true, wajibpajak: true };
  var JENIS_CONTAINS = { jenispajak: true, tipepajak: true };

  var PK_BANNED_ROWS = /^(total|sub\s*-?\s*total|jumlah|grand\s*total|pagu|note|catatan|keterangan|laporan|kegiatan|opsi|dasar\s*hukum|perpu|pp\s*\d+|uu|perda|perwal)/i;

  /* Baris benar-benar pola total/keterangan (footer), bukan nama OP:
     nilai disamakan ke kata jumlah secara utuh, atau diikuti pemisah/angka
     (mis. "Jumlah", "TOTAL:", "Sub Total 125", "PP 12 Tahun 2018"). */
  function isBannedTotalRow(value) {
    var v = String(value == null ? "" : value).trim();
    if (!v) return false;
    var lower = v.toLowerCase().replace(/\s+/g, " ");
    var exact = [];
    "total|sub total|subtotal|grand total|jumlah|pagu|note|catatan|keterangan|laporan|kegiatan|opsi|dasar hukum|perpu|pp|uu|perda|perwal".split("|").forEach(function (w) { exact.push(w); });
    for (var j = 0; j < exact.length; j++) {
      var w = exact[j];
      if (w === "pp" || w === "uu" || w === "perpu" || w === "perda" || w === "perwal") continue;
      if (lower === w) return true;
      if (lower.indexOf(w + ":") === 0 || lower.indexOf(w + ";") === 0) return true;
      if (lower.indexOf(w + " ") === 0) {
        var rest = lower.slice(w.length + 1).trim();
        if (/^\d/.test(rest) || rest === "") return true;
      }
    }
    var m = /^(pp|uu|perpu|perda|perwal)[\s:.]*(\d+|tahun)/i.exec(lower);
    return !!m;
  }

  function normalizeHeader(value) {
    return String(value == null ? "" : value).toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function findCol(header, keys, containsKeys) {
    var i, j;
    var norm = [];
    for (i = 0; i < header.length; i++) norm.push(normalizeHeader(header[i]));
    for (i = 0; i < norm.length; i++) {
      for (j = 0; j < keys.length; j++) {
        var k = normalizeHeader(keys[j]);
        if (k && (norm[i] === k || (containsKeys[k] && norm[i].indexOf(k) !== -1))) return i;
      }
    }
    return -1;
  }

function findColPrefer(header, keys, containsKeys, preferKeys) {
  var p = findCol(header, preferKeys, containsKeys);
  return p !== -1 ? p : findCol(header, keys, containsKeys);
}

function detectColumns(header) {
  var preferNameKeys = ["nama op", "nama wpd", "wajib pajak daerah", "nama pemenang", "nama peserta"];
  return {
    npwpdIdx: findCol(header, NPWPD_KEYS, NPWPD_CONTAINS),
    nameIdx: findColPrefer(header, NAMA_KEYS, NAMA_CONTAINS, preferNameKeys),
    jenisIdx: findCol(header, JENIS_KEYS, JENIS_CONTAINS)
  };
}

  /* ==========================================================================
     NORMALIZER & PARTICIPANT POOL
     ========================================================================== */

  /* rows sudah bersih (tidak kosong sempurna), mapping dari Column Mapper. */
  function normalizeTaxType(value) {
    return String(value == null ? "" : value).trim().toLocaleUpperCase("id-ID");
  }

  /* Hitung baris data valid vs baris non-data (header berulang / total / kosong).
     Dipakai untuk validasi sebelum impor agar jumlah yang akan masuk bisa dicek. */
  function previewImportCounts(cleaned, mapping) {
    var header = cleaned[0];
    var npwpdIdx = mapping.npwpdIdx;
    var nameIdx = mapping.nameIdx;
    if (npwpdIdx === nameIdx) nameIdx = -1;
    var valid = 0, nonData = 0;
    for (var i = 1; i < cleaned.length; i++) {
      var cols = cleaned[i];
      var npwpd = npwpdIdx !== -1 ? String(cols[npwpdIdx] == null ? "" : cols[npwpdIdx]).trim() : "";
      var namaOp = nameIdx !== -1 ? String(cols[nameIdx] == null ? "" : cols[nameIdx]).trim() : "";
      if (npwpd && namaOp && npwpd === header[npwpdIdx] && namaOp === header[nameIdx]) { nonData++; continue; }
      if (!npwpd && !namaOp) { nonData++; continue; }
      if (isBannedTotalRow(npwpd) || (!npwpd && isBannedTotalRow(namaOp))) { nonData++; continue; }
      valid++;
    }
    return { valid: valid, nonData: nonData };
  }

  function importRows(cleaned, mapping, meta) {
    var header = cleaned[0];
    var npwpdIdx = mapping.npwpdIdx;
    var nameIdx = mapping.nameIdx;
    var jenisIdx = mapping.jenisIdx;
    if (npwpdIdx === nameIdx) nameIdx = -1;

    /* Kebijakan undian: SEMUA baris file dimasukkan apa adanya.
       Duplikat NPWPD (dalam file maupun antar file) TIDAK dibuang agar tidak
       ada data yang terlewat. */

    /* Identitas baris untuk NPWPD kosong: deterministik per file+sheet+baris sehingga
       impor ulang file yang sama tidak menghasilkan peserta ganda. */
    var sourceTag = slugify((meta.fileName || "") + "|" + (meta.sheetName || ""));

    var added = 0;
    var reasons = { banned: 0, header: 0, empty: 0 };
    var skipped = 0;
    var skippedExamples = [];

    function noteSkip(reason, label) {
      reasons[reason]++;
      skipped++;
      if (skippedExamples.length < 5) skippedExamples.push(label);
    }

    for (var i = 1; i < cleaned.length; i++) {
      var cols = cleaned[i];
      var npwpd = npwpdIdx !== -1 ? String(cols[npwpdIdx] == null ? "" : cols[npwpdIdx]).trim() : "";
      var namaOp = nameIdx !== -1 ? String(cols[nameIdx] == null ? "" : cols[nameIdx]).trim() : "";

      /* Baris yang mengulang teks header (header berulang di tengah file). */
      if (npwpd && namaOp && npwpd === header[npwpdIdx] && namaOp === header[nameIdx]) {
        noteSkip("header", "baris ularang-ulang header \u201c" + namaOp + "\u201d");
        continue;
      }
      if (!npwpd && !namaOp) { noteSkip("empty", "baris kosong #" + i); continue; }

      /* Baris total/jumlah/catatan yang tertangkap pola. Hanya dilewati bila sel NPWPD-nya
         kosong atau jantung baris memang kata jumlah — jadi nama OP seperti "RM Perdana",
         "Total Masakan", "Keterangan Nasi" dsb. TIDAK akan hilang. */
      var looksTotal = isBannedTotalRow(npwpd) || (!npwpd && isBannedTotalRow(namaOp));
      if (looksTotal) {
        noteSkip("banned", "baris bukan data \u201c" + (namaOp || npwpd) + "\u201d (baris data #" + i + ")");
        continue;
      }

      /* NPWPD kosong → beri id sintetis stabil agar semua baris tercatat. */
      if (!npwpd) npwpd = "ROW-" + slugify(namaOp) + "-" + sourceTag + "-" + i;
      if (!namaOp) namaOp = "-";

      var jenisPajak = normalizeTaxType(meta.jenisPajak || "");
      if (!jenisPajak && jenisIdx !== -1) {
        jenisPajak = normalizeTaxType(cols[jenisIdx]);
      }
      if (!jenisPajak) jenisPajak = "-";

      state.participants.push({
        id: nextUid(),
        npwpd: npwpd,
        namaOp: namaOp,
        jenisPajak: jenisPajak,
        sourceFile: meta.fileName || "-",
        sourceSheet: meta.sheetName || "-",
        won: false
      });
      added++;
    }
    return { added: added, skipped: skipped, header: header, reasons: reasons, skippedExamples: skippedExamples };
  }

  function slugify(value) {
    return String(value == null ? "" : value).toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24) || "x";
  }

  /* ==========================================================================
     UPLOAD PESERTA  (file dipilih → kolom NPWPD/NAMA/JENIS dideteksi otomatis → langsung masuk pool)
     ========================================================================== */

  /* ==========================================================================
     JENIS PAJAK DARI JUDUL POJOK  (file per-jenis: judul di pojok kiri atas)
     ========================================================================== */

  function collectTaxTypesPool() {
    var pool = Array.prototype.slice.call(
      state.jenisPajakList && state.jenisPajakList.length ? state.jenisPajakList : DEFAULT_TAX_LIST
    );
    DEFAULT_TAX_LIST.forEach(function (t) { if (pool.indexOf(t) === -1) pool.push(t); });
    return pool;
  }

  /* Baca jenis pajak dari pojok kiri file (judul di atas header), mis. "PAJAK HOTEL TAHUN 2026"
     atau "DAFTAR NOMINATIF WAJIB PAJAK RESTORAN". Urutan cek: sama persis / mengandung nama
     pajak yang dikenal, lalu pola "pajak <kata>". */
  function detectSheetTaxType(rows, headerIdx) {
    var pool = collectTaxTypesPool();
    var nrm = pool.map(function (p) { return p.toLowerCase().replace(/[^a-z0-9]/g, ""); });

    var scanMax = Math.min(headerIdx + 1, 8);
    var scanCols = Math.min(6, (rows[0] || []).length);
    for (var c = 0; c < scanCols; c++) {
      for (var r = 0; r < scanMax; r++) {
        var v = String((rows[r] || [])[c] == null ? "" : rows[r][c]).trim();
        if (!v) continue;
        var n = v.toLowerCase().replace(/[^a-z0-9]/g, "");
        var best = null, bestLen = 0;
        for (var j = 0; j < nrm.length; j++) {
          if (!nrm[j]) continue;
          if (n === nrm[j]) return pool[j];
          if (n.indexOf(nrm[j]) !== -1 && nrm[j].length > bestLen) { best = pool[j]; bestLen = nrm[j].length; }
        }
        if (best) return best;
        var m = /pajak\s+([a-z0-9][a-z0-9 ._\-]*)/i.exec(v);
        if (m) {
          var t = m[1].replace(/\s*(tahun|thn|tp)\b.*$/i, "").replace(/\s*\d{4}\s*$/, "").trim();
          if (t) return ("Pajak " + t).replace(/\s+/g, " ");
        }
      }
    }
    return "";
  }

  /* Cari baris header terbaik: baris dengan beberapa kolom terisi dan memiliki kolom NPWPD/Nama. */
  function findParticipantHeader(rows) {
    var best = null;
    for (var r = 0; r < rows.length; r++) {
      var m = detectColumns(rows[r]);
      if (m.npwpdIdx === -1 && m.nameIdx === -1) continue;
      var filled = 0;
      for (var c = 0; c < rows[r].length; c++) {
        if (String(rows[r][c] == null ? "" : rows[r][c]).trim() !== "") filled++;
      }
      if (filled < 2) continue;
      var score = (m.npwpdIdx > -1 ? 4 : 0) + (m.nameIdx > -1 ? 2 : 0) + (m.jenisIdx > -1 ? 1 : 0);
      if (!best || score > best.score) best = { headerIdx: r, mapping: m, score: score };
    }
    return best || null;
  }

  var pendingImportJobs = null;

  function collectTaxTypePool() {
    var values = [];
    var seen = {};
    [DEFAULT_TAX_LIST, state.jenisPajakList, collectTaxTypes(state.participants), collectTaxTypes(state.winners)].forEach(function (list) {
      (list || []).forEach(function (v) {
        v = String(v == null ? "" : v).trim();
        if (v && !seen[v]) { seen[v] = true; values.push(v); }
      });
    });
    return values;
  }

  function handleFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (files.length === 0) return;
    var parsed = files.map(function (file) {
      return extractRows(file).then(function (result) { return { file: file, result: result }; });
    });
    Promise.all(parsed).then(function (entries) {
      var jobs = [];
      var badFiles = [];
      entries.forEach(function (entry) {
        var fileHasJob = false;
        entry.result.sheets.forEach(function (sheet) {
          var cleaned = sheet.rows.filter(function (row) {
            return row.some(function (cell) { return String(cell == null ? "" : cell).trim() !== ""; });
          });
          if (cleaned.length === 0) return;
          var found = findParticipantHeader(cleaned);
          if (!found) return;
          fileHasJob = true;
          var cornerTax = detectSheetTaxType(cleaned, found.headerIdx) || "";
          jobs.push({ file: entry.file, sheetName: sheet.sheetName, cleaned: cleaned, found: found, cornerTax: cornerTax });
        });
        if (!fileHasJob) badFiles.push(entry.file.name);
      });
      if (jobs.length === 0) {
        showToast("Tidak ada sheet valid berisi kolom No NPWPD & Nama OP di file terpilih" +
          (badFiles.length ? ": " + badFiles.join(", ") : "") + ".", "danger");
        return;
      }
      pendingImportJobs = jobs;
      renderImportTaxModal(jobs);
    }).catch(function (err) {
      console.error(err);
      showToast(err.message || "Gagal membaca file", "danger");
    });
  }

  function renderImportTaxModal(jobs) {
    $("importTaxModalDatalist").innerHTML = collectTaxTypePool().map(function (v) {
      return '<option value="' + escapeHtml(normalizeTaxType(v)) + '"></option>';
    }).join("");
    var list = $("importTaxList");
    var totalValid = 0, totalNonData = 0;
    list.innerHTML = jobs.map(function (job, i) {
      var hasColumn = job.found.mapping.jenisIdx !== -1;
      var corner = normalizeTaxType(job.cornerTax);
      var hint = hasColumn
        ? '<span class="tag tag-blue">kolom Jenis Pajak ada (otomatis)</span>'
        : (corner
          ? '<span class="tag tag-purple">tampak di judul file: ' + escapeHtml(corner) + '</span>'
          : '<span class="tag tag-ghost">tidak terdeteksi \u2014 isi manual</span>');
      var preview = previewImportCounts(job.cleaned, job.found.mapping);
      totalValid += preview.valid;
      totalNonData += preview.nonData;
      return '<div class="import-tax-row">' +
        '<div class="import-tax-info">' +
          '<strong>' + escapeHtml(job.file.name) + '</strong>' +
          '<span class="import-tax-sheet">' + escapeHtml(job.sheetName) + ' \u2014 total ' + job.cleaned.length + ' baris</span>' +
          '<span class="import-tax-preview ' + (preview.valid > 0 ? 'ok' : 'warn') + '">' +
            preview.valid + ' data valid \u2208 impor' +
            (preview.nonData ? ' \u00b7 ' + preview.nonData + ' non-data dilewati' : '') +
          '</span>' +
          '<div class="import-tax-hints">' + hint + '</div>' +
        '</div>' +
        '<input class="import-tax-select" list="importTaxModalDatalist" placeholder="Ketik jenis pajak..." data-tax-index="' + i + '">' +
      '</div>';
    }).join("");
    var inputs = list.querySelectorAll("input[data-tax-index]");
    for (var i = 0; i < inputs.length; i++) {
      var job = jobs[i];
      var prefill = (job.found.mapping.jenisIdx !== -1) ? ""
        : (normalizeTaxType(job.cornerTax) || "");
      inputs[i].value = prefill;
      inputs[i].addEventListener("input", function () {
        var upper = this.value.toLocaleUpperCase("id-ID");
        if (this.value !== upper) {
          var pos = this.selectionStart != null ? this.selectionStart : 0;
          this.value = upper;
          if (this.setSelectionRange) { try { this.setSelectionRange(pos, pos); } catch (e) {} }
        }
      });
    }
    $("importTaxSub").textContent =
      jobs.length + " sheet siap diimpor \u2208 total " + totalValid + " data valid" +
      (totalNonData ? ", " + totalNonData + " baris non-data akan dilewati" : "") +
      ". Isi/cek jenis pajak tiap file lalu klik \u201cImpor sekarang\u201d.";
    $("importTaxModal").classList.add("open");
  }

  function runImportFromJobs() {
    if (!pendingImportJobs || pendingImportJobs.length === 0) { closeImportTaxModal(); return; }
    var jobs = pendingImportJobs;
    var inputs = $("importTaxList").querySelectorAll("input[data-tax-index]");
    var totalAdded = 0;
    var totalSkipped = 0;
    var perFileAdded = {};
    var perFileSkipped = {};
    var perFileReasons = {};
    var perFileSources = {};
    jobs.forEach(function (job, i) {
      var chosen = normalizeTaxType(inputs[i] ? inputs[i].value : "");
      var hasColumn = job.found.mapping.jenisIdx !== -1;
      var taxValue;
      var source;
      if (chosen) {
        taxValue = chosen;
        source = (job.cornerTax && normalizeTaxType(job.cornerTax) === chosen) ? "corner" : "user";
      } else if (hasColumn) {
        taxValue = ""; source = "column";
      } else if (job.cornerTax) {
        taxValue = normalizeTaxType(job.cornerTax); source = "corner";
      } else {
        taxValue = ""; source = "none";
      }
      var res = importRows(job.cleaned.slice(job.found.headerIdx), job.found.mapping, {
        jenisPajak: taxValue,
        fileName: job.file.name,
        sheetName: job.sheetName
      });
      totalAdded += res.added;
      totalSkipped += res.skipped;
      var f = job.file.name;
      perFileAdded[f] = (perFileAdded[f] || 0) + res.added;
      perFileSkipped[f] = (perFileSkipped[f] || 0) + res.skipped;
      perFileSources[f] = perFileSources[f] || {};
      perFileSources[f][source] = true;
      perFileReasons[f] = perFileReasons[f] || {};
      if (res.reasons) {
        ["banned", "header", "empty"].forEach(function (k) {
          if (res.reasons[k]) perFileReasons[f][k] = (perFileReasons[f][k] || 0) + res.reasons[k];
        });
      }
    });
    pendingImportJobs = null;
    closeImportTaxModal();
    saveState();
    renderAll();
    var sourceLabels = { column: "kolom file", corner: "judul pojok file", user: "pengaturan di dialog", none: "tanpa jenis pajak" };
    var reasonLabels = {
      banned: "baris bukan data (total/keterangan)",
      header: "baris header berulang",
      empty: "baris kosong"
    };
    var lines = Object.keys(perFileAdded).map(function (f) {
      var srcLabels = Object.keys(perFileSources[f]).map(function (s) { return sourceLabels[s]; });
      var reasonParts = [];
      var rf = perFileReasons[f] || {};
      Object.keys(reasonLabels).forEach(function (k) {
        if (rf[k]) reasonParts.push(rf[k] + " " + reasonLabels[k]);
      });
      var skipInfo = reasonParts.length ? " — dilewati: " + reasonParts.join(", ") : "";
      return "'" + f + "': " + perFileAdded[f] + " peserta dimasukkan semua apa adanya" +
        (perFileSkipped[f] ? ", " + perFileSkipped[f] + " bukan baris data (dilewati)" : "") +
        skipInfo +
        " [Jenis Pajak: " + (srcLabels.join(" + ") || "-") + "]";
    });
    if (totalAdded === 0) {
      showToast("Tidak ada data yang bisa diimpor. " + lines.join("; "), "danger");
    } else {
      showToast(lines.join("; "), "success");
    }
  }

  function closeImportTaxModal() {
    $("importTaxModal").classList.remove("open");
  }

  /* ==========================================================================
     SAMPLE DATA  (data dummy untuk uji coba)
     ========================================================================== */

  var FIRST_NAMES = ["Agus", "Budi", "Andi", "Siti", "Dewi", "Eko", "Rina", "Fajar", "Gita", "Hendra", "Indah", "Joko", "Kartika", "Lina", "Maya", "Nanda", "Oki", "Putri", "Rizky", "Salsa", "Tono", "Umi", "Vina", "Wahyu", "Yanti", "Zaki", "Agung", "Bayu", "Citra", "Dimas", "Eka", "Fitri", "Gilang", "Hana", "Ilham", "Jihan", "Kurnia", "Laras", "Miftah", "Nadia", "Oscar", "Panji", "Qori", "Rama", "Shela", "Taufik", "Umar", "Vanesa", "Widya", "Yoga"];
  var LAST_NAMES = ["Santoso", "Saputra", "Pratama", "Wijaya", "Hidayat", "Firmansyah", "Kusuma", "Rahayu", "Wibowo", "Nugroho", "Suryanto", "Sulistyo", "Setyawan", "Permata", "Anggraini", "Mahendra", "Wicaksono", "Handayani", "Prasetyo", "Rahmawati", "Lestari", "Kurniawan", "Utomo", "Susanti", "Gunawan"];

  function makeRandomNpwpd() {
    var s = "";
    for (var i = 0; i < 15; i++) s += secureRandomInt(10);
    return s.replace(/(\d{2})(\d{3})(\d{5})(\d)(\d{4})/, "$1.$2.$3.$4.$5");
  }

  function makeRandomPersonName() {
    return FIRST_NAMES[secureRandomInt(FIRST_NAMES.length)] + " " + LAST_NAMES[secureRandomInt(LAST_NAMES.length)];
  }

  function loadSampleData() {
    if (state.sampleLoaded) {
      showToast("Data contoh sudah dimuat sebelumnya", "danger");
      return;
    }
    var taxOptions = state.jenisPajakList.length ? state.jenisPajakList : DEFAULT_TAX_LIST;
    var count = 15000;
    var batch = [];
    for (var i = 1; i <= count; i++) {
      batch.push({
        id: nextUid(),
        npwpd: makeRandomNpwpd(),
        namaOp: makeRandomPersonName(),
        jenisPajak: taxOptions[secureRandomInt(taxOptions.length)],
        sourceFile: "data-contoh.csv",
        sourceSheet: "-",
        won: false
      });
    }
    state.participants = state.participants.concat(batch);
    state.sampleLoaded = true;
    saveState();
    renderAll();
    showToast("15.000 data contoh berhasil dimuat", "success");
  }

  /* ==========================================================================
     PRIZES
     ========================================================================== */

  function addPrize(qty, name) {
    qty = parseInt(qty, 10);
    name = (name || "").trim().toLocaleUpperCase("id-ID");
    if (!name) { showToast("Nama hadiah tidak boleh kosong", "danger"); return; }
    if (!qty || qty < 1) { showToast("Jumlah pemenang minimal 1", "danger"); return; }
    state.prizes.push({ id: nextUid(), qty: qty, name: name, drawn: 0 });
    saveState();
    renderAll();
  }

  function removePrize(id) {
    state.prizes = state.prizes.filter(function (p) { return p.id !== id; });
    saveState();
    renderAll();
  }

  function remainingSlots() {
    return state.prizes.reduce(function (sum, p) { return sum + Math.max(0, p.qty - (p.drawn || 0)); }, 0);
  }

  /* ---- Impor hadiah dari file Excel/CSV (mis. format RENCANA HADIAH: NO | NAMA BARANG | SPESIFIKASI | JML BRG | ...) ---- */

  var PRIZE_NAME_KEYS = ["nama barang", "barang", "nama hadiah", "hadiah", "nama kategori", "kategori hadiah", "hadiah utama", "prize", "prize name", "kategori"];
  var PRIZE_NAME_CONTAINS = { barang: true, hadiah: true, prize: true };
  var PRIZE_SPEC_KEYS = ["spesifikasi", "spek", "merk", "tipe", "varian", "keterangan", "rincian"];
  var PRIZE_SPEC_CONTAINS = { spesifikasi: true, spek: true };
  var PRIZE_QTY_KEYS = ["jml brg", "jumlah brg", "jumlah barang", "jml barang", "jumlah pemenang", "jml pemenang", "jml", "jumlah", "qty", "banyak", "kuota"];
  var PRIZE_QTY_CONTAINS = { jml: true, jumlah: true, qty: true, banyak: true };
  var PRIZE_NO_KEYS = ["no", "nomor", "urutan", "no urut", "no. urut"];
  var PRIZE_NO_CONTAINS = { nomor: true };

  function mapPrizeColumns(header) {
    return {
      nameIdx: findCol(header, PRIZE_NAME_KEYS, PRIZE_NAME_CONTAINS),
      specIdx: findCol(header, PRIZE_SPEC_KEYS, PRIZE_SPEC_CONTAINS),
      qtyIdx: findCol(header, PRIZE_QTY_KEYS, PRIZE_QTY_CONTAINS),
      noIdx: findCol(header, PRIZE_NO_KEYS, PRIZE_NO_CONTAINS)
    };
  }

  /* Baris non-data (judul ringkasan, anggaran, kegiatan) dilewati. */
  var PRIZE_BANNED_NAMES = /^(total|sub\s*-?\s*total|jumlah|grand\s*total|pagu|kegiatan|operasional|pengad|perkiraan|rencana|sisa|dasar\s*hukum)/i;

  /* Cari baris header (memuat kolom nama & jumlah) di posisi mana pun, lalu ekstrak kandidat hadiah. */
  function parsePrizeSheet(rows) {
    var cols = null, headerIdx = -1;
    for (var r = 0; r < rows.length; r++) {
      var m = mapPrizeColumns(rows[r]);
      if (m.nameIdx > -1 && m.qtyIdx > -1) { cols = m; headerIdx = r; break; }
    }
    if (!cols) return { prizes: [] };

    var prizes = [];
    for (var i = headerIdx + 1; i < rows.length; i++) {
      var row = rows[i];
      var name = String(row[cols.nameIdx] == null ? "" : row[cols.nameIdx]).trim();
      if (!name || PRIZE_BANNED_NAMES.test(name)) continue;

      var noRaw = cols.noIdx > -1 ? String(row[cols.noIdx] == null ? "" : row[cols.noIdx]).trim() : "";
      if (noRaw && !/^[\d,.\s]+$/.test(noRaw)) continue;

      var spec = cols.specIdx > -1 ? String(row[cols.specIdx] == null ? "" : row[cols.specIdx]).trim() : "";
      var qtyRaw = cols.qtyIdx > -1 ? String(row[cols.qtyIdx] == null ? "" : row[cols.qtyIdx]).trim() : "";
      var qtyDigits = qtyRaw.replace(/[^\d]/g, "");
      if (qtyRaw && !qtyDigits) continue;

      var qty = qtyDigits ? parseInt(qtyDigits, 10) : 1;
      if (qty < 1) qty = 1;
      prizes.push({ name: name, spec: spec, qty: qty });
    }
    return { prizes: prizes };
  }

  /* Kandidat yang sedang dibuka di jendela pilih hadiah (tidak disimpan). */
  var prizeCandidates = [];
  var prizeActiveSheet = "";

  function handlePrizeFile(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    files.forEach(function (file) {
      extractRows(file).then(function (result) {
        var sheets = [];
        result.sheets.forEach(function (sheet) {
          var parsed = parsePrizeSheet(sheet.rows);
          parsed.sheetName = sheet.sheetName;
          parsed.prizes.forEach(function (pr) { pr.sheetName = sheet.sheetName; });
          sheets.push(parsed);
        });
        if (sheets.length === 0 || sheets.every(function (s) { return s.prizes.length === 0; })) {
          showToast("'" + file.name + "': tidak ada baris hadiah yang dikenali (cari kolom NAMA BARANG / JML BRG)", "danger");
          return;
        }
        prizeCandidates = [];
        var sheetIdx = -1;
        sheets.forEach(function (s) {
          if (s.prizes.length > 0) sheetIdx++;
          s.prizes.forEach(function (pr) {
            pr._sheetIndex = sheetIdx < 0 ? -1 : sheetIdx;
            prizeCandidates.push(pr);
          });
        });
        var withData = sheets.filter(function (s) { return s.prizes.length > 0; });
        prizeActiveSheet = withData.length === 1 ? withData[0].sheetName : "";
        openPrizePick(file.name, sheets);
      }).catch(function (err) {
        console.error(err);
        showToast(err.message || "Gagal memproses hadiah " + file.name, "danger");
      });
    });
  }

  function prizeLabel(pr) {
    var label = pr.name.toLocaleUpperCase("id-ID");
    if (pr.spec) label += " - " + pr.spec.toLocaleUpperCase("id-ID");
    return label;
  }

  function openPrizePick(fileName, sheets) {
    var existing = {};
    state.prizes.forEach(function (p) { existing[String(p.name).toLowerCase()] = true; });
    prizeCandidates.forEach(function (pr, i) {
      pr._idx = i;
      pr.combined = prizeLabel(pr);
      pr.exists = !!existing[pr.combined.toLowerCase()];
      pr.checked = !pr.exists;
    });
    renderPrizePickSheetPicker(fileName, sheets);
    $("prizePickSub").textContent = "Ditemukan " + prizeCandidates.length + " hadiah dari '" + fileName + "'. Pilih sheet, centang yang mau diundi, lalu klik Impor terpilih.";
    renderPrizePick();
    $("prizePickModal").classList.add("open");
  }

  function renderPrizePickSheetPicker(fileName, sheets) {
    var select = $("prizePickSheet");
    var withData = sheets.filter(function (s) { return s.prizes.length > 0; });
    if (withData.length <= 1) {
      select.innerHTML = '<option value="">Semua sheet (' + prizeCandidates.length + ' hadiah)</option>';
      select.disabled = true;
      prizeActiveSheet = "";
      select.value = "";
      return;
    }
    select.innerHTML =
      '<option value="">Semua sheet (' + prizeCandidates.length + ' hadiah)</option>' +
      withData.map(function (s, i) {
        return '<option value="' + escapeHtml(String(i)) + '">' + escapeHtml(s.sheetName) + ' (' + s.prizes.length + ' hadiah)</option>';
      }).join("");
    select.disabled = false;
    select.value = "";
    prizeActiveSheet = "";
  }

  function activeSheetCandidates() {
    if (prizeActiveSheet === "") return prizeCandidates;
    var sheetIndex = parseInt(prizeActiveSheet, 10);
    if (isNaN(sheetIndex)) return prizeCandidates;
    return prizeCandidates.filter(function (pr) { return pr._sheetIndex === sheetIndex; });
  }

  function renderPrizePick() {
    var visible = activeSheetCandidates();
    var groups = {};
    visible.forEach(function (pr) {
      (groups[pr.sheetName || "-"] = groups[pr.sheetName || "-"] || []).push(pr);
    });
    updatePrizePickSummary();

    var html = "";
    Object.keys(groups).forEach(function (groupName) {
      html += '<div class="prize-pick-group"><svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14l4-4h12a2 2 0 0 0 2-2z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg><span>' + escapeHtml(groupName) + "</span></div>";
      groups[groupName].forEach(function (pr) {
        html += '<label class="prize-pick-item' + (pr.exists ? " is-existing" : "") + '">' +
          '<input type="checkbox" data-pick-idx="' + pr._idx + '"' + (pr.checked ? " checked" : "") + (pr.exists ? " disabled" : "") + ">" +
          '<span class="qty">' + pr.qty + '&times;</span>' +
          '<span class="info"><strong>' + escapeHtml(pr.name) + '</strong>' +
          (pr.spec ? '<span>' + escapeHtml(pr.spec) + '</span>' : "") +
          (pr.exists ? '<span class="exists-note">sudah ada di daftar</span>' : "") +
          '</span></label>';
      });
    });
    $("prizePickList").innerHTML = html;
  }

  function updatePrizePickSummary() {
    var visible = activeSheetCandidates();
    var selected = visible.filter(function (pr) { return pr.checked; }).length;
    $("prizePickCount").textContent = selected + " dari " + visible.length + " dipilih";
    $("prizePickAll").checked = selected > 0 && selected === visible.length;
    $("prizePickImportBtn").disabled = selected === 0;
  }

  function importSelectedPrizes() {
    var imported = 0, dup = 0;
    prizeCandidates.forEach(function (pr) {
      if (!pr.checked) return;
      var label = prizeLabel(pr);
      var exists = state.prizes.some(function (p) { return String(p.name).toLowerCase() === label.toLowerCase(); });
      if (exists) { dup++; return; }
      state.prizes.push({ id: nextUid(), qty: pr.qty, name: label, drawn: 0, sourceSheet: pr.sheetName || "-" });
      imported++;
    });
    saveState();
    renderAll();
    closePrizePick();
    showToast((imported ? imported + " hadiah ditambahkan" : "Tidak ada hadiah baru") + (dup ? ", " + dup + " sudah ada di daftar" : ""), imported ? "success" : "warning");
  }

  function closePrizePick() {
    prizeCandidates = [];
    $("prizePickModal").classList.remove("open");
  }

  /* ==========================================================================
     DRAW ENGINE  (randomizer + pengundi)
     ========================================================================== */

  var isSpinning = false;

  /* Konfigurasi durasi animasi pengundian (ms) — mudah disesuaikan.
     Alur satu pemenang: spin (3 dtk) -> pemenang di reel -> POP UP nama pemenang
     entrance subtle 0.5 dtk -> tampil 5 DETIK penuh ->
     exit mengecil & bergerak masuk ke tabel -> blur perlahan hilang ->
     tabel fokus kembali -> mengundi lagi. */
  var WINNER_REVEAL_DELAY = 4000;   // (tidak dipakai lagi — diganti rantai popup)
  var DRAW_SPIN_DURATION = 3200;    // durasi animasi spin tiap pemenang
  var SPIN_TICK_MS = 70;            // interval awal pergantian nama saat spin
  var SPIN_RAMP_MS = [SPIN_TICK_MS, SPIN_TICK_MS, 90, 110, 140, 180, 230, 290, 360, 440, 520, 610];
                                    // spin melambat: makin dekat pemenang, makin pelan
  var WINNER_FOUND_MS = 640;        // jeda "WINNER FOUND" sebelum popup celebration
  var POPUP_IN_MS = 1100;           // entrance penuh (puncak animasi popup ~0.9 dtk)
  var POPUP_HOLD_MS = 4200;         // popup tampil 4.2 DETIK penuh setelah entrance selesai
  var POPUP_OUT_MS = 2000;          // exit otomatis: cinematic menuju tabel (2 dtk)
  var POPUP_QUICK_OUT_MS = 320;    // exit saat tombol X ditekan: scale .92 + fade (320ms)
  var BLUR_OUT_DELAY_MS = 1500;     // blur mulai hilang 1.5 dtk setelah exit dimulai
  var ROW_SETTLE_MS = 1200;         // jeda setelah baris masuk tabel sebelum mengundi lagi

  /* Dipanggil saat operator menekan "Setuju & Lanjutkan" di akhir reveal. */
  var revealConfirmCallback = null;

  function pendingPrizes() {
    return state.prizes.filter(function (p) { return (p.drawn || 0) < p.qty; });
  }

  function renderPrizeDrawSelect(selectedId) {
    var select = $("prizeDrawSelect");
    if (!select) return;
    var pending = pendingPrizes();
    select.innerHTML = pending.map(function (p) {
      var left = p.qty - (p.drawn || 0);
      return '<option value="' + p.id + '">' + p.qty + '&times; ' + escapeHtml(p.name) + ' — ' + left + ' pemenang tersisa</option>';
    }).join("");
    if (pending.length === 0) {
      select.innerHTML = '<option value="">Semua hadiah sudah selesai diundi</option>';
    }
    if (selectedId && pending.some(function (p) { return p.id === selectedId; })) {
      select.value = selectedId;
    }
  }

  function runDraw() {
    if (isSpinning) return;

    var active = activeParticipants();
    if (active.length === 0) {
      showToast("Tidak ada peserta aktif untuk diundi", "danger");
      return;
    }
    var pending = pendingPrizes();
    if (pending.length === 0) {
      showToast("Semua hadiah sudah selesai diundi", "danger");
      return;
    }
    var select = $("prizeDrawSelect");
    var prize = pending[0];
    if (select && select.value) {
      var chosen = state.prizes.find(function (p) { return p.id === select.value; });
      if (chosen && (chosen.drawn || 0) < chosen.qty) prize = chosen;
    }
    if ((prize.drawn || 0) >= prize.qty) {
      showToast("Hadiah tersebut sudah selesai diundi", "danger");
      return;
    }

    isSpinning = true;
    $("spinBtn").disabled = true;
    $("cancelLastBtn").disabled = true;

    /* Semua undian memakai flow reveal (multi-pemenang / 1 pemenang).
       Hasil ditentukan SEKALI oleh draw engine (crypto.getRandomValues +
       rejection sampling — tetap sama), lalu pemenang direveal satu per satu
       oleh animasi yang murni visual. */
    $("drawStatus").classList.add("live");
    $("drawStatus").innerHTML = '<span class="pulse"></span> Mengundi ' + quoteFor(prize.name) + '...';
    performDraw(prize);
  }

  function quoteFor(text) { return "\"" + String(text == null ? "" : text) + "\""; }

  function performDraw(prize) {
    var pool = activeParticipants().slice(); // working copy, sudah excludes yang menang
    var need = prize.qty - (prize.drawn || 0);
    if (need <= 0) {
      isSpinning = false;
      $("spinBtn").disabled = false;
      $("drawStatus").classList.remove("live");
      $("drawStatus").innerHTML = '<span class="pulse"></span> Siap diundi';
      showToast("Hadiah \"" + prize.name + "\" sudah selesai diundi", "danger");
      return;
    }
    if (pool.length === 0) {
      isSpinning = false;
      $("spinBtn").disabled = false;
      $("drawStatus").classList.remove("live");
      $("drawStatus").innerHTML = '<span class="pulse"></span> Siap diundi';
      showToast("Tidak ada peserta aktif tersisa untuk prizenya", "danger");
      return;
    }
    if (need > pool.length) {
      isSpinning = false;
      $("spinBtn").disabled = false;
      $("drawStatus").classList.remove("live");
      $("drawStatus").innerHTML = '<span class="pulse"></span> Siap diundi';
      showToast("Kuota hadiah (" + need + ") melebihi peserta aktif (" + pool.length + ")", "danger");
      return;
    }

    /* UNDIAN MURNI ACAK.
       Setiap peserta aktif punya peluang yang sama persis, tanpa jatah per jenis
       pajak. Pool diambil acak satu per satu (crypto.getRandomValues + rejection
       sampling) dan peserta terpilih langsung dicabut dari pool, sehingga:
         - dalam satu batch tidak ada nama yang terulang,
         - peserta yang sudah menang tidak akan pernah ikut diundi lagi
           (activeParticipants() hanya berisi p.won === false).
       Jenis pajak TIDAK memengaruhi peluang — supaya hasil murni ditentukan
       undian, bukan komposisi data. Komposisi jenis pajak hanya ditampilkan
       sebagai laporan di modal hasil (taxBreakdown), bukan sebagai kuota. */
    var picks = [];
    for (var i = 0; i < need; i++) {
      var idx = secureRandomInt(pool.length);
      picks.push(pool[idx]);
      pool.splice(idx, 1);
    }

    var drawnList = [];
    picks.forEach(function (picked) {
      picked.won = true;

      var record = {
        winnerId: nextUid(),
        no: state.winners.length + 1,
        npwpd: picked.npwpd,
        namaOp: picked.namaOp,
        jenisPajak: picked.jenisPajak,
        prize: prize.name,
        prizeId: prize.id,
        prizeQty: prize.qty,
        sourceFile: picked.sourceFile || "-",
        drawnAt: new Date().toISOString(),
        dateStr: "",
        timeStr: "",
        timestamp: Date.now(),
        prizeBatchId: "",
        status: "Pemenang"
      };
      state.winners.push(record);
      drawnList.push(record);
    });

    prize.drawn = (prize.drawn || 0) + drawnList.length;
    var prizeSnapshot = { id: prize.id, qty: prize.qty, name: prize.name };
    var prizeBatchId = nextUid();
    var now = new Date();
    var f = formatDateTime(now);

    drawnList.forEach(function (w) {
      w.prizeBatchId = prizeBatchId;
      w.dateStr = f.dateStr;
      w.timeStr = f.timeStr;
      w.drawnAt = now.toISOString();
      w.timestamp = now.getTime();
    });

    state.rounds += 1;
    state.prizeBatches.unshift({
      id: prizeBatchId,
      round: state.rounds,
      prizes: [prizeSnapshot],
      winnerCount: drawnList.length,
      dateStr: f.dateStr,
      timeStr: f.timeStr,
      timestamp: now.getTime(),
      status: "Sudah diundi"
    });

    state.lastBatch = drawnList.map(function (w) { return w.no; });

    saveState();

    /* Satu hadiah -> N pemenang: hasil sudah ditentukan & diarsipkan SEKALI
       di atas (state.winners / prizeBatch / lastBatch sama persis seperti sistem lama).
       Divisi berikut hanya mengatur tampilan + animasi, bukan logika pengundian.
       Semua undian (termasuk 1 pemenang) memakai flow reveal yang sama. */
    playSequentialReveal(drawnList, prize);
  }

  /* Rapikan tampilan card undian & kembalikan kontrol setelah proses undian selesai. */
  function finalizeDrawUi() {
    $("drawStatus").classList.remove("live");
    $("drawStatus").innerHTML = '<span class="pulse"></span> Undian selesai';

    isSpinning = false;
    $("spinBtn").disabled = false;
    $("cancelLastBtn").disabled = false;

    renderAll();
  }

  /* Reveal pemenang satu per satu: spin -> tampil pemenang ke-i -> jeda -> spin berikutnya.
     SEMUA pemenang sudah ditentukan performDraw lebih dulu; fungsi ini HANYA visualisasi.
     Peserta yang sudah menang tidak dipakai lagi di pool animasi (activeParticipants
     sudah mengecualikan p.won = true), sehingga tidak pernah terlihat menang 2x. */
  function playSequentialReveal(winners, prize) {
    var overlay = $("revealOverlay");
    var titleMain = $("revealTitleMain");
    var titleSub = $("revealTitleSub");
    var badgeText = $("revealBadgeText");
    var track = $("revealReelTrack");
    var reel = $("revealReel");
    var confettiBox = $("revealConfetti");
    var closeBtn = $("revealPopupClose");
    var statusEl = $("revealStatus");
    var dotsEl = $("revealDots");
    var winnerCard = $("revealWinnerCard");
    var summaryBody = $("revealSummaryBody");
    var confirmBtn = $("revealConfirmBtn");
    var popup = $("revealPopup");
    var blurEl = $("revealBlur");
    var total = winners.length;
    var closed = false;
    var spinTimer = null;
    var stepTimer = null;
    var popupAdvancing = false;    // true = popup sedang keluar (X diabaikan)

    /* Judul dua baris: baris 1 = nama hadiah, baris 2 = keterangan KAPASITAS (jika ada). */
    var capLabel = null;
    var capMatch = String(prize.name).match(/^(.+?)\s*[-:\u2013]?\s*(KAPASITAS\s+.+)$/i);
    if (capMatch) {
      titleMain.textContent = capMatch[1].replace(/\s+$/, "");
      capLabel = capMatch[2].trim();
      titleSub.textContent = capLabel;
      titleSub.style.display = "block";
    } else {
      titleMain.textContent = prize.name;
      titleSub.textContent = "";
      titleSub.style.display = "none";
    }

    if (track) track.innerHTML = "";
    if (summaryBody) summaryBody.innerHTML = "";
    if (winnerCard) winnerCard.style.display = "block";
    if (confirmBtn) confirmBtn.style.display = "none";
    if (badgeText) badgeText.textContent = "PEMENANG KE-1 DARI " + total;
    if (statusEl) statusEl.textContent = "Sedang mencari pemenang...";
    setDots(0);
    overlay.classList.add("open");
    document.body.classList.add("reveal-lock");

    function poolItems() {
      var pool = activeParticipants();
      if (pool.length === 0) pool = state.participants.slice();
      return pool.map(function (p) { return { name: p.namaOp, npwpd: p.npwpd }; });
    }

    function randomItem(pool) { return pool[secureRandomInt(pool.length)]; }

    function itemSlot(item, isCenter, isWinner) {
      return '<div class="reveal-ri' + (isCenter ? ' is-center' : '') + (isWinner ? ' is-winner' : '') + '">' +
        '<strong>' + escapeHtml(item.name) + '</strong>' +
        '<span>' + escapeHtml(item.npwpd) + '</span>' +
        '</div>';
    }

    function setSlots(arr, centerIsWinner) {
      if (!track) return;
      var html = "";
      for (var k = 0; k < 5; k++) {
        var item = arr[k] || { name: "", npwpd: "" };
        html += itemSlot(item, k === 2, k === 2 && centerIsWinner);
      }
      track.innerHTML = html;
    }

    function setDots(active) {
      if (!dotsEl) return;
      var html = "";
      for (var d = 0; d < 5; d++) {
        html += '<span class="reveal-dot' + (d < active ? ' is-on' : '') + '"></span>';
      }
      dotsEl.innerHTML = html;
    }

    function clearTimers() {
      if (spinTimer) { clearTimeout(spinTimer); spinTimer = null; }
      if (stepTimer) { clearTimeout(stepTimer); stepTimer = null; }
    }

    /* Confetti: 15-25 partikel (dikurangi di mobile), warna coral/pink/lavender/gold lembut.
       Dibangun ulang tiap popup supaya posisinya selalu berbeda. */
    var CONF_COLORS = ["#F43F6F", "#FF6F91", "#C084B8", "#8B5C83", "#F2C078", "#FDECEF"];

    function rnd(a, b) { return a + secureRandomInt(b - a + 1); }

    function buildConfetti() {
      if (!confettiBox) return;
      var small = window.innerWidth < 720;
      var total = small ? 15 : 20;
      var html = "";
      for (var k = 0; k < total; k++) {
        var round = secureRandomInt(4) === 0;
        var w = round ? rnd(6, 9) : rnd(6, 10);
        var h = round ? w : rnd(9, 15);
        var color = CONF_COLORS[secureRandomInt(CONF_COLORS.length)];
        var isFloat = secureRandomInt(10) < 3;
        var dur = isFloat ? (rnd(26, 34) / 10) : (rnd(15, 28) / 10);
        var delay = (rnd(0, 55) / 100);
        var style =
          "--x:" + rnd(2, 96) + "%;" +
          "--w:" + w + "px;--h:" + h + "px;--c:" + color + ";" +
          "--dx:" + rnd(-90, 90) + "px;" +
          "--rot:" + rnd(-540, 540) + "deg;" +
          "--d:" + dur.toFixed(2) + "s;--dl:" + delay.toFixed(2) + "s;";
        html += '<i class="wc' + (isFloat ? " is-float" : " is-fall") + (round ? " is-round" : "") +
                '" style="' + style + '"></i>';
      }
      confettiBox.innerHTML = html;
    }

    function startSpin(shown) {
      clearTimers();
      if (badgeText) badgeText.textContent = "PEMENANG KE-" + shown + " DARI " + total;
      if (statusEl) statusEl.textContent = "Sedang mencari pemenang...";
      setDots(shown - 1);
      var pool = poolItems();
      if (reel) reel.classList.add("is-rolling");
      overlay.classList.add("is-rolling");
      var arr = [];
      for (var k = 0; k < 5; k++) arr.push(randomItem(pool));
      setSlots(arr, false);

      /* Spin melambat bertahap (ramp) supaya terasa seperti drum yang sedang kehilangan tenaga. */
      var step = 0;
      function tick() {
        if (!reel || !reel.classList.contains("is-rolling")) return;
        arr.shift();
        arr.push(randomItem(pool));
        setSlots(arr, false);
        var delay = SPIN_RAMP_MS[Math.min(step, SPIN_RAMP_MS.length - 1)];
        step++;
        spinTimer = setTimeout(tick, delay);
      }
      spinTimer = setTimeout(tick, SPIN_RAMP_MS[0]);
    }

    function rowHTML(i) {
      var w = winners[i];
      return '<tr class="is-new">' +
        '<td class="c-no"><span class="rnum">' + (i + 1) + '</span></td>' +
        '<td>' + escapeHtml(w.npwpd) + '</td>' +
        '<td class="c-name">' + escapeHtml(w.namaOp) + '</td>' +
        '<td>' + escapeHtml(w.jenisPajak) + '</td>' +
        '</tr>';
    }

    /* WINNER FOUND: spin berhenti, pemenang terkunci di tengah, denyut singkat.
       Popup celebration dipanggil terpisah oleh rantai timing (showPopup). */
    function revealWinner(i) {
      clearTimers();
      if (reel) reel.classList.add("is-found");
      if (reel) reel.classList.remove("is-rolling");
      overlay.classList.remove("is-rolling");
      overlay.classList.add("is-found");
      var w = winners[i];
      if (badgeText) badgeText.textContent = "PEMENANG KE-" + (i + 1) + " DARI " + total;
      if (statusEl) statusEl.textContent = "PEMENANG DITEMUKAN!";
      setDots(5);
      var pool = poolItems();
      var arr = [
        randomItem(pool),
        randomItem(pool),
        { name: w.namaOp, npwpd: w.npwpd },
        randomItem(pool),
        randomItem(pool)
      ];
      setSlots(arr, true);
      if (blurEl) blurEl.classList.add("on");
      stepTimer = setTimeout(function () {
        if (reel) reel.classList.remove("is-found");
        overlay.classList.remove("is-found");
      }, WINNER_FOUND_MS);
    }

    /* Celebration: build confetti -> isi data pemenang -> tampilkan modal. */
    function showPopup(i) {
      if (!popup) return;
      var w = winners[i];
      var card = popup.querySelector(".reveal-popup-card");
      if (card && card.getAnimations) card.getAnimations().forEach(function (a) { a.cancel(); });
      $("revealPopupName").textContent = w.namaOp;
      $("revealPopupSub").textContent = w.npwpd;
      $("revealPopupTax").textContent = w.jenisPajak || "";
      buildConfetti();
      popup.classList.remove("out");
      popup.classList.remove("show");
      void popup.offsetWidth;
      popup.classList.add("show");
    }

    /* Titik tujuan popup "kembali masuk ke tabel": tepat di area baris pemenang berikutnya. */
    function popupExitTarget() {
      var box = summaryBody && summaryBody.getBoundingClientRect ? summaryBody : winnerCard;
      var r = box ? box.getBoundingClientRect() : null;
      if (!r || (r.width === 0 && r.height === 0)) {
        return { x: window.innerWidth / 2, y: Math.max(90, window.innerHeight * 0.68) };
      }
      var lastRow = summaryBody ? summaryBody.querySelector("tr:last-child") : null;
      var tr = lastRow ? lastRow.getBoundingClientRect() : null;
      var x = r.left + r.width / 2;
      var y = tr ? Math.min(tr.top + tr.height / 2, r.bottom) : Math.min(r.top + 24, r.bottom);
      x = Math.max(50, Math.min(x, window.innerWidth - 50));
      y = Math.max(70, Math.min(y, window.innerHeight - 45));
      return { x: x, y: y };
    }

    /* EXIT cinematic: popup mengecil sambil bergerak menuju tabel (ditarik kembali ke posisi
       barisnya), lalu menghilang di area tabel. Dipakai Web Animations API (GPU-friendly). */
    function hidePopup(i, quick) {
      if (!popup) return quick ? POPUP_QUICK_OUT_MS : POPUP_OUT_MS;
      if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        popup.classList.remove("show");
        return 0;
      }
      var card = popup.querySelector(".reveal-popup-card");
      if (!card) { popup.classList.remove("show"); return 0; }
      /* Tutup manual: scale(1) -> scale(.92) + fade, 320ms (CSS .reveal-popup.out). */
      if (quick) {
        popup.classList.add("out");
        setTimeout(function () {
          popup.classList.remove("show");
          popup.classList.remove("out");
        }, POPUP_QUICK_OUT_MS);
        return POPUP_QUICK_OUT_MS;
      }
      var target = popupExitTarget();
      var r = card.getBoundingClientRect();
      var dx = target.x - (r.left + r.width / 2);
      var dy = target.y - (r.top + r.height / 2);
      var kf = [
        { transform: "translate(0px,0px) scale(1)",      opacity: 1,   offset: 0 },
        { transform: "translate(" + (dx * .10) + "px," + (dy * .10) + "px) scale(.85)", opacity: 1, offset: .2 },
        { transform: "translate(" + (dx * .28) + "px," + (dy * .28) + "px) scale(.60)", opacity: 1, offset: .4 },
        { transform: "translate(" + (dx * .52) + "px," + (dy * .52) + "px) scale(.35)", opacity: 1, offset: .6 },
        { transform: "translate(" + (dx * .78) + "px," + (dy * .78) + "px) scale(.10)", opacity: .92, offset: .8 },
        { transform: "translate(" + dx + "px," + dy + "px) scale(0)",  opacity: 0, offset: 1 }
      ];
      var anim = card.animate(kf, { duration: POPUP_OUT_MS, easing: "ease-in", fill: "forwards" });
      anim.addEventListener("finish", function () {
        popup.classList.remove("show");
      });
      return POPUP_OUT_MS;
    }

    /* Baris pemenang masuk ke tabel (opacity .7->1 + subtle glow) dan tabel kembali fokus. */
    function appendWinnerRow(i) {
      if (summaryBody) summaryBody.insertAdjacentHTML("beforeend", rowHTML(i));
      if (winnerCard) { winnerCard.style.display = "block"; winnerCard.classList.add("winner-arrived"); }
      stepTimer = setTimeout(function () {
        if (summaryBody) summaryBody.querySelectorAll("tr.is-new").forEach(function (tr) { tr.classList.remove("is-new"); });
        if (winnerCard) winnerCard.classList.remove("winner-arrived");
      }, 2400);
    }

    /* Selesai (semua qty hadiah terundi): tampilkan tombol konfirmasi operator. */
    function showDone() {
      clearTimers();
      if (reel) reel.classList.remove("is-rolling");
      overlay.classList.remove("is-rolling");
      if (popup) {
        var card2 = popup.querySelector(".reveal-popup-card");
        if (card2 && card2.getAnimations) card2.getAnimations().forEach(function (a) { a.cancel(); });
        popup.classList.remove("show");
        popup.classList.remove("out");
      }
      if (blurEl) blurEl.classList.remove("on");
      if (badgeText) badgeText.textContent = "UNDIAN SELESAI \u00b7 " + total + " PEMENANG";
      if (statusEl) statusEl.textContent = "Semua pemenang telah ditentukan";
      setDots(5);
      if (confirmBtn) confirmBtn.style.display = "inline-flex";
      revealConfirmCallback = closeReveal;
    }

    function closeReveal() {
      if (closed) return;
      closed = true;
      clearTimers();
      if (reel) reel.classList.remove("is-rolling");
      overlay.classList.remove("is-rolling");
      if (popup) {
        var card2 = popup.querySelector(".reveal-popup-card");
        if (card2 && card2.getAnimations) card2.getAnimations().forEach(function (a) { a.cancel(); });
        popup.classList.remove("show");
        popup.classList.remove("out");
      }
      if (blurEl) blurEl.classList.remove("on");
      if (winnerCard) winnerCard.classList.remove("winner-arrived");
      if (confirmBtn) confirmBtn.style.display = "none";
      revealConfirmCallback = null;
      overlay.classList.remove("open");
      document.body.classList.remove("reveal-lock");
      isSpinning = false;
      finalizeDrawUi();
    }

    /* Rantai aftermath popup: exit -> blur hilang -> baris masuk tabel -> undian berikutnya. */
    function popupAftermath(i, quick) {
      if (popupAdvancing) return;
      popupAdvancing = true;
      if (closeBtn) closeBtn.disabled = true;
      var outMs = hidePopup(i, quick) || POPUP_OUT_MS;
      var blurMs = quick ? Math.min(BLUR_OUT_DELAY_MS, outMs) : BLUR_OUT_DELAY_MS;
      stepTimer = setTimeout(function () {
        if (blurEl) blurEl.classList.remove("on");
      }, blurMs);
      stepTimer = setTimeout(function () {
        appendWinnerRow(i);
        stepTimer = setTimeout(function () {
          stageStep(i + 1);
        }, ROW_SETTLE_MS);
      }, outMs);
    }

    function stageStep(i) {
      if (closed) return;
      if (i >= total) { showDone(); return; }
      popupAdvancing = false;
      if (closeBtn) closeBtn.disabled = false;
      startSpin(i + 1);
      stepTimer = setTimeout(function () {
        revealWinner(i);                                   // spin berhenti + "winner found"
        stepTimer = setTimeout(function () {               // jeda winner found
          showPopup(i);                                    // celebration + modal
          stepTimer = setTimeout(function () {             // entrance selesai
            stepTimer = setTimeout(function () {           // tampil penuh -> mulai exit
              popupAftermath(i);
            }, POPUP_HOLD_MS);
          }, POPUP_IN_MS);
        }, WINNER_FOUND_MS);
      }, DRAW_SPIN_DURATION);

      /* Tombol X = percepat: lewati jeda tampil, langsung mulai exit.
         Rantai selanjutnya tetap sama (blur -> baris -> undian berikutnya). */
      if (closeBtn) {
        closeBtn.onclick = function () {
          if (closed || popupAdvancing || !popup || !popup.classList.contains("show")) return;
          clearTimers();
          popupAftermath(i, true);
        };
      }
    }

    stageStep(0);
  }

  /* ==========================================================================
     WINNER MANAGER  (undo/batalkan undian terakhir)
     ========================================================================== */

  function cancelLastDraw() {
    if (!state.lastBatch || state.lastBatch.length === 0) {
      showToast("Tidak ada undian terakhir untuk dibatalkan", "danger");
      return;
    }
    var count = state.lastBatch.length;
    openConfirm(
      "Batalkan undian terakhir",
      "Batalkan <strong>" + count + " pemenang terakhir</strong>?" +
        "<br>Peserta terkait akan dikembalikan ke pool undian.",
      "Ya, Batalkan",
      executeCancelLastDraw
    );
  }

  function executeCancelLastDraw() {
    var batchNos = state.lastBatch;
    var cancelled = state.winners.filter(function (w) {
      return batchNos.indexOf(w.no) !== -1 && w.status === "Pemenang";
    });

    cancelled.forEach(function (w) {
      var participant = state.participants.find(function (p) { return p.npwpd === w.npwpd; });
      if (participant) participant.won = false;
      w.status = "Dibatalkan";
      w.cancelledTimestamp = Date.now();
    });

    if (cancelled.length) {
      var prize = cancelPrizeProgress(cancelled[0].prizeId || null, cancelled[0].prize || null, cancelled.length);
      if (prize) {
        var batchId = cancelled[0].prizeBatchId;
        state.prizeBatches = state.prizeBatches.filter(function (batch) {
          return !(batch.id === batchId && batch.prizes && batch.prizes.length === 1 && batch.prizes[0].id === (prize.id || null));
        });
      }
    }

    state.lastBatch = [];

    saveState();
    renderAll();
    showToast(cancelled.length + " undian terakhir dibatalkan dan peserta dikembalikan ke pool", "success");

    $("drawStatus").innerHTML = '<span class="pulse"></span> Siap diundi';
  }

  function cancelPrizeProgress(prizeId, prizeName, count) {
    var prize = state.prizes.find(function (p) { return p.id === prizeId; });
    if (!prize && prizeName) {
      prize = state.prizes.find(function (p) { return String(p.name).toLowerCase() === String(prizeName).toLowerCase(); });
    }
    if (prize) {
      prize.drawn = Math.max(0, (prize.drawn || 0) - (count || 1));
      return prize;
    }
    return null;
  }

  /* ==========================================================================
     RESULT MODAL
     ========================================================================== */

  function showResultModal(winners, finished) {
    var list = $("modalWinnerList");
    list.innerHTML =
      '<table class="winner-table">' +
      '<thead><tr>' +
      '<th class="th-no">No</th>' +
      '<th class="th-name">Nama OP</th>' +
      '<th class="th-npwpd">NPWPD</th>' +
      '<th class="th-tax">Jenis Pajak</th>' +
      '<th class="th-prize">Hadiah</th>' +
      '</tr></thead>' +
      '<tbody>' +
      winners.map(function (w) {
        return '<tr>' +
          '<td class="td-no">' + w.no + '</td>' +
          '<td class="td-name"><strong>' + escapeHtml(w.namaOp) + '</strong></td>' +
          '<td class="td-npwpd">' + escapeHtml(w.npwpd) + '</td>' +
          '<td class="td-tax">' + escapeHtml(w.jenisPajak) + '</td>' +
          '<td class="td-prize"><span class="prize-badge">' + escapeHtml(w.prize) + '</span></td>' +
          '</tr>';
      }).join("") +
      '</tbody></table>';
    var single = winners[0];
    var base = single
      ? winners.length + " pemenang terpilih untuk hadiah \u201c" + single.prize + "\u201d."
      : "Pemenang untuk undian ini.";
    if (winners.length) {
      base += " Susunan pemenang menurut jenis pajak: " + taxBreakdown(winners) +
        ". Peluang undian murni acak, tidak ada jatah per jenis pajak.";
    }
    $("modalSub").textContent = base;
    $("resultModal").classList.add("open");
  }

  /* Ringkasan jumlah pemenang per jenis pajak, mis. "Pajak Hotel 2 · Pajak Restoran 5".
     murni laporan hasil undian, bukan kuota/jatah undian. */
  function taxBreakdown(winners) {
    var map = {};
    (winners || []).forEach(function (w) {
      var t = String(w.jenisPajak || "-");
      map[t] = (map[t] || 0) + 1;
    });
    return Object.keys(map)
      .sort(function (a, b) { return String(a).localeCompare(String(b), "id"); })
      .map(function (t) { return t + " " + map[t]; })
      .join(" \u00b7 ");
  }

  function closeModal() {
    $("resultModal").classList.remove("open");
  }

  /* ==========================================================================
     EXPORT  (CSV & XLSX — snapshot pemenang, tidak bergantung ID peserta)
     ========================================================================== */

  var EXPORT_HEADERS = ["No", "No NPWPD", "Nama OP", "Jenis Pajak", "Hadiah", "File Sumber", "Tanggal Undian", "Jam Undian", "Status"];

  function exportRows() {
    return state.winners.map(function (w) {
      return [w.no, w.npwpd, w.namaOp, w.jenisPajak, w.prize, w.sourceFile, w.dateStr, w.timeStr, w.status];
    });
  }

  function exportWinnersXlsx() {
    if (state.winners.length === 0) {
      showToast("Belum ada pemenang untuk diekspor", "danger");
      return;
    }
    var aoa = [EXPORT_HEADERS].concat(exportRows());
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [
      { wch: 4 }, { wch: 20 }, { wch: 28 }, { wch: 26 },
      { wch: 22 }, { wch: 18 }, { wch: 22 }, { wch: 10 }, { wch: 12 }
    ];

    var GREEN = { fill: { patternType: "solid", fgColor: { rgb: "C6EFCE" } }, font: { color: { rgb: "006100" } } };
    var RED = { fill: { patternType: "solid", fgColor: { rgb: "FFC7CE" } }, font: { color: { rgb: "9C0006" } } };

    state.winners.forEach(function (w, i) {
      var styleRow = w.status === "Dibatalkan" ? RED : GREEN;
      for (var c = 0; c < EXPORT_HEADERS.length; c++) {
        var ref = XLSX.utils.encode_cell({ r: i + 1, c: c });
        if (ws[ref]) ws[ref].s = styleRow;
      }
    });

    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Pemenang");
    XLSX.writeFile(wb, "arsip-pemenang-bpkpd-" + dateSlug() + ".xlsx");
    showToast("File Excel berhasil diunduh (.xlsx) \u2014 pemenang hijau, dibatalkan merah", "success");
  }

  function exportWinnersCsv() {
    if (state.winners.length === 0) {
      showToast("Belum ada pemenang untuk diekspor", "danger");
      return;
    }
    var lines = [EXPORT_HEADERS].concat(exportRows()).map(function (row) {
      return row.map(csvEscape).join(",");
    });
    var content = "\uFEFF" + lines.join("\r\n");
    var blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "arsip-pemenang-bpkpd-" + dateSlug() + ".csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("File CSV berhasil diunduh (.csv)", "success");
  }

  function csvEscape(value) {
    var s = String(value == null ? "" : value).replace(/"/g, '""');
    return /[",;\n\r]/.test(s) || /^[\uFEFF \t]/.test(s) ? '"' + s + '"' : s;
  }

  function dateSlug() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  /* ==========================================================================
     RESET
     ========================================================================== */

  function resetData() {
    openConfirm(
      "Reset seluruh data",
      "Yakin ingin menghapus <strong>seluruh data peserta, hadiah, dan riwayat pemenang</strong>?" +
        "<br>Tindakan ini tidak dapat dibatalkan.",
      "Hapus Semua",
      executeResetData
    );
  }

  function executeResetData() {
    state = {
      participants: [],
      prizes: [],
      prizeBatches: [],
      winners: [],
      lastBatch: [],
      rounds: 0,
      sampleLoaded: false,
      jenisPajakList: DEFAULT_TAX_LIST.slice()
    };
    localStorage.removeItem(STORAGE_KEY);
    $("drawStatus").innerHTML = '<span class="pulse"></span> Siap diundi';
    renderAll();
    showToast("Seluruh data berhasil direset", "success");
  }

  /* ==========================================================================
     RENDER  (UI)
     ========================================================================== */

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
    $("metaNeeded").textContent = remainingSlots();
    $("metaActive").textContent = active.toLocaleString("id-ID");
    $("metaRounds").textContent = state.rounds;

    $("cancelLastBtn").disabled = !state.lastBatch || state.lastBatch.length === 0;

    renderPrizeDrawSelect($("prizeDrawSelect") && $("prizeDrawSelect").value);
    renderParticipantsTable();
    renderImportTaxDatalist();
    renderPrizeList();
    renderDashPrizeList();
    renderUndianWinners();
    renderArchiveTable();
  }

  function renderImportTaxDatalist() {
    var dl = $("importTaxDatalist");
    if (!dl) return;
    var values = [];
    var seen = {};
    [DEFAULT_TAX_LIST, state.jenisPajakList, collectTaxTypes(state.participants), collectTaxTypes(state.winners)].forEach(function (list) {
      (list || []).forEach(function (v) {
        v = String(v == null ? "" : v).trim();
        if (v && !seen[v]) { seen[v] = true; values.push(v); }
      });
    });
    dl.innerHTML = values.map(function (v) { return '<option value="' + escapeHtml(v) + '"></option>'; }).join("");
  }

  function renderParticipantsTable() {
    var body = $("participantsTableBody");
    var note = $("participantsTableNote");
    var search = ($("participantSearch").value || "").trim().toLowerCase();
    var tax = $("participantTaxFilter").value;
    var status = $("participantStatusFilter").value;
    var filtered = state.participants.filter(function (p) {
      var haystack = [p.npwpd, p.namaOp, p.jenisPajak, p.sourceFile].join(" ").toLowerCase();
      var matchesSearch = !search || haystack.indexOf(search) !== -1;
      var matchesTax = !tax || normalizeTaxType(p.jenisPajak) === normalizeTaxType(tax);
      var matchesStatus = !status || (status === "won" ? p.won : !p.won);
      return matchesSearch && matchesTax && matchesStatus;
    });
    var totalPages = Math.max(1, Math.ceil(filtered.length / participantPageSize));
    if (participantPage >= totalPages) participantPage = totalPages - 1;
    var start = participantPage * participantPageSize;
    var subset = filtered.slice(start, start + participantPageSize);

    renderParticipantTaxOptions();
    if (filtered.length === 0) {
      body.innerHTML = "";
      note.textContent = state.participants.length === 0
        ? "Belum ada peserta. Impor file Excel/CSV atau muat data contoh."
        : "Tidak ada peserta yang cocok dengan filter.";
      updateParticipantPagination(0, 1);
      return;
    }
    body.innerHTML = subset.map(function (p, i) {
      var statusBadge = p.won
        ? '<span class="badge badge-success">Menang</span>'
        : '<span class="badge" style="color:var(--text-muted);background:rgba(255,255,255,0.06);">Aktif</span>';
      return "<tr><td class=\"col-no\">" + (start + i + 1) + "</td><td>" + escapeHtml(p.npwpd) + "</td><td>" + escapeHtml(p.namaOp) + "</td><td>" + escapeHtml(p.jenisPajak) + "</td><td>" + escapeHtml(p.sourceFile) + '</td><td>' + statusBadge + "</td></tr>";
    }).join("");
    note.textContent = "Menampilkan " + (start + 1) + "–" + (start + subset.length) +
      " dari " + filtered.length.toLocaleString("id-ID") + " peserta yang cocok.";
    updateParticipantPagination(filtered.length, totalPages);
  }

  function renderParticipantTaxOptions() {
    var select = $("participantTaxFilter");
    var current = select.value;
    var values = collectTaxTypes(state.participants);
    select.innerHTML = '<option value="">Semua jenis pajak</option>' + values.map(function (value) {
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
      var drawn = p.drawn || 0;
      var done = drawn >= p.qty;
      return '<div class="prize-item' + (done ? " prize-done" : "") + '">' +
        '<span class="qty">' + p.qty + '&times;</span>' +
        '<span class="name" title="' + escapeHtml(p.name) + '">' + escapeHtml(p.name) + '</span>' +
        prizeStatusHtml(drawn, p.qty, done) +
        (done ? '' : '<button data-remove-prize="' + p.id + '" aria-label="Hapus hadiah">✕</button>') +
        '</div>';
    }).join("");
  }

  function prizeStatusHtml(drawn, qty, done) {
    if (done) {
      return '<span class="prize-done-check" title="Sudah selesai diundi" aria-label="Selesai diundi">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M20 6L9 17l-5-5"/></svg></span>';
    }
    return '<span class="dash-prize-status">' + drawn + "/" + qty + '</span>';
  }

  function renderDashPrizeList() {
    var list = $("dashPrizeList");
    $("dashPrizeCount").textContent = state.prizes.length + " kategori";
    if (state.prizes.length === 0) {
      list.innerHTML = '<p class="empty-note">Belum ada hadiah diatur. Buka tab Undian &amp; Hadiah.</p>';
      return;
    }
    list.innerHTML = state.prizes.map(function (p) {
      var drawn = p.drawn || 0;
      var done = drawn >= p.qty;
      return '<div class="prize-item' + (done ? " prize-done" : "") + '">' +
        '<span class="qty">' + p.qty + '&times;</span>' +
        '<span class="name" title="' + escapeHtml(p.name) + '">' + escapeHtml(p.name) + '</span>' +
        prizeStatusHtml(drawn, p.qty, done) +
      '</div>';
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
    var rows = activeWinners.map(function (w, i) {
      return '<tr>' +
        '<td class="td-no">' + (i + 1) + '</td>' +
        '<td class="td-name"><strong>' + escapeHtml(w.namaOp) + '</strong></td>' +
        '<td class="td-npwpd">' + escapeHtml(w.npwpd) + '</td>' +
        '<td class="td-tax">' + escapeHtml(w.jenisPajak) + '</td>' +
        '<td class="td-prize"><span class="prize-badge">' + escapeHtml(w.prize) + '</span></td>' +
        '</tr>';
    }).join("");
    list.innerHTML = '<div class="table-wrap"><table class="winner-table">' +
      '<thead><tr>' +
      '<th>No</th><th>Nama OP</th><th>NPWPD</th><th>Jenis Pajak</th><th>Hadiah</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function renderArchiveTable() {
    var body = $("archiveTableBody");
    var note = $("archiveTableNote");
    var search = ($("archiveSearch").value || "").trim().toLowerCase();
    var tax = $("archiveTaxFilter").value;
    var sortMode = $("archiveSort").value;
    renderArchiveTaxOptions();

    if (state.winners.length === 0) {
      body.innerHTML = "";
      note.textContent = "Belum ada pemenang.";
      return;
    }

    var filtered = state.winners.filter(function (w) {
      var haystack = [w.no, w.npwpd, w.namaOp, w.jenisPajak, w.sourceFile].join(" ").toLowerCase();
      return (!search || haystack.indexOf(search) !== -1) && (!tax || normalizeTaxType(w.jenisPajak) === normalizeTaxType(tax));
    });

    var sorted = filtered.slice().sort(function (a, b) {
      if (sortMode === "tax") {
        return String(a.jenisPajak).localeCompare(String(b.jenisPajak), "id") || Number(a.no) - Number(b.no);
      }
      if (sortMode === "name") {
        return String(a.namaOp).localeCompare(String(b.namaOp), "id") || Number(a.no) - Number(b.no);
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
      return "<tr><td>" + w.no + "</td><td>" + escapeHtml(w.npwpd) + "</td><td>" + escapeHtml(w.namaOp) + "</td><td>" + escapeHtml(w.jenisPajak) +
        "</td><td>" + escapeHtml(w.prize) + "</td><td>" + escapeHtml(w.sourceFile) + "</td><td>" + escapeHtml(w.dateStr) + " " + escapeHtml(w.timeStr) + '</td><td><span class="badge ' + badgeClass + '">' + escapeHtml(w.status || "Pemenang") + "</span></td></tr>";
    }).join("");
    note.textContent = "Menampilkan " + sorted.length.toLocaleString("id-ID") + " dari " +
      state.winners.length.toLocaleString("id-ID") + " riwayat undian.";
  }

  function renderArchiveTaxOptions() {
    var select = $("archiveTaxFilter");
    var current = select.value;
    var values = collectTaxTypes(state.winners);
    select.innerHTML = '<option value="">Semua jenis pajak</option>' + values.map(function (value) {
      return '<option value="' + escapeHtml(value) + '">' + escapeHtml(value) + '</option>';
    }).join("");
    if (values.indexOf(current) !== -1) select.value = current;
  }

  /* ==========================================================================
     EVENTS
     ========================================================================== */

  function wireEvents() {
    $("brandHomeBtn").addEventListener("click", function () { switchView("dashboard"); });

    qsa(".nav-link").forEach(function (btn) {
      btn.addEventListener("click", function () { switchView(btn.dataset.view); });
    });
    qsa("[data-goto]").forEach(function (btn) {
      btn.addEventListener("click", function () { switchView(btn.dataset.goto); });
    });

    $("menuToggle").addEventListener("click", function () { $("mainNav").classList.toggle("open"); });
    window.addEventListener("scroll", function () { $("mainNav").classList.remove("open"); }, { passive: true });
    document.addEventListener("click", function (e) {
      var header = document.querySelector(".site-header");
      if (!$("mainNav").contains(e.target) && !$("menuToggle").contains(e.target) && !header.contains(e.target)) {
        $("mainNav").classList.remove("open");
      }
    });

    $("resetBtn").addEventListener("click", resetData);

    /* ---- Upload: file dipilih → langsung diimpor otomatis ---- */
    $("csvInput").addEventListener("change", function (e) {
      handleFiles(e.target.files);
      e.target.value = "";
    });

    $("importTaxGoBtn").addEventListener("click", runImportFromJobs);
    $("importTaxCancelBtn").addEventListener("click", function () {
      pendingImportJobs = null;
      closeImportTaxModal();
    });

    $("prizeFileInput").addEventListener("change", function (e) {
      handlePrizeFile(e.target.files);
      e.target.value = "";
    });

    $("loadSampleBtn").addEventListener("click", loadSampleData);

    /* ---- Filters peserta ---- */
    $("participantSearch").addEventListener("input", function () { participantPage = 0; renderParticipantsTable(); });
    $("participantTaxFilter").addEventListener("change", function () { participantPage = 0; renderParticipantsTable(); });
    $("participantStatusFilter").addEventListener("change", function () { participantPage = 0; renderParticipantsTable(); });
    $("resetParticipantFilter").addEventListener("click", function () {
      $("participantSearch").value = "";
      $("participantTaxFilter").value = "";
      $("participantStatusFilter").value = "";
      participantPage = 0;
      renderParticipantsTable();
    });
    $("participantsPrev").addEventListener("click", function () {
      if (participantPage > 0) { participantPage -= 1; renderParticipantsTable(); }
    });
    $("participantsNext").addEventListener("click", function () {
      participantPage += 1;
      renderParticipantsTable();
    });

    /* ---- Filters arsip ---- */
    $("archiveSearch").addEventListener("input", renderArchiveTable);
    $("archiveTaxFilter").addEventListener("change", renderArchiveTable);
    $("archiveSort").addEventListener("change", renderArchiveTable);
    $("resetArchiveFilter").addEventListener("click", function () {
      $("archiveSearch").value = "";
      $("archiveTaxFilter").value = "";
      $("archiveSort").value = "number";
      renderArchiveTable();
    });

    /* ---- Hadiah ---- */
    $("addPrizeBtn").addEventListener("click", function () {
      addPrize($("prizeQty").value, $("prizeName").value);
      $("prizeName").value = "";
      $("prizeQty").value = "1";
      $("prizeName").focus();
    });
    $("prizeName").addEventListener("keydown", function (e) { if (e.key === "Enter") $("addPrizeBtn").click(); });
    $("prizeName").addEventListener("input", function (e) {
      var field = e.target;
      var upperName = field.value.toLocaleUpperCase("id-ID");
      if (field.value !== upperName) field.value = upperName;
    });
    $("prizeList").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-remove-prize]");
      if (btn) removePrize(btn.getAttribute("data-remove-prize"));
    });

    /* ---- Pilih hadiah hasil impor (modal) ---- */
    $("prizePickImportBtn").addEventListener("click", importSelectedPrizes);
    $("prizePickCloseBtn").addEventListener("click", closePrizePick);
    $("prizePickModal").addEventListener("click", function (e) {
      if (e.target === $("prizePickModal")) closePrizePick();
    });
    $("prizePickSheet").addEventListener("change", function () {
      prizeActiveSheet = this.value || "";
      renderPrizePick();
    });
    $("prizePickAll").addEventListener("change", function () {
      var on = $("prizePickAll").checked;
      activeSheetCandidates().forEach(function (pr) { if (!pr.exists) pr.checked = on; });
      renderPrizePick();
    });
    $("prizePickList").addEventListener("change", function (e) {
      var cb = e.target.closest("[data-pick-idx]");
      if (!cb) return;
      var pr = prizeCandidates[parseInt(cb.getAttribute("data-pick-idx"), 10)];
      if (pr && !pr.exists) pr.checked = !!cb.checked;
      updatePrizePickSummary();
    });

    /* ---- Undian ---- */
    $("spinBtn").addEventListener("click", runDraw);
    $("cancelLastBtn").addEventListener("click", cancelLastDraw);

    /* ---- Export ---- */
    $("exportXlsxBtn").addEventListener("click", exportWinnersXlsx);
    $("exportCsvBtn").addEventListener("click", exportWinnersCsv);

    /* ---- Modal ---- */
    $("modalCloseBtn").addEventListener("click", closeModal);
    $("resultModal").addEventListener("click", function (e) {
      if (e.target === $("resultModal")) closeModal();
    });

    /* ---- Confirm modal ---- */
    $("confirmYesBtn").addEventListener("click", function () {
      var cb = confirmCallback;
      closeConfirm();
      if (typeof cb === "function") cb();
    });
    $("confirmNoBtn").addEventListener("click", closeConfirm);
    $("confirmModal").addEventListener("click", function (e) {
      if (e.target === $("confirmModal")) closeConfirm();
    });

    /* ---- Reveal selesai (Setuju & Lanjutkan) ---- */
    var confirmBtn = $("revealConfirmBtn");
    if (confirmBtn) confirmBtn.addEventListener("click", function () {
      if (typeof revealConfirmCallback === "function") revealConfirmCallback();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { closeModal(); closePrizePick(); closeConfirm(); }
    });
  }

  /* ==========================================================================
     INIT
     ========================================================================== */

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
      setTimeout(function () { splash.classList.add("is-hidden"); }, 120);
    }, 2400);
  }

  document.addEventListener("DOMContentLoaded", init);
})();