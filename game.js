// ─── Firebase ─────────────────────────────────────────────

const firebaseConfig = {
  apiKey:            'AIzaSyBUt4H04iNgr4zPg49e-A2KDWzNhSGafkw',
  authDomain:        'timegame-bb838.firebaseapp.com',
  databaseURL:       'https://timegame-bb838-default-rtdb.firebaseio.com',
  projectId:         'timegame-bb838',
  storageBucket:     'timegame-bb838.firebasestorage.app',
  messagingSenderId: '102710484907',
  appId:             '1:102710484907:web:1cdcb304aaea9d1ed7bcee',
};

const firebaseApp = firebase.initializeApp(firebaseConfig);
const db          = firebase.database();
const counterRef  = db.ref('globalSeconds');

counterRef.on('value', (snapshot) => {
  const total = snapshot.val() || 0;
  document.getElementById('global-value').textContent = total.toFixed(2) + 's';
});

function addToGlobalCounter(seconds) {
  counterRef.set(firebase.database.ServerValue.increment(seconds));
}

// ─── Constants ────────────────────────────────────────────

const DAILY_ROUNDS      = 5;
const MIN_TIME          = 1;
const MAX_TIME          = 25;
const COUNTDOWN_SECONDS = 3;
const STORAGE_KEY       = 'timeit_daily';

// ─── Mode & round state ───────────────────────────────────

let mode             = null;  // 'daily' | 'practice' | 'challenge'
let currentRound     = 0;
let roundScores      = [];
let seededTargets    = [];    // used for both daily and challenge modes

// ─── Per-round state ──────────────────────────────────────
//
// States: idle → countdown → active → result → idle
// Challenge adds: awaiting-opponent (after finishing all rounds)

let state          = 'idle';
let targetTime     = 0;
let startTime      = 0;
let countdownTimer = null;

// ─── Challenge state ──────────────────────────────────────

let challengeId      = null;  // Firebase key for this challenge
let challengeRef     = null;  // Firebase ref for this challenge
let myPlayerKey      = null;  // 'player1' or 'player2'
let opponentKey      = null;  // 'player2' or 'player1'
let challengeStarted = false; // prevents double-starting when both ready

// ─── DOM references ───────────────────────────────────────

const screens = {
  home:               document.getElementById('home-screen'),
  game:               document.getElementById('game-screen'),
  results:            document.getElementById('results-screen'),
  'challenge-lobby':  document.getElementById('challenge-lobby-screen'),
  'challenge-results':document.getElementById('challenge-results-screen'),
};

const box            = document.getElementById('game-box');
const roundIndicator = document.getElementById('round-indicator');
const targetSection  = document.getElementById('target-section');
const targetDisplay  = document.getElementById('target-display');
const countdown      = document.getElementById('countdown');
const message        = document.getElementById('message');
const resultBlock    = document.getElementById('result-block');
const resultYourTime = document.getElementById('result-your-time');
const resultDiff     = document.getElementById('result-diff');
const gameButtons    = document.getElementById('game-buttons');
const nextBtn        = document.getElementById('next-btn');
const homeBtnGame    = document.getElementById('home-btn-game');
const clickHint      = document.getElementById('click-hint');
const waitingOverlay = document.getElementById('waiting-overlay');

const roundsBody     = document.getElementById('rounds-body');
const totalValue     = document.getElementById('total-value');

// ─── Screen navigation ────────────────────────────────────

function showScreen(name) {
  Object.entries(screens).forEach(([key, el]) => {
    el.classList.toggle('hidden', key !== name);
  });
  waitingOverlay.classList.add('hidden');
}

function goHome() {
  if (challengeRef) {
    challengeRef.off(); // remove all Firebase listeners for this challenge
    challengeRef = null;
  }
  challengeId      = null;
  myPlayerKey      = null;
  opponentKey      = null;
  challengeStarted = false;
  mode             = null;
  state            = 'idle';
  // Clear challenge ID from URL without reloading
  window.history.replaceState({}, '', window.location.pathname);
  showScreen('home');
}

// ─── Helpers ──────────────────────────────────────────────

function formatSeconds(sec) {
  return sec.toFixed(2) + 's';
}

function randomTime() {
  const raw = Math.random() * (MAX_TIME - MIN_TIME) + MIN_TIME;
  return Math.round(raw * 100) / 100;
}

function grade(diff) {
  if (diff <= 0.25) return { label: 'Excellent!',     cls: 'good' };
  if (diff <= 0.75) return { label: 'Close!',         cls: 'ok'   };
  if (diff <= 2.00) return { label: 'Not bad.',       cls: 'ok'   };
  return              { label: 'Keep practicing.', cls: 'bad'  };
}

// ─── Seeded random number generator ──────────────────────

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateTargets(seed) {
  const rand = mulberry32(seed);
  return Array.from({ length: DAILY_ROUNDS }, () => {
    const raw = rand() * (MAX_TIME - MIN_TIME) + MIN_TIME;
    return Math.round(raw * 100) / 100;
  });
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

// ─── Daily save data (localStorage) ──────────────────────

function getDailySave() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
  catch { return {}; }
}

function saveDailyResult(scores) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ date: todayString(), scores }));
}

function hasPlayedTodaysDaily() {
  return getDailySave().date === todayString();
}

// ─── Mode entry points ────────────────────────────────────

function startDaily() {
  if (hasPlayedTodaysDaily()) {
    roundScores = getDailySave().scores;
    showDailyResults(true);
    return;
  }
  mode          = 'daily';
  currentRound  = 0;
  roundScores   = [];
  seededTargets = generateTargets(parseInt(todayString().replace(/-/g, ''), 10));
  showScreen('game');
  startRound();
}

function startPractice() {
  mode         = 'practice';
  currentRound = 0;
  showScreen('game');
  startRound();
}

// ─── Challenge — create (Player 1) ───────────────────────

function generateChallengeId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function createChallenge() {
  challengeId      = generateChallengeId();
  myPlayerKey      = 'player1';
  opponentKey      = 'player2';
  challengeStarted = false;
  const seed       = Math.floor(Math.random() * 2147483647);
  seededTargets    = generateTargets(seed);

  challengeRef = db.ref(`challenges/${challengeId}`);
  challengeRef.set({
    seed,
    player1: { joined: true,  ready: false },
    player2: { joined: false, ready: false },
  });

  showChallengeLobby();
}

// ─── Challenge — join (Player 2) ─────────────────────────

function joinChallenge(id) {
  challengeId  = id;
  myPlayerKey  = 'player2';
  opponentKey  = 'player1';
  challengeRef = db.ref(`challenges/${id}`);

  challengeRef.once('value', (snap) => {
    const data = snap.val();
    if (!data) { goHome(); return; }

    seededTargets = generateTargets(data.seed);

    // Mark player 2 as joined so P1's lobby updates
    challengeRef.child('player2/joined').set(true);

    showChallengeLobby();
  });
}

// ─── Challenge lobby ──────────────────────────────────────

function showChallengeLobby() {
  const isP1    = myPlayerKey === 'player1';
  const linkUrl = `${window.location.origin}${window.location.pathname}?c=${challengeId}`;

  document.getElementById('lobby-title').textContent =
    isP1 ? 'Challenge Created' : "You've been challenged!";

  document.getElementById('lobby-status').textContent =
    isP1 ? 'Waiting for opponent to join…' : 'Ready to play?';

  const linkRow = document.getElementById('lobby-link-row');
  if (isP1) {
    linkRow.classList.remove('hidden');
    document.getElementById('lobby-link-text').textContent = linkUrl;
  } else {
    linkRow.classList.add('hidden');
  }

  // Ready button: P2 can ready immediately; P1 must wait for P2 to join
  document.getElementById('lobby-ready-btn').disabled = isP1;

  showScreen('challenge-lobby');
  listenToChallenge();
}

function listenToChallenge() {
  if (!challengeRef) return;

  challengeRef.on('value', (snap) => {
    const data = snap.val();
    if (!data) return;

    const p1 = data.player1 || {};
    const p2 = data.player2 || {};

    // ── Lobby UI updates ──────────────────────────────────
    if (state === 'idle') {
      const opponentJoined = myPlayerKey === 'player1' ? p2.joined : p1.joined;
      const myReady        = data[myPlayerKey]?.ready;
      const oppReady       = data[opponentKey]?.ready;

      // Enable P1's Ready button once P2 has joined
      if (myPlayerKey === 'player1') {
        document.getElementById('lobby-ready-btn').disabled = !opponentJoined;
      }

      // Update status message
      const statusEl = document.getElementById('lobby-status');
      if (!opponentJoined) {
        statusEl.textContent = 'Waiting for opponent to join…';
      } else if (myReady && !oppReady) {
        statusEl.textContent = 'Waiting for opponent to ready up…';
      } else if (!myReady && oppReady) {
        statusEl.textContent = 'Opponent is ready! Ready up!';
      } else if (opponentJoined && !myReady) {
        statusEl.textContent = 'Opponent joined! Ready up!';
      }
    }

    // ── Start game when both are ready ────────────────────
    if (p1.ready && p2.ready && !challengeStarted) {
      challengeStarted = true;
      startChallengeRounds();
    }

    // ── Show results when both players have finished ──────
    if (state === 'awaiting-opponent') {
      const myScores  = data[myPlayerKey]?.scores;
      const oppScores = data[opponentKey]?.scores;
      if (myScores?.length === DAILY_ROUNDS && oppScores?.length === DAILY_ROUNDS) {
        showChallengeResults(data);
      }
    }
  });
}

function markReady() {
  if (!challengeRef || !myPlayerKey) return;
  document.getElementById('lobby-ready-btn').disabled = true;
  document.getElementById('lobby-status').textContent = 'Waiting for opponent to ready up…';
  challengeRef.child(`${myPlayerKey}/ready`).set(true);
}

// ─── Challenge game ───────────────────────────────────────

function startChallengeRounds() {
  mode         = 'challenge';
  currentRound = 0;
  roundScores  = [];
  showScreen('game');
  startRound();
}

// ─── Round lifecycle ──────────────────────────────────────

function startRound() {
  currentRound++;

  targetTime = (mode === 'daily' || mode === 'challenge')
    ? seededTargets[currentRound - 1]
    : randomTime();

  state = 'countdown';

  gameButtons.classList.remove('show');
  resultBlock.classList.remove('show');
  box.classList.remove('active');
  clickHint.style.display = 'none';
  countdown.textContent   = '';
  message.textContent     = 'Get ready…';

  roundIndicator.textContent = (mode === 'daily' || mode === 'challenge')
    ? `Round ${currentRound} of ${DAILY_ROUNDS}`
    : '';

  targetSection.style.display = 'flex';
  targetDisplay.textContent   = formatSeconds(targetTime);

  const steps = ['3', '2', '1'];
  let i = 0;
  countdown.textContent = steps[i];

  countdownTimer = setInterval(() => {
    i++;
    if (i < steps.length) {
      countdown.textContent = steps[i];
    } else {
      clearInterval(countdownTimer);
      countdown.textContent = '';
      activateRed();
    }
  }, 1000);
}

function activateRed() {
  state     = 'active';
  startTime = performance.now();
  box.classList.add('active');
  message.textContent     = '';
  clickHint.style.display = 'block';
}

function stopRound() {
  if (state !== 'active') return;

  const elapsed = (performance.now() - startTime) / 1000;
  const diff    = Math.abs(elapsed - targetTime);
  const sign    = elapsed > targetTime ? '+' : '-';
  state = 'result';

  box.classList.remove('active');
  clickHint.style.display = 'none';
  message.textContent     = `Target was ${formatSeconds(targetTime)}`;

  const { label, cls } = grade(diff);
  resultYourTime.textContent = formatSeconds(elapsed);
  resultDiff.textContent     = `${sign}${formatSeconds(diff)} — ${label}`;
  resultDiff.className       = cls;
  resultBlock.classList.add('show');

  // Both players contribute to the global counter
  addToGlobalCounter(COUNTDOWN_SECONDS + elapsed);

  if (mode === 'daily') {
    roundScores.push({ target: targetTime, elapsed, diff });
    if (roundScores.length === DAILY_ROUNDS) saveDailyResult(roundScores);
    handleDailyRoundEnd();
  } else if (mode === 'challenge') {
    roundScores.push({ target: targetTime, elapsed, diff });
    handleChallengeRoundEnd();
  } else {
    handlePracticeRoundEnd();
  }
}

// ─── Post-round logic ─────────────────────────────────────

function handleDailyRoundEnd() {
  const isLastRound = currentRound === DAILY_ROUNDS;
  nextBtn.textContent       = isLastRound ? 'See Results' : 'Next Round';
  homeBtnGame.style.display = 'none';
  gameButtons.classList.add('show');
  nextBtn.onclick = isLastRound ? () => showDailyResults() : startRound;
}

function handleChallengeRoundEnd() {
  const isLastRound = currentRound === DAILY_ROUNDS;

  if (!isLastRound) {
    nextBtn.textContent       = 'Next Round';
    homeBtnGame.style.display = 'none';
    gameButtons.classList.add('show');
    nextBtn.onclick = startRound;
  } else {
    // Save scores to Firebase then wait for opponent
    const total = roundScores.reduce((sum, r) => sum + r.diff, 0);
    challengeRef.child(myPlayerKey).update({
      scores: roundScores,
      total,
    });

    state = 'awaiting-opponent';
    gameButtons.classList.remove('show');
    waitingOverlay.classList.remove('hidden');
  }
}

function handlePracticeRoundEnd() {
  nextBtn.textContent       = 'Play Again';
  homeBtnGame.style.display = 'block';
  gameButtons.classList.add('show');
  nextBtn.onclick = startRound;
}

// ─── Daily results ────────────────────────────────────────

function showDailyResults(alreadyPlayed = false) {
  roundsBody.innerHTML = '';
  let total = 0;

  roundScores.forEach((r, i) => {
    const sign = r.elapsed > r.target ? '+' : '-';
    const row  = document.createElement('tr');
    row.innerHTML = `
      <td>${i + 1}</td>
      <td>${formatSeconds(r.target)}</td>
      <td>${formatSeconds(r.elapsed)}</td>
      <td>${sign}${formatSeconds(r.diff)}</td>
    `;
    roundsBody.appendChild(row);
    total += r.diff;
  });

  totalValue.textContent = formatSeconds(total);
  document.getElementById('results-title').textContent =
    alreadyPlayed ? "Today's Results" : 'Daily Results';

  showScreen('results');
}

// ─── Challenge results ────────────────────────────────────

function showChallengeResults(data) {
  waitingOverlay.classList.add('hidden');

  const myData  = data[myPlayerKey];
  const oppData = data[opponentKey];
  const myTotal  = myData.total;
  const oppTotal = oppData.total;

  const winnerText = myTotal < oppTotal
    ? 'You Win!'
    : myTotal > oppTotal
    ? 'You Lose.'
    : 'It\'s a Tie!';

  document.getElementById('challenge-winner-text').textContent = winnerText;
  document.getElementById('my-total-display').textContent  = formatSeconds(myTotal);
  document.getElementById('opp-total-display').textContent = formatSeconds(oppTotal);

  const tbody = document.getElementById('challenge-body');
  tbody.innerHTML = '';

  myData.scores.forEach((myRound, i) => {
    const oppRound = oppData.scores[i];
    const mySign   = myRound.elapsed  > myRound.target  ? '+' : '-';
    const oppSign  = oppRound.elapsed > oppRound.target ? '+' : '-';

    // Highlight the better score for each round
    const myWon  = myRound.diff <= oppRound.diff;
    const oppWon = oppRound.diff <= myRound.diff;

    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${i + 1}</td>
      <td>${formatSeconds(myRound.target)}</td>
      <td style="${myWon  ? 'font-weight:700' : 'color:#999'}">${mySign}${formatSeconds(myRound.diff)}</td>
      <td style="${oppWon ? 'font-weight:700' : 'color:#999'}">${oppSign}${formatSeconds(oppRound.diff)}</td>
    `;
    tbody.appendChild(row);
  });

  showScreen('challenge-results');
}

// ─── Event listeners ──────────────────────────────────────

document.getElementById('daily-btn').addEventListener('click', startDaily);
document.getElementById('practice-btn').addEventListener('click', startPractice);
document.getElementById('challenge-btn').addEventListener('click', createChallenge);

document.getElementById('lobby-ready-btn').addEventListener('click', markReady);
document.getElementById('lobby-home-btn').addEventListener('click', goHome);

document.getElementById('lobby-copy-btn').addEventListener('click', () => {
  const link    = document.getElementById('lobby-link-text').textContent;
  const confirm = document.getElementById('lobby-copy-confirm');
  navigator.clipboard.writeText(link).then(() => {
    confirm.classList.remove('hidden');
    setTimeout(() => confirm.classList.add('hidden'), 2000);
  });
});

nextBtn.addEventListener('click', (e) => e.stopPropagation());
homeBtnGame.addEventListener('click', (e) => { e.stopPropagation(); goHome(); });

document.getElementById('home-btn-results').addEventListener('click', goHome);
document.getElementById('challenge-results-home-btn').addEventListener('click', goHome);

document.getElementById('rematch-btn').addEventListener('click', () => {
  if (challengeRef) challengeRef.off();
  challengeRef     = null;
  challengeStarted = false;
  createChallenge();
});

box.addEventListener('click', () => stopRound());

// ─── Init — check URL for challenge invite ─────────────────

(function init() {
  const params = new URLSearchParams(window.location.search);
  const inviteId = params.get('c');
  if (inviteId) {
    joinChallenge(inviteId);
  }
})();
