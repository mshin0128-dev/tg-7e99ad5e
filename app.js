/* TOEIC単語帳 — アプリ本体。ビルド不要。一覧 / めくる / テスト / 進み具合 / 設定。語数・セット数は words.js から導出（100語ごとに1セット）。 */
(function () {
  "use strict";

  // ---------- 定数 ----------
  var PROGRESS_KEY = "toeic:v1";
  var THEME_KEY = "toeic:v1:theme";
  var DRAFT_KEY = "toeic:v1:input_draft";
  var LEGACY_PROGRESS_KEY = "tango_progress_v1"; // 旧TOEIC単語帳（読み取り専用。削除・書き換えはしない）
  var LEGACY_THEME_KEY = "tango_theme_pref";
  var OPENAI_KEY = "wayaku_openai_key"; // 旧アプリと共有（キーを1回入れれば両方で使える）
  var OPENAI_MODEL = "gpt-6-luna";      // 参照アプリの値をそのまま使用。変更はここだけ。
  var TEST_COUNT_OPTIONS = [10, 20, 30, 40, 50];
  var SET_SIZE = 100;

  // words.js は `const WORDS`（window のプロパティではない）なので識別子として参照する。
  var SOURCE_WORDS = (typeof WORDS !== "undefined" && Array.isArray(WORDS)) ? WORDS : [];
  // セット（範囲）: 語数から導出。"001-100", "101-200", … "1401-1500"（セット1〜15）
  var RANGES = (function () {
    var n = Math.max(1, Math.ceil(SOURCE_WORDS.length / SET_SIZE)), out = [];
    function p3(x) { return x < 100 ? ("00" + x).slice(-3) : String(x); }
    for (var i = 0; i < n; i++) {
      var a = i * SET_SIZE + 1, b = Math.min((i + 1) * SET_SIZE, Math.max(SOURCE_WORDS.length, SET_SIZE));
      out.push(p3(a) + "-" + b);
    }
    return out;
  })();

  function rangeLabel(r) { return "セット" + (RANGES.indexOf(r) + 1); }
  function rangeChipInner(r, rest) {
    return "<b>" + rangeLabel(r) + '</b><span class="rest">No.' + r + '</span><span class="rest">' + rest + "</span>";
  }

  var ALL_WORDS = SOURCE_WORDS.map(function (w, i) {
    var no = i + 1;
    var setNo = (w.set | 0) >= 1 && (w.set | 0) <= RANGES.length ? (w.set | 0) : Math.min(RANGES.length, Math.ceil(no / SET_SIZE));
    return {
      no: no, set: setNo, range: RANGES[setNo - 1],
      word: w.word, pos: w.pos, meaning: w.meaning,
      example: w.example || "", exampleJa: w.exampleJa || "", hint: w.hint || ""
    };
  });
  var wordByNo = {};
  ALL_WORDS.forEach(function (w) { wordByNo[w.no] = w; });

  var DEFAULT_DAILY_GOAL = 20;
  var progress = { learned: {}, history: {}, sessions: [], cycles: {}, tips: {}, days: {}, settings: { dailyGoal: DEFAULT_DAILY_GOAL }, flags: {}, srs: {}, checkedAt: {} };

  function $(id) { return document.getElementById(id); }
  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // ---------- モーション共通 ----------
  function reduceMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  // トースト（画面下部の小さな通知）
  var toastTimer = null;
  function showToast(msg) {
    var el = $("toast");
    if (!el) return;
    el.textContent = msg;
    void el.offsetWidth;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 2200);
  }

  // リップル（押した位置から広がる）: 主ボタン・選択ボタン・タブ
  var RIPPLE_SEL = ".btn.primary, .chip, .seg-btn, .tab-btn";
  document.addEventListener("pointerdown", function (e) {
    if (reduceMotion() || (e.button != null && e.button > 0)) return;
    var el = e.target && e.target.closest ? e.target.closest(RIPPLE_SEL) : null;
    if (!el || el.disabled) return;
    var r = el.getBoundingClientRect();
    var size = Math.max(r.width, r.height) * 2.2;
    var s = document.createElement("span");
    s.className = "ripple";
    s.style.width = s.style.height = size + "px";
    s.style.left = (e.clientX - r.left - size / 2) + "px";
    s.style.top = (e.clientY - r.top - size / 2) + "px";
    el.appendChild(s);
    var remove = function () { if (s.parentNode) s.parentNode.removeChild(s); };
    s.addEventListener("animationend", remove);
    setTimeout(remove, 900);
  });

  // チェックボックスのポップ
  document.addEventListener("change", function (e) {
    var t = e.target;
    if (reduceMotion() || !t || t.type !== "checkbox" || !t.checked) return;
    t.classList.remove("chk-pop");
    void t.offsetWidth;
    t.classList.add("chk-pop");
    t.addEventListener("animationend", function () { t.classList.remove("chk-pop"); }, { once: true });
  });

  // 紙吹雪（ライブラリなし。transform/opacity のみのアニメ）
  var CONFETTI_COLORS = ["var(--accent)", "#8A6CFF", "var(--good)", "var(--close)", "var(--danger)"];
  function launchConfetti() {
    if (reduceMotion()) return;
    var wrap = document.createElement("div");
    wrap.className = "confetti";
    wrap.setAttribute("aria-hidden", "true");
    for (var i = 0; i < 44; i++) {
      var p = document.createElement("i");
      p.style.setProperty("--x", (Math.random() * 100).toFixed(1) + "%");
      p.style.setProperty("--w", (6 + Math.random() * 6).toFixed(1) + "px");
      p.style.setProperty("--c", CONFETTI_COLORS[i % CONFETTI_COLORS.length]);
      p.style.setProperty("--dx", (Math.random() * 160 - 80).toFixed(0) + "px");
      p.style.setProperty("--r", (360 + Math.random() * 540).toFixed(0) + "deg");
      p.style.setProperty("--d", (1.8 + Math.random() * 1.1).toFixed(2) + "s");
      p.style.setProperty("--delay", (Math.random() * 0.45).toFixed(2) + "s");
      wrap.appendChild(p);
    }
    document.body.appendChild(wrap);
    setTimeout(function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }, 3800);
  }

  // ボタンのローディング状態（短いスピナーを見せてから実行）
  function runWithLoading(btn, fn) {
    if (reduceMotion() || !btn) { fn(); return; }
    if (btn.classList.contains("is-loading")) return;
    btn.classList.add("is-loading");
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
    setTimeout(function () {
      btn.classList.remove("is-loading");
      btn.disabled = false;
      btn.removeAttribute("aria-busy");
      fn();
    }, 320);
  }

  // ---------- 保存 / 読み込み ----------
  var lastSaveOk = true;
  function showStorageNotice(show) {
    var el = $("notice");
    if (el) el.hidden = !show;
  }

  function saveProgress() {
    try {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
      showStorageNotice(false);
      lastSaveOk = true;
    } catch (e) {
      showStorageNotice(true);
      lastSaveOk = false;
    }
  }

  function numList(v) {
    return (Array.isArray(v) ? v : []).filter(function (n) { return typeof n === "number" && wordByNo[n]; });
  }

  function normalizeProgress(saved) {
    saved = (saved && typeof saved === "object") ? saved : {};
    var sl = (saved.learned && typeof saved.learned === "object") ? saved.learned : {};
    var sh = (saved.history && typeof saved.history === "object") ? saved.history : {};
    var st = (saved.tips && typeof saved.tips === "object") ? saved.tips : {};
    var learned = {}, history = {}, tips = {};
    ALL_WORDS.forEach(function (w) {
      learned[w.no] = hasOwn(sl, w.no) ? !!sl[w.no] : false;
      history[w.no] = hasOwn(sh, w.no) ? String(sh[w.no] || "").replace(/[^○×]/g, "") : "";
      if (hasOwn(st, w.no) && typeof st[w.no] === "string" && st[w.no] !== w.hint) tips[w.no] = st[w.no];
    });
    var cycles = {};
    var sc = (saved.cycles && typeof saved.cycles === "object") ? saved.cycles : {};
    Object.keys(sc).forEach(function (rawKey) {
      var c = sc[rawKey];
      if (!c || typeof c !== "object") return;
      // 旧データ（範囲×対象）は 英→日 の周回として引き継ぐ。新形式の同名キーがあればそちらを優先。
      var key = normalizeCycleKey(rawKey);
      if (key !== rawKey && hasOwn(sc, key)) return;
      cycles[key] = {
        lap: (typeof c.lap === "number" && c.lap >= 1) ? c.lap : 1,
        remaining: numList(c.remaining),
        wrongLap: numList(c.wrongLap),
        reserved: numList(c.reserved),
        everStarted: !!c.everStarted,
        lapTotal: (typeof c.lapTotal === "number" && c.lapTotal > 0) ? c.lapTotal : undefined
      };
    });
    var sessions = (Array.isArray(saved.sessions) ? saved.sessions : []).filter(function (s) {
      return s && typeof s === "object";
    });
    // 追加フィールド（古い保存データには無いので既定値で補う）
    var days = {};
    var sd = (saved.days && typeof saved.days === "object" && !Array.isArray(saved.days)) ? saved.days : {};
    Object.keys(sd).forEach(function (k) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) return;
      var seen = {}, arr = [];
      numList(sd[k]).forEach(function (no) { if (!seen[no]) { seen[no] = true; arr.push(no); } });
      if (arr.length) days[k] = arr;
    });
    var goal = DEFAULT_DAILY_GOAL;
    if (saved.settings && typeof saved.settings === "object" && typeof saved.settings.dailyGoal === "number" && isFinite(saved.settings.dailyGoal)) {
      goal = Math.max(1, Math.min(500, Math.round(saved.settings.dailyGoal)));
    }
    // ★フラグ: { 単語番号: true }
    var flags = {};
    var sf = (saved.flags && typeof saved.flags === "object" && !Array.isArray(saved.flags)) ? saved.flags : {};
    Object.keys(sf).forEach(function (k) { if (sf[k] === true && wordByNo[k]) flags[k] = true; });
    // 間隔反復: { 単語番号: { stage, due, last, pending, prev? } }。保存に無い語は履歴から遅延初期化する。
    var srs = normalizeSrs(saved.srs, history, sessions);
    // 覚えた日: { 単語番号: "YYYY-MM-DD"(端末のローカル日付) }。チェック中の語だけ持つ。
    // 古いデータには無いので、その語を含む最新の学習日（days）から補う。
    var checkedAt = {};
    var sca = (saved.checkedAt && typeof saved.checkedAt === "object" && !Array.isArray(saved.checkedAt)) ? saved.checkedAt : {};
    var dayKeys = Object.keys(days).sort();
    ALL_WORDS.forEach(function (w) {
      if (!learned[w.no]) return;
      var v = hasOwn(sca, w.no) ? sca[w.no] : null;
      if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) { checkedAt[w.no] = v; return; }
      for (var i = dayKeys.length - 1; i >= 0; i--) {
        if (days[dayKeys[i]].indexOf(w.no) !== -1) { checkedAt[w.no] = dayKeys[i]; return; }
      }
    });
    return { learned: learned, history: history, sessions: sessions, cycles: cycles, tips: tips, days: days, settings: { dailyGoal: goal }, flags: flags, srs: srs, checkedAt: checkedAt, migrations: {} };
  }

  // ---------- 間隔反復（忘却曲線） ----------
  var SRS_INTERVAL_DAYS = [1, 2, 4, 7, 14, 30]; // stage 0..5
  var DAY_MS = 86400000;
  var JST_OFFSET_MS = 9 * 3600000;
  function srsIntervalMs(stage) { return SRS_INTERVAL_DAYS[Math.max(0, Math.min(5, stage | 0))] * DAY_MS; }
  // 今日(東京時間)の終わり。これ以前が期限の語は「今日の復習」対象。
  function endOfTodayMs(now) {
    return (Math.floor((now + JST_OFFSET_MS) / DAY_MS) + 1) * DAY_MS - JST_OFFSET_MS;
  }
  function finiteNum(v) { return (typeof v === "number" && isFinite(v)) ? v : null; }
  function normalizeSrs(savedSrs, history, sessions) {
    var ss = (savedSrs && typeof savedSrs === "object" && !Array.isArray(savedSrs)) ? savedSrs : {};
    var out = {}, now = Date.now();
    // 旧データ用: 語ごとの最終テスト時刻をセッション記録から求める
    var lastAt = null;
    ALL_WORDS.forEach(function (w) {
      var e = hasOwn(ss, w.no) ? ss[w.no] : null;
      if (e && typeof e === "object") {
        var stage = finiteNum(e.stage), due = finiteNum(e.due);
        if (stage !== null && due !== null) {
          var o = { stage: Math.max(0, Math.min(5, Math.round(stage))), due: due, last: finiteNum(e.last) || 0, pending: !!e.pending };
          if (e.prev && typeof e.prev === "object" && finiteNum(e.prev.stage) !== null && finiteNum(e.prev.due) !== null) {
            o.prev = { stage: Math.max(0, Math.min(5, Math.round(e.prev.stage))), due: e.prev.due, last: finiteNum(e.prev.last) || 0, pending: !!e.prev.pending, none: !!e.prev.none };
          }
          out[w.no] = o;
          return;
        }
      }
      var h = history[w.no];
      if (!h) return; // 未テストの語は対象外
      if (!lastAt) {
        lastAt = {};
        sessions.forEach(function (s) {
          var t = s.at ? Date.parse(s.at) : NaN;
          if (isNaN(t) || !Array.isArray(s.items)) return;
          s.items.forEach(function (it) { if (it && typeof it.no === "number" && (!lastAt[it.no] || t > lastAt[it.no])) lastAt[it.no] = t; });
        });
      }
      var wrong = h.charAt(h.length - 1) === "×";
      var streak = 0;
      for (var i = h.length - 1; i >= 0 && h.charAt(i) === "○"; i--) streak++;
      var stg = wrong ? 0 : Math.min(5, streak);
      var last = lastAt[w.no] || null;
      // 日付が分かれば「最終テスト + 間隔」、分からなければ今すぐ期限
      out[w.no] = { stage: stg, due: last ? last + srsIntervalMs(stg) : now, last: last || 0, pending: wrong };
    });
    return out;
  }
  function srsSnapshot(e) { return e ? { stage: e.stage, due: e.due, last: e.last, pending: e.pending } : { none: true, stage: 0, due: 0, last: 0, pending: false }; }
  function srsApply(no, correct, now) {
    var e = progress.srs[no];
    var prev = srsSnapshot(e);
    var stage = e ? e.stage : 0;
    if (correct) {
      stage = Math.min(5, stage + 1);
      progress.srs[no] = { stage: stage, due: now + srsIntervalMs(stage), last: now, pending: false, prev: prev };
    } else {
      progress.srs[no] = { stage: 0, due: now + srsIntervalMs(0), last: now, pending: true, prev: prev };
    }
  }
  // 手動で判定を変えた時: 直前の更新を巻き戻して、新しい判定で更新し直す
  function srsRevise(no, correct) {
    var e = progress.srs[no];
    if (e && e.prev) {
      if (e.prev.none) delete progress.srs[no];
      else progress.srs[no] = { stage: e.prev.stage, due: e.prev.due, last: e.prev.last, pending: e.prev.pending };
    }
    srsApply(no, correct, e && e.last ? e.last : Date.now());
  }
  function isSrsDue(no, now) {
    var e = progress.srs && progress.srs[no];
    if (!e || !getHistory(no)) return false; // 一度もテストしていない語は含めない
    return e.pending || e.due <= endOfTodayMs(now);
  }

  // ---------- 旧TOEIC単語帳（tango_progress_v1）からの移行 ----------
  // 新しい保存キーが無い初回だけ実行。旧キーは読むだけで削除しない。新データがあれば何もしない（冪等）。
  // 引き継ぐもの: learned / history(○×文字列) / tips(自分で編集した覚え方 → 覚え方の上書き) / cycles(旧「範囲|対象」→「範囲|対象|en-ja」)。
  // 引き継がないもの: sessions(テスト記録), days, srs, flags（旧アプリに無い／形式が異なる）。
  function legacyProgressToSaved(old) {
    if (!isPlainObject(old)) return null;
    var saved = { learned: {}, history: {}, tips: {}, cycles: {} };
    var any = false;
    if (isPlainObject(old.learned)) {
      Object.keys(old.learned).forEach(function (k) {
        if (wordByNo[k] && typeof old.learned[k] === "boolean") { saved.learned[k] = old.learned[k]; any = true; }
      });
    }
    if (isPlainObject(old.history)) {
      Object.keys(old.history).forEach(function (k) {
        if (wordByNo[k] && typeof old.history[k] === "string") { saved.history[k] = old.history[k].replace(/[^○×]/g, ""); any = true; }
      });
    }
    if (isPlainObject(old.tips)) {
      Object.keys(old.tips).forEach(function (k) {
        if (wordByNo[k] && typeof old.tips[k] === "string") { saved.tips[k] = old.tips[k]; any = true; }
      });
    }
    if (isPlainObject(old.cycles)) {
      Object.keys(old.cycles).forEach(function (key) {
        var c = old.cycles[key];
        if (!isPlainObject(c)) return;
        var bar = key.lastIndexOf("|");
        if (bar < 0) return;
        var rangeKey = key.slice(0, bar), mode = key.slice(bar + 1);
        if (mode !== "all" && mode !== "unchecked") return;
        var rangeOk = rangeKey === "ALL" || (rangeKey !== "" && rangeKey.split(",").every(function (r) { return RANGES.indexOf(r) !== -1; }));
        if (!rangeOk) return;
        var newKey = makeCycleKey(rangeKey, mode, "en-ja"); // 旧アプリは英→日のみ
        var copy = {};
        Object.keys(c).forEach(function (f) { copy[f] = c[f]; });
        if (typeof copy.everStarted !== "boolean") {
          var len = function (a) { return Array.isArray(a) ? a.length : 0; };
          copy.everStarted = !!(len(copy.remaining) || len(copy.wrongLap) || len(copy.reserved) || (typeof copy.lap === "number" && copy.lap > 1));
        }
        saved.cycles[newKey] = copy;
        any = true;
      });
    }
    return any ? saved : null;
  }
  function migrateLegacyProgress() {
    var raw = null, old = null;
    try { raw = localStorage.getItem(LEGACY_PROGRESS_KEY); } catch (e) { return null; }
    if (!raw) return null;
    try { old = JSON.parse(raw); } catch (e) { return null; }
    var saved = legacyProgressToSaved(old);
    if (!saved) return null;
    var p = normalizeProgress(saved);
    p.migrations = { tangoImport_v1: true };
    return p;
  }
  function migrateLegacyTheme() {
    try {
      if (localStorage.getItem(THEME_KEY) === null) {
        var t = localStorage.getItem(LEGACY_THEME_KEY);
        if (t === "light" || t === "dark" || t === "auto") localStorage.setItem(THEME_KEY, t);
      }
    } catch (e) {}
  }

  function loadProgress() {
    var raw = null;
    try { raw = localStorage.getItem(PROGRESS_KEY); } catch (e) { raw = null; }
    var parsed = null;
    if (raw) { try { parsed = JSON.parse(raw); } catch (e) { parsed = null; } }
    if (raw === null) {
      var migrated = migrateLegacyProgress();
      if (migrated) { progress = migrated; saveProgress(); return; }
    }
    progress = normalizeProgress(parsed);
    saveProgress();
  }

  function reconcileReservedOnLoad() {
    var draft = loadInputDraft();
    var keepKey = draft ? normalizeCycleKey(draft.activeCycleKey) : null;
    var keepNos = {};
    if (draft && Array.isArray(draft.questions)) draft.questions.forEach(function (q) { keepNos[q.no] = true; });
    var changed = false;
    Object.keys(progress.cycles).forEach(function (key) {
      var c = progress.cycles[key];
      if (!c.reserved.length) return;
      var still = [];
      c.reserved.forEach(function (no) {
        if (key === keepKey && keepNos[no]) still.push(no);
        else { changed = true; if (c.remaining.indexOf(no) === -1) c.remaining.push(no); }
      });
      c.reserved = still;
    });
    if (changed) saveProgress();
  }

  // ---------- 単語ごとの状態 ----------
  function isLearned(no) { return !!progress.learned[no]; }
  function getHistory(no) { return progress.history[no] || ""; }
  function setLearned(no, val) {
    progress.learned[no] = !!val;
    if (!progress.checkedAt) progress.checkedAt = {};
    if (val) { noteStudied(no); progress.checkedAt[no] = localDateKey(new Date()); }
    else delete progress.checkedAt[no];
    saveProgress();
    renderStudyStats();
  }
  function appendHistory(no, mark) {
    progress.history[no] = getHistory(no) + mark;
    srsApply(no, mark !== "×", Date.now());
    noteStudied(no);
    saveProgress();
    renderStudyStats();
  }

  // 学習日の記録: テストで採点した語 / 覚えたにした語を、その日(東京時間)の語数として重複なしで数える
  function todayKey() { return tokyoTodayKey() || localDateKey(new Date()); }
  function localDateKey(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function noteStudied(no) {
    if (!progress.days) progress.days = {};
    var key = todayKey();
    var arr = progress.days[key];
    if (!Array.isArray(arr)) arr = progress.days[key] = [];
    if (arr.indexOf(no) === -1) arr.push(no);
  }
  // 今日の学習語数 = 今チェックが付いている語のうち、チェックした日が今日（ローカル日付）のもの。状態から毎回数える。
  function todayCount() {
    var ca = progress.checkedAt || {}, today = localDateKey(new Date()), n = 0;
    ALL_WORDS.forEach(function (w) { if (progress.learned[w.no] && ca[w.no] === today) n++; });
    return n;
  }
  function dailyGoal() {
    var g = progress.settings && progress.settings.dailyGoal;
    return (typeof g === "number" && g >= 1) ? g : DEFAULT_DAILY_GOAL;
  }
  // 今日の復習 = (a) 最新の記録が× + (b) 復習期限が今日以前でテスト済みの語（未テストの語は含めない）
  function reviewNos() {
    var now = Date.now();
    return ALL_WORDS.filter(function (w) {
      return getHistory(w.no).slice(-1) === "×" || isSrsDue(w.no, now);
    }).map(function (w) { return w.no; });
  }
  function isFlagged(no) { return !!(progress.flags && progress.flags[no]); }
  function setFlagged(no, on) {
    if (!progress.flags) progress.flags = {};
    if (on) progress.flags[no] = true; else delete progress.flags[no];
    saveProgress();
  }
  function flaggedNosInRange() {
    return wordsForRangeKey(normalizeRangeKeyForCycle()).filter(function (w) { return isFlagged(w.no); }).map(function (w) { return w.no; });
  }
  var STAR_SVG = '<svg viewBox="0 0 24 24" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2 6.3 20.3l1.2-6.4L2.8 9.5l6.4-.8z"></path></svg>';
  function syncStarBtn(btn, no, withLabel) {
    var on = isFlagged(no);
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-pressed", String(on));
    btn.setAttribute("aria-label", (on ? "★フラグを外す: " : "★フラグを付ける: ") + (wordByNo[no] ? wordByNo[no].word : ""));
    btn.innerHTML = STAR_SVG + (withLabel ? "<span>" + (on ? "フラグ済み" : "フラグ") + "</span>" : "");
  }

  function studyStatsHtml() {
    var streak = computeStreak(buildSessionDayMap(), todayKey());
    var n = todayCount(), goal = dailyGoal();
    var pct = Math.min(100, Math.round(n / goal * 100));
    var note = n >= goal ? '<div class="stat-note done">今日の目標を達成しました</div>'
      : '<div class="stat-note">目標まであと' + (goal - n) + '語</div>';
    return '<div class="stat-top">' +
      '<div class="stat-cell"><div class="num">' + streak + '<small>日</small></div><div class="lbl">連続日数</div></div>' +
      '<div class="stat-cell"><div class="num">' + n + '<small>/ ' + goal + '語</small></div><div class="lbl">今日の学習語数</div></div></div>' +
      '<div class="bar-track" role="progressbar" aria-label="今日の目標" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '"><div class="bar-fill" style="width:' + pct + '%"></div></div>' + note;
  }
  function renderStudyStats() {
    var h = $("homeStats"), p = $("progStats");
    if (!h || !p) return;
    var html = studyStatsHtml();
    h.innerHTML = html;
    p.innerHTML = html;
    var cnt = $("reviewCount");
    if (cnt) cnt.textContent = "（" + reviewNos().length + "語）";
  }
  function rewriteLastHistoryMark(no, mark) {
    var h = getHistory(no);
    progress.history[no] = h.length ? h.slice(0, -1) + mark : mark;
    srsRevise(no, mark !== "×");
    saveProgress();
  }

  function addSession(session) {
    progress.sessions.push(session);
    saveProgress();
    return session;
  }
  function makeSessionId() {
    return "app-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }
  function sessionRangesFromNos(nos) {
    var seen = {}, out = [];
    nos.forEach(function (no) {
      var w = wordByNo[no];
      if (w && !seen[w.range]) { seen[w.range] = true; out.push(w.range); }
    });
    return out;
  }

  function renderHistoryBlock(no) {
    var h = getHistory(no);
    if (!h) return '<div class="hist-wrap"><span class="hist-none">まだ記録なし</span></div>';
    var chars = "", good = 0, miss = 0;
    for (var i = 0; i < h.length; i++) {
      if (h.charAt(i) === "○") { good++; chars += '<span class="hist-good">○</span>'; }
      else { miss++; chars += '<span class="hist-bad">×</span>'; }
    }
    var acc = Math.round((good / h.length) * 100);
    return '<div class="hist-wrap"><div class="hist-str">' + chars + '</div>' +
      '<div class="hist-stats">×' + miss + '回 ・ 正答率' + acc + '%</div></div>';
  }

  // ---------- 覚え方（hint）の編集 ----------
  function getOriginalTip(no) { var w = wordByNo[no]; return (w && w.hint) || ""; }
  function getEffectiveTip(no) { return hasOwn(progress.tips, no) ? progress.tips[no] : getOriginalTip(no); }
  function setTipOverride(no, value) {
    delete progress.tips[no];
    if (value !== getOriginalTip(no)) progress.tips[no] = value;
    saveProgress();
  }
  function clearTipOverride(no) { delete progress.tips[no]; saveProgress(); }

  function renderTipBlockInto(container, no, holder, onChange) {
    container.innerHTML = "";
    container.onclick = function (e) { e.stopPropagation(); };
    var effective = getEffectiveTip(no);
    var editingState = holder.tipEdit;
    var editing = !!(editingState && editingState.no === no);

    var labelRow = document.createElement("div");
    labelRow.className = "tip-label-row";
    var label = document.createElement("span");
    label.className = "detail-label";
    label.textContent = "覚え方";
    labelRow.appendChild(label);

    if (editing) {
      container.appendChild(labelRow);
      var ta = document.createElement("textarea");
      ta.className = "tip-textarea";
      ta.value = editingState.draft;
      ta.setAttribute("aria-label", "覚え方を編集");
      ta.addEventListener("click", function (e) { e.stopPropagation(); });
      ta.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
      ta.addEventListener("input", function () { editingState.draft = ta.value; });
      container.appendChild(ta);
      if (editingState.focus) {
        editingState.focus = false;
        setTimeout(function () { ta.focus(); }, 0);
      }
      var btnRow = document.createElement("div");
      btnRow.className = "tip-btn-row";
      var saveBtn = document.createElement("button");
      saveBtn.type = "button"; saveBtn.className = "btn primary"; saveBtn.textContent = "保存";
      saveBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        setTipOverride(no, ta.value);
        holder.tipEdit = null;
        showToast("覚え方を保存しました");
        onChange();
      });
      var revertBtn = document.createElement("button");
      revertBtn.type = "button"; revertBtn.className = "btn"; revertBtn.textContent = "元に戻す";
      revertBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        clearTipOverride(no);
        holder.tipEdit = null;
        showToast("覚え方を元に戻しました");
        onChange();
      });
      btnRow.appendChild(saveBtn);
      btnRow.appendChild(revertBtn);
      container.appendChild(btnRow);
      setTimeout(function () { if (btnRow.scrollIntoView) btnRow.scrollIntoView({ block: "nearest", inline: "nearest" }); }, 0);
    } else {
      var startEdit = function (e) {
        e.stopPropagation();
        holder.tipEdit = { no: no, draft: effective, focus: true };
        onChange();
      };
      var editBtn = document.createElement("button");
      editBtn.type = "button"; editBtn.className = "tip-edit-btn"; editBtn.textContent = "編集";
      editBtn.addEventListener("click", startEdit);
      labelRow.appendChild(editBtn);
      container.appendChild(labelRow);
      var p = document.createElement("p");
      if (effective) { p.className = "tip-display"; p.textContent = effective; }
      else { p.className = "tip-display tip-placeholder"; p.textContent = "タップして覚え方を書く"; }
      p.addEventListener("click", startEdit);
      container.appendChild(p);
    }
  }

  function wordsInRange(range) {
    if (range === "ALL") return ALL_WORDS;
    return ALL_WORDS.filter(function (w) { return w.range === range; });
  }
  function rangeRemaining(range) {
    return wordsInRange(range).filter(function (w) { return !isLearned(w.no); }).length;
  }

  // ---------- 発音（Web Speech API） ----------
  var SPEAK_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M4 9v6h4l5 4V5L8 9H4z"></path><path d="M16.3 8.7a5 5 0 0 1 0 6.6"></path><path d="M19 6a8.5 8.5 0 0 1 0 12"></path></svg>';

  function supportsSpeech() {
    return !!(window.speechSynthesis && typeof window.speechSynthesis.speak === "function" && window.SpeechSynthesisUtterance);
  }
  function pickEnglishVoice(voices) {
    if (!voices || !voices.length) return null;
    var exact = voices.filter(function (v) { return v.lang === "en-US"; });
    if (exact.length) return exact[0];
    var en = voices.filter(function (v) { return /^en/i.test(v.lang || ""); });
    return en.length ? en[0] : null;
  }
  function speakWord(word) {
    if (!supportsSpeech() || !word) return;
    try {
      window.speechSynthesis.cancel();
      var utter = new SpeechSynthesisUtterance(word);
      utter.lang = "en-US";
      var voice = pickEnglishVoice(typeof window.speechSynthesis.getVoices === "function" ? window.speechSynthesis.getVoices() : []);
      if (voice) utter.voice = voice;
      window.speechSynthesis.speak(utter);
    } catch (e) {}
  }
  function buildSpeakBtn(word) {
    if (!supportsSpeech()) return null;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "speak-btn";
    btn.setAttribute("aria-label", "発音を再生: " + word);
    btn.innerHTML = SPEAK_ICON_SVG;
    btn.addEventListener("click", function (e) { e.stopPropagation(); speakWord(word); });
    return btn;
  }

  // ---------- 周回（Cycle） ----------
  function cycleTake(remaining, n) {
    var arr = Array.isArray(remaining) ? remaining : [];
    var count = Math.max(0, n | 0);
    return { taken: arr.slice(0, count), leftover: arr.slice(count) };
  }

  function normalizeRangeKeyForCycle() {
    if (state.test.allRanges) return "ALL";
    var sorted = state.test.selectedRanges.slice().sort();
    if (sorted.length === RANGES.length && RANGES.every(function (r) { return sorted.indexOf(r) !== -1; })) return "ALL";
    return sorted.join(",");
  }
  // 周回キー = 範囲 | 対象(unchecked/all) | 形式(en-ja/ja-en/cloze)。旧形式（形式なし）は en-ja 扱い。
  var LAP_FORMATS = [
    { ui: "input", lap: "en-ja", label: "英→日 入力", short: "英→日" },
    { ui: "jaen", lap: "ja-en", label: "日→英 入力", short: "日→英" },
    { ui: "cloze", lap: "cloze", label: "例文穴埋め", short: "例文" }
  ];
  function lapFormatOfUi(ui) {
    for (var i = 0; i < LAP_FORMATS.length; i++) if (LAP_FORMATS[i].ui === ui) return LAP_FORMATS[i];
    return LAP_FORMATS[0];
  }
  function splitCycleKey(key) {
    var p = String(key).split("|");
    return { rangeKey: p[0], mode: p[1] || "all", fmt: p[2] || "en-ja" };
  }
  function makeCycleKey(rangeKey, mode, fmt) { return rangeKey + "|" + mode + "|" + fmt; }
  function normalizeCycleKey(key) {
    if (typeof key !== "string") return key;
    var p = splitCycleKey(key);
    return makeCycleKey(p.rangeKey, p.mode, p.fmt);
  }
  function currentCycleKey() {
    return makeCycleKey(normalizeRangeKeyForCycle(), state.test.unlearnedOnly ? "unchecked" : "all", lapFormatOfUi(state.test.format).lap);
  }
  // 周回数（未開始は0）。状態は変更しない。
  function lapNumberForKey(key) {
    var c = progress.cycles[key];
    return (c && c.everStarted && typeof c.lap === "number") ? c.lap : 0;
  }
  function wordsForRangeKey(rangeKey) {
    if (rangeKey === "ALL") return ALL_WORDS.slice();
    var seen = {}, out = [];
    rangeKey.split(",").forEach(function (r) {
      wordsInRange(r).forEach(function (w) { if (!seen[w.no]) { seen[w.no] = true; out.push(w); } });
    });
    return out;
  }
  function cycleModeFromKey(key) { return splitCycleKey(key).mode; }
  function poolNosForKey(key) {
    var rangeKey = splitCycleKey(key).rangeKey;
    var words = wordsForRangeKey(rangeKey);
    if (cycleModeFromKey(key) === "unchecked") words = words.filter(function (w) { return !isLearned(w.no); });
    return words.map(function (w) { return w.no; });
  }

  function getCycle(key) {
    if (!progress.cycles[key]) progress.cycles[key] = { lap: 1, remaining: [], wrongLap: [], reserved: [], everStarted: false };
    var c = progress.cycles[key];
    if (!Array.isArray(c.remaining)) c.remaining = [];
    if (!Array.isArray(c.wrongLap)) c.wrongLap = [];
    if (!Array.isArray(c.reserved)) c.reserved = [];
    if (typeof c.lap !== "number" || c.lap < 1) c.lap = 1;
    if (typeof c.everStarted !== "boolean") c.everStarted = !!(c.remaining.length || c.wrongLap.length || c.reserved.length || c.lap > 1);
    return c;
  }

  function pruneForUnchecked(c, mode, freshPoolNos) {
    if (mode !== "unchecked") return;
    var poolSet = {};
    freshPoolNos.forEach(function (no) { poolSet[no] = true; });
    c.remaining = c.remaining.filter(function (no) { return poolSet[no]; });
    c.wrongLap = c.wrongLap.filter(function (no) { return poolSet[no]; });
  }
  function advanceLapIfPossible(c, mode, freshPoolNos) {
    pruneForUnchecked(c, mode, freshPoolNos);
    var guard = 0;
    while (c.everStarted && c.remaining.length === 0 && c.reserved.length === 0 && freshPoolNos.length > 0 && guard < 20) {
      guard++;
      c.lap = (c.lap || 1) + 1;
      c.wrongLap = [];
      c.remaining = shuffle(freshPoolNos);
      c.lapTotal = c.remaining.length;
      pruneForUnchecked(c, mode, freshPoolNos);
    }
  }
  function startNewLapIfEmpty(c, mode, freshPoolNos) {
    advanceLapIfPossible(c, mode, freshPoolNos);
    if (c.remaining.length === 0 && c.reserved.length === 0 && c.wrongLap.length === 0 && freshPoolNos.length > 0) {
      c.lap = 1;
      c.remaining = shuffle(freshPoolNos);
      c.everStarted = true;
      c.lapTotal = c.remaining.length;
    }
  }
  function lapTotalForCycle(c, key) {
    if (typeof c.lapTotal === "number" && c.lapTotal > 0) return { total: c.lapTotal, reliable: true };
    if ((c.lap || 1) === 1 && cycleModeFromKey(key) === "all") {
      return { total: wordsForRangeKey(splitCycleKey(key).rangeKey).length, reliable: true };
    }
    return { total: c.remaining.length + c.reserved.length + c.wrongLap.length, reliable: false };
  }
  function cycleStatusInfo(key) {
    var freshPool = poolNosForKey(key);
    var c = progress.cycles[key];
    var remaining = c ? c.remaining.length : 0;
    var reserved = c ? c.reserved.length : 0;
    var info = {
      poolSize: freshPool.length,
      everStarted: !!(c && c.everStarted),
      lap: c ? c.lap : 1,
      remaining: remaining, reserved: reserved,
      wrong: c ? c.wrongLap.length : 0,
      z: remaining + reserved,
      lapTotal: 0, lapTotalReliable: false, tested: 0
    };
    if (c) {
      var t = lapTotalForCycle(c, key);
      info.lapTotal = t.total;
      info.lapTotalReliable = t.reliable;
      info.tested = Math.max(0, t.total - info.z);
    }
    return info;
  }
  // 進み具合用: 形式ごとの周回を1行で（例: 英→日 2周目 ・ 日→英 0周目 ・ 例文 1周目）。詳細行は 英→日 のみ。
  function cycleGroupHtml(rangeKey, mode, heading) {
    var info = cycleStatusInfo(makeCycleKey(rangeKey, mode, "en-ja"));
    var lines = ['<div class="range-sub-heading">' + escapeHtml(heading) + '</div>'];
    if (info.poolSize === 0) {
      lines.push('<div class="range-sub-row">対象の単語がありません</div>');
      return lines.join("");
    }
    lines.push('<div class="range-lap-line">' + LAP_FORMATS.map(function (f) {
      return escapeHtml(f.short) + ' <b>' + lapNumberForKey(makeCycleKey(rangeKey, mode, f.lap)) + '周目</b>';
    }).join(' ・ ') + '</div>');
    if (info.everStarted) {
      lines.push('<div class="range-sub-row">英→日 テスト済み: <b>' + info.tested + (info.lapTotalReliable ? ' / ' + info.lapTotal : '') + '語</b>（残り' + info.z + '語）・ この周の×: <b>' + info.wrong + '語</b></div>');
    }
    return lines.join("");
  }
  function reconcileCycleAfterTest(key, confirmedNos, wrongNos, unansweredNos) {
    if (!key) return;
    var c = getCycle(key);
    var removeSet = {};
    confirmedNos.concat(unansweredNos).forEach(function (no) { removeSet[no] = true; });
    c.reserved = c.reserved.filter(function (no) { return !removeSet[no]; });
    unansweredNos.forEach(function (no) { if (c.remaining.indexOf(no) === -1) c.remaining.push(no); });
    wrongNos.forEach(function (no) { if (c.wrongLap.indexOf(no) === -1) c.wrongLap.push(no); });
    advanceLapIfPossible(c, cycleModeFromKey(key), poolNosForKey(key));
    saveProgress();
  }
  function adjustCycleForVerdictChange(key, lap, no, wasWrong, isWrong) {
    if (!key || wasWrong === isWrong) return;
    var c = progress.cycles[normalizeCycleKey(key)];
    if (!c || c.lap !== lap) return;
    if (wasWrong && !isWrong) {
      var idx = c.wrongLap.indexOf(no);
      if (idx !== -1) c.wrongLap.splice(idx, 1);
    } else if (c.wrongLap.indexOf(no) === -1) {
      c.wrongLap.push(no);
    }
    saveProgress();
  }

  // ---------- 採点 ----------
  var BRACKET_RE = /\([^)]*\)|（[^）]*）|\[[^\]]*\]|【[^】]*】|「[^」]*」/g;
  var SYMBOL_RE = /[\s。．.、，,;；:：・\/／ー'"\[\]「」（）()【】-]/g;
  var TRAILING_SUFFIXES = ["すること", "する", "的", "の", "な", "に"];
  var MEANING_SPLIT_RE = /[、,;；／\/]/;

  function normalizeAnswer(s) {
    if (s == null) return "";
    s = String(s).replace(BRACKET_RE, "").normalize("NFKC");
    s = s.replace(/[ァ-ヶ]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0x60); });
    s = s.toLowerCase().replace(SYMBOL_RE, "");
    var changed = true;
    while (changed) {
      changed = false;
      for (var i = 0; i < TRAILING_SUFFIXES.length; i++) {
        var suf = TRAILING_SUFFIXES[i];
        if (s.length > suf.length && s.slice(s.length - suf.length) === suf) {
          s = s.slice(0, s.length - suf.length);
          changed = true;
          break;
        }
      }
    }
    return s;
  }
  function bigramsOf(s) {
    var arr = [];
    for (var i = 0; i < s.length - 1; i++) arr.push(s.slice(i, i + 2));
    return arr;
  }
  function diceCoefficient(a, b) {
    var ba = bigramsOf(a), bb = bigramsOf(b);
    if (!ba.length || !bb.length) return 0;
    var counts = {}, matches = 0;
    ba.forEach(function (g) { counts[g] = (counts[g] || 0) + 1; });
    bb.forEach(function (g) { if (counts[g] > 0) { matches++; counts[g]--; } });
    return (2 * matches) / (ba.length + bb.length);
  }
  function splitMeaningSynonyms(meaning) {
    return String(meaning == null ? "" : meaning).split(MEANING_SPLIT_RE)
      .map(normalizeAnswer).filter(function (p) { return p !== ""; });
  }
  function gradeAnswer(answer, meaning) {
    var norm = normalizeAnswer(answer);
    if (!norm) return { verdict: "wrong" };
    var syns = splitMeaningSynonyms(meaning);
    if (syns.indexOf(norm) !== -1) return { verdict: "correct" };
    if (norm === normalizeAnswer(meaning)) return { verdict: "correct" };
    for (var i = 0; i < syns.length; i++) {
      var syn = syns[i];
      if (norm.length >= 2 && syn.length >= 2 && (syn.indexOf(norm) !== -1 || norm.indexOf(syn) !== -1)) return { verdict: "correct" };
    }
    var maxDice = 0;
    syns.forEach(function (syn) { var d = diceCoefficient(norm, syn); if (d > maxDice) maxDice = d; });
    return { verdict: maxDice >= 0.6 ? "close" : "wrong" };
  }

  // ---------- テーマ ----------
  function readThemePref() { try { return localStorage.getItem(THEME_KEY) || "auto"; } catch (e) { return "auto"; } }
  function effectiveTheme(pref) {
    if (pref === "light" || pref === "dark") return pref;
    return (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
  }
  function applyTheme() {
    var pref = readThemePref();
    var effective = effectiveTheme(pref);
    document.documentElement.setAttribute("data-theme", effective);
    document.documentElement.style.colorScheme = effective;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", effective === "dark" ? "#1C1826" : "#FFFFFF");
    Array.prototype.forEach.call($("themeSeg").querySelectorAll(".seg-btn"), function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-theme-choice") === pref);
    });
  }
  if (window.matchMedia) {
    var mq = window.matchMedia("(prefers-color-scheme: dark)");
    var mqHandler = function () { if (readThemePref() === "auto") applyTheme(); };
    if (mq.addEventListener) mq.addEventListener("change", mqHandler);
    else if (mq.addListener) mq.addListener(mqHandler);
  }

  // ---------- 画面状態 / タブ ----------
  var state = {
    tab: "list",
    list: { range: RANGES[0], query: "", openNo: null },
    flip: { range: RANGES[0], shuffle: false, unlearnedOnly: false, deck: [], index: 0, flipped: false },
    test: {
      phase: "setup",
      selectedRanges: [RANGES[0]],
      allRanges: false,
      unlearnedOnly: true,
      flaggedOnly: false,   // ★フラグのみ（true の間は周回を使わない）
      count: 20,
      format: "input", runFormat: "input", review: false,
      activeCycleKey: null, activeCycleLap: null,
      inputQuestions: [], inputResults: [], currentInputSession: null
    },
    progress: { expandedSessions: {} }
  };
  var lastMainTab = "list";
  var booted = false;

  function switchTab(name) {
    var opened = booted && state.tab !== name; // 起動時・同じタブの再タップではスタッガーしない
    if (name !== "settings") lastMainTab = name;
    state.tab = name;
    Array.prototype.forEach.call(document.querySelectorAll(".view"), function (v) {
      v.classList.toggle("active", v.id === "view-" + name);
    });
    Array.prototype.forEach.call(document.querySelectorAll(".tab-btn"), function (b) {
      var t = b.getAttribute("data-tab");
      b.classList.toggle("active", name === "settings" ? t === lastMainTab : t === name);
    });
    $("settingsBtn").setAttribute("aria-pressed", name === "settings" ? "true" : "false");
    if (name === "list") { renderStudyStats(); renderList(opened ? "open" : undefined); }
    if (name === "flip") {
      var rangeChanged = state.flip.range !== state.list.range;
      state.flip.range = state.list.range;
      renderFlipChips(opened);
      if (rangeChanged || !state.flip.deck.length) flipBuildDeck(); else renderFlipCard();
    }
    if (name === "test") {
      if (state.test.phase === "inputTest") {
        updateTestPhaseVisibility();
        renderInputTest(false);
      } else if (!tryResumeDraft()) {
        renderTestSetup(opened);
      }
    }
    if (name === "progress") renderProgress();
    if (name === "settings") { refreshOpenaiKeyUI(); $("goalInput").value = dailyGoal(); }
    window.scrollTo(0, 0);
  }

  Array.prototype.forEach.call(document.querySelectorAll(".tab-btn"), function (btn) {
    btn.addEventListener("click", function () { switchTab(btn.getAttribute("data-tab")); });
  });

  function openSettings() {
    if (state.tab === "test" && state.test.phase === "inputTest") {
      if (!window.confirm("テストの途中です。設定を開くとテストを中断します。中断しますか？")) return;
      abortInputTest();
    }
    switchTab("settings");
  }
  function closeSettings() { switchTab(lastMainTab || "list"); }
  $("settingsBtn").addEventListener("click", function () {
    if (state.tab === "settings") closeSettings(); else openSettings();
  });
  $("settingsBackBtn").addEventListener("click", closeSettings);

  // ---------- 一覧 ----------
  function renderRangeChips(wrapId, current, onPick, animate) {
    var wrap = $(wrapId);
    wrap.innerHTML = "";
    RANGES.forEach(function (r, idx) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip" + (current === r ? " active" : "") + (animate ? " stagger-in" : "");
      if (animate) chip.style.setProperty("--i", idx);
      chip.innerHTML = rangeChipInner(r, "未チェック" + rangeRemaining(r) + "語");
      chip.addEventListener("click", function () { onPick(r); });
      wrap.appendChild(chip);
    });
  }
  function renderListChips(animate) {
    renderRangeChips("listRangeChips", state.list.range, function (r) { state.list.range = r; renderList("pick"); }, animate);
  }

  // mode: "open"=画面を開いた時（チップも行もスタッガー） / "pick"=セット切替（行だけ） / 未指定=アニメなし
  function renderList(mode) {
    var animate = mode === "open" || mode === "pick";
    renderListChips(mode === "open");
    var ul = $("listWords");
    var q = state.list.query.trim().toLowerCase();
    var words = wordsInRange(state.list.range).filter(function (w) {
      if (!q) return true;
      return w.word.toLowerCase().indexOf(q) !== -1 ||
        (w.meaning || "").toLowerCase().indexOf(q) !== -1 ||
        String(w.no).indexOf(q) !== -1;
    });
    ul.innerHTML = "";
    if (!words.length) {
      var empty = document.createElement("li");
      empty.className = "empty-msg";
      empty.textContent = "該当する単語がありません";
      ul.appendChild(empty);
      return;
    }
    words.forEach(function (w, idx) {
      var learned = isLearned(w.no);
      var li = document.createElement("li");
      li.className = "word-row" + (learned ? " is-learned" : "") + (animate ? " stagger-in" : "");
      if (animate) li.style.setProperty("--i", Math.min(idx, 10));
      li.setAttribute("data-no", w.no);

      var main = document.createElement("div");
      main.className = "row-main";

      var chkWrap = document.createElement("label");
      chkWrap.className = "chk-wrap";
      var chk = document.createElement("input");
      chk.type = "checkbox";
      chk.checked = learned;
      chk.setAttribute("aria-label", "覚えた: " + w.word);
      chk.addEventListener("change", function () {
        setLearned(w.no, chk.checked);
        li.classList.toggle("is-learned", chk.checked);
        renderListChips();
        showToast(chk.checked ? "「" + w.word + "」を覚えた に追加しました" : "「" + w.word + "」のチェックを外しました");
      });
      chkWrap.appendChild(chk);

      var textWrap = document.createElement("div");
      textWrap.className = "row-text";
      textWrap.innerHTML =
        '<div class="row-top"><span class="w-no">No.' + w.no + '</span>' +
        '<span class="w-word">' + escapeHtml(w.word) + '</span>' +
        '<span class="w-pos">' + escapeHtml(w.pos || "") + '</span></div>' +
        '<div class="w-meaning-placeholder">タップで意味と詳細を表示</div>' +
        '<div class="row-hist">' + renderHistoryBlock(w.no) + '</div>';
      textWrap.setAttribute("role", "button");
      textWrap.setAttribute("tabindex", "0");
      textWrap.setAttribute("aria-label", w.word + " の詳細を開く");
      textWrap.setAttribute("aria-expanded", "false");
      textWrap.addEventListener("click", function () { toggleRow(w.no); });
      textWrap.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleRow(w.no); }
      });

      main.appendChild(chkWrap);
      main.appendChild(textWrap);
      var sb = buildSpeakBtn(w.word);
      if (sb) main.appendChild(sb);
      var star = document.createElement("button");
      star.type = "button";
      star.className = "star-btn";
      syncStarBtn(star, w.no, false);
      star.addEventListener("click", function (e) {
        e.stopPropagation();
        var on = !isFlagged(w.no);
        setFlagged(w.no, on);
        syncStarBtn(star, w.no, false);
        showToast(on ? "「" + w.word + "」に★を付けました" : "「" + w.word + "」の★を外しました");
      });
      main.appendChild(star);
      li.appendChild(main);

      ul.appendChild(li);
      if (state.list.openNo === w.no) showRowDetail(li, w, false);
    });
  }

  // ---------- 単語詳細（行内展開） ----------
  function rowByNo(no) { return $("listWords").querySelector('li[data-no="' + no + '"]'); }

  function toggleRow(no) {
    var prev = state.list.openNo;
    state.list.tipEdit = null;
    if (prev != null) hideRowDetail(rowByNo(prev));
    if (prev === no) { state.list.openNo = null; return; }
    state.list.openNo = no;
    var li = rowByNo(no);
    if (li) showRowDetail(li, wordByNo[no], true);
  }

  function hideRowDetail(li) {
    if (!li) return;
    var detail = li.querySelector(".row-detail");
    li.classList.remove("is-open");
    var tw = li.querySelector(".row-text");
    if (tw) tw.setAttribute("aria-expanded", "false");
    if (wordByNo[li.getAttribute("data-no")]) setRowMeaning(li, wordByNo[li.getAttribute("data-no")], false);
    if (!detail) return;
    detail.classList.remove("open");
    if (reduceMotion()) { detail.remove(); return; }
    setTimeout(function () { if (!li.classList.contains("is-open") && detail.parentNode) detail.remove(); }, 300);
  }

  function showRowDetail(li, w, animate) {
    var old = li.querySelector(".row-detail");
    if (old) old.remove();
    var detail = document.createElement("div");
    detail.className = "row-detail";
    var inner = document.createElement("div");
    inner.className = "row-detail-inner";
    detail.appendChild(inner);
    li.appendChild(detail);
    li.classList.add("is-open");
    setRowMeaning(li, w, true);
    renderRowDetailBody(inner, w, li);
    if (animate && !reduceMotion()) {
      void detail.offsetWidth; // reflow してから open を付与 → 展開アニメーション
    }
    detail.classList.add("open");
    var tw = li.querySelector(".row-text");
    if (tw) tw.setAttribute("aria-expanded", "true");
  }

  function renderRowDetailBody(body, w, li) {
    body.innerHTML = "";

    var tipLine = document.createElement("div");
    tipLine.className = "detail-line";
    renderTipBlockInto(tipLine, w.no, state.list, function () { renderRowDetailBody(body, w, li); });
    body.appendChild(tipLine);

    if (w.example) {
      var ex = document.createElement("div");
      ex.className = "detail-line";
      ex.innerHTML = '<span class="detail-label">例文</span><p>' + escapeHtml(w.example) + '</p>' +
        (w.exampleJa ? '<p class="ja">' + escapeHtml(w.exampleJa) + '</p>' : "");
      body.appendChild(ex);
    }

  }

  // 行は変えず、意味の行だけ（プレースホルダ ⇄ 意味）切り替える
  function setRowMeaning(li, w, shown) {
    var el = li.querySelector(".w-meaning, .w-meaning-placeholder");
    if (!el) return;
    if (shown) {
      el.className = "w-meaning";
      el.textContent = w.meaning || "";
    } else {
      el.className = "w-meaning-placeholder";
      el.textContent = "タップで意味と詳細を表示";
    }
  }

  $("listSearch").addEventListener("input", function (e) {
    state.list.query = e.target.value;
    renderList();
  });

  // ---------- めくる ----------
  function renderFlipChips(animate) {
    renderRangeChips("flipRangeChips", state.flip.range, function (r) {
      state.flip.range = r;
      state.list.range = r;
      renderFlipChips();
      flipBuildDeck();
    }, animate);
  }

  // カードのスプリング遷移: "next" / "prev"（スワイプ・ボタン）、"pop"（めくり）
  function animateFlipCard(kind) {
    var card = $("flipCard");
    if (reduceMotion()) return;
    card.classList.remove("card-in-next", "card-in-prev", "card-pop");
    card.style.transition = "";
    card.style.transform = "";
    void card.offsetWidth;
    var cls = kind === "next" ? "card-in-next" : (kind === "prev" ? "card-in-prev" : "card-pop");
    card.classList.add(cls);
    card.addEventListener("animationend", function () { card.classList.remove(cls); }, { once: true });
  }
  function flipBuildDeck() {
    var words = wordsInRange(state.flip.range);
    if (state.flip.unlearnedOnly) words = words.filter(function (w) { return !isLearned(w.no); });
    if (state.flip.shuffle) words = shuffle(words);
    state.flip.deck = words;
    state.flip.index = 0;
    state.flip.flipped = false;
    state.flip.tipEdit = null;
    renderFlipCard();
  }
  function currentFlipWord() { return state.flip.deck[state.flip.index] || null; }

  function renderFlipCard() {
    var w = currentFlipWord();
    var front = $("flipFront"), back = $("flipBack"), chk = $("flipLearnedChk");
    $("flipProgress").textContent = state.flip.deck.length ? (state.flip.index + 1) + " / " + state.flip.deck.length : "0 / 0";

    if (!w) {
      state.flip.tipEdit = null;
      $("flipFrontNo").textContent = "";
      $("flipFrontWord").textContent = "カードがありません";
      $("flipFrontSpeakWrap").innerHTML = "";
      $("flipBackSpeakWrap").innerHTML = "";
      front.hidden = false;
      back.hidden = true;
      chk.checked = false;
      chk.disabled = true;
      $("flipStarBtn").style.display = "none";
      $("flipBackTipWrap").innerHTML = "";
      $("flipBackHistory").innerHTML = "";
      return;
    }
    if (state.flip.tipEdit && state.flip.tipEdit.no !== w.no) state.flip.tipEdit = null;
    chk.disabled = false;
    $("flipStarBtn").style.display = "";
    syncStarBtn($("flipStarBtn"), w.no, true);
    $("flipFrontNo").textContent = "No." + w.no + " ・ " + (w.pos || "");
    $("flipFrontWord").textContent = w.word;
    var fs = $("flipFrontSpeakWrap"); fs.innerHTML = "";
    var fb = buildSpeakBtn(w.word); if (fb) fs.appendChild(fb);
    var bs = $("flipBackSpeakWrap"); bs.innerHTML = "";
    var bb = buildSpeakBtn(w.word); if (bb) bs.appendChild(bb);
    $("flipBackPos").textContent = "品詞: " + (w.pos || "");
    $("flipBackMeaning").textContent = w.meaning || "";
    renderTipBlockInto($("flipBackTipWrap"), w.no, state.flip, renderFlipCard);
    $("flipBackExample").textContent = w.example || "";
    $("flipBackExampleJa").textContent = w.exampleJa || "";
    $("flipBackExampleWrap").style.display = w.example ? "" : "none";
    $("flipBackHistory").innerHTML = renderHistoryBlock(w.no);
    front.hidden = state.flip.flipped;
    back.hidden = !state.flip.flipped;
    chk.checked = isLearned(w.no);
  }

  $("flipCard").addEventListener("click", function (e) {
    if (!currentFlipWord()) return;
    // 裏面のボタン・入力欄・覚え方ブロックの操作ではめくり直さない
    if (e.target.closest && e.target.closest("button, textarea, input, #flipBackTipWrap")) return;
    state.flip.flipped = !state.flip.flipped;
    renderFlipCard();
    animateFlipCard("pop");
  });

  function flipGoto(delta) {
    if (!state.flip.deck.length) return;
    var next = Math.max(0, Math.min(state.flip.deck.length - 1, state.flip.index + delta));
    var moved = next !== state.flip.index;
    if (moved) state.flip.tipEdit = null;
    state.flip.index = next;
    state.flip.flipped = false;
    renderFlipCard();
    if (moved) animateFlipCard(delta > 0 ? "next" : "prev");
  }
  $("flipPrevBtn").addEventListener("click", function () { flipGoto(-1); });
  $("flipNextBtn").addEventListener("click", function () { flipGoto(1); });

  (function flipSwipe() {
    var outer = document.querySelector(".flip-card-outer");
    var card = $("flipCard");
    var sx = 0, sy = 0, tracking = false, dragged = false;
    function springBack() {
      if (!dragged) return;
      dragged = false;
      card.style.transition = "transform .5s var(--ease-spring)";
      card.style.transform = "";
      setTimeout(function () { card.style.transition = ""; }, 520);
    }
    outer.addEventListener("touchstart", function (e) {
      if (!e.touches[0]) return;
      var el = e.target;
      if (el && el.closest && el.closest("textarea, input, button, #flipBackTipWrap")) { tracking = false; return; }
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; tracking = true; dragged = false;
    }, { passive: true });
    // 指に追従してカードが傾きながら動く（動きを減らす設定の時は追従しない）
    outer.addEventListener("touchmove", function (e) {
      if (!tracking || reduceMotion() || !e.touches[0]) return;
      var dx = e.touches[0].clientX - sx, dy = e.touches[0].clientY - sy;
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy)) return;
      dragged = true;
      card.style.transition = "none";
      card.style.transform = "translateX(" + (dx * 0.5).toFixed(1) + "px) rotate(" + (dx * 0.02).toFixed(2) + "deg)";
    }, { passive: true });
    outer.addEventListener("touchend", function (e) {
      if (!tracking) return;
      tracking = false;
      var t = e.changedTouches[0];
      if (!t) { springBack(); return; }
      var dx = t.clientX - sx, dy = t.clientY - sy;
      var swiped = Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy);
      var atEdge = swiped && (dx < 0
        ? state.flip.index >= state.flip.deck.length - 1
        : state.flip.index <= 0);
      if (swiped && !atEdge) {
        dragged = false;
        card.style.transition = ""; card.style.transform = "";
        flipGoto(dx < 0 ? 1 : -1);
      } else {
        springBack(); // 端やしきい値未満ではバネで元の位置に戻る
      }
    }, { passive: true });
    outer.addEventListener("touchcancel", function () { tracking = false; springBack(); }, { passive: true });
  })();

  $("flipLearnedChk").addEventListener("change", function (e) {
    var w = currentFlipWord();
    if (!w) return;
    setLearned(w.no, e.target.checked);
    showToast(e.target.checked ? "「" + w.word + "」を覚えた に追加しました" : "「" + w.word + "」のチェックを外しました");
  });
  $("flipStarBtn").addEventListener("click", function () {
    var w = currentFlipWord();
    if (!w) return;
    var on = !isFlagged(w.no);
    setFlagged(w.no, on);
    syncStarBtn($("flipStarBtn"), w.no, true);
    showToast(on ? "「" + w.word + "」に★を付けました" : "「" + w.word + "」の★を外しました");
  });
  $("flipShuffleBtn").addEventListener("click", function (e) {
    state.flip.shuffle = !state.flip.shuffle;
    e.currentTarget.textContent = "シャッフル: " + (state.flip.shuffle ? "オン" : "オフ");
    e.currentTarget.setAttribute("aria-pressed", String(state.flip.shuffle));
    flipBuildDeck();
  });
  $("flipUnlearnedBtn").addEventListener("click", function (e) {
    state.flip.unlearnedOnly = !state.flip.unlearnedOnly;
    e.currentTarget.textContent = "未習得だけ: " + (state.flip.unlearnedOnly ? "オン" : "オフ");
    e.currentTarget.setAttribute("aria-pressed", String(state.flip.unlearnedOnly));
    flipBuildDeck();
  });
  $("flipStartBtn").addEventListener("click", flipBuildDeck);

  // ---------- テスト ----------
  function updateTestPhaseVisibility() {
    var phase = state.test.phase;
    $("testSetup").style.display = phase === "setup" ? "" : "none";
    $("inputTest").style.display = phase === "inputTest" ? "" : "none";
    $("inputResult").style.display = phase === "inputResult" ? "" : "none";
  }
  function showSetupMessage(msg) {
    var el = $("testSetupMsg");
    el.style.display = "";
    el.textContent = msg;
  }
  function toggleTestRange(r) {
    if (r === "ALL") { state.test.allRanges = true; state.test.selectedRanges = []; }
    else { state.test.allRanges = false; state.test.selectedRanges = [r]; }
    renderTestSetup();
  }

  function renderCycleStatus() {
    var key = currentCycleKey();
    var rangeKey = splitCycleKey(key).rangeKey;
    var fmtShort = lapFormatOfUi(state.test.format).short;
    var c = getCycle(key);
    advanceLapIfPossible(c, cycleModeFromKey(key), poolNosForKey(key));
    saveProgress();
    var unchecked = wordsForRangeKey(rangeKey).filter(function (w) { return !isLearned(w.no); }).length;
    var info = cycleStatusInfo(key);
    var rows = ['<div class="cycle-row">未チェック: <span class="cv">' + unchecked + '語</span>（範囲内の未習得）</div>'];
    if (info.poolSize === 0) {
      rows.push('<div class="cycle-row">対象の単語がありません。</div>');
    } else if (!info.everStarted) {
      rows.push('<div class="cycle-row">今の周回（' + fmtShort + '）: <span class="cv">0周目</span>（開始すると1周目、' + info.poolSize + '語が対象）</div>');
    } else {
      rows.push('<div class="cycle-row">今の周回（' + fmtShort + '）: <span class="cv">' + info.lap + '周目</span></div>');
      rows.push('<div class="cycle-row">この周のテスト済み: <span class="cv">' + info.tested + (info.lapTotalReliable ? ' / ' + info.lapTotal : '') + '語</span>（残り' + info.z + '語）</div>');
      rows.push('<div class="cycle-row">この周の×: <span class="cv">' + info.wrong + '語</span></div>');
    }
    $("testCycleStatus").innerHTML = rows.join("");
  }

  function renderTestSetup(animate) {
    updateTestPhaseVisibility();
    $("testSetupMsg").style.display = "none";

    var rwrap = $("testRangeChips");
    rwrap.innerHTML = "";
    RANGES.concat(["ALL"]).forEach(function (r, idx) {
      var selected = r === "ALL" ? state.test.allRanges : (!state.test.allRanges && state.test.selectedRanges.indexOf(r) !== -1);
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip" + (selected ? " active" : "") + (animate ? " stagger-in" : "");
      if (animate) chip.style.setProperty("--i", idx);
      chip.innerHTML = r === "ALL"
        ? '<b>全範囲</b><span class="rest">' + ALL_WORDS.length + '語</span>'
        : rangeChipInner(r, "未チェック" + rangeRemaining(r) + "語");
      chip.addEventListener("click", function () { toggleTestRange(r); });
      rwrap.appendChild(chip);
    });

    var curTarget = state.test.flaggedOnly ? "flagged" : (state.test.unlearnedOnly ? "unchecked" : "all");
    Array.prototype.forEach.call($("testTargetSeg").querySelectorAll(".seg-btn"), function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-target") === curTarget);
    });
    var flaggedN = flaggedNosInRange().length;
    $("testFlaggedBtn").textContent = "★フラグのみ（" + flaggedN + "）";

    var review = state.test.review, rn = reviewNos().length;
    // 形式ボタン: 選択中の範囲×対象での各形式の周回を小さく添える（復習・★フラグでは周回を使わないので出さない）
    var showLapCaption = !review && !state.test.flaggedOnly;
    var capRange = normalizeRangeKeyForCycle(), capMode = state.test.unlearnedOnly ? "unchecked" : "all";
    Array.prototype.forEach.call($("testFormatSeg").querySelectorAll(".seg-btn"), function (btn) {
      var f = lapFormatOfUi(btn.getAttribute("data-format"));
      var lap = lapNumberForKey(makeCycleKey(capRange, capMode, f.lap));
      btn.classList.toggle("active", f.ui === state.test.format);
      btn.innerHTML = '<span class="seg-label">' + escapeHtml(f.label) + '</span>' +
        (showLapCaption ? '<span class="seg-sub">' + (lap > 0 ? lap + '周目' : '未開始') + '</span>' : '');
    });
    $("testFormatField").style.display = review ? "none" : ""; // 復習は 英→日 入力で行う
    $("testRangeField").style.display = review ? "none" : "";
    $("testTargetField").style.display = review ? "none" : "";
    var flaggedMode = !review && state.test.flaggedOnly;
    $("testCycleCard").style.display = (review || flaggedMode) ? "none" : "";
    $("reviewInfo").innerHTML = review
      ? '<b>今日の復習モード</b>: ×の単語と復習期限が来た単語 ' + rn + '語から、英→日 入力で出題します（全セット対象）。'
      : '今日の復習（×の単語＋期限が来た単語）: <b>' + rn + '語</b>（全セット対象）';
    var noFlagged = flaggedMode && flaggedN === 0;
    $("testStartBtn").disabled = noFlagged;
    if (noFlagged) showSetupMessage("この範囲に★フラグの付いた単語がありません。一覧やめくる画面で★を付けてください。");
    $("reviewToggleBtn").textContent = review ? "通常のテストに戻す" : "今日の復習モードにする";
    $("reviewToggleBtn").className = "btn block" + (review ? "" : " primary");
    $("testStartBtn").textContent = review ? "復習テストを始める" : "テストを始める";

    var cwrap = $("testCountChips");
    cwrap.innerHTML = "";
    TEST_COUNT_OPTIONS.forEach(function (c, idx) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip" + (state.test.count === c ? " active" : "") + (animate ? " stagger-in" : "");
      if (animate) chip.style.setProperty("--i", idx + 2);
      chip.innerHTML = "<b>" + c + "問</b>";
      chip.addEventListener("click", function () { state.test.count = c; renderTestSetup(); });
      cwrap.appendChild(chip);
    });
    renderCycleStatus();
  }

  $("testTargetSeg").addEventListener("click", function (e) {
    var btn = e.target.closest(".seg-btn");
    if (!btn) return;
    var t = btn.getAttribute("data-target");
    state.test.flaggedOnly = t === "flagged";
    state.test.unlearnedOnly = t === "unchecked";
    renderTestSetup();
  });
  $("cycleResetBtn").addEventListener("click", function () {
    if (!window.confirm("この範囲×対象×形式（" + lapFormatOfUi(state.test.format).label + "）の周回をリセットします。よろしいですか？")) return;
    delete progress.cycles[currentCycleKey()];
    saveProgress();
    renderTestSetup();
  });

  $("testFormatSeg").addEventListener("click", function (e) {
    var btn = e.target.closest(".seg-btn");
    if (!btn) return;
    state.test.format = btn.getAttribute("data-format");
    renderTestSetup();
  });

  // 今日の復習: 最新の記録が×の単語を全セットから集めて出題（周回には影響させない）
  function setReviewMode(on) {
    if (on && !reviewNos().length) { state.test.review = false; showToast("今日復習する単語はありません"); renderTestSetup(); return false; }
    state.test.review = !!on;
    renderTestSetup();
    return true;
  }
  $("reviewToggleBtn").addEventListener("click", function () { setReviewMode(!state.test.review); });
  $("reviewBtn").addEventListener("click", function () {
    if (!reviewNos().length) { showToast("今日復習する単語はありません"); return; }
    if (state.test.phase === "inputTest" || loadInputDraft()) {
      showToast("途中のテストがあります。先にそのテストを終えてください");
      switchTab("test");
      return;
    }
    if (state.test.phase === "inputResult") state.test.phase = "setup";
    state.test.review = true;
    switchTab("test");
    showToast("復習する問題数を選んで始めてください");
  });

  function startReviewTest() {
    var pool = reviewNos();
    if (!pool.length) {
      state.test.review = false;
      state.test.phase = "setup";
      renderTestSetup();
      showToast("今日復習する単語はありません");
      return;
    }
    var chosen = shuffle(pool).slice(0, state.test.count);
    state.test.activeCycleKey = null;
    state.test.activeCycleLap = null;
    startInputTest(chosen.map(function (no) { return wordByNo[no]; }).filter(Boolean));
  }

  function handleStartClick() {
    if (state.test.review) { startReviewTest(); return; }
    if (state.test.flaggedOnly) {
      // ★フラグのみ: 範囲内のフラグ付き語からランダムに出題（周回には影響させない）
      var flagged = flaggedNosInRange();
      if (!flagged.length) {
        state.test.phase = "setup";
        renderTestSetup();
        return;
      }
      state.test.activeCycleKey = null;
      state.test.activeCycleLap = null;
      startInputTest(shuffle(flagged).slice(0, state.test.count).map(function (no) { return wordByNo[no]; }).filter(Boolean));
      return;
    }
    var key = currentCycleKey();
    var mode = cycleModeFromKey(key);
    var freshPool = poolNosForKey(key);
    if (!freshPool.length) {
      state.test.phase = "setup";
      renderTestSetup();
      showSetupMessage("出題できる単語がありません");
      return;
    }
    var c = getCycle(key);
    startNewLapIfEmpty(c, mode, freshPool);
    var n = Math.min(state.test.count, c.remaining.length);
    if (n <= 0) {
      state.test.phase = "setup";
      renderTestSetup();
      showSetupMessage("この組み合わせは周回完了です。対象の単語が増えると次の周を始められます。");
      return;
    }
    var take = cycleTake(c.remaining, n);
    c.remaining = take.leftover;
    c.reserved = take.taken.slice();
    saveProgress();
    state.test.activeCycleKey = key;
    state.test.activeCycleLap = c.lap;
    startInputTest(take.taken.map(function (no) { return wordByNo[no]; }).filter(Boolean));
  }
  // 出題の準備（抽選・描画）の間、ボタンにスピナーを出す。待っている間に画面を離れたら開始しない。
  function startWithLoading(e) {
    runWithLoading(e.currentTarget, function () { if (state.tab === "test") handleStartClick(); });
  }
  $("testStartBtn").addEventListener("click", startWithLoading);

  // ---------- 入力テスト（英→日・記述式） ----------
  var VERDICT_LABELS = { correct: "正解", close: "近い（正解扱い）", wrong: "不正解" };
  var VERDICT_CLASSES = { correct: "v-correct", close: "v-close", wrong: "v-wrong" };

  // 形式: input=英→日 入力 / jaen=日→英 入力 / cloze=例文穴埋め（4択）。周回は形式ごと / セッション記録は全形式 / 履歴・習得・SRS は input のみ。
  var FORMATS = ["input", "jaen", "cloze"];
  var FORMAT_SESSION_LABELS = { input: "入力", jaen: "日→英", cloze: "穴埋め" };
  function validFormat(f) { return FORMATS.indexOf(f) !== -1 ? f : "input"; }
  // 習得記録（履歴・正答率・覚えた・SRS・今日の語数）を作るのは 英→日 入力だけ。他の形式は周回の進みとセッション記録のみ。
  function buildsMastery() { return state.test.runFormat === "input"; }

  function escapeRegExp(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  // 例文中の対象語（活用形を含む）を ＿＿＿ に置き換える。見つからなければ null。
  function blankSentence(example, word) {
    if (!example || !word) return null;
    var min = Math.max(3, word.length - 3);
    for (var len = word.length; len >= min; len--) {
      var re = new RegExp("\\b" + escapeRegExp(word.slice(0, len)) + "[A-Za-z]*", "gi");
      var out = example.replace(re, "_____");
      if (out !== example) return out;
    }
    return null;
  }

  function normEnglish(s) { return String(s == null ? "" : s).normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g, ""); }
  // 編集距離が1以内か（置換・挿入・削除・隣接文字の入れ替えを1とする）
  function withinOneEdit(a, b) {
    if (a === b) return true;
    var la = a.length, lb = b.length;
    if (Math.abs(la - lb) > 1) return false;
    var i = 0;
    while (i < la && i < lb && a.charAt(i) === b.charAt(i)) i++;
    if (la === lb) {
      if (a.slice(i + 1) === b.slice(i + 1)) return true; // 置換
      return i + 1 < la && a.charAt(i) === b.charAt(i + 1) && a.charAt(i + 1) === b.charAt(i) && a.slice(i + 2) === b.slice(i + 2); // 入れ替え
    }
    return la > lb ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);
  }
  function gradeEnglish(answer, word) {
    var norm = normEnglish(answer);
    if (!norm) return { verdict: "wrong" };
    var targets = String(word).replace(BRACKET_RE, "").split(/[\/／,、;；]/).map(normEnglish).filter(Boolean);
    if (!targets.length) targets = [normEnglish(word)];
    if (targets.indexOf(norm) !== -1) return { verdict: "correct" };
    for (var i = 0; i < targets.length; i++) {
      if (targets[i].length >= 4 && withinOneEdit(norm, targets[i])) return { verdict: "close" }; // 短い語は typo 許容なし
    }
    return { verdict: "wrong" };
  }
  function gradeQuestion(q, format) {
    if (format === "jaen") return gradeEnglish(q.answer, q.word);
    if (format === "cloze") return { verdict: (q.answer || "") === q.word ? "correct" : "wrong" };
    return gradeAnswer(q.answer, q.meaning);
  }

  // 同じセットから不正解の選択肢を3つ選び、正解と混ぜる
  function buildChoices(w) {
    var others = shuffle(ALL_WORDS.filter(function (x) { return x.set === w.set && x.no !== w.no && x.word !== w.word; }));
    if (others.length < 3) others = others.concat(shuffle(ALL_WORDS.filter(function (x) { return x.set !== w.set && x.word !== w.word; })));
    return shuffle([w.word].concat(others.slice(0, 3).map(function (x) { return x.word; })));
  }

  function startInputTest(chosen) {
    // 今日の復習は習得記録（SRS）を更新できる 英→日 入力で固定
    var fmt = state.test.runFormat = state.test.review ? "input" : validFormat(state.test.format);
    state.test.inputQuestions = chosen.map(function (w) {
      var q = { no: w.no, word: w.word, pos: w.pos, meaning: w.meaning, answer: "" };
      if (fmt === "cloze") q.choices = buildChoices(w);
      return q;
    });
    state.test.currentInputSession = null;
    state.test.phase = "inputTest";
    updateTestPhaseVisibility();
    renderInputTest(false, true);
    saveInputDraft();
    window.scrollTo(0, 0);
  }

  // 回答済みの問題数に合わせて進捗バーを伸ばす（幅は CSS の transition でなめらかに動く）
  function updateTestProgress() {
    var qs = state.test.inputQuestions, total = qs.length;
    var done = qs.filter(function (q) { return (q.answer || "").trim() !== ""; }).length;
    var pct = total ? Math.round(done / total * 100) : 0;
    $("testProgText").textContent = done + " / " + total;
    $("testProgBar").style.width = pct + "%";
    $("testProgTrack").setAttribute("aria-valuenow", String(pct));
  }

  function renderInputTest(resumed, autoFocus) {
    $("inputResumeNote").style.display = resumed ? "" : "none";
    var wrap = $("inputTestList");
    wrap.innerHTML = "";
    var inputEls = [];
    var qs = state.test.inputQuestions;
    var fmt = state.test.runFormat;
    updateTestProgress();
    qs.forEach(function (q, idx) {
      var div = document.createElement("div");
      div.className = "input-q card";
      div.setAttribute("data-no", q.no);

      var head = document.createElement("div");
      head.className = "input-q-head";
      head.innerHTML = '<span class="input-q-no">' + (idx + 1) + '. No.' + q.no + '</span><span class="w-pos">' + escapeHtml(q.pos || "") + '</span>';
      div.appendChild(head);

      if (fmt === "cloze") {
        var w0 = wordByNo[q.no] || {};
        var blanked = blankSentence(w0.example, q.word);
        var sent = document.createElement("p");
        sent.className = "cloze-sentence";
        sent.textContent = blanked || "（例文中に語形が見つかりません。日本語訳と意味を手がかりに選んでください）";
        div.appendChild(sent);
        if (w0.exampleJa) {
          var ja = document.createElement("p");
          ja.className = "cloze-ja";
          ja.textContent = w0.exampleJa;
          div.appendChild(ja);
        }
        if (!blanked) {
          var hint = document.createElement("p");
          hint.className = "cloze-hint";
          hint.textContent = "意味: " + q.meaning;
          div.appendChild(hint);
        }
        var group = document.createElement("div");
        group.className = "choice-list";
        group.setAttribute("role", "radiogroup");
        group.setAttribute("aria-label", "選択肢");
        (q.choices || []).forEach(function (c) {
          var b = document.createElement("button");
          b.type = "button";
          b.className = "choice-btn";
          b.setAttribute("role", "radio");
          b.setAttribute("aria-checked", q.answer === c ? "true" : "false");
          b.textContent = c;
          b.addEventListener("click", function () {
            q.answer = c;
            Array.prototype.forEach.call(group.children, function (el) { el.setAttribute("aria-checked", el === b ? "true" : "false"); });
            saveInputDraft();
            updateTestProgress();
          });
          group.appendChild(b);
        });
        div.appendChild(group);
        wrap.appendChild(div);
        return;
      }

      var wordRow = document.createElement("div");
      wordRow.className = "input-q-word-row";
      if (fmt === "jaen") {
        var mSpan = document.createElement("span");
        mSpan.className = "jaen-meaning";
        mSpan.textContent = q.meaning;
        wordRow.appendChild(mSpan);
      } else {
        var wordSpan = document.createElement("span");
        wordSpan.className = "input-q-word";
        wordSpan.textContent = q.word;
        wordRow.appendChild(wordSpan);
        var sb = buildSpeakBtn(q.word);
        if (sb) wordRow.appendChild(sb);
      }
      div.appendChild(wordRow);

      var input = document.createElement("input");
      input.type = "text";
      input.className = "input-answer";
      input.setAttribute("aria-label", (fmt === "jaen" ? "英単語を入力: " + q.meaning : "回答: " + q.word));
      input.setAttribute("enterkeyhint", idx === qs.length - 1 ? "done" : "next");
      input.autocomplete = "off";
      if (fmt === "jaen") {
        input.lang = "en";
        input.placeholder = "英単語を入力";
        input.setAttribute("autocapitalize", "none");
        input.setAttribute("autocorrect", "off");
        input.spellcheck = false;
      } else {
        input.lang = "ja";
      }
      input.value = q.answer || "";
      input.addEventListener("input", function (e) { q.answer = e.target.value; saveInputDraft(); updateTestProgress(); });
      input.addEventListener("keydown", function (e) {
        if (e.key !== "Enter" && e.keyCode !== 13) return;
        if (e.isComposing || e.keyCode === 229) return;
        e.preventDefault();
        var nextInput = inputEls[idx + 1];
        if (nextInput) nextInput.focus(); else $("inputGradeBtn").click();
      });
      input.addEventListener("focus", function () {
        setTimeout(function () { if (input.scrollIntoView) input.scrollIntoView({ block: "center", inline: "nearest" }); }, 50);
      });
      inputEls.push(input);
      div.appendChild(input);
      wrap.appendChild(div);
    });

    if (autoFocus && inputEls.length) {
      var target = inputEls[0];
      for (var i = 0; i < inputEls.length; i++) {
        if (!(qs[i].answer || "").trim()) { target = inputEls[i]; break; }
      }
      setTimeout(function () { target.focus(); }, 0);
    }
  }

  function saveInputDraft() {
    if (state.test.phase !== "inputTest") return;
    var payload = {
      settings: {
        format: state.test.runFormat,
        review: !!state.test.review,
        ranges: state.test.allRanges ? ["ALL"] : state.test.selectedRanges.slice(),
        unlearnedOnly: state.test.unlearnedOnly,
        flaggedOnly: !!state.test.flaggedOnly,
        count: state.test.count
      },
      activeCycleKey: state.test.activeCycleKey,
      activeCycleLap: state.test.activeCycleLap,
      questions: state.test.inputQuestions.map(function (q) {
        var o = { no: q.no, word: q.word, pos: q.pos, meaning: q.meaning, answer: q.answer };
        if (q.choices) o.choices = q.choices;
        return o;
      })
    };
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(payload)); } catch (e) {}
  }
  function clearInputDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch (e) {} }
  function loadInputDraft() {
    var raw;
    try { raw = localStorage.getItem(DRAFT_KEY); } catch (e) { return null; }
    if (!raw) return null;
    try {
      var parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.questions) || !parsed.questions.length) return null;
      // 単語データと一致しない問題が混ざる下書きは破棄する
      var ok = parsed.questions.every(function (q) { return q && wordByNo[q.no] && wordByNo[q.no].word === q.word; });
      if (ok && parsed.settings && parsed.settings.format === "cloze") {
        ok = parsed.questions.every(function (q) {
          return Array.isArray(q.choices) && q.choices.length >= 2 && q.choices.indexOf(q.word) !== -1;
        });
      }
      return ok ? parsed : null;
    } catch (e) { return null; }
  }

  function tryResumeDraft() {
    var draft = loadInputDraft();
    if (!draft) return false;
    if (draft.settings) {
      var rs = draft.settings.ranges;
      if (rs && rs.indexOf("ALL") !== -1) { state.test.allRanges = true; state.test.selectedRanges = []; }
      else if (rs && rs.length) { state.test.allRanges = false; state.test.selectedRanges = rs.slice(); }
      if (typeof draft.settings.unlearnedOnly === "boolean") state.test.unlearnedOnly = draft.settings.unlearnedOnly;
      state.test.flaggedOnly = draft.settings.flaggedOnly === true;
      if (draft.settings.count) state.test.count = draft.settings.count;
    }
    state.test.activeCycleKey = draft.activeCycleKey ? normalizeCycleKey(draft.activeCycleKey) : null;
    state.test.activeCycleLap = draft.activeCycleLap || null;
    state.test.runFormat = validFormat(draft.settings && draft.settings.format);
    state.test.format = state.test.runFormat;
    state.test.review = !!(draft.settings && draft.settings.review);
    state.test.inputQuestions = draft.questions.map(function (q) {
      var o = { no: q.no, word: q.word, pos: q.pos, meaning: q.meaning, answer: q.answer || "" };
      if (state.test.runFormat === "cloze") o.choices = q.choices.slice();
      return o;
    });
    state.test.phase = "inputTest";
    updateTestPhaseVisibility();
    renderInputTest(true, true);
    return true;
  }

  function computeInputStats(results) {
    var total = results.length;
    var good = results.filter(function (r) { return r.verdict === "correct" || r.verdict === "close"; }).length;
    return { total: total, good: good, acc: total ? Math.round((good / total) * 100) : 0 };
  }
  function showAiNote(show, message, busy) {
    var el = $("inputAiNote");
    el.style.display = show ? "" : "none";
    el.classList.toggle("busy", !!(show && busy));
    if (show) el.textContent = message || "AI判定は使えませんでした";
  }

  function sessionItemFrom(r) {
    var w = wordByNo[r.no];
    return {
      no: r.no, word: r.word, meaning: r.meaning, pos: r.pos || (w ? w.pos : ""),
      mark: r.verdict === "wrong" ? "×" : "○", answer: r.answer || "", verdict: r.verdict
    };
  }

  function abortInputTest() {
    var qs = state.test.inputQuestions;
    var answered = qs.filter(function (q) { return (q.answer || "").trim() !== ""; });
    var unanswered = qs.filter(function (q) { return (q.answer || "").trim() === ""; });
    var wrongNos = [];
    if (answered.length) {
      var correctCount = 0;
      var items = answered.map(function (q) {
        var g = gradeQuestion(q, state.test.runFormat);
        var wrong = g.verdict === "wrong";
        if (buildsMastery()) { appendHistory(q.no, wrong ? "×" : "○"); setLearned(q.no, !wrong); }
        if (wrong) wrongNos.push(q.no); else correctCount++;
        return sessionItemFrom({ no: q.no, word: q.word, meaning: q.meaning, pos: q.pos, answer: q.answer, verdict: g.verdict });
      });
      addSession({
        id: makeSessionId(), source: "app", type: state.test.runFormat, at: new Date().toISOString(),
        ranges: sessionRangesFromNos(answered.map(function (q) { return q.no; })),
        total: answered.length, correct: correctCount,
        cycleKey: state.test.activeCycleKey || null, lap: state.test.activeCycleLap || null,
        items: items
      });
    }
    reconcileCycleAfterTest(
      state.test.activeCycleKey,
      answered.map(function (q) { return q.no; }),
      wrongNos,
      unanswered.map(function (q) { return q.no; })
    );
    state.test.activeCycleKey = null;
    clearInputDraft();
    state.test.phase = "setup";
    renderTestSetup();
    showToast(answered.length ? "テストを中断しました（回答した分は記録しました）" : "テストを中断しました");
  }

  function refreshResultCards() {
    if (state.test.phase === "inputResult") renderInputResult();
  }

  function buildResultItemCard(item) {
    var div = document.createElement("div");
    div.className = "input-result-item card";
    div.setAttribute("data-no", item.no);
    var answerText = (item.answer && String(item.answer).trim() !== "") ? item.answer : "（未回答）";

    var head = document.createElement("div");
    head.className = "ir-head";
    head.innerHTML = '<span class="ir-no">No.' + item.no + '</span><span class="ir-word">' + escapeHtml(item.word) + '</span>';
    var sb = buildSpeakBtn(item.word);
    if (sb) head.appendChild(sb);
    div.appendChild(head);

    var fmt = state.test.runFormat;
    var lines = '<div class="ir-line"><span class="ir-lbl">回答</span><span class="ir-val">' + escapeHtml(answerText) + '</span></div>';
    if (fmt === "input") {
      lines += '<div class="ir-line"><span class="ir-lbl">正しい意味</span><span class="ir-val">' + escapeHtml(item.meaning) + '</span></div>';
    } else {
      lines += '<div class="ir-line"><span class="ir-lbl">正解</span><span class="ir-val">' + escapeHtml(item.word) + '</span></div>' +
        '<div class="ir-line"><span class="ir-lbl">意味</span><span class="ir-val">' + escapeHtml(item.meaning) + '</span></div>';
    }
    var rest = document.createElement("div");
    rest.innerHTML = lines +
      '<div class="verdict ' + (VERDICT_CLASSES[item.verdict] || "v-wrong") + '">' + (VERDICT_LABELS[item.verdict] || "不正解") + '</div>' +
      '<div class="btn-row" style="margin-top:0;">' +
      '<button type="button" class="btn btn-mark-correct">正解にする</button>' +
      '<button type="button" class="btn btn-mark-wrong">不正解にする</button></div>';
    while (rest.firstChild) div.appendChild(rest.firstChild);
    div.querySelector(".btn-mark-correct").addEventListener("click", function () { manualSetVerdict(item.no, "correct"); });
    div.querySelector(".btn-mark-wrong").addEventListener("click", function () { manualSetVerdict(item.no, "wrong"); });

    var w = wordByNo[item.no];
    if (w && w.example) {
      var ex = document.createElement("div");
      ex.className = "detail-line";
      ex.innerHTML = '<span class="detail-label">例文</span><p>' + escapeHtml(w.example) + '</p>' +
        (w.exampleJa ? '<p class="ja">' + escapeHtml(w.exampleJa) + '</p>' : "");
      div.appendChild(ex);
    }
    var tipLine = document.createElement("div");
    tipLine.className = "detail-line";
    renderTipBlockInto(tipLine, item.no, state.test, refreshResultCards);
    div.appendChild(tipLine);

    var learnedLabel = document.createElement("label");
    learnedLabel.className = "check-label";
    learnedLabel.style.marginTop = "10px";
    learnedLabel.innerHTML = '<input type="checkbox"' + (isLearned(item.no) ? " checked" : "") + '>覚えた';
    learnedLabel.querySelector("input").addEventListener("change", function (e) {
      setLearned(item.no, e.target.checked);
      showToast(e.target.checked ? "「" + item.word + "」を覚えた に追加しました" : "「" + item.word + "」のチェックを外しました");
    });
    div.appendChild(learnedLabel);
    return div;
  }

  var CONFETTI_THRESHOLD = 80; // 正答率(%)がこの値以上なら紙吹雪

  // opts.graded: 採点直後（不正解カードをシェイク、高得点ならスプリング+紙吹雪） / opts.shakeNo: 手動で不正解にした1件だけシェイク
  function renderInputResult(opts) {
    opts = opts || {};
    var results = state.test.inputResults;
    var stats = computeInputStats(results);
    $("inputResultAccuracy").textContent = stats.acc + "%";
    $("inputResultCorrect").textContent = stats.good + " / " + stats.total;
    var listWrap = $("inputResultList");
    listWrap.innerHTML = "";
    var shakeIdx = 0, canMove = !reduceMotion();
    results.forEach(function (r) {
      var card = buildResultItemCard(r);
      if (canMove && r.verdict === "wrong" && (opts.graded || opts.shakeNo === r.no)) {
        card.style.setProperty("--i", Math.min(shakeIdx++, 5));
        card.classList.add("shake");
        card.addEventListener("animationend", function () { card.classList.remove("shake"); }, { once: true });
      }
      listWrap.appendChild(card);
    });

    var celebrate = !!opts.graded && stats.total > 0 && stats.acc >= CONFETTI_THRESHOLD;
    Array.prototype.forEach.call(document.querySelectorAll("#inputResult .result-stat"), function (el) {
      el.classList.remove("spring");
      if (celebrate && canMove) {
        void el.offsetWidth;
        el.classList.add("spring");
        el.addEventListener("animationend", function () { el.classList.remove("spring"); }, { once: true });
      }
    });
    if (celebrate) launchConfetti();
  }

  function syncCurrentInputSessionScore() {
    var session = state.test.currentInputSession;
    if (!session) return;
    session.correct = computeInputStats(state.test.inputResults).good;
    saveProgress();
  }

  function setResultVerdict(r, newVerdict) {
    var wasWrong = r.verdict === "wrong";
    var isWrong = newVerdict === "wrong";
    r.verdict = newVerdict;
    if (buildsMastery()) {
      rewriteLastHistoryMark(r.no, isWrong ? "×" : "○");
      setLearned(r.no, !isWrong);
    }
    var session = state.test.currentInputSession;
    if (session) {
      var it = (session.items || []).filter(function (x) { return x.no === r.no; })[0];
      if (it) { it.verdict = newVerdict; it.mark = isWrong ? "×" : "○"; }
      adjustCycleForVerdictChange(session.cycleKey, session.lap, r.no, wasWrong, isWrong);
    }
  }

  function manualSetVerdict(no, newVerdict) {
    var r = state.test.inputResults.filter(function (x) { return x.no === no; })[0];
    if (!r || r.verdict === newVerdict) return;
    r.manual = true;
    setResultVerdict(r, newVerdict);
    syncCurrentInputSessionScore();
    renderInputResult({ shakeNo: newVerdict === "wrong" ? no : null });
  }

  function gradeInputTest() {
    showAiNote(false);
    var confirmedNos = [], wrongNos = [];
    var results = state.test.inputQuestions.map(function (q) {
      var g = gradeQuestion(q, state.test.runFormat);
      var wrong = g.verdict === "wrong";
      if (buildsMastery()) { appendHistory(q.no, wrong ? "×" : "○"); setLearned(q.no, !wrong); }
      confirmedNos.push(q.no);
      if (wrong) wrongNos.push(q.no);
      return { no: q.no, word: q.word, pos: q.pos, meaning: q.meaning, answer: q.answer, verdict: g.verdict };
    });
    state.test.inputResults = results;
    state.test.phase = "inputResult";
    clearInputDraft();
    var stats = computeInputStats(results);
    var key = state.test.activeCycleKey, lap = state.test.activeCycleLap;
    state.test.currentInputSession = addSession({
      id: makeSessionId(), source: "app", type: state.test.runFormat, at: new Date().toISOString(),
      ranges: sessionRangesFromNos(results.map(function (r) { return r.no; })),
      total: stats.total, correct: stats.good,
      cycleKey: key || null, lap: lap || null,
      items: results.map(sessionItemFrom)
    });
    reconcileCycleAfterTest(key, confirmedNos, wrongNos, []);
    updateTestPhaseVisibility();
    window.scrollTo(0, 0);
    renderInputResult({ graded: true });
    if (lastSaveOk) showToast(stats.acc >= CONFETTI_THRESHOLD ? "お見事！記録を保存しました" : "記録を保存しました");
    if (state.test.runFormat === "input") maybeRunAiCheck(results); // AI再判定は意味の入力テスト専用
  }

  $("inputGradeBtn").addEventListener("click", gradeInputTest);
  $("continueInputBtn").addEventListener("click", startWithLoading);
  $("backToSetupInputBtn").addEventListener("click", function () {
    state.test.phase = "setup";
    renderTestSetup();
  });
  $("abortInputBtn").addEventListener("click", function () {
    if (!window.confirm("テストを中断しますか？")) return;
    abortInputTest();
  });

  // ---------- AI再判定（OpenAI・任意） ----------
  function openaiKey() { try { return localStorage.getItem(OPENAI_KEY) || ""; } catch (e) { return ""; } }

  function buildAiPrompt(items) {
    var lines = items.map(function (it, idx) {
      return (idx + 1) + ". word: " + it.word + " / official meaning: " + it.meaning + " / user answer: " + it.answer;
    });
    return "以下は英単語テストの採点結果です。各項目について、ユーザーの回答(user answer)が、その単語の公式な意味(official meaning)として妥当かどうかを判定してください。" +
      "厳密な完全一致でなくても、意味的に正しい、または許容できる言い換え・類義語であれば妥当とみなしてください。" +
      "次のJSON形式で、項目数と順序を保ったまま回答してください（説明文は不要です）: " +
      "{\"results\":[{\"index\": 1, \"acceptable\": true}, ...]}\n\n" + lines.join("\n");
  }

  function callOpenAI(apiKey, promptText) {
    return fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: "system", content: "あなたは英単語テストの採点補助です。指定されたJSONだけを返してください。" },
          { role: "user", content: promptText }
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: 400,
        reasoning_effort: "none"
      })
    }).then(function (res) {
      if (!res.ok) { var err = new Error("openai http " + res.status); err.status = res.status; throw err; }
      return res.json();
    }).then(function (data) {
      var text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      return JSON.parse(text);
    });
  }

  function aiFailMessage(e) {
    var status = e && e.status;
    if (status === 401) return "APIキーが正しくありません（OpenAIで有効か確認して入れ直してください）";
    if (status === 429) return "APIの利用上限か残高不足です";
    return "AI判定は使えませんでした";
  }

  function applyAiResults(parsed, items) {
    var list = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.results) ? parsed.results : null);
    if (!list) { showAiNote(true); return; }
    showAiNote(false);
    list.forEach(function (entry) {
      if (!entry || typeof entry.index !== "number" || entry.acceptable !== true) return;
      var item = items[entry.index - 1];
      if (!item) return;
      var r = state.test.inputResults.filter(function (x) { return x.no === item.no; })[0];
      if (r && r.verdict === "wrong" && !r.manual) {   // 手動で変更した判定は上書きしない
        r.aiChecked = true;
        setResultVerdict(r, "correct");
      }
    });
    syncCurrentInputSessionScore();
    if (state.test.phase === "inputResult") renderInputResult();
  }

  function maybeRunAiCheck(results) {
    var wrongs = results.filter(function (r) { return r.verdict === "wrong"; });
    if (!wrongs.length) return;
    var key = openaiKey();
    if (!key) { showAiNote(true, "設定でOpenAIのAPIキーを入れると、不正解の回答をAIが再確認します"); return; }
    var items = wrongs.map(function (r) { return { no: r.no, word: r.word, answer: r.answer || "", meaning: r.meaning }; });
    var session = state.test.currentInputSession;
    showAiNote(true, "AIが不正解の回答を確認しています…", true);
    callOpenAI(key, buildAiPrompt(items)).then(function (parsed) {
      // 結果が返る前に別のテストへ移っていたら反映しない
      if (state.test.currentInputSession !== session) return;
      applyAiResults(parsed, items);
    }).catch(function (e) {
      if (state.test.currentInputSession === session) showAiNote(true, aiFailMessage(e));
    });
  }

  function refreshOpenaiKeyUI() {
    var hasKey = !!openaiKey();
    var input = $("openaiKeyInput");
    input.placeholder = hasKey ? "保存済み" : "APIキーを入力";
    input.value = "";
    $("openaiKeyDeleteBtn").style.display = hasKey ? "" : "none";
    $("openaiKeyStatus").textContent = hasKey ? "保存済みのキーがあります" : "未設定です（なくても動作します）";
  }
  $("openaiKeySaveBtn").addEventListener("click", function () {
    var v = $("openaiKeyInput").value.trim();
    if (!v) return;
    try { localStorage.setItem(OPENAI_KEY, v); } catch (e) {}
    refreshOpenaiKeyUI();
    showToast("APIキーを保存しました");
  });
  $("openaiKeyDeleteBtn").addEventListener("click", function () {
    try { localStorage.removeItem(OPENAI_KEY); } catch (e) {}
    refreshOpenaiKeyUI();
    showToast("APIキーを削除しました");
  });

  // ---------- 進み具合 ----------
  function renderProgress() {
    renderStudyStats();
    var totalLearned = ALL_WORDS.filter(function (w) { return isLearned(w.no); }).length;
    $("progOverallText").textContent = totalLearned + " / " + ALL_WORDS.length;
    $("progOverallBar").style.width = (ALL_WORDS.length ? totalLearned / ALL_WORDS.length * 100 : 0) + "%";

    var learnedWrap = $("progRangeLearned");
    learnedWrap.innerHTML = "";
    RANGES.forEach(function (r) {
      var words = wordsInRange(r);
      var learned = words.filter(function (w) { return isLearned(w.no); }).length;
      var pct = words.length ? learned / words.length * 100 : 0;
      var block = document.createElement("div");
      block.className = "range-progress-block";
      block.innerHTML =
        '<div class="bar-row" style="margin-bottom:0;">' +
        '<div class="bar-label"><span class="nm">' + rangeLabel(r) + ' (No.' + r + ')</span><span class="vv">チェック済み ' + learned + ' / ' + words.length + '</span></div>' +
        '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%"></div></div></div>' +
        '<div class="range-sub-rows"><div class="range-sub-row">未チェック: <b>' + (words.length - learned) + ' / ' + words.length + '語</b></div>' +
        cycleGroupHtml(r, "unchecked", "未チェックの周回") +
        cycleGroupHtml(r, "all", "全部の周回") + '</div>';
      learnedWrap.appendChild(block);
    });

    var accWrap = $("progRangeAccuracy");
    accWrap.innerHTML = "";
    RANGES.forEach(function (r) {
      var totalMarks = 0, correctMarks = 0;
      wordsInRange(r).forEach(function (w) {
        var h = getHistory(w.no);
        for (var i = 0; i < h.length; i++) { totalMarks++; if (h.charAt(i) === "○") correctMarks++; }
      });
      var row = document.createElement("div");
      row.className = "bar-row";
      var acc = totalMarks ? Math.round(correctMarks / totalMarks * 100) : 0;
      row.innerHTML = '<div class="bar-label"><span class="nm">' + rangeLabel(r) + ' (No.' + r + ')</span><span class="vv">' +
        (totalMarks ? acc + '%（' + correctMarks + '/' + totalMarks + '）' : 'まだなし') + '</span></div>' +
        '<div class="bar-track"><div class="bar-fill acc" style="width:' + acc + '%"></div></div>';
      accWrap.appendChild(row);
    });

    renderCalendar();
    renderSessionList();
  }

  function sessionTimestamp(s) {
    var t = s.at ? Date.parse(s.at) : NaN;
    return isNaN(t) ? -Infinity : t;
  }
  function sessionLabel(s) {
    var ranges = (s.ranges && s.ranges.length) ? s.ranges.map(function (r) { return RANGES.indexOf(r) >= 0 ? rangeLabel(r) : r; }).join("・") : "";
    return (ranges ? ranges + " ・ " : "") + (FORMAT_SESSION_LABELS[s.type] || s.type || "");
  }
  function pad2(n) { return String(n).padStart(2, "0"); }
  function sessionDateLabel(s) {
    if (s.at) {
      var d = new Date(s.at);
      if (!isNaN(d.getTime())) return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
    }
    return "日付不明";
  }
  function scoreText(s) {
    return (typeof s.correct === "number" && typeof s.total === "number") ? s.correct + " / " + s.total : "正解数の記録なし";
  }
  function buildSessionDetailHtml(s) {
    if (!Array.isArray(s.items) || !s.items.length) {
      return '<p class="empty-msg" style="padding:10px 0;">この回の単語ごとの記録はありません</p>';
    }
    return '<div class="session-items">' + s.items.map(function (it) {
      var w = wordByNo[it.no];
      var ans = (it.answer && String(it.answer).trim() !== "") ? it.answer : "（未回答）";
      return '<div class="sess-item-row"><div><span class="sess-item-no">No.' + escapeHtml(it.no) + '</span>' +
        '<span class="sess-item-mark ' + (it.mark === "○" ? "hist-good" : "hist-bad") + '">' + escapeHtml(it.mark || "") + '</span>' +
        '<span class="sess-item-word">' + escapeHtml(it.word || (w ? w.word : "")) + '</span></div>' +
        '<div class="sess-item-meaning">' + escapeHtml(it.meaning || (w ? w.meaning : "")) + '</div>' +
        '<div class="sess-item-answer">回答: ' + escapeHtml(ans) + '</div></div>';
    }).join("") + '</div>';
  }

  // 学習カレンダー（Asia/Tokyo）
  var TOKYO_DATE_FMT = (function () {
    try { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }); }
    catch (e) { return null; }
  })();
  function tokyoDateKeyFromDate(d) {
    if (!TOKYO_DATE_FMT || isNaN(d.getTime())) return null;
    return TOKYO_DATE_FMT.format(d);
  }
  function tokyoTodayKey() { return tokyoDateKeyFromDate(new Date()); }
  function sessionDateKeyFor(s) {
    if (s && s.at) { var d = new Date(s.at); if (!isNaN(d.getTime())) return tokyoDateKeyFromDate(d); }
    return null;
  }
  function buildSessionDayMap() {
    var map = {}, unknownCount = 0;
    progress.sessions.forEach(function (s) {
      var key = sessionDateKeyFor(s);
      if (!key) { unknownCount++; return; }
      if (!map[key]) map[key] = { sessions: [], totalItems: 0 };
      map[key].sessions.push(s);
      map[key].totalItems += (typeof s.total === "number") ? s.total : (Array.isArray(s.items) ? s.items.length : 0);
    });
    return { map: map, unknownCount: unknownCount };
  }
  function calDotsCount(n) { return n <= 0 ? 0 : (n < 10 ? 1 : (n < 20 ? 2 : 3)); }
  function addDaysToKey(key, delta) {
    var p = key.split("-").map(Number);
    var d = new Date(p[0], p[1] - 1, p[2]);
    d.setDate(d.getDate() + delta);
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  function computeStreak(dayMap, todayKey) {
    if (!todayKey) return 0;
    // テスト記録のある日 + 「覚えた」を付けた日（progress.days）のどちらも学習日として数える
    var isDay = function (k) { return !!dayMap.map[k] || !!(progress.days && progress.days[k] && progress.days[k].length); };
    var cur = isDay(todayKey) ? todayKey : addDaysToKey(todayKey, -1);
    var streak = 0;
    while (isDay(cur)) { streak++; cur = addDaysToKey(cur, -1); }
    return streak;
  }

  function renderCalendarDayDetail(dayMap) {
    var wrap = $("calDayDetail");
    var cs = state.progress.calendar;
    if (!cs.selectedDate || !dayMap.map[cs.selectedDate]) { wrap.innerHTML = ""; return; }
    var sessions = dayMap.map[cs.selectedDate].sessions.slice().sort(function (a, b) { return sessionTimestamp(b) - sessionTimestamp(a); });
    var html = '<h3>' + escapeHtml(cs.selectedDate) + 'の記録</h3><ul class="session-list">';
    sessions.forEach(function (s, idx) {
      var sid = "cal-" + cs.selectedDate + "-" + idx;
      html += '<li class="session-item"><div class="session-main-wrap" data-sid="' + sid + '"><div class="session-main"><span class="session-label">' +
        escapeHtml(sessionLabel(s)) + '</span><span class="session-score">' + escapeHtml(scoreText(s)) + '</span></div></div>';
      if (state.progress.expandedSessions[sid]) html += '<div class="session-detail">' + buildSessionDetailHtml(s) + '</div>';
      html += '</li>';
    });
    wrap.innerHTML = html + '</ul>';
    Array.prototype.forEach.call(wrap.querySelectorAll(".session-main-wrap"), function (el) {
      el.addEventListener("click", function () {
        var sid = el.getAttribute("data-sid");
        state.progress.expandedSessions[sid] = !state.progress.expandedSessions[sid];
        renderCalendarDayDetail(dayMap);
      });
    });
  }

  function renderCalendar() {
    if (!state.progress.calendar) {
      var tp = (tokyoTodayKey() || "1970-01-01").split("-");
      state.progress.calendar = { year: parseInt(tp[0], 10), month: parseInt(tp[1], 10), selectedDate: null };
    }
    var cs = state.progress.calendar;
    var dayMap = buildSessionDayMap();
    var todayKey = tokyoTodayKey();
    $("calTitle").textContent = cs.year + "年" + cs.month + "月";
    $("calWeekdays").innerHTML = ["日", "月", "火", "水", "木", "金", "土"].map(function (n) {
      return '<div class="cal-weekday">' + n + '</div>';
    }).join("");

    var grid = $("calGrid");
    grid.innerHTML = "";
    var firstWd = new Date(cs.year, cs.month - 1, 1).getDay();
    var numDays = new Date(cs.year, cs.month, 0).getDate();
    var monthDays = 0;
    for (var i = 0; i < firstWd; i++) {
      var padEl = document.createElement("div");
      padEl.className = "cal-cell is-pad";
      grid.appendChild(padEl);
    }
    for (var day = 1; day <= numDays; day++) {
      var key = cs.year + "-" + pad2(cs.month) + "-" + pad2(day);
      var info = dayMap.map[key];
      if (info) monthDays++;
      var cell = document.createElement(info ? "button" : "div");
      if (info) cell.type = "button";
      cell.className = "cal-cell" + (info ? " has-data" : "") + (key === todayKey ? " is-today" : "") + (cs.selectedDate === key ? " is-selected" : "");
      var dots = "";
      if (info) for (var di = 0; di < calDotsCount(info.totalItems); di++) dots += '<span class="cal-dot"></span>';
      cell.innerHTML = '<span class="cal-daynum">' + day + '</span>' + (dots ? '<div class="cal-dots">' + dots + '</div>' : "");
      if (info) {
        cell.setAttribute("aria-label", key + "の記録を見る");
        cell.addEventListener("click", (function (k) {
          return function () { cs.selectedDate = (cs.selectedDate === k) ? null : k; renderCalendar(); };
        })(key));
      }
      grid.appendChild(cell);
    }
    $("calSummary").innerHTML =
      '<span>表示中の月の学習日数: <b>' + monthDays + '日</b></span>' +
      '<span>連続学習日数: <b>' + computeStreak(dayMap, todayKey) + '日</b></span>';
    var unknownEl = $("calUnknownMsg");
    unknownEl.style.display = dayMap.unknownCount > 0 ? "" : "none";
    if (dayMap.unknownCount > 0) unknownEl.textContent = "日付不明の記録が" + dayMap.unknownCount + "件あります";
    renderCalendarDayDetail(dayMap);
  }

  $("calPrevBtn").addEventListener("click", function () {
    var cs = state.progress.calendar;
    cs.month -= 1;
    if (cs.month < 1) { cs.month = 12; cs.year -= 1; }
    cs.selectedDate = null;
    renderCalendar();
  });
  $("calNextBtn").addEventListener("click", function () {
    var cs = state.progress.calendar;
    cs.month += 1;
    if (cs.month > 12) { cs.month = 1; cs.year += 1; }
    cs.selectedDate = null;
    renderCalendar();
  });

  function renderSessionList() {
    var wrap = $("progSessionList");
    var sessions = progress.sessions.slice().sort(function (a, b) { return sessionTimestamp(b) - sessionTimestamp(a); });
    wrap.innerHTML = "";
    if (!sessions.length) {
      wrap.innerHTML = '<p class="empty-msg" style="padding:12px 0;">まだ記録がありません</p>';
      return;
    }
    var ul = document.createElement("ul");
    ul.className = "session-list";
    sessions.forEach(function (s, idx) {
      var sid = s.id || ("idx-" + idx);
      var li = document.createElement("li");
      li.className = "session-item";
      var main = document.createElement("div");
      main.className = "session-main-wrap";
      main.innerHTML = '<div class="session-date">' + escapeHtml(sessionDateLabel(s)) + '</div>' +
        '<div class="session-main"><span class="session-label">' + escapeHtml(sessionLabel(s)) + '</span>' +
        '<span class="session-score">' + escapeHtml(scoreText(s)) + '</span></div>';
      main.addEventListener("click", function () {
        state.progress.expandedSessions[sid] = !state.progress.expandedSessions[sid];
        renderSessionList();
      });
      li.appendChild(main);
      if (state.progress.expandedSessions[sid]) {
        var detail = document.createElement("div");
        detail.className = "session-detail";
        detail.innerHTML = buildSessionDetailHtml(s);
        li.appendChild(detail);
      }
      ul.appendChild(li);
    });
    wrap.appendChild(ul);
  }

  // ---------- 設定 ----------
  $("themeSeg").addEventListener("click", function (e) {
    var btn = e.target.closest(".seg-btn");
    if (!btn) return;
    try { localStorage.setItem(THEME_KEY, btn.getAttribute("data-theme-choice")); } catch (err) {}
    applyTheme();
  });

  $("exportBtn").addEventListener("click", function () {
    var blob = new Blob([JSON.stringify(progress, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    var d = new Date();
    a.href = url;
    a.download = "toeic_progress_" + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    showToast("進捗を書き出しました");
  });

  $("goalInput").addEventListener("change", function (e) {
    var v = parseInt(e.target.value, 10);
    if (!isFinite(v) || v < 1) { e.target.value = dailyGoal(); showToast("1〜500の数を入れてください"); return; }
    v = Math.min(500, v);
    progress.settings = { dailyGoal: v };
    saveProgress();
    e.target.value = v;
    renderStudyStats();
    showToast("1日の目標を" + v + "語にしました");
  });

  // 読み込み前の形の検証。問題があれば理由の文字列、無ければ null。
  function isPlainObject(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function validateImportShape(p) {
    if (!isPlainObject(p)) return "not an object";
    if (!isPlainObject(p.learned) || !isPlainObject(p.history)) return "learned/history missing";
    var lk = Object.keys(p.learned), hk = Object.keys(p.history);
    if (lk.some(function (k) { return typeof p.learned[k] !== "boolean"; })) return "learned values";
    if (hk.some(function (k) { return typeof p.history[k] !== "string"; })) return "history values";
    // 単語番号のキーが1つも当てはまらないファイルは別アプリのデータとみなす
    if ((lk.length || hk.length) && !lk.concat(hk).some(function (k) { return wordByNo[k]; })) return "no known word numbers";
    if (hasOwn(p, "sessions") && !Array.isArray(p.sessions)) return "sessions";
    if (hasOwn(p, "cycles") && !isPlainObject(p.cycles)) return "cycles";
    if (hasOwn(p, "tips") && !isPlainObject(p.tips)) return "tips";
    if (hasOwn(p, "days") && !isPlainObject(p.days)) return "days";
    if (hasOwn(p, "flags") && !isPlainObject(p.flags)) return "flags";
    if (hasOwn(p, "srs") && !isPlainObject(p.srs)) return "srs";
    if (hasOwn(p, "checkedAt") && !isPlainObject(p.checkedAt)) return "checkedAt";
    if (hasOwn(p, "settings") && !isPlainObject(p.settings)) return "settings";
    return null;
  }

  function showImportMsg(ok, text) {
    var msg = $("importMsg");
    msg.style.display = "";
    msg.className = "import-msg " + (ok ? "ok" : "err");
    msg.textContent = text;
  }

  $("importFile").addEventListener("change", function (e) {
    var file = e.target.files && e.target.files[0];
    var input = e.target;
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(String(reader.result));
        var problem = validateImportShape(parsed);
        if (problem) throw new Error(problem);
        var nLearned = Object.keys(parsed.learned).filter(function (k) { return parsed.learned[k] === true && wordByNo[k]; }).length;
        var nSessions = Array.isArray(parsed.sessions) ? parsed.sessions.length : 0;
        if (!window.confirm("今の進捗を、このファイルの内容（覚えた " + nLearned + "語・テスト記録 " + nSessions + "回）で置き換えます。元に戻せません。よろしいですか？")) {
          showImportMsg(false, "読み込みをキャンセルしました。");
          return;
        }
        var prevSettings = progress.settings;
        progress = normalizeProgress(parsed);
        if (!parsed.settings) progress.settings = prevSettings; // 古い書き出しファイルには目標設定が無い
        saveProgress();
        clearInputDraft();
        state.test.phase = "setup";
        state.test.activeCycleKey = null;
        reconcileReservedOnLoad();
        showImportMsg(true, "読み込みました");
        renderAll();
        showToast("進捗を読み込みました");
      } catch (err) {
        showImportMsg(false, "読み込みに失敗しました。ファイルの形式を確認してください。");
        showToast("読み込みに失敗しました");
      }
    };
    reader.onerror = function () { showImportMsg(false, "ファイルを読み込めませんでした。"); showToast("読み込みに失敗しました"); };
    reader.readAsText(file);
    input.value = "";
  });

  $("resetBtn").addEventListener("click", function () {
    if (!window.confirm("学習記録をすべて消して最初の状態に戻します。よろしいですか？")) return;
    var keptTips = progress.tips;
    progress = normalizeProgress({ tips: keptTips, settings: progress.settings, flags: progress.flags });
    saveProgress();
    clearInputDraft();
    state.test.phase = "setup";
    state.test.activeCycleKey = null;
    state.progress.expandedSessions = {};
    renderAll();
    showToast("学習記録をリセットしました");
  });

  function renderAll() {
    renderStudyStats();
    $("goalInput").value = dailyGoal();
    renderList();
    renderFlipChips();
    flipBuildDeck();
    renderTestSetup();
    renderProgress();
  }

  // ---------- キーボード表示中はタブバーを隠す ----------
  (function () {
    var tabbarEl = $("tabbar");
    function isFormFocused() {
      var el = document.activeElement;
      if (!el) return false;
      if (el.tagName === "TEXTAREA") return true;
      if (el.tagName === "INPUT") return el.type !== "checkbox" && el.type !== "radio";
      return false;
    }
    function keyboardLikelyOpen() {
      if (!window.visualViewport) return false;
      return ((document.documentElement.clientHeight || window.innerHeight) - window.visualViewport.height) > 80;
    }
    function update() { tabbarEl.classList.toggle("is-hidden", isFormFocused() || keyboardLikelyOpen()); }
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", function () { setTimeout(update, 0); });
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", update);
      window.visualViewport.addEventListener("scroll", update);
    }
    window.addEventListener("resize", update);
  })();

  // ---------- ダブルタップ拡大の抑止（入力欄は除外） ----------
  (function () {
    var lastTouchEnd = 0;
    function editable(el) {
      if (!el) return false;
      var t = el.tagName;
      return t === "INPUT" || t === "TEXTAREA" || t === "SELECT" || el.isContentEditable;
    }
    document.addEventListener("touchend", function (e) {
      if (editable(e.target)) return;
      var now = Date.now();
      if (now - lastTouchEnd <= 300) e.preventDefault();
      lastTouchEnd = now;
    }, { passive: false });
    document.addEventListener("dblclick", function (e) { if (!editable(e.target)) e.preventDefault(); }, { passive: false });
  })();

  // ---------- 起動 ----------
  migrateLegacyTheme();
  loadProgress();
  reconcileReservedOnLoad();
  applyTheme();
  $("appbarSub").textContent = "TOEIC · " + ALL_WORDS.length + " WORDS";
  switchTab("list");
  booted = true; // 起動時の初回表示ではスタッガーしない
  flipBuildDeck();
  renderTestSetup();
  renderProgress();
  $("goalInput").value = dailyGoal();

  // ---------- PWA: Service Worker 登録（オフライン用。失敗しても通常動作） ----------
  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    });
  }
})();
