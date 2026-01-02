/**
 * Sentence Builder
 * - phrases.json を fetch して出題
 * - 単語バンクはシャッフル表示
 * - クリック順で回答エリアへ
 * - Backspace: 最後の1語を戻す / Esc: リセット
 * - 全語選択時に自動判定
 */

// ===== DOM =====
const el = {
  counter: document.getElementById("counter"),
  jaText: document.getElementById("jaText"),
  answer: document.getElementById("answerArea"),
  bank: document.getElementById("wordBank"),
  status: document.getElementById("status"),
  btnNext: document.getElementById("btnNext"),
  btnReset: document.getElementById("btnReset"),
  progressBar: document.getElementById("progressBar"),
  progressPct: document.getElementById("progressPct"),

};

// ===== State =====
let phrases = [];
let allPhrases = [];   // JSON全体
let currentCategory = "all";
let index = 0;
let current = null;

let correctWords = [];      // 正解の単語列
let shuffledWords = [];     // 表示用（シャッフル）
let answerWords = [];       // 回答（クリック順）

let usedBankIndices = [];   // 単語バンクで使用済みの index
let answerBankIndices = []; // 回答がどの bankIndex から来たか (取り消し用)

let wrongCount = 0;         // 現在の問題の間違い回数
let isShowingCorrectAnswer = false;  // 正解を表示中

// ===== Utilities =====
function speak(text) {
  if (!window.speechSynthesis) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US'; // 英語
  utterance.rate = 0.8; // 少しゆっくり
  return new Promise((resolve) => {
    utterance.onend = resolve;
    window.speechSynthesis.speak(utterance);
  });
}

function normalizeText(s) {
  return s.replace(/\s+/g, " ").trim();
}

function tokenize(text) {
  return normalizeText(text).split(" ");
}

function shuffle(array) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function setStatus(message, kind) {
  el.status.classList.remove("ok", "ng");
  if (kind) el.status.classList.add(kind);
  el.status.textContent = message;
}

function isWordUsedAtIndex(bankIndex) {
  return usedBankIndices.includes(bankIndex);
}

function updateProgress() {
  const total = Math.max(phrases.length, 1);
  const currentNo = Math.min(index + 1, total);
  const pct = Math.round((currentNo / total) * 100);

  if (el.progressBar) el.progressBar.style.width = `${pct}%`;
  if (el.progressPct) el.progressPct.textContent = `${pct}%`;
}

function flashAnswerArea(kind) {
  el.answer.classList.remove("flash-ok", "flash-ng");
  void el.answer.offsetWidth;
  el.answer.classList.add(kind === "ok" ? "flash-ok" : "flash-ng");
  setTimeout(() => {
    el.answer.classList.remove("flash-ok", "flash-ng");
  }, 220);
}


// ===== UI helpers (Bootstrap) =====
function showToast(id, options = {}) {
  const elToast = document.getElementById(id);
  if (!elToast || !window.bootstrap) return;
  const toast = bootstrap.Toast.getOrCreateInstance(elToast, {
    delay: options.delay ?? 1400,
  });
  toast.show();
}

function isMobile() {
  return window.matchMedia && window.matchMedia("(max-width: 576px)").matches;
}

// wordBank を mobile dock に移動（DOM は1つで運用）
function syncWordBankPlacement() {
  const bank = document.getElementById("wordBank");
  if (!bank) return;

  const dockBody = document.querySelector("#bankDockCollapse .bankDock__body");
  const desktopCard = document.querySelector(".bankDesktop .card-body");

  if (isMobile()) {
    // dock に移す（既に入っていたら何もしない）
    if (dockBody && bank.parentElement !== dockBody) {
      // placeholder を消す
      const ph = dockBody.querySelector(".bankDock__placeholder");
      if (ph) ph.remove();
      dockBody.appendChild(bank);
    }
  } else {
    // desktop 側に戻す
    if (desktopCard && bank.parentElement !== desktopCard) {
      desktopCard.appendChild(bank);
    }
  }
}

// dock の開閉に合わせて body にクラス付与（下余白調整）
function bindDockOpenState() {
  const collapseEl = document.getElementById("bankDockCollapse");
  if (!collapseEl || !window.bootstrap) return;

  collapseEl.addEventListener("shown.bs.collapse", () => {
    document.body.classList.add("bankdock-open");
  });
  collapseEl.addEventListener("hidden.bs.collapse", () => {
    document.body.classList.remove("bankdock-open");
  });
}

// ===== Render =====
function showCorrectAnswer() {
  // ユーザーの回答をクリアしてから正解を表示
  answerWords = [];
  usedBankIndices = [];
  answerBankIndices = [];

  isShowingCorrectAnswer = true;
  render();
}

function render() {
  el.counter.textContent = `${index + 1} / ${phrases.length}`;
  el.jaText.textContent = current?.ja ?? "-";

  // 回答エリア
  el.answer.innerHTML = "";
  if (isShowingCorrectAnswer) {
    // 正解表示中：正解のチップを表示し、ユーザーの回答と比較して色をつける
    correctWords.forEach((correctWord, i) => {
      const chip = document.createElement("div");
      chip.className = "chip chip--correct";
      chip.textContent = correctWord;

      // ユーザーの回答がこの位置まで一致したら色をつける
      if (i < answerWords.length && answerWords[i] === correctWord) {
        chip.classList.add("chip--matched");
      }

      el.answer.appendChild(chip);
    });
  } else {
    // 通常の回答表示
    answerWords.forEach((w, i) => {
      const chip = document.createElement("div");
      chip.className = "chip";
      chip.textContent = w;
      chip.title = "クリックで取り消し";
      chip.addEventListener("click", () => removeAnswerAt(i));
      el.answer.appendChild(chip);
    });
  }

  // 単語バンク
  el.bank.innerHTML = "";
  shuffledWords.forEach((w, bankIndex) => {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.textContent = w;

    const used = isWordUsedAtIndex(bankIndex);
    chip.setAttribute("aria-disabled", used ? "true" : "false");

    chip.addEventListener("click", () => {
      if (used) return;
      addWordFromBank(bankIndex);
    });

    el.bank.appendChild(chip);
  });

    updateProgress();
}

// ===== Game flow =====
function loadQuestion(i) {
  index = (i + phrases.length) % phrases.length;
  current = phrases[index];

  correctWords = tokenize(current.text);
  shuffledWords = shuffle(correctWords);

  answerWords = [];
  usedBankIndices = [];
  answerBankIndices = [];

  wrongCount = 0;  // 間違い回数をリセット
  isShowingCorrectAnswer = false;  // 正解表示フラグをリセット

  setStatus("Ready");
  render();
}

function addWordFromBank(bankIndex) {
  const selectedWord = shuffledWords[bankIndex];

  if (isShowingCorrectAnswer) {
    // 正解表示中：次の正解単語と一致するかチェック
    const nextCorrectIndex = answerWords.length;
    if (nextCorrectIndex >= correctWords.length || selectedWord !== correctWords[nextCorrectIndex]) {
      // 不一致：選ばない
      return;
    }
  }

  answerWords.push(selectedWord);
  answerBankIndices.push(bankIndex);
  usedBankIndices.push(bankIndex);

  if (isShowingCorrectAnswer) {
    // 正解表示中：全て選んだら正解かチェック
    if (answerWords.length === correctWords.length) {
      const user = normalizeText(answerWords.join(" "));
      const correct = normalizeText(correctWords.join(" "));
      if (user === correct) {
        // 正解：次の問題へ
        setStatus("Correct", "ok");
        showToast("toastCorrect", { delay: 700 });
        flashAnswerArea("ok");
        speak(correct).then(() => {
          next();
        });
      } else {
        // 不正解：リセット
        setStatus("Incorrect", "ng");
        showToast("toastIncorrect", { delay: 900 });
        flashAnswerArea("ng");
        setTimeout(() => {
          resetAnswer();
        }, 300);
      }
    } else {
      setStatus("...");
    }
  } else if (answerWords.length === correctWords.length) {
    judge();
  } else {
    setStatus("...");
  }
  render();
}

function removeAnswerAt(answerIndex) {
  const removedBankIndex = answerBankIndices[answerIndex];

  answerWords.splice(answerIndex, 1);
  answerBankIndices.splice(answerIndex, 1);

  usedBankIndices = usedBankIndices.filter(i => i !== removedBankIndex);

  setStatus("...");
  render();
}

function resetAnswer() {
  answerWords = [];
  usedBankIndices = [];
  answerBankIndices = [];
  setStatus("Reset");
  render();
}

function judge() {
  const user = normalizeText(answerWords.join(" "));
  const correct = normalizeText(correctWords.join(" "));

  if (user === correct) {
    setStatus("Correct", "ok");
    showToast("toastCorrect", { delay: 700 });
    flashAnswerArea("ok");
    speak(correct).then(() => {
      next();
    });

  } else {
    wrongCount++;
    if (wrongCount >= 2) {
      // 2回間違えたら正解を表示
      showCorrectAnswer();
      setStatus("Incorrect (showing answer)", "ng");
      showToast("toastIncorrect", { delay: 900 });

      // 正解表示後、手動で次へ進む（自動で進まない）
    } else {
      setStatus("Incorrect", "ng");
      showToast("toastIncorrect", { delay: 900 });
      flashAnswerArea("ng");

      // ❗ 不正解時：同じ問題をもう一度
      // 回答だけ初期化（問題文・単語順は維持）
      setTimeout(() => {
        resetAnswer();
      }, 300);
    }
  }
}

function next() {
  loadQuestion(index + 1);
}

function prev() {
  loadQuestion(index - 1);
}

// ===== Events =====
el.btnNext.addEventListener("click", next);
el.btnReset.addEventListener("click", resetAnswer);

window.addEventListener("keydown", (e) => {
  if (e.key === "Backspace") {
    if (answerWords.length > 0) {
      removeAnswerAt(answerWords.length - 1);
      e.preventDefault();
    }
  }
  if (e.key === "Escape") {
    resetAnswer();
  }
  if (e.key === "ArrowRight") {
    next();
  }
  if (e.key === "ArrowLeft") {
    prev();
  }
});

// ===== Init =====
async function init() {
  try {
    const res = await fetch("./phrases.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load JSON: ${res.status}`);
    const data = await res.json();

    if (!Array.isArray(data) || data.length === 0) {
      throw new Error("JSON is empty or invalid.");
    }

    allPhrases = data;
    phrases = allPhrases;
    loadQuestion(0);
    // --- mobile dock support ---
    syncWordBankPlacement();
    bindDockOpenState();
    window.addEventListener("resize", syncWordBankPlacement);

    // カテゴリを動的に生成
    populateCategorySelect();
  } catch (err) {
    el.jaText.textContent = "JSONの読み込みに失敗しました。";
    setStatus(String(err), "ng");
    console.error(err);
  }
}

init();

// ===== Category selection =====
function populateCategorySelect() {
  const categorySelect = document.getElementById("categorySelect");
  if (!categorySelect) return;

  // 既存のオプションをクリア（"すべて"以外）
  categorySelect.innerHTML = '<option value="all">すべて</option>';

  // JSONからユニークなcategoryを取得
  const categories = [...new Set(allPhrases.map(p => p.category))];

  categories.forEach(cat => {
    const option = document.createElement("option");
    option.value = cat;
    option.textContent = cat; // そのまま表示
    categorySelect.appendChild(option);
  });
}

const categorySelect = document.getElementById("categorySelect");

categorySelect.addEventListener("change", () => {
  currentCategory = categorySelect.value;

  if (currentCategory === "all") {
    phrases = allPhrases;
  } else {
    phrases = allPhrases.filter(
      p => p.category === currentCategory
    );
  }

  if (phrases.length === 0) {
    el.jaText.textContent = "このカテゴリには問題がありません。";
    setStatus("No questions", "ng");
    return;
  }

  loadQuestion(0);
});


