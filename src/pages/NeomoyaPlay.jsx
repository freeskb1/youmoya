import { useState, useEffect, useMemo, useRef } from "react";
import {
  submitNeomoyaScoreVote,
  submitNeomoyaScoreLeadAnswers,
  revealNeomoyaScoreResult,
  submitNeomoyaFunAnswers,
  finishNeomoyaFun,
  updateNeomoyaProgress,
  updateLeadProgress,
  nextRound,
  markReady,
} from "../lib/room";
import { josa, calculateFunModeStats } from "../lib/game";
import Avatar from "../components/Avatar";
import ScenarioPopup from "../components/ScenarioPopup";
import { colors, radius, shadow, containerStyle } from "../lib/theme";

// 너모야 모드 게임 진행
// subMode: "score" (점수, 선플레이어 있음) | "fun" (재미, 선플레이어 없음)
export default function NeomoyaPlay({ room, code, myPlayerId, leadPlayer, players, onFinish, isHost: isHostProp, onRestart, onReturnToWaiting }) {
  const subMode = room.neomoya?.subMode || "score";
  const scenarios = room.neomoya?.scenarios || [];
  const count = room.neomoya?.count || 5;
  const leadAnswers = room.neomoya?.leadAnswers || null;
  const isLead = subMode === "score" && leadPlayer?.id === myPlayerId;

  const [phase, setPhase] = useState("intro"); // intro / voting-popup / voting-confirm / lead-answering / lead-confirm / voted-waiting / lead-waiting / result / reveal / fun-result
  const [myStepAnswers, setMyStepAnswers] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  // 점수 모드 - 현재 라운드 투표 집계
  const currentVotes = useMemo(() => {
    const v = room.votes?.[room.currentRound] || {};
    return Object.entries(v).map(([pid, data]) => ({ playerId: pid, ...data }));
  }, [room.votes, room.currentRound]);

  const submittedVotesCount = currentVotes.length;
  const nonLeadCount = subMode === "score" ? players.length - 1 : 0;
  const currentResult = room.results?.[room.currentRound];

  // 재미 모드 - 답변 집계
  const funAnswers = useMemo(() => {
    if (subMode !== "fun") return [];
    const data = room.neomoyaFunAnswers || {};
    return Object.entries(data).map(([pid, d]) => ({ playerId: pid, answers: d.answers || [] }));
  }, [room.neomoyaFunAnswers, subMode]);

  const funSubmittedCount = funAnswers.length;
  const myFunAnswer = funAnswers.find((a) => a.playerId === myPlayerId);

  // 진행도 (몇 번째 시나리오까지 답했는지)
  const progressData = useMemo(() => {
    const round = room.currentRound;
    const prog = room.neomoyaProgress?.[round] || {};
    return {
      fun: prog.fun || {},
      scoreVote: prog.scoreVote || {},
      scoreLead: prog.scoreLead || {},
    };
  }, [room.neomoyaProgress, room.currentRound]);

  // 진행도를 플레이어 리스트로 변환 (제출 완료한 사람은 count로 고정)
  function buildProgressList(progressKey, submittedPlayerIds, excludeIds = []) {
    return players
      .filter((p) => !excludeIds.includes(p.id))
      .map((p) => {
        const submitted = submittedPlayerIds.includes(p.id);
        const cur = submitted ? count : (progressData[progressKey][p.id] || 0);
        return { id: p.id, nickname: p.nickname, current: cur, total: count, done: submitted };
      });
  }

  // ============ Phase 전환 ============
  function computeNextPhase() {
    if (subMode === "fun") {
      // 재미 모드: 답 입력 → 확인 → 모두 완료까지 대기 → 결과
      if (room.status === "finished") return "fun-result";
      if (myFunAnswer) return "fun-waiting";
      return "voting-popup";
    }

    // 점수 모드
    if (currentResult?.revealed) return "reveal";
    if (isLead) {
      if (!leadAnswers) {
        if (submittedVotesCount >= nonLeadCount && nonLeadCount > 0) {
          return "lead-answering";
        }
        return "lead-waiting";
      }
      return "result";
    }
    const myVote = currentVotes.find((v) => v.playerId === myPlayerId);
    if (myVote) {
      if (leadAnswers) return "result";
      return "voted-waiting";
    }
    return "voting-popup";
  }

  // 라운드 시작 인트로 (setTimeout은 IntroScreen 내부에서 처리, stale closure 회피)
  const lastRoundRef = useRef(null);
  useEffect(() => {
    if (room.status !== "playing" && room.status !== "finished") return;
    if (subMode === "fun") {
      if (room.status === "finished") {
        setPhase("fun-result");
        return;
      }
      if (myFunAnswer) {
        setPhase("fun-waiting");
        return;
      }
      // 답변 안 했으면 인트로 진입 (한 번만)
      if (phase !== "intro" && phase !== "voting-popup" && phase !== "voting-confirm") {
        setPhase("intro");
        setMyStepAnswers([]);
      }
      return;
    }
    // 점수 모드 - 라운드 번호 바뀌면 인트로 강제
    if (lastRoundRef.current !== room.currentRound) {
      lastRoundRef.current = room.currentRound;
      setPhase("intro");
      setMyStepAnswers([]);
    }
  }, [room.currentRound, room.status, subMode, myFunAnswer, phase]); // eslint-disable-line

  // 통합 phase
  useEffect(() => {
    if (room.status !== "playing" && room.status !== "finished") return;
    if (phase === "intro") return;
    if (phase === "voting-confirm" || phase === "lead-confirm") return;
    const next = computeNextPhase();
    if (next !== phase) setPhase(next);
  }, [
    phase, room.status, subMode, isLead, leadAnswers,
    submittedVotesCount, nonLeadCount, currentResult?.revealed,
    myFunAnswer, funSubmittedCount,
  ]); // eslint-disable-line

  // ============ 액션 ============
  function handleStepAnswer(answer) {
    if (myStepAnswers.length >= count) return;
    const newAnswers = [...myStepAnswers, answer];
    setMyStepAnswers(newAnswers);
    // 진행도 Firebase 업데이트
    const progressKey = subMode === "fun" ? "fun" : (isLead ? "scoreLead" : "scoreVote");
    updateNeomoyaProgress(code, room.currentRound, myPlayerId, progressKey, newAnswers.length);
    // 점수 모드 선플레이어면 실시간 공유용 leadProgress 도 업데이트
    if (subMode === "score" && isLead) {
      updateLeadProgress(code, room.currentRound, newAnswers.length);
    }
    if (newAnswers.length === count) {
      setPhase(isLead ? "lead-confirm" : "voting-confirm");
    }
  }

  async function handleVoteConfirm() {
    if (submitting) return;
    setSubmitting(true);
    try {
      if (subMode === "fun") {
        await submitNeomoyaFunAnswers(code, myPlayerId, myStepAnswers);
      } else {
        await submitNeomoyaScoreVote(code, room.currentRound, myPlayerId, myStepAnswers);
      }
      setPhase(subMode === "fun" ? "fun-waiting" : "voted-waiting");
    } catch (e) {
      console.error(e);
      alert("전송 실패");
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
  }

  async function handleLeadConfirm() {
    if (submitting) return;
    setSubmitting(true);
    try {
      await submitNeomoyaScoreLeadAnswers(code, myStepAnswers);
      setPhase("result");
    } catch (e) {
      console.error(e);
      alert("전송 실패");
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
  }

  // ============ 준비 체크 ============
  async function handleMarkReadyReveal() {
    await markReady(code, room.currentRound, "reveal", myPlayerId);
  }

  async function handleMarkReadyNext() {
    await markReady(code, room.currentRound, "next", myPlayerId);
  }

  const isHost = (room.players?.[myPlayerId] || {}).isHost;
  const readyReveal = room.readyState?.[room.currentRound]?.reveal || {};
  const readyNext = room.readyState?.[room.currentRound]?.next || {};
  const activePlayerIds = players.map((p) => p.id);
  const readyRevealCount = activePlayerIds.filter((id) => readyReveal[id]).length;
  const readyNextCount = activePlayerIds.filter((id) => readyNext[id]).length;
  const totalPlayerCount = players.length;
  const myReadyReveal = !!readyReveal[myPlayerId];
  const myReadyNext = !!readyNext[myPlayerId];

  // 점수 모드 자동 트리거
  useEffect(() => {
    if (subMode !== "score") return;
    if (!isHost) return;
    if (phase !== "result") return;
    if (currentResult?.revealed) return;
    if (readyRevealCount === totalPlayerCount && totalPlayerCount > 0) {
      revealNeomoyaScoreResult(code, room.currentRound);
    }
  }, [subMode, isHost, phase, readyRevealCount, totalPlayerCount, currentResult?.revealed]); // eslint-disable-line

  const nextTriggeredRef = useRef({});
  useEffect(() => {
    if (subMode !== "score") return;
    if (!isHost) return;
    if (phase !== "reveal") return;
    if (readyNextCount === totalPlayerCount && totalPlayerCount > 0) {
      const key = `${room.currentRound}`;
      if (nextTriggeredRef.current[key]) return;
      nextTriggeredRef.current[key] = true;
      nextRound(code);
    }
  }, [subMode, isHost, phase, readyNextCount, totalPlayerCount]); // eslint-disable-line

  // 재미 모드: 모두 답변 완료 → 방장이 자동 finish
  // (ref 안 씀 - finishNeomoyaFun이 status를 finished로 바꾸면 가드에 걸려 중복 방지됨)
  useEffect(() => {
    if (subMode !== "fun") return;
    if (!isHost) return;
    if (room.status === "finished") return;
    if (funSubmittedCount === totalPlayerCount && totalPlayerCount > 0) {
      finishNeomoyaFun(code);
    }
  }, [subMode, isHost, funSubmittedCount, totalPlayerCount, room.status]); // eslint-disable-line

  // ============ 렌더 ============
  if (phase === "intro") {
    return <IntroScreen
      subMode={subMode}
      round={room.currentRound}
      totalRounds={room.totalRounds}
      leadPlayer={leadPlayer}
      players={players}
      count={count}
      onComplete={() => setPhase(computeNextPhase())}
    />;
  }

  // 재미 모드: 답변 대기
  if (subMode === "fun" && phase === "fun-waiting") {
    const submittedIds = funAnswers.map((a) => a.playerId);
    const list = buildProgressList("fun", submittedIds);
    return <FunWaitingView submittedCount={funSubmittedCount} totalCount={totalPlayerCount} progressList={list} myPlayerId={myPlayerId} />;
  }

  // 재미 모드: 최종 결과
  if (subMode === "fun" && phase === "fun-result") {
    return (
      <FunResultView
        funAnswers={funAnswers}
        scenarios={scenarios}
        players={players}
        myPlayerId={myPlayerId}
        isHost={isHostProp}
        onFinish={onFinish}
        onRestart={onRestart}
        onReturnToWaiting={onReturnToWaiting}
      />
    );
  }

  // 점수 모드 - 선플레이어 대기 (일반 유저들 진행도 표시)
  if (phase === "lead-waiting" && isLead) {
    const submittedIds = currentVotes.map((v) => v.playerId);
    const list = buildProgressList("scoreVote", submittedIds, [myPlayerId]); // 선플 본인 제외
    return <WaitingDark round={room.currentRound} totalRounds={room.totalRounds} votedCount={submittedVotesCount} totalCount={nonLeadCount} progressList={list} />;
  }

  // 투표/답변 입력 팝업
  if (phase === "voting-popup" || phase === "lead-answering") {
    const step = myStepAnswers.length;
    const scenario = scenarios[step];
    return (
      <PopupBackground room={room} leadPlayer={leadPlayer} subMode={subMode} step={step + 1} total={count} isLead={isLead}>
        <ScenarioPopup
          open={true}
          currentStep={step + 1}
          totalSteps={count}
          scenario={scenario}
          onAnswer={handleStepAnswer}
          leadPlayer={leadPlayer}
          isLead={isLead}
          subMode={subMode}
        />
      </PopupBackground>
    );
  }

  // 최종 확인
  if (phase === "voting-confirm" || phase === "lead-confirm") {
    return (
      <ConfirmView
        round={room.currentRound}
        totalRounds={room.totalRounds}
        leadPlayer={leadPlayer}
        scenarios={scenarios}
        myAnswers={myStepAnswers}
        isLead={isLead}
        subMode={subMode}
        onConfirm={isLead ? handleLeadConfirm : handleVoteConfirm}
        submitting={submitting}
      />
    );
  }

  // 점수 모드: 투표 완료 후 대기
  if (phase === "voted-waiting" && !isLead) {
    // 모든 일반 플레이어가 투표를 마쳤는지
    const allVotersSubmitted = submittedVotesCount >= nonLeadCount && nonLeadCount > 0;

    if (!allVotersSubmitted) {
      // 아직 다른 일반 플레이어들이 투표 중
      const submittedIds = currentVotes.map((v) => v.playerId);
      const list = buildProgressList("scoreVote", submittedIds, [leadPlayer?.id].filter(Boolean));
      return (
        <div style={{ ...containerStyle, justifyContent: "center", alignItems: "center", padding: "0 16px" }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>⏳</div>
          <p style={{ fontSize: 14, fontWeight: 700, color: colors.text1, margin: "0 0 4px" }}>
            예측 완료!
          </p>
          <p style={{ fontSize: 12, color: colors.text3, margin: "0 0 10px" }}>
            다른 친구들이 예측 중이에요
          </p>
          <div style={{ marginBottom: 14, padding: "4px 14px", borderRadius: 100, background: colors.accentBg, fontSize: 13, fontWeight: 700, color: colors.accentDeep }}>
            완료 {submittedVotesCount} / {nonLeadCount}
          </div>
          {list.length > 0 && (
            <div style={{ width: "100%", maxWidth: 300, display: "flex", flexDirection: "column", gap: 6 }}>
              {list.map((p) => {
                const isMe = p.id === myPlayerId;
                return (
                  <div key={p.id} style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "8px 12px", borderRadius: 10,
                    background: p.done ? colors.correctBg : colors.surface,
                    border: `1px solid ${p.done ? colors.correctFill : colors.border1}`,
                  }}>
                    <span style={{ fontSize: 12, fontWeight: isMe ? 700 : 600, flex: 1, color: colors.text1 }}>
                      {p.nickname}
                    </span>
                    {p.done ? (
                      <span style={{ fontSize: 11, fontWeight: 700, color: colors.correctText }}>✓ 완료</span>
                    ) : (
                      <span style={{ fontSize: 11, fontWeight: 700, color: colors.text3 }}>
                        {p.current} / {p.total}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    // 모든 일반 플레이어 투표 완료 → 선플레이어 답변 중 (현재 시나리오 실시간 공유)
    const leadProgress = leadPlayer ? (progressData.scoreLead[leadPlayer.id] || 0) : 0;
    const leadDone = !!leadAnswers;
    const leadCurrentStep = room.leadProgress?.[room.currentRound] ?? 0;
    const currentScenario = !leadDone && scenarios[leadCurrentStep];
    return (
      <div style={{ ...containerStyle, padding: "14px 12px 16px", justifyContent: "center" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, fontSize: 11, color: colors.text3 }}>
          <span style={{ fontWeight: 600 }}>Round {room.currentRound} / {room.totalRounds}</span>
          <span style={{ color: colors.accentText, fontWeight: 600 }}>🙈 선플레이어: {leadPlayer?.nickname}</span>
        </div>

        <div style={{ textAlign: "center", marginBottom: 12 }}>
          <p style={{ fontSize: 12, color: colors.accentDeep, fontWeight: 700, margin: 0 }}>
            🙈 {leadPlayer?.nickname} 답변 중...
          </p>
          <p style={{ fontSize: 10, color: colors.text3, margin: "2px 0 0" }}>
            {leadDone ? `${count}/${count}` : `${Math.min(leadCurrentStep + 1, count)} / ${count}`} · 같은 시나리오를 함께 봐요
          </p>
        </div>

        {/* 현재 선플레이어가 보는 시나리오 - 큰 카드 */}
        {currentScenario && (
          <div style={{
            padding: "20px 16px", borderRadius: radius.lg,
            background: colors.cardBg, border: `2px solid ${colors.cardBorderDeep}`,
            marginBottom: 14, boxShadow: shadow.cardLift,
          }}>
            <p style={{ fontSize: 10, color: colors.accentText, fontWeight: 700, margin: "0 0 8px", textAlign: "center" }}>
              지금 이 시나리오에 답하는 중
            </p>
            <p style={{ fontSize: 14, fontWeight: 700, color: colors.text1, margin: "0 0 14px", lineHeight: 1.4, wordBreak: "keep-all", textAlign: "center" }}>
              {currentScenario.scenario}
            </p>
            {/* A/B 옵션 - 답은 가림 */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{
                padding: "10px 12px", borderRadius: radius.md,
                background: colors.surface, border: `1.5px solid ${colors.border2}`,
                display: "flex", alignItems: "center", gap: 8,
              }}>
                <span style={{
                  fontSize: 11, fontWeight: 800, padding: "2px 9px", borderRadius: 100,
                  background: colors.accentBg, color: colors.accentDeep,
                }}>A</span>
                <span style={{ fontSize: 12, color: colors.text2, flex: 1, lineHeight: 1.3 }}>{currentScenario.optionA}</span>
              </div>
              <div style={{
                padding: "10px 12px", borderRadius: radius.md,
                background: colors.surface, border: `1.5px solid ${colors.border2}`,
                display: "flex", alignItems: "center", gap: 8,
              }}>
                <span style={{
                  fontSize: 11, fontWeight: 800, padding: "2px 9px", borderRadius: 100,
                  background: colors.accentBg, color: colors.accentDeep,
                }}>B</span>
                <span style={{ fontSize: 12, color: colors.text2, flex: 1, lineHeight: 1.3 }}>{currentScenario.optionB}</span>
              </div>
            </div>
            <p style={{ fontSize: 10, color: colors.text3, margin: "10px 0 0", textAlign: "center", fontStyle: "italic" }}>
              🤫 선플레이어의 선택은 정답 공개 때 확인할 수 있어요
            </p>
          </div>
        )}

        {leadDone && (
          <div style={{ padding: "16px", borderRadius: radius.lg, background: colors.surface, border: `1.5px solid ${colors.border1}`, textAlign: "center" }}>
            <p style={{ fontSize: 14, fontWeight: 700, color: colors.text1, margin: 0 }}>
              ✨ 답변 완료! 결과 정리 중...
            </p>
          </div>
        )}
      </div>
    );
  }

  // 점수 모드: 결과 (정답자 공개 전)
  if (phase === "result") {
    return (
      <ResultView
        room={room}
        leadPlayer={leadPlayer}
        scenarios={scenarios}
        leadAnswers={leadAnswers || []}
        myAnswers={isLead ? leadAnswers || [] : myStepAnswers}
        isLead={isLead}
        onMarkReady={handleMarkReadyReveal}
        isReady={myReadyReveal}
        readyCount={readyRevealCount}
        totalCount={totalPlayerCount}
      />
    );
  }

  // 점수 모드: 정답 공개
  if (phase === "reveal") {
    return (
      <RevealView
        room={room}
        players={players}
        leadPlayer={leadPlayer}
        scenarios={scenarios}
        leadAnswers={leadAnswers || []}
        votes={currentVotes}
        myPlayerId={myPlayerId}
        myAnswers={myStepAnswers}
        isLead={isLead}
        isLastRound={room.currentRound >= room.totalRounds}
        onMarkReady={handleMarkReadyNext}
        isReady={myReadyNext}
        readyCount={readyNextCount}
        totalCount={totalPlayerCount}
      />
    );
  }

  return null;
}

// ============================================
// 인트로
// ============================================
function IntroScreen({ subMode, round, totalRounds, leadPlayer, players, count, onComplete }) {
  // 마운트 시 2.5초 후 onComplete 호출 (stale closure 문제 회피)
  useEffect(() => {
    if (!onComplete) return;
    const t = setTimeout(() => onComplete(), 2500);
    return () => clearTimeout(t);
  }, [onComplete]);

  return (
    <div style={{ ...containerStyle, justifyContent: "center", alignItems: "center", padding: "20px 12px" }}>
      <div style={{ textAlign: "center", marginBottom: 16 }}>
        <p style={{ fontSize: 11, color: colors.text3, letterSpacing: 1.2, margin: "0 0 4px", fontWeight: 600 }}>
          {subMode === "fun" ? "FUN MODE" : `ROUND ${round} / ${totalRounds}`}
        </p>
        <p style={{ fontSize: 17, fontWeight: 700, color: colors.text1, margin: 0 }}>
          🎭 너모야 시작!
        </p>
      </div>

      {subMode === "score" && leadPlayer && (
        <div style={{
          padding: "24px 20px", borderRadius: radius.xl, textAlign: "center",
          background: colors.cardBg, border: `2px solid ${colors.cardBorderDeep}`,
          marginBottom: 20, boxShadow: shadow.cardLift,
        }}>
          <Avatar nickname={leadPlayer.nickname} colorIndex={(players || []).findIndex((p) => p.id === leadPlayer.id)} size={72} style={{ marginBottom: 12 }} />
          <div style={{ fontSize: 24, fontWeight: 700, color: colors.accentDeep, marginBottom: 4 }}>
            {leadPlayer.nickname}
          </div>
          <div style={{ fontSize: 12, color: colors.accentText, fontWeight: 600 }}>
            오늘의 선플레이어 🎯
          </div>
        </div>
      )}

      <p style={{ fontSize: 13, color: colors.text2, textAlign: "center", lineHeight: 1.5, margin: 0 }}>
        {subMode === "fun" ? (
          <>
            <strong>{count}개</strong> 시나리오에<br />각자 답해보세요 💭
          </>
        ) : (
          <>
            {josa(leadPlayer?.nickname || "", "을/를")} 향한 <strong>{count}개</strong>의 시나리오!<br />
            어떻게 답할지 맞춰보세요 🎯
          </>
        )}
      </p>
    </div>
  );
}

// ============================================
// 팝업 배경
// ============================================
function PopupBackground({ room, leadPlayer, subMode, step, total, isLead, children }) {
  return (
    <>
      {/* 배경 (흐릿하게) */}
      <div style={{ ...containerStyle, padding: "14px 12px 16px", justifyContent: "center", opacity: 0.4 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, fontSize: 11, color: colors.text3 }}>
          <span style={{ fontWeight: 600 }}>
            {subMode === "fun" ? "너모야 · 재미 모드" : `Round ${room.currentRound} / ${room.totalRounds}`}
          </span>
          <span style={{ color: subMode === "fun" ? colors.accentText : (isLead ? colors.correctText : colors.accentText), fontWeight: 600 }}>
            {subMode === "fun" ? "🎭 각자 답하기" : (isLead ? "🙈 내가 선플레이어" : `🙈 선플레이어: ${leadPlayer?.nickname || ""}`)}
          </span>
        </div>
        <p style={{ textAlign: "center", fontSize: 14, fontWeight: 600, color: colors.text2 }}>
          {subMode === "fun"
            ? "시나리오에 솔직하게 답하는 중..."
            : (isLead ? "내 답변 입력 중..." : `${josa(leadPlayer?.nickname || "", "이/가")} 어떻게 답할지 예측 중...`)}
        </p>
      </div>
      {/* 팝업 (position: fixed 라 자체적으로 화면 중앙) */}
      {children}
    </>
  );
}

// ============================================
// 선플레이어 대기 (점수 모드)
// ============================================
function WaitingDark({ round, totalRounds, votedCount, totalCount, progressList }) {
  return (
    <div style={{ ...containerStyle, background: "#2a2520", color: "#FFF8F0", justifyContent: "center", alignItems: "center", padding: "0 16px" }}>
      <p style={{ fontSize: 11, opacity: 0.6, letterSpacing: 1, margin: 0 }}>ROUND {round} / {totalRounds}</p>
      <div style={{ fontSize: 36, margin: "12px 0 6px" }}>👀</div>
      <p style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>친구들이 예측 중...</p>
      <div style={{ marginTop: 10, marginBottom: 14, padding: "4px 14px", borderRadius: 100, background: "rgba(255,255,255,0.12)", fontSize: 13, fontWeight: 700 }}>
        완료 {votedCount} / {totalCount}
      </div>

      {/* 진행도 리스트 */}
      {progressList && progressList.length > 0 && (
        <div style={{ width: "100%", maxWidth: 280, display: "flex", flexDirection: "column", gap: 6 }}>
          {progressList.map((p) => (
            <div key={p.id} style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "7px 12px", borderRadius: 10,
              background: p.done ? "rgba(43,186,140,0.2)" : "rgba(255,255,255,0.07)",
            }}>
              <span style={{ fontSize: 12, fontWeight: 600, flex: 1, color: "#FFF8F0" }}>
                {p.nickname}
              </span>
              {p.done ? (
                <span style={{ fontSize: 11, fontWeight: 700, color: "#5FD9AE" }}>✓ 완료</span>
              ) : (
                <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.7 }}>
                  {p.current} / {p.total}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <p style={{ fontSize: 11, opacity: 0.5, marginTop: 12 }}>모두 끝나면 내 차례</p>
    </div>
  );
}

// ============================================
// 최종 확인 화면
// ============================================
function ConfirmView({ round, totalRounds, leadPlayer, scenarios, myAnswers, isLead, subMode, onConfirm, submitting }) {
  return (
    <div style={{ ...containerStyle, padding: "14px 12px 16px", justifyContent: "center" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, fontSize: 11, color: colors.text3 }}>
        <span style={{ fontWeight: 600 }}>
          {subMode === "fun" ? "너모야 (재미)" : `Round ${round} / ${totalRounds}`}
        </span>
        <span style={{ color: subMode === "fun" ? colors.accentText : (isLead ? colors.correctText : colors.accentText), fontWeight: 600 }}>
          {subMode === "fun" ? "🎭 내 답변" : (isLead ? "🙈 내가 선플레이어" : `🙈 선플레이어: ${leadPlayer?.nickname}`)}
        </span>
      </div>

      <div style={{ textAlign: "center", marginBottom: 12 }}>
        <p style={{ fontSize: 13, fontWeight: 700, margin: 0, color: colors.text1 }}>
          {subMode === "fun" ? "💭 내가 고른 답" : (isLead ? "🎯 나의 답변 확인" : `💭 내가 예상한 ${leadPlayer?.nickname}의 답변`)}
        </p>
        <p style={{ fontSize: 10, color: colors.text3, margin: "4px 0 0" }}>
          맞다면 확정해주세요
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
        {scenarios.map((s, i) => (
          <ScenarioAnswerRow key={i} index={i + 1} scenario={s} answer={myAnswers[i]} />
        ))}
      </div>

      <button
        onClick={onConfirm}
        disabled={submitting}
        style={{
          padding: 13, borderRadius: radius.lg,
          background: `linear-gradient(180deg, ${colors.correctFillLight} 0%, ${colors.correctFill} 100%)`,
          color: "#FFFFFF", fontSize: 14, fontWeight: 700,
          border: "none", boxShadow: shadow.button,
          cursor: submitting ? "default" : "pointer",
          fontFamily: "inherit", opacity: submitting ? 0.7 : 1,
        }}
      >
        {submitting ? "전송 중..." : "✨ 답변 확정"}
      </button>
    </div>
  );
}

// 시나리오 + 내 답변 1행 (펼침 가능)
function ScenarioAnswerRow({ index, scenario, answer }) {
  const [expanded, setExpanded] = useState(false);
  const truncated = scenario.scenario.length > 30;
  const displayText = !expanded && truncated ? scenario.scenario.substring(0, 30) + "..." : scenario.scenario;
  const myChoice = answer === "A" ? scenario.optionA : scenario.optionB;
  const myColor = answer === "A" ? colors.correctFill : colors.wrongFill;

  return (
    <div
      onClick={() => truncated && setExpanded(!expanded)}
      style={{
        padding: "8px 10px",
        borderRadius: radius.md,
        background: colors.surface,
        border: `1px solid ${colors.border1}`,
        cursor: truncated ? "pointer" : "default",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 10, color: colors.text3, fontWeight: 700, minWidth: 14, marginTop: 2 }}>{index}</span>
        <span style={{ fontSize: 12, color: colors.text1, flex: 1, wordBreak: "keep-all", fontWeight: 500, lineHeight: 1.4 }}>
          {displayText}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 20 }}>
        <span style={{
          fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 100,
          background: myColor, color: "#FFFFFF",
        }}>
          {answer}
        </span>
        <span style={{ fontSize: 11, color: colors.text1, fontWeight: 600 }}>
          {myChoice}
        </span>
      </div>
    </div>
  );
}

// ============================================
// 점수 모드 - 결과 (정답자 공개 직전)
// ============================================
function ResultView({ room, leadPlayer, scenarios, leadAnswers, myAnswers, isLead, onMarkReady, isReady, readyCount, totalCount }) {
  return (
    <div style={{ ...containerStyle, padding: "14px 12px 16px", justifyContent: "center" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, fontSize: 11, color: colors.text3 }}>
        <span style={{ fontWeight: 600 }}>Round {room.currentRound} / {room.totalRounds}</span>
        <span style={{ color: isLead ? colors.correctText : colors.accentText, fontWeight: 600 }}>
          🙈 {isLead ? "내가 선플레이어" : `선플레이어: ${leadPlayer?.nickname}`}
        </span>
      </div>

      <div style={{ textAlign: "center", marginBottom: 14 }}>
        <p style={{ fontSize: 14, fontWeight: 700, margin: 0, color: colors.text1 }}>
          {isLead ? "✓ 내 답변 완료" : `✓ ${leadPlayer?.nickname}의 답변 완료`}
        </p>
        <p style={{ fontSize: 11, color: colors.text3, margin: "4px 0 0" }}>
          {isLead ? "친구들의 예측을 확인해보세요" : "내 예측이 얼마나 맞았을까?"}
        </p>
      </div>

      {isLead && (
        <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 14 }}>
          {scenarios.map((s, i) => (
            <ScenarioAnswerRow key={i} index={i + 1} scenario={s} answer={leadAnswers[i]} />
          ))}
        </div>
      )}

      <ReadyButton
        isReady={isReady}
        readyCount={readyCount}
        totalCount={totalCount}
        onClick={onMarkReady}
        actionLabel="🎉 정답자 공개"
      />
    </div>
  );
}

// ============================================
// 점수 모드 - 정답 공개
// ============================================
function RevealView({ room, players, leadPlayer, scenarios, leadAnswers, votes, myPlayerId, isLead, isLastRound, onMarkReady, isReady, readyCount, totalCount }) {
  const myVote = votes.find((v) => v.playerId === myPlayerId);
  const myMatchCount = myVote?.matchCount ?? 0;
  const count = scenarios.length;

  function getVotersForScenario(qIdx, answer) {
    return votes
      .filter((v) => v.voteArray && v.voteArray[qIdx] === answer)
      .map((v) => players.find((p) => p.id === v.playerId))
      .filter(Boolean);
  }

  const voterResults = [...votes]
    .map((v) => ({ ...v, player: players.find((p) => p.id === v.playerId) }))
    .filter((v) => v.player)
    .sort((a, b) => (b.matchCount || 0) - (a.matchCount || 0));

  return (
    <div style={{ ...containerStyle, padding: "14px 12px 16px", justifyContent: "center" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12, fontSize: 11, color: colors.text3 }}>
        <span style={{ fontWeight: 600 }}>Round {room.currentRound} / {room.totalRounds}</span>
        <span style={{ color: colors.accentText, fontWeight: 600 }}>🎉 정답 공개</span>
      </div>

      {/* 상단 맥락 강조 - 누구 답인지 + 내 점수 */}
      <div style={{
        textAlign: "center", marginBottom: 14,
        padding: "14px 16px", borderRadius: radius.lg,
        background: colors.cardBg, border: `2px solid ${colors.cardBorderDeep}`,
      }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: colors.accentDeep, margin: "0 0 2px" }}>
          🙈 {isLead ? "내 답변" : `${leadPlayer?.nickname}의 답변`} 공개!
        </p>
        {isLead ? (
          <p style={{ fontSize: 11, color: colors.text3, margin: "4px 0 0" }}>
            친구들이 얼마나 맞췄을까요?
          </p>
        ) : (
          <p style={{ fontSize: 20, fontWeight: 800, color: myMatchCount > count / 2 ? colors.correctText : colors.text2, margin: "6px 0 0" }}>
            {myMatchCount} <span style={{ fontSize: 13, color: colors.text3, fontWeight: 600 }}>/ {count} 맞춤</span>
          </p>
        )}
      </div>

      {/* 시나리오별 - 위계 정리 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
        {scenarios.map((s, i) => {
          const correctAns = leadAnswers[i];
          const myAns = myVote?.voteArray?.[i];
          const aVoters = getVotersForScenario(i, "A");
          const bVoters = getVotersForScenario(i, "B");
          return (
            <ScenarioRevealRow
              key={i}
              index={i + 1}
              scenario={s}
              correctAns={correctAns}
              myAns={myAns}
              isLead={isLead}
              aVoters={aVoters}
              bVoters={bVoters}
              myPlayerId={myPlayerId}
            />
          );
        })}
      </div>

      {/* 점수 표 */}
      <div style={{ padding: "10px 12px", borderRadius: radius.md, background: colors.surface, border: `1px solid ${colors.border1}`, marginBottom: 12 }}>
        <p style={{ fontSize: 11, color: colors.text3, margin: "0 0 8px", fontWeight: 700 }}>
          🏆 이번 라운드 점수
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {voterResults.map((v) => (
            <div key={v.playerId} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              <Avatar nickname={v.player.nickname} colorIndex={players.findIndex((p) => p.id === v.playerId)} size={20} />
              <span style={{ flex: 1, color: colors.text1, fontWeight: v.playerId === myPlayerId ? 700 : 400 }}>
                {v.player.nickname}{v.playerId === myPlayerId && " (나)"}
              </span>
              <span style={{ fontWeight: 700, color: colors.correctText }}>
                +{v.matchCount || 0}점
              </span>
              <span style={{ fontSize: 10, color: colors.text3 }}>
                ({v.matchCount || 0}/{count})
              </span>
            </div>
          ))}
        </div>
      </div>

      <ReadyButton
        isReady={isReady}
        readyCount={readyCount}
        totalCount={totalCount}
        onClick={onMarkReady}
        actionLabel={isLastRound ? "🎊 최종 결과 보기" : "▶ 다음 라운드"}
      />
    </div>
  );
}

// 시나리오 1개 - A/B 둘 다 표시, 선플레이어가 고른 칸만 색상박스
function ScenarioRevealRow({ index, scenario, correctAns, myAns, isLead, aVoters, bVoters, myPlayerId }) {
  const [expanded, setExpanded] = useState(false);
  const truncated = scenario.scenario.length > 35;
  const displayText = !expanded && truncated ? scenario.scenario.substring(0, 35) + "..." : scenario.scenario;

  return (
    <div style={{
      borderRadius: radius.md,
      background: colors.surface,
      border: `1px solid ${colors.border1}`,
      overflow: "hidden",
    }}>
      <div style={{ padding: "10px 12px" }}>
        {/* 시나리오 텍스트 */}
        <div
          onClick={() => truncated && setExpanded(!expanded)}
          style={{ display: "flex", alignItems: "flex-start", gap: 6, marginBottom: 8, cursor: truncated ? "pointer" : "default" }}
        >
          <span style={{ fontSize: 10, color: colors.text3, fontWeight: 700, minWidth: 14, marginTop: 2 }}>{index}</span>
          <span style={{ fontSize: 12, color: colors.text1, flex: 1, wordBreak: "keep-all", fontWeight: 600, lineHeight: 1.4 }}>{displayText}</span>
        </div>

        {/* A / B 둘 다 표시 - 선플레이어가 고른 칸만 강조 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <RevealOptionLine
            label="A"
            optionText={scenario.optionA}
            voters={aVoters}
            isLeadChoice={correctAns === "A"}
            myPlayerId={myPlayerId}
            myAnswer={myAns}
            isLead={isLead}
          />
          <RevealOptionLine
            label="B"
            optionText={scenario.optionB}
            voters={bVoters}
            isLeadChoice={correctAns === "B"}
            myPlayerId={myPlayerId}
            myAnswer={myAns}
            isLead={isLead}
          />
        </div>
      </div>
    </div>
  );
}

// 정답 공개 - 선택지 1줄 (A 또는 B), 선플레이어가 고른 칸이면 강조
function RevealOptionLine({ label, optionText, voters, isLeadChoice, myPlayerId, myAnswer, isLead }) {
  // 우측 라벨 결정
  // - 선플레이어 본인: 본인이 고른 칸에 "✓ 내 답"
  // - 일반 플레이어: 내가 맞춘 칸 (= 내 예측 == 선플 선택)에 "✓ 정답"
  let rightLabel = null;
  if (isLead) {
    if (isLeadChoice) rightLabel = "✓ 내 답";
  } else {
    if (myAnswer === label && isLeadChoice) rightLabel = "✓ 정답";
  }

  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 8,
      padding: "7px 9px",
      borderRadius: radius.sm,
      background: isLeadChoice ? colors.accentBg : colors.surface2,
      border: isLeadChoice ? `1.5px solid ${colors.accentText}` : `1px solid ${colors.border1}`,
    }}>
      <span style={{
        fontSize: 11, fontWeight: 800,
        padding: "2px 9px", borderRadius: 100,
        background: isLeadChoice ? colors.accentText : colors.border2,
        color: "#FFFFFF",
        minWidth: 24, textAlign: "center", flexShrink: 0,
      }}>
        {label}
      </span>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{
          fontSize: 11,
          color: isLeadChoice ? colors.accentDeep : colors.text2,
          fontWeight: isLeadChoice ? 700 : 500,
          lineHeight: 1.3,
        }}>
          {optionText}
        </span>
        {voters.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {(() => {
              const sorted = [...voters].sort((a, b) => {
                if (a.id === myPlayerId) return -1;
                if (b.id === myPlayerId) return 1;
                return 0;
              });
              return sorted.map((v, i) => {
                const isMe = v.id === myPlayerId;
                return (
                  <span key={v.id} style={{
                    fontSize: 10,
                    color: isMe ? colors.accentText : colors.text3,
                    fontWeight: isMe ? 800 : 500,
                  }}>
                    {v.nickname}{i < sorted.length - 1 && <span style={{ opacity: 0.3, marginLeft: 4 }}>·</span>}
                  </span>
                );
              });
            })()}
          </div>
        ) : (
          <span style={{ fontSize: 9, color: colors.text3, fontStyle: "italic" }}>
            선택자 없음
          </span>
        )}
      </div>
      {rightLabel && (
        <span style={{ fontSize: 9, color: colors.accentText, fontWeight: 700, flexShrink: 0, marginTop: 2 }}>
          {rightLabel}
        </span>
      )}
    </div>
  );
}

// ============================================
// 재미 모드 - 답변 후 대기
// ============================================
function FunWaitingView({ submittedCount, totalCount, progressList, myPlayerId }) {
  return (
    <div style={{ ...containerStyle, justifyContent: "center", alignItems: "center", padding: "0 16px" }}>
      <div style={{ fontSize: 32, marginBottom: 8 }}>⏳</div>
      <p style={{ fontSize: 14, fontWeight: 700, color: colors.text1, margin: "0 0 4px" }}>
        답변 완료!
      </p>
      <p style={{ fontSize: 12, color: colors.text3, margin: "0 0 10px" }}>
        다른 친구들을 기다리는 중
      </p>
      <div style={{ marginBottom: 14, padding: "4px 14px", borderRadius: 100, background: colors.accentBg, fontSize: 13, fontWeight: 700, color: colors.accentDeep }}>
        완료 {submittedCount} / {totalCount}
      </div>

      {/* 진행도 리스트 */}
      {progressList && progressList.length > 0 && (
        <div style={{ width: "100%", maxWidth: 300, display: "flex", flexDirection: "column", gap: 6 }}>
          {progressList.map((p) => {
            const isMe = p.id === myPlayerId;
            return (
              <div key={p.id} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "8px 12px", borderRadius: 10,
                background: p.done ? colors.correctBg : colors.surface,
                border: `1px solid ${p.done ? colors.correctFill : colors.border1}`,
              }}>
                <span style={{ fontSize: 12, fontWeight: isMe ? 700 : 600, flex: 1, color: colors.text1 }}>
                  {p.nickname}{isMe && " (나)"}
                </span>
                {p.done ? (
                  <span style={{ fontSize: 11, fontWeight: 700, color: colors.correctText }}>✓ 완료</span>
                ) : (
                  <span style={{ fontSize: 11, fontWeight: 700, color: colors.text3 }}>
                    {p.current} / {p.total}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================
// 재미 모드 - 최종 결과
// ============================================
function FunResultView({ funAnswers, scenarios, players, myPlayerId, isHost, onFinish, onRestart, onReturnToWaiting }) {
  const stats = useMemo(() => calculateFunModeStats(funAnswers, scenarios), [funAnswers, scenarios]);
  const playerById = useMemo(() => {
    const m = {};
    for (const p of players) m[p.id] = p;
    return m;
  }, [players]);

  function nick(pid) {
    return playerById[pid]?.nickname || "?";
  }

  function colorIdx(pid) {
    return players.findIndex((p) => p.id === pid);
  }

  return (
    <div style={{ ...containerStyle, padding: "16px 12px 16px", justifyContent: "center" }}>
      <div style={{ textAlign: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 32, marginBottom: 4 }}>🎊</div>
        <p style={{ fontSize: 17, fontWeight: 700, color: colors.text1, margin: 0 }}>
          오늘의 너모야!
        </p>
      </div>

      {/* 영혼의 단짝 톱3 */}
      <div style={{
        padding: "12px 14px", borderRadius: radius.lg, marginBottom: 12,
        background: colors.pinkBg, border: `1px solid ${colors.pinkBorder}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
          <span style={{ fontSize: 16 }}>👯</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: colors.pinkText }}>
            오늘의 영혼의 단짝
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {stats.soulmatePairs.map((pair, idx) => {
            const medals = ["🥇", "🥈", "🥉"];
            return (
              <div key={`${pair.p1}-${pair.p2}`} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 18, width: 24, textAlign: "center" }}>{medals[idx]}</span>
                <Avatar nickname={nick(pair.p1)} colorIndex={colorIdx(pair.p1)} size={24} />
                <span style={{ fontSize: 12, fontWeight: 700, color: colors.pinkDeep }}>{nick(pair.p1)}</span>
                <span style={{ fontSize: 10, color: colors.text3 }}>,</span>
                <Avatar nickname={nick(pair.p2)} colorIndex={colorIdx(pair.p2)} size={24} />
                <span style={{ fontSize: 12, fontWeight: 700, color: colors.pinkDeep }}>{nick(pair.p2)}</span>
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 10, color: colors.pinkText, fontWeight: 600 }}>
                  {pair.total}개 중 {pair.matchCount}개
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 가장 독특한 사람 */}
      {stats.mostUnique && (
        <div style={{
          padding: "10px 14px", borderRadius: radius.lg, marginBottom: 12,
          background: colors.surface, border: `1px solid ${colors.border1}`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <span style={{ fontSize: 16 }}>🦄</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: colors.text3 }}>
              가장 독특한 사람
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Avatar nickname={nick(stats.mostUnique.playerId)} colorIndex={colorIdx(stats.mostUnique.playerId)} size={26} />
            <span style={{ fontSize: 13, fontWeight: 700, color: colors.text1 }}>{nick(stats.mostUnique.playerId)}</span>
            <span style={{ fontSize: 11, color: colors.text3 }}>
              — {stats.mostUnique.count}번이나 혼자 다른 답!
            </span>
          </div>
        </div>
      )}

      {/* 정반대 영혼 톱3 */}
      <div style={{
        padding: "12px 14px", borderRadius: radius.lg, marginBottom: 12,
        background: colors.surface2, border: `1px solid ${colors.border1}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
          <span style={{ fontSize: 16 }}>🌗</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: colors.text3 }}>
            정반대 영혼
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {stats.oppositePairs.map((pair) => (
            <div key={`${pair.p1}-${pair.p2}`} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Avatar nickname={nick(pair.p1)} colorIndex={colorIdx(pair.p1)} size={20} />
              <span style={{ fontSize: 11, fontWeight: 600, color: colors.text1 }}>{nick(pair.p1)}</span>
              <span style={{ fontSize: 10, color: colors.text3 }}>↔</span>
              <Avatar nickname={nick(pair.p2)} colorIndex={colorIdx(pair.p2)} size={20} />
              <span style={{ fontSize: 11, fontWeight: 600, color: colors.text1 }}>{nick(pair.p2)}</span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 10, color: colors.text3 }}>
                {pair.total}개 중 {pair.matchCount}개
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 호불호 갈린 시나리오 톱3 */}
      <div style={{
        padding: "12px 14px", borderRadius: radius.lg, marginBottom: 16,
        background: colors.surface, border: `1px solid ${colors.border1}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
          <span style={{ fontSize: 16 }}>💝</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: colors.text3 }}>
            가장 호불호 갈린 시나리오
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {stats.divisiveQuestions.map((q, idx) => (
            <DivisiveScenarioRow key={idx} scenario={scenarios[q.scenarioIdx]} aCount={q.aCount} bCount={q.bCount} />
          ))}
        </div>
      </div>

      {isHost ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button
            onClick={onRestart}
            style={{
              padding: 13, borderRadius: radius.lg,
              background: `linear-gradient(180deg, ${colors.correctFillLight} 0%, ${colors.correctFill} 100%)`,
              color: "#FFFFFF", fontSize: 14, fontWeight: 700,
              border: "none", boxShadow: shadow.button,
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            🔄 같은 멤버로 다시 한판
          </button>
          <button
            onClick={onReturnToWaiting}
            style={{
              padding: 12, borderRadius: radius.lg,
              background: colors.surface, color: colors.text1,
              fontSize: 13, fontWeight: 600,
              border: `1.5px solid ${colors.border2}`,
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            ⚙️ 모드 바꿔서 다시하기
          </button>
          <button
            onClick={() => {
              if (window.confirm("방을 닫고 홈으로 돌아갈까요?\n(다른 친구들도 모두 나가게 돼요)")) {
                onFinish();
              }
            }}
            style={{
              padding: 11, borderRadius: radius.lg,
              background: "transparent", color: colors.text3,
              fontSize: 12, fontWeight: 600,
              border: "none", cursor: "pointer", fontFamily: "inherit",
            }}
          >
            방 나가기
          </button>
        </div>
      ) : (
        <div style={{ textAlign: "center" }}>
          <p style={{ fontSize: 12, color: colors.text3, margin: "0 0 10px" }}>
            방장이 다음 게임을 준비하고 있어요
          </p>
          <button
            onClick={() => {
              if (window.confirm("방에서 나가고 홈으로 돌아갈까요?")) {
                onFinish();
              }
            }}
            style={{
              padding: 11, borderRadius: radius.lg,
              background: "transparent", color: colors.text3,
              fontSize: 12, fontWeight: 600,
              border: `1px solid ${colors.border1}`,
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            방 나가기
          </button>
        </div>
      )}
    </div>
  );
}

function DivisiveScenarioRow({ scenario, aCount, bCount }) {
  const [expanded, setExpanded] = useState(false);
  const truncated = scenario.scenario.length > 35;
  const displayText = !expanded && truncated ? scenario.scenario.substring(0, 35) + "..." : scenario.scenario;
  return (
    <div
      onClick={() => truncated && setExpanded(!expanded)}
      style={{
        padding: "6px 8px", borderRadius: radius.sm,
        background: colors.surface2,
        cursor: truncated ? "pointer" : "default",
      }}
    >
      <p style={{ fontSize: 11, color: colors.text1, margin: "0 0 4px", lineHeight: 1.4, fontWeight: 500 }}>
        "{displayText}"
      </p>
      <p style={{ fontSize: 10, color: colors.text3, margin: 0 }}>
        → A {aCount}명 / B {bCount}명
      </p>
    </div>
  );
}

// ============================================
// 준비 버튼
// ============================================
function ReadyButton({ isReady, readyCount, totalCount, onClick, actionLabel }) {
  const percent = totalCount > 0 ? (readyCount / totalCount) * 100 : 0;

  if (isReady) {
    return (
      <div style={{
        padding: "14px 16px", borderRadius: radius.lg,
        background: colors.surface, border: `1.5px solid ${colors.border1}`,
        textAlign: "center",
      }}>
        <div style={{ fontSize: 12, color: colors.text2, fontWeight: 600, marginBottom: 8 }}>
          ⏳ 다른 친구들을 기다리는 중 · {readyCount}/{totalCount}
        </div>
        <div style={{ height: 4, borderRadius: 100, background: colors.surface2, overflow: "hidden" }}>
          <div
            style={{
              height: "100%", width: `${percent}%`,
              background: colors.correctFill, borderRadius: 100,
              transition: "width 0.4s",
            }}
          />
        </div>
        <div style={{ fontSize: 10, color: colors.text3, marginTop: 6 }}>
          모두 준비되면 자동으로 넘어가요
        </div>
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={onClick}
        style={{
          width: "100%", padding: 13, borderRadius: radius.lg,
          background: colors.accentBg, color: colors.accentDeep,
          fontSize: 14, fontWeight: 700,
          border: "none", boxShadow: "0 2px 4px rgba(83,74,183,0.15)",
          cursor: "pointer", fontFamily: "inherit",
        }}
      >
        {actionLabel} →
      </button>
      {readyCount > 0 && (
        <div style={{ fontSize: 10, color: colors.text3, textAlign: "center", marginTop: 6 }}>
          {readyCount}명이 먼저 준비됨 · 모두 준비되면 자동 진행
        </div>
      )}
    </div>
  );
}
