import { QUESTIONS } from "./questions";
import { SCENARIOS } from "./scenarios";

// ============================================
// 한국어 조사 처리 유틸
// ============================================
export function hasJongseong(str) {
  if (!str || typeof str !== "string") return false;
  const lastChar = str[str.length - 1];
  const code = lastChar.charCodeAt(0);
  if (code < 0xAC00 || code > 0xD7A3) return false;
  return (code - 0xAC00) % 28 !== 0;
}

export function josa(name, pair) {
  if (!name) return "";
  const [withJong, withoutJong] = pair.split("/");
  return name + (hasJongseong(name) ? withJong : withoutJong);
}

// ============================================
// 게임 룸 코드
// ============================================
export function generateRoomCode() {
  return String(Math.floor(100 + Math.random() * 900));
}

// ============================================
// 피라미드
// ============================================
export function getCardCountForDepth(depth) {
  let total = 0;
  for (let i = 1; i <= depth; i++) total += i;
  return total;
}

// 배열 셔플 (Fisher-Yates - sort 보다 균등)
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ============================================
// 전체 게임 질문 풀 생성 (라운드 순서 + 플레이어 순서 고려)
// ============================================
//
// playerOrder: [pid1, pid2, pid1, pid2] (라운드별 선플레이어)
// perRoundCount: 라운드당 필요 질문 수
// usedQuestionsByPlayer: { [playerId]: [질문문자열, ...] } - 이전에 사용한 질문들
//
// 반환:
//   pool: [질문, 질문, ...] (라운드 순서대로 평탄화된 배열, 전체 길이 = totalRounds * perRoundCount)
//   newUsedQuestions: { [playerId]: [...] } - 갱신된 사용 질문 (기존 + 이번 게임)
//
// 각 라운드의 perRoundCount 만큼 질문은:
// 1. 그 라운드의 선플레이어가 이전 게임에서 받았던 질문 제외
// 2. 그 라운드의 선플레이어가 이번 게임의 이전 라운드에서 받은 질문도 제외
// 3. 남은 질문 중에서 무작위로 perRoundCount 개 선택
//
export function buildGameQuestionPool(playerOrder, perRoundCount, usedQuestionsByPlayer = {}) {
  const totalRounds = playerOrder.length;
  const pool = [];

  // 누적 사용 질문 (기존 + 이번 게임 진행 중에 추가)
  const cumulativeUsed = {};
  for (const pid in usedQuestionsByPlayer) {
    cumulativeUsed[pid] = new Set(usedQuestionsByPlayer[pid] || []);
  }
  // playerOrder 의 모든 플레이어에 대해 초기화
  for (const pid of playerOrder) {
    if (!cumulativeUsed[pid]) cumulativeUsed[pid] = new Set();
  }

  for (let r = 0; r < totalRounds; r++) {
    const leadPid = playerOrder[r];
    const usedSet = cumulativeUsed[leadPid];

    // 사용 가능한 질문 = 전체 질문 - 이 사람이 받은 적 있는 질문
    let available = QUESTIONS.filter((q) => !usedSet.has(q));

    // 만약 부족하면 (이 사람이 거의 모든 질문을 다 받음) → 사용 이력 초기화 (안전장치)
    if (available.length < perRoundCount) {
      cumulativeUsed[leadPid] = new Set();
      available = [...QUESTIONS];
    }

    // 셔플 후 perRoundCount 개 추출
    const shuffled = shuffle(available);
    const chosen = shuffled.slice(0, perRoundCount);

    // 풀에 추가
    pool.push(...chosen);

    // 누적 사용 질문에 기록
    for (const q of chosen) {
      cumulativeUsed[leadPid].add(q);
    }
  }

  // Set → Array 로 변환해서 반환 (Firebase 저장용)
  const newUsedQuestions = {};
  for (const pid in cumulativeUsed) {
    newUsedQuestions[pid] = Array.from(cumulativeUsed[pid]);
  }

  return { pool, newUsedQuestions };
}

// 라운드별 카드 추출
export function buildPyramidFromPool(pool, roundIdx, depth) {
  const cardCount = getCardCountForDepth(depth);
  const start = roundIdx * cardCount;
  const cards = pool.slice(start, start + cardCount);

  const levels = [];
  let idx = 0;
  for (let lv = 1; lv <= depth; lv++) {
    const levelCards = [];
    for (let i = 0; i < lv; i++) {
      levelCards.push(cards[idx++]);
    }
    levels.push(levelCards);
  }
  return {
    depth,
    levels,
    answers: [],
  };
}

export function buildMachobaFromPool(pool, roundIdx, count) {
  const start = roundIdx * count;
  return pool.slice(start, start + count);
}

// ============================================
// 게임 진행 유틸 (피라미드)
// ============================================
export function getCardIndexAtLevel(answers, targetLevel) {
  if (targetLevel === 1) return 0;
  let idx = 0;
  for (let i = 0; i < targetLevel - 1; i++) {
    if (answers[i] && answers[i].answer === "NO") idx += 1;
  }
  return idx;
}

export function getCurrentQuestion(pyramid) {
  const answers = pyramid.answers || [];
  if (answers.length >= pyramid.depth) return null;

  const targetLevel = answers.length + 1;
  const cardIdx = getCardIndexAtLevel(answers, targetLevel);
  return {
    level: targetLevel,
    cardIndex: cardIdx,
    question: pyramid.levels[targetLevel - 1][cardIdx],
  };
}

export function getDestination(answers) {
  if (!answers || answers.length === 0) return null;
  const depth = answers.length;
  const finalIdx = getCardIndexAtLevel(answers, depth);
  const finalAns = answers[depth - 1].answer;
  return `${finalIdx}${finalAns === "Y" || finalAns === "YES" ? "Y" : "N"}`;
}

export function getAnswerSequence(answers) {
  return (answers || []).map((a) => a.answer);
}

// ============================================
// 라운드 / 플레이어 순서
// ============================================
// rounds: 1, 2, 3 (바퀴 수)
// 인원수 × rounds = 총 라운드 수
export function calculateTotalRounds(playerCount, rounds = 2) {
  return playerCount * rounds;
}

export function buildLeadPlayerOrder(playerIds, rounds = 2) {
  const totalRounds = calculateTotalRounds(playerIds.length, rounds);
  const shuffled = shuffle(playerIds);
  const order = [];
  for (let i = 0; i < totalRounds; i++) {
    order.push(shuffled[i % playerIds.length]);
  }
  return order;
}

// ============================================
// 소울메이트 (나를 잘 맞춘 사람 톱3 + 꼴찌)
// ============================================
// 반환: {
//   ranking: [{ playerId, correctCount, total, percent }, ...] (점수 내림차순)
//   totalCount: 합산 분모 (오디야: 라운드 수, 마쵸바: 총 문제 수)
//   worst: { ... } | null (4명 이상일 때만)
// }
export function calculateSoulmate(myPlayerId, myLeadRounds, allVotes) {
  if (myLeadRounds.length === 0) {
    return { ranking: [], totalCount: 0, worst: null };
  }

  const relevant = allVotes.filter(
    (v) => myLeadRounds.includes(v.round) && v.playerId !== myPlayerId
  );

  // 마쵸바 모드 여부 판단: matchCount 가 있으면 마쵸바
  const isMachoba = relevant.some((v) => typeof v.matchCount === "number");

  // 플레이어별 합산
  // 마쵸바: matchCount 누적 / 전체 문제 수 누적
  // 오디야: isCorrect true 횟수 / 라운드 수
  const playerStats = {}; // { pid: { correct, total } }

  if (isMachoba) {
    // 라운드별 문제 수 매핑
    const roundQuestions = {};
    for (const v of relevant) {
      if (v.totalQuestions > 0) {
        roundQuestions[v.round] = v.totalQuestions;
      }
    }
    // 내가 선플레이어였던 라운드의 총 문제 수
    let totalQuestionsSum = 0;
    for (const round of myLeadRounds) {
      totalQuestionsSum += roundQuestions[round] || 0;
    }

    for (const v of relevant) {
      if (!playerStats[v.playerId]) {
        playerStats[v.playerId] = { correct: 0, total: totalQuestionsSum };
      }
      playerStats[v.playerId].correct += (v.matchCount || 0);
    }

    const totalCount = totalQuestionsSum;
    const allEntries = Object.entries(playerStats)
      .map(([playerId, stat]) => ({
        playerId,
        // total이 0이면 데이터 이상 - correctCount도 0으로 (0개 중 5개 같은 표시 방지)
        correctCount: stat.total > 0 ? stat.correct : 0,
        total: stat.total,
        percent: stat.total > 0 ? Math.round((stat.correct / stat.total) * 100) : 0,
      }))
      .sort((a, b) => b.correctCount - a.correctCount);

    const ranking = allEntries.slice(0, 3);
    const worst = allEntries.length >= 4 ? allEntries[allEntries.length - 1] : null;
    return { ranking, totalCount, worst };
  }

  // 오디야 모드
  for (const v of relevant) {
    if (!playerStats[v.playerId]) {
      playerStats[v.playerId] = { correct: 0, total: myLeadRounds.length };
    }
    if (v.isCorrect === true) playerStats[v.playerId].correct += 1;
  }

  const totalCount = myLeadRounds.length;
  const allEntries = Object.entries(playerStats)
    .map(([playerId, stat]) => ({
      playerId,
      correctCount: stat.correct,
      total: stat.total,
      percent: stat.total > 0 ? Math.round((stat.correct / stat.total) * 100) : 0,
    }))
    .sort((a, b) => b.correctCount - a.correctCount);

  const ranking = allEntries.slice(0, 3);
  const worst = allEntries.length >= 4 ? allEntries[allEntries.length - 1] : null;
  return { ranking, totalCount, worst };
}

// ============================================
// 마쵸바
// ============================================
export function countMachobaMatches(myVote, leadAnswers) {
  if (!myVote || !leadAnswers) return 0;
  let count = 0;
  for (let i = 0; i < Math.min(myVote.length, leadAnswers.length); i++) {
    if (myVote[i] === leadAnswers[i]) count += 1;
  }
  return count;
}

// 아바타 색상 (8개 팔레트)
const AVATAR_COLORS = [
  "#1D9E75", "#D4537E", "#534AB7", "#BA7517",
  "#1B7AB6", "#A53FAB", "#E27D3D", "#5A8B2F",
];

// 닉네임 해시 기반 (fallback)
export function getAvatarColor(nickname) {
  let hash = 0;
  for (let i = 0; i < nickname.length; i++) {
    hash = (hash * 31 + nickname.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// 위치 인덱스 기반 (방 내 중복 방지)
export function getAvatarColorByIndex(index) {
  return AVATAR_COLORS[((index % AVATAR_COLORS.length) + AVATAR_COLORS.length) % AVATAR_COLORS.length];
}

// players 배열에서 특정 playerId 의 인덱스 찾기
// players: [{ id, nickname, ... }, ...] (joinedAt 순서대로 정렬되어 있음)
export function getPlayerIndex(players, playerId) {
  if (!players || !playerId) return 0;
  const idx = players.findIndex((p) => p.id === playerId);
  return idx >= 0 ? idx : 0;
}

// ============================================
// 너모야 모드
// ============================================

// 시나리오 풀 생성 (점수 모드 - 플레이어별 사용 이력 추적)
// playerOrder, perRoundCount: 마쵸바와 동일
// usedScenariosByPlayer: { [playerId]: [scenario문자열, ...] }
// 반환: { pool: [{scenario, optionA, optionB}, ...], newUsed: {...} }
export function buildNeomoyaScorePool(playerOrder, perRoundCount, usedScenariosByPlayer = {}) {
  const totalRounds = playerOrder.length;
  const pool = [];

  const cumulativeUsed = {};
  for (const pid in usedScenariosByPlayer) {
    cumulativeUsed[pid] = new Set(usedScenariosByPlayer[pid] || []);
  }
  for (const pid of playerOrder) {
    if (!cumulativeUsed[pid]) cumulativeUsed[pid] = new Set();
  }

  for (let r = 0; r < totalRounds; r++) {
    const leadPid = playerOrder[r];
    const usedSet = cumulativeUsed[leadPid];

    let available = SCENARIOS.filter((s) => !usedSet.has(s.scenario));
    if (available.length < perRoundCount) {
      cumulativeUsed[leadPid] = new Set();
      available = [...SCENARIOS];
    }

    const shuffled = shuffle(available);
    const chosen = shuffled.slice(0, perRoundCount);
    pool.push(...chosen);

    for (const s of chosen) {
      cumulativeUsed[leadPid].add(s.scenario);
    }
  }

  const newUsed = {};
  for (const pid in cumulativeUsed) {
    newUsed[pid] = Array.from(cumulativeUsed[pid]);
  }

  return { pool, newUsed };
}

// 재미 모드: 방 단위 사용 이력만 (선플레이어 없으니 플레이어별 X)
// 반환: { pool, newUsed: [scenario문자열, ...] }
export function buildNeomoyaFunPool(count, usedScenarios = []) {
  const usedSet = new Set(usedScenarios);
  let available = SCENARIOS.filter((s) => !usedSet.has(s.scenario));
  if (available.length < count) {
    available = [...SCENARIOS]; // 안전장치
  }
  const shuffled = shuffle(available);
  const chosen = shuffled.slice(0, count);
  const newUsed = [...usedScenarios, ...chosen.map((s) => s.scenario)];
  return { pool: chosen, newUsed };
}

// 점수 모드 - 라운드별 시나리오 추출
export function buildNeomoyaScoreFromPool(pool, roundIdx, count) {
  const start = roundIdx * count;
  return pool.slice(start, start + count);
}

// 마쵸바 일치 계산을 시나리오 답에 그대로 사용 가능
// (countMachobaMatches 재사용)

// ============================================
// 너모야 재미 모드 - 통계 집계
// ============================================
// allAnswers: [{ playerId, answers: ["A", "B", ...] }, ...]
// 반환: {
//   soulmatePairs: [{ p1, p2, matchCount, total }, ...] 내림차순 톱3
//   oppositePairs: [{ p1, p2, matchCount, total }, ...] 오름차순 톱3
//   mostUnique: { playerId, count } | null
//   divisiveQuestions: [{ scenarioIdx, aCount, bCount }, ...] 톱3 (가장 갈린 순)
// }
export function calculateFunModeStats(allAnswers, scenarios) {
  const players = allAnswers.map((a) => a.playerId);
  const total = scenarios.length;

  // 모든 2인 조합의 일치율
  const pairs = [];
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const aAns = allAnswers[i].answers;
      const bAns = allAnswers[j].answers;
      let matchCount = 0;
      for (let k = 0; k < total; k++) {
        if (aAns[k] && bAns[k] && aAns[k] === bAns[k]) matchCount++;
      }
      pairs.push({
        p1: players[i],
        p2: players[j],
        matchCount,
        total,
      });
    }
  }

  // 단짝 톱3 (일치율 내림차순)
  const soulmatePairs = [...pairs].sort((a, b) => b.matchCount - a.matchCount).slice(0, 3);
  // 정반대 영혼 톱3 (일치율 오름차순)
  const oppositePairs = [...pairs].sort((a, b) => a.matchCount - b.matchCount).slice(0, 3);

  // 가장 독특한 사람 - 혼자만 다른 답 고른 횟수
  const uniqueCount = {};
  for (const pid of players) uniqueCount[pid] = 0;
  for (let k = 0; k < total; k++) {
    const votesA = allAnswers.filter((a) => a.answers[k] === "A").map((a) => a.playerId);
    const votesB = allAnswers.filter((a) => a.answers[k] === "B").map((a) => a.playerId);
    if (votesA.length === 1 && votesB.length >= 1) {
      uniqueCount[votesA[0]] += 1;
    }
    if (votesB.length === 1 && votesA.length >= 1) {
      uniqueCount[votesB[0]] += 1;
    }
  }
  let mostUnique = null;
  let maxUnique = 0;
  for (const pid in uniqueCount) {
    if (uniqueCount[pid] > maxUnique) {
      maxUnique = uniqueCount[pid];
      mostUnique = { playerId: pid, count: uniqueCount[pid] };
    }
  }
  if (maxUnique === 0) mostUnique = null;

  // 호불호 갈린 시나리오 톱3 (50:50에 가장 가까운 순)
  const divisive = [];
  for (let k = 0; k < total; k++) {
    const votesA = allAnswers.filter((a) => a.answers[k] === "A").length;
    const votesB = allAnswers.filter((a) => a.answers[k] === "B").length;
    const diff = Math.abs(votesA - votesB);
    divisive.push({ scenarioIdx: k, aCount: votesA, bCount: votesB, diff });
  }
  const divisiveQuestions = divisive.sort((a, b) => a.diff - b.diff).slice(0, 3);

  return {
    soulmatePairs,
    oppositePairs,
    mostUnique,
    divisiveQuestions,
  };
}
