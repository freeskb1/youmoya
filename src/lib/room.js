import { db, ensureSignedIn } from "./firebase";
import {
  ref,
  set,
  get,
  update,
  remove,
  onValue,
  off,
  serverTimestamp,
  runTransaction,
} from "firebase/database";
import {
  generateRoomCode,
  buildLeadPlayerOrder,
  calculateTotalRounds,
  buildGameQuestionPool,
  buildMachobaFromPool,
  buildNeomoyaScorePool,
  buildNeomoyaFunPool,
  buildNeomoyaScoreFromPool,
  countMachobaMatches,
} from "./game";

// ============================================
// 방 생성
// ============================================
export async function createRoom(nickname) {
  const user = await ensureSignedIn();

  let code = "";
  for (let i = 0; i < 10; i++) {
    code = generateRoomCode();
    const snapshot = await get(ref(db, `rooms/${code}`));
    if (!snapshot.exists()) break;
  }

  const playerId = user.uid;
  const roomData = {
    code,
    status: "waiting",
    gameMode: "machoba", // "machoba" | "neomoya"
    neomoyaSubMode: "score", // "score" or "fun"
    machobaCount: 5,
    neomoyaCount: 5, // 5, 10, 15
    rounds: 2, // 1, 2, 3 바퀴 (선플레이어 N번씩)
    currentRound: 0,
    totalRounds: 0,
    currentLeadPlayerId: null,
    machoba: null,
    neomoya: null,
    questionPool: null,
    usedQuestionsRoom: null, // 마쵸바 방 단위 사용 이력
    usedScenariosRoom: null, // 너모야 점수 모드 방 단위
    usedScenariosFun: null, // 너모야 재미 모드 방 단위
    playerOrder: null,
    createdAt: serverTimestamp(),
    players: {
      [playerId]: {
        nickname,
        isHost: true,
        score: 0,
        joinedAt: serverTimestamp(),
      },
    },
  };

  await set(ref(db, `rooms/${code}`), roomData);
  return { code, playerId };
}

// ============================================
// 방 입장
// ============================================
export async function joinRoom(code, nickname) {
  const user = await ensureSignedIn();

  const snapshot = await get(ref(db, `rooms/${code}`));
  if (!snapshot.exists()) {
    return { error: "존재하지 않는 방이에요" };
  }
  const room = snapshot.val();
  if (room.status === "finished") {
    return { error: "이미 종료된 방이에요" };
  }

  const players = room.players || {};

  // 1) 이 브라우저(uid) 가 이미 방에 있으면 → 재접속 (닉네임 무시하고 기존 것 그대로 복귀)
  if (players[user.uid]) {
    return { code, playerId: user.uid, rejoined: true };
  }

  // 2) 신규 입장 — 닉네임 자동 부여 (다른 사람과 겹치면 (2), (3)...)
  let finalNickname = nickname;
  const existingNicknames = new Set(Object.values(players).map((p) => p.nickname));
  if (existingNicknames.has(finalNickname)) {
    let n = 2;
    while (existingNicknames.has(`${nickname} (${n})`)) n++;
    finalNickname = `${nickname} (${n})`;
  }

  const playerId = user.uid;
  const isGameInProgress = room.status === "playing";
  const playerData = {
    nickname: finalNickname,
    isHost: false,
    score: 0,
    joinedAt: serverTimestamp(),
  };
  // 게임 중 입장이면 관전 상태로 마킹
  // 현재 라운드까지 관전, 다음 라운드부터 정식 참여
  if (isGameInProgress) {
    playerData.spectatorUntilRound = room.currentRound || 1;
    playerData.joinedAtRound = (room.currentRound || 1) + 1;
  }
  await set(ref(db, `rooms/${code}/players/${playerId}`), playerData);

  return {
    code,
    playerId,
    isSpectator: isGameInProgress,
    nickname: finalNickname,
  };
}

// ============================================
// 말랑월드 자동 입장 (방 키 = h{말랑월드 방번호}, 방에 hubSid 저장)
// ============================================
// 방장: 방이 없거나 다른 판(hubSid 다름)이면 새로 만들고, 같은 판이면 그대로 들어간다.
// 트랜잭션이라 새로고침/중복 호출에도 멱등 (이미 들어온 멤버를 덮어쓰지 않음).
export async function createHubRoom(code, nickname, hubSid, hubUid) {
  const user = await ensureSignedIn();
  const playerId = user.uid;
  const now = Date.now(); // 트랜잭션 안에서는 serverTimestamp 대신 로컬 시각 사용

  const hostPlayer = {
    nickname,
    isHost: true,
    score: 0,
    joinedAt: now,
  };
  if (hubUid) hostPlayer.hubUid = hubUid;

  await runTransaction(ref(db, `rooms/${code}`), (current) => {
    if (!current || current.hubSid !== hubSid) {
      // 새 판 → 새 방 (createRoom 과 같은 기본값)
      return {
        code,
        hubSid,
        status: "waiting",
        gameMode: "machoba",
        neomoyaSubMode: "score",
        machobaCount: 5,
        neomoyaCount: 5,
        rounds: 2,
        currentRound: 0,
        totalRounds: 0,
        createdAt: now,
        players: {
          [playerId]: hostPlayer,
        },
      };
    }
    // 같은 판의 방이 이미 있음
    if (current.players && current.players[playerId]) return; // 그대로 (abort = 변경 없음)
    // 익명 uid 가 바뀐 경우 등 → 방장으로 추가
    return {
      ...current,
      players: { ...(current.players || {}), [playerId]: hostPlayer },
    };
  });

  return { code, playerId };
}

// 멤버: hubSid 가 맞는 방이 생긴 뒤 호출. 이미 players 에 있으면 다시 쓰지 않는다.
// 닉네임 중복 처리(" (2)")는 하지 않는다 (말랑월드에서 이미 겹치지 않음).
// 종료(finished) 상태여도 입장은 허용 (방장이 리게임/대기실 복귀 가능).
export async function joinHubRoom(code, nickname, hubUid) {
  const user = await ensureSignedIn();
  const playerId = user.uid;

  const snapshot = await get(ref(db, `rooms/${code}`));
  if (!snapshot.exists()) {
    return { error: "존재하지 않는 방이에요" };
  }
  const room = snapshot.val();
  const players = room.players || {};

  // 이미 있으면 재접속 (게임 중이어도 그대로 복귀)
  if (players[playerId]) {
    return { code, playerId, rejoined: true };
  }

  const isGameInProgress = room.status === "playing";
  const playerData = {
    nickname,
    isHost: false,
    score: 0,
    joinedAt: serverTimestamp(),
  };
  if (hubUid) playerData.hubUid = hubUid;
  // 게임 도중 새로 들어온 사람은 기존 규칙대로 관전 후 다음 라운드부터 참여
  if (isGameInProgress) {
    playerData.spectatorUntilRound = room.currentRound || 1;
    playerData.joinedAtRound = (room.currentRound || 1) + 1;
  }
  await set(ref(db, `rooms/${code}/players/${playerId}`), playerData);

  return { code, playerId, isSpectator: isGameInProgress };
}

// ============================================
// 방장 옵션
// ============================================
export async function updateGameMode(code, gameMode) {
  await update(ref(db, `rooms/${code}`), { gameMode });
}
export async function updateMachobaCount(code, machobaCount) {
  await update(ref(db, `rooms/${code}`), { machobaCount });
}
export async function updateNeomoyaSubMode(code, neomoyaSubMode) {
  await update(ref(db, `rooms/${code}`), { neomoyaSubMode });
}
export async function updateNeomoyaCount(code, neomoyaCount) {
  await update(ref(db, `rooms/${code}`), { neomoyaCount });
}
export async function updateRounds(code, rounds) {
  await update(ref(db, `rooms/${code}`), { rounds });
}

// ============================================
// 방 떠나기
// ============================================
export async function leaveRoom(code, playerId) {
  await remove(ref(db, `rooms/${code}/players/${playerId}`));
  const snapshot = await get(ref(db, `rooms/${code}/players`));
  if (!snapshot.exists()) {
    await remove(ref(db, `rooms/${code}`));
  }
}

// ============================================
// 방 구독
// ============================================
export function subscribeRoom(code, callback) {
  const roomRef = ref(db, `rooms/${code}`);
  const handler = (snapshot) => {
    callback(snapshot.exists() ? snapshot.val() : null);
  };
  onValue(roomRef, handler);
  return () => off(roomRef, "value", handler);
}

// ============================================
// 게임 초기화 헬퍼 (시작 / 리게임 공통)
// ============================================
function buildInitialUpdates(room, playerIds) {
  const gameMode = room.gameMode || "machoba";
  const rounds = room.rounds || 2; // 1/2/3바퀴

  // 너모야 재미 모드는 라운드 시스템 없음
  if (gameMode === "neomoya" && room.neomoyaSubMode === "fun") {
    const count = room.neomoyaCount || 5;
    const existingUsedFun = room.usedScenariosFun || [];
    const { pool, newUsed } = buildNeomoyaFunPool(count, existingUsedFun);

    return {
      status: "playing",
      currentRound: 1,
      totalRounds: 1, // 재미 모드는 단일 세션
      currentLeadPlayerId: null,
      playerOrder: null,
      questionPool: null,
      neomoya: {
        subMode: "fun",
        count,
        scenarios: pool,
      },
      usedScenariosFun: newUsed,
      machoba: null,
      votes: null,
      results: null,
      readyState: null,
      neomoyaFunAnswers: null,
      neomoyaProgress: null,
      machobaProgress: null,
      leadProgress: null,
    };
  }

  // 선플레이어 있는 모드 (마쵸바/너모야 점수)
  const order = buildLeadPlayerOrder(playerIds, rounds);
  const totalRounds = calculateTotalRounds(playerIds.length, rounds);

  const updates = {
    status: "playing",
    currentRound: 1,
    totalRounds,
    currentLeadPlayerId: order[0],
    playerOrder: order,
    machoba: null,
    neomoya: null,
    votes: null,
    results: null,
    readyState: null,
    neomoyaFunAnswers: null,
    neomoyaProgress: null,
    machobaProgress: null,
    leadProgress: null,
  };

  if (gameMode === "machoba") {
    const perRoundCount = room.machobaCount || 5;
    const existingUsed = room.usedQuestionsRoom || [];
    const { pool, newUsedQuestions } = buildGameQuestionPool(order, perRoundCount, existingUsed);
    updates.questionPool = pool;
    updates.usedQuestionsRoom = newUsedQuestions;
    updates.machoba = {
      count: perRoundCount,
      questions: buildMachobaFromPool(pool, 0, perRoundCount),
      leadAnswers: null,
    };
  } else if (gameMode === "neomoya") {
    // 점수 모드
    const perRoundCount = room.neomoyaCount || 5;
    const existingUsed = room.usedScenariosRoom || [];
    const { pool, newUsed } = buildNeomoyaScorePool(order, perRoundCount, existingUsed);
    updates.questionPool = pool;
    updates.usedScenariosRoom = newUsed;
    updates.neomoya = {
      subMode: "score",
      count: perRoundCount,
      scenarios: buildNeomoyaScoreFromPool(pool, 0, perRoundCount),
      leadAnswers: null,
    };
  }

  return updates;
}

// ============================================
// 게임 시작
// ============================================
export async function startGame(code) {
  const snapshot = await get(ref(db, `rooms/${code}`));
  if (!snapshot.exists()) return;
  const room = snapshot.val();
  const playerIds = Object.keys(room.players || {});
  if (playerIds.length < 2) return;

  const updates = buildInitialUpdates(room, playerIds);
  await update(ref(db, `rooms/${code}`), updates);
}

// ============================================
// 리게임 (같은 멤버, 점수 0)
// ============================================
export async function restartGame(code) {
  const snapshot = await get(ref(db, `rooms/${code}`));
  if (!snapshot.exists()) return;
  const room = snapshot.val();
  const playerIds = Object.keys(room.players || {});
  if (playerIds.length < 2) return;

  const updates = buildInitialUpdates(room, playerIds);
  for (const pid of playerIds) {
    updates[`players/${pid}/score`] = 0;
  }
  await update(ref(db, `rooms/${code}`), updates);
}

// ============================================
// 대기실 복귀
// ============================================
export async function returnToWaiting(code) {
  const snapshot = await get(ref(db, `rooms/${code}`));
  if (!snapshot.exists()) return;
  const room = snapshot.val();
  const playerIds = Object.keys(room.players || {});

  const playerUpdates = {};
  for (const pid of playerIds) {
    playerUpdates[`players/${pid}/score`] = 0;
  }

  await update(ref(db, `rooms/${code}`), {
    ...playerUpdates,
    status: "waiting",
    currentRound: 0,
    totalRounds: 0,
    currentLeadPlayerId: null,
    machoba: null,
    neomoya: null,
    questionPool: null,
    votes: null,
    results: null,
    playerOrder: null,
    readyState: null,
    neomoyaFunAnswers: null,
    neomoyaProgress: null,
    machobaProgress: null,
    leadProgress: null,
  });
}

// ============================================
// 마쵸바: 투표자 답변
// ============================================
export async function submitMachobaVote(code, round, playerId, voteArray) {
  await set(ref(db, `rooms/${code}/votes/${round}/${playerId}`), {
    voteArray,
    matchCount: null,
  });
}

// ============================================
// 마쵸바: 선 플레이어 답변
// ============================================
export async function submitMachobaLeadAnswers(code, leadAnswers) {
  const snapshot = await get(ref(db, `rooms/${code}`));
  if (!snapshot.exists()) return;
  const room = snapshot.val();
  if (!room.machoba) return;

  await update(ref(db, `rooms/${code}/machoba`), {
    leadAnswers,
  });

  await set(ref(db, `rooms/${code}/results/${room.currentRound}`), {
    leadPlayerId: room.currentLeadPlayerId,
    leadAnswers,
    questions: room.machoba.questions,
  });
}

// ============================================
// 마쵸바: 정답 공개
// ============================================
export async function revealMachobaResult(code, round) {
  const snapshot = await get(ref(db, `rooms/${code}`));
  if (!snapshot.exists()) return;
  const room = snapshot.val();
  const result = room.results?.[round];
  if (!result || !result.leadAnswers) return;

  const votes = room.votes?.[round] || {};
  const updates = {};

  for (const playerId in votes) {
    const v = votes[playerId];
    const matchCount = countMachobaMatches(v.voteArray || [], result.leadAnswers);
    updates[`votes/${round}/${playerId}/matchCount`] = matchCount;

    if (matchCount > 0) {
      const player = room.players[playerId];
      if (player) {
        updates[`players/${playerId}/score`] = (player.score || 0) + matchCount;
      }
    }
  }

  updates[`results/${round}/revealed`] = true;
  await update(ref(db, `rooms/${code}`), updates);
}

// ============================================
// 다음 라운드 (questionPool에서 다음 슬라이스 꺼냄)
// ============================================
export async function nextRound(code) {
  const snapshot = await get(ref(db, `rooms/${code}`));
  if (!snapshot.exists()) return;
  const room = snapshot.val();

  const nextRoundNum = room.currentRound + 1;
  if (nextRoundNum > room.totalRounds) {
    await update(ref(db, `rooms/${code}`), { status: "finished" });
    return;
  }

  const nextLead = room.playerOrder[nextRoundNum - 1];
  const gameMode = room.gameMode || "machoba";
  const pool = room.questionPool || [];

  const updates = {
    currentRound: nextRoundNum,
    currentLeadPlayerId: nextLead,
    leadProgress: null, // 새 라운드 시작 시 선플레이어 진행도 초기화
  };

  if (gameMode === "machoba") {
    const count = room.machobaCount || 5;
    updates.machoba = {
      count,
      questions: buildMachobaFromPool(pool, nextRoundNum - 1, count),
      leadAnswers: null,
    };
    updates.neomoya = null;
  } else if (gameMode === "neomoya") {
    // 너모야 점수 모드 (재미 모드는 nextRound 없음)
    const count = room.neomoyaCount || 5;
    updates.neomoya = {
      subMode: "score",
      count,
      scenarios: buildNeomoyaScoreFromPool(pool, nextRoundNum - 1, count),
      leadAnswers: null,
    };
    updates.machoba = null;
  }

  await update(ref(db, `rooms/${code}`), updates);
}

// ============================================
// 준비 체크 (정답자 공개 / 다음 라운드 대기)
// ============================================
// readyKey: "reveal" 또는 "next"
export async function markReady(code, round, readyKey, playerId) {
  await set(ref(db, `rooms/${code}/readyState/${round}/${readyKey}/${playerId}`), true);
}

// 준비 상태 초기화 (라운드 넘어갈 때)
export async function clearReadyState(code, round) {
  await remove(ref(db, `rooms/${code}/readyState/${round}`));
}

// ============================================
// 너모야 - 진행도 표시 (몇 번째 시나리오까지 답했는지)
// ============================================
// phase별로 분리: "fun" | "score-vote" | "score-lead"
export async function updateNeomoyaProgress(code, round, playerId, progressKey, current) {
  await set(ref(db, `rooms/${code}/neomoyaProgress/${round}/${progressKey}/${playerId}`), current);
}

// ============================================
// 마쵸바 - 진행도 표시 (몇 번째 문제까지 답했는지)
// ============================================
// progressKey: "vote" (일반 플레이어) | "lead" (선플레이어)
export async function updateMachobaProgress(code, round, playerId, progressKey, current) {
  await set(ref(db, `rooms/${code}/machobaProgress/${round}/${progressKey}/${playerId}`), current);
}

// ============================================
// 선플레이어 현재 진행 인덱스 (마쵸바+너모야 공통)
// 일반 플레이어 화면에 선플레이어가 보는 질문을 실시간 표시하기 위함
// step: 0-based (0 = 첫 문제, count = 모두 끝남)
// ============================================
export async function updateLeadProgress(code, round, step) {
  await set(ref(db, `rooms/${code}/leadProgress/${round}`), step);
}

// ============================================
// 너모야 점수 모드 - 마쵸바와 동일한 흐름
// ============================================
// 일반 플레이어 답변 (A/B 배열)
export async function submitNeomoyaScoreVote(code, round, playerId, voteArray) {
  await set(ref(db, `rooms/${code}/votes/${round}/${playerId}`), {
    voteArray,
    matchCount: null,
  });
}

// 선플레이어 답변 (A/B 배열)
export async function submitNeomoyaScoreLeadAnswers(code, leadAnswers) {
  const snapshot = await get(ref(db, `rooms/${code}`));
  if (!snapshot.exists()) return;
  const room = snapshot.val();
  if (!room.neomoya) return;

  await update(ref(db, `rooms/${code}/neomoya`), {
    leadAnswers,
  });

  await set(ref(db, `rooms/${code}/results/${room.currentRound}`), {
    leadPlayerId: room.currentLeadPlayerId,
    leadAnswers,
    scenarios: room.neomoya.scenarios,
  });
}

// 점수 모드 - 정답 공개 (마쵸바와 동일한 로직)
export async function revealNeomoyaScoreResult(code, round) {
  const snapshot = await get(ref(db, `rooms/${code}`));
  if (!snapshot.exists()) return;
  const room = snapshot.val();
  const result = room.results?.[round];
  if (!result || !result.leadAnswers) return;

  const votes = room.votes?.[round] || {};
  const updates = {};

  for (const playerId in votes) {
    const v = votes[playerId];
    const matchCount = countMachobaMatches(v.voteArray || [], result.leadAnswers);
    updates[`votes/${round}/${playerId}/matchCount`] = matchCount;

    if (matchCount > 0) {
      const player = room.players[playerId];
      if (player) {
        updates[`players/${playerId}/score`] = (player.score || 0) + matchCount;
      }
    }
  }

  updates[`results/${round}/revealed`] = true;
  await update(ref(db, `rooms/${code}`), updates);
}

// ============================================
// 너모야 재미 모드 - 동시 투표, 점수 없음
// ============================================
// 본인 답변 (A/B 배열) 제출
export async function submitNeomoyaFunAnswers(code, playerId, answers) {
  await set(ref(db, `rooms/${code}/neomoyaFunAnswers/${playerId}`), {
    answers,
    submittedAt: serverTimestamp(),
  });
}

// 재미 모드 종료 (모두 제출 완료 시 호출 - 결과 단계로)
export async function finishNeomoyaFun(code) {
  const snapshot = await get(ref(db, `rooms/${code}`));
  if (!snapshot.exists()) return;
  await update(ref(db, `rooms/${code}`), {
    status: "finished",
  });
}

// ============================================
// 방 닫기
// ============================================
export async function closeRoom(code) {
  await remove(ref(db, `rooms/${code}`));
}

// ============================================
// 미답변자 강제 스킵 (방장 "지금 넘기기" 버튼)
// ============================================
// 아직 답 안 낸 사람들을 "미답변" 으로 표시. 관전자는 제외.
// 마쵸바: 미답변자 = 빈 배열 (0개 맞춤 처리)
// 너모야 점수: 미답변자 = 빈 배열
export async function forceSkipMissingVoters(code) {
  const snapshot = await get(ref(db, `rooms/${code}`));
  if (!snapshot.exists()) return;
  const room = snapshot.val();
  const round = room.currentRound;
  const votes = room.votes?.[round] || {};
  const players = room.players || {};
  const leadId = room.currentLeadPlayerId;

  const updates = {};
  for (const pid of Object.keys(players)) {
    if (pid === leadId) continue; // 선플레이어는 별도
    const player = players[pid];
    // 관전자 제외
    if (player.spectatorUntilRound != null && round <= player.spectatorUntilRound) continue;
    // 이미 답 낸 사람 제외
    if (votes[pid]) continue;
    // 미답변으로 마킹
    updates[`votes/${round}/${pid}`] = { voteArray: [], matchCount: null, skipped: true };
  }

  if (Object.keys(updates).length > 0) {
    await update(ref(db, `rooms/${code}`), updates);
  }
}

// 선플레이어 튕김 → 이 라운드 통째 스킵
// 예측한 사람들 답변도 무효 처리하고 다음 라운드로
export async function skipRoundDueToLead(code) {
  const snapshot = await get(ref(db, `rooms/${code}`));
  if (!snapshot.exists()) return;
  const room = snapshot.val();
  const round = room.currentRound;

  // 이 라운드의 votes / result 지우고 nextRound 처럼 진행
  const nextRoundNum = round + 1;
  if (nextRoundNum > room.totalRounds) {
    await update(ref(db, `rooms/${code}`), {
      status: "finished",
      [`votes/${round}`]: null,
      [`results/${round}`]: null,
    });
    return;
  }

  const nextLead = room.playerOrder?.[nextRoundNum - 1];
  const gameMode = room.gameMode || "machoba";
  const pool = room.questionPool || [];
  const updates = {
    currentRound: nextRoundNum,
    currentLeadPlayerId: nextLead,
    leadProgress: null,
    [`votes/${round}`]: null,
    [`results/${round}`]: null,
  };

  if (gameMode === "machoba") {
    const count = room.machobaCount || 5;
    // buildMachobaFromPool 은 아래에서 재사용 (같은 pool 에서 다음 슬라이스)
    // pool 슬라이스는 nextRoundNum-1 인덱스로 계산
    // 하지만 이번 라운드 questionPool 부분은 이미 skip 됐으므로 그대로 두고 진행
    const startIdx = (nextRoundNum - 1) * count;
    updates.machoba = {
      count,
      questions: pool.slice(startIdx, startIdx + count),
      leadAnswers: null,
    };
    updates.neomoya = null;
  } else if (gameMode === "neomoya") {
    const count = room.neomoyaCount || 5;
    const startIdx = (nextRoundNum - 1) * count;
    updates.neomoya = {
      subMode: "score",
      count,
      scenarios: pool.slice(startIdx, startIdx + count),
      leadAnswers: null,
    };
    updates.machoba = null;
  }

  await update(ref(db, `rooms/${code}`), updates);
}
