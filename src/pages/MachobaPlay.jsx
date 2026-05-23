import { useState, useEffect, useMemo, useRef } from "react";
import {
  submitMachobaVote,
  submitMachobaLeadAnswers,
  revealMachobaResult,
  updateMachobaProgress,
  updateLeadProgress,
  nextRound,
  markReady,
} from "../lib/room";
import { josa } from "../lib/game";
import Avatar from "../components/Avatar";
import StepPopup from "../components/StepPopup";
import { colors, radius, shadow, containerStyle } from "../lib/theme";

// 마쵸바 모드 게임 진행
export default function MachobaPlay({ room, code, myPlayerId, leadPlayer, players, onFinish }) {
  const [phase, setPhase] = useState("intro");
  // 단계별 답변 수집 (선플레이어와 투표자 공통)
  const [myStepAnswers, setMyStepAnswers] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  const isLead = room.currentLeadPlayerId === myPlayerId;
  const machoba = room.machoba;
  const count = machoba?.count || 5;
  const questions = machoba?.questions || [];
  const leadAnswers = machoba?.leadAnswers; // 선 플레이어 답변 (배열 or null)

  // 현재 라운드 votes
  const currentVotes = useMemo(() => {
    const v = (room.votes || {})[room.currentRound] || {};
    return Object.entries(v).map(([pid, data]) => ({
      playerId: pid,
      voteArray: data.voteArray,
      matchCount: data.matchCount,
    }));
  }, [room.votes, room.currentRound]);

  const myVote = currentVotes.find((v) => v.playerId === myPlayerId);
  const nonLeadCount = players.length - 1;
  const submittedVotesCount = currentVotes.length;
  const currentResult = (room.results || {})[room.currentRound];

  // 진행도 (몇 번째 문제까지 답했는지)
  const machobaProg = useMemo(() => {
    const prog = room.machobaProgress?.[room.currentRound] || {};
    return { vote: prog.vote || {}, lead: prog.lead || {} };
  }, [room.machobaProgress, room.currentRound]);

  // 일반 플레이어 진행도 리스트 (선플레이어 제외, 제출 완료자는 count 고정)
  function buildVoteProgressList() {
    const submittedIds = currentVotes.map((v) => v.playerId);
    return players
      .filter((p) => p.id !== leadPlayer?.id)
      .map((p) => {
        const done = submittedIds.includes(p.id);
        const cur = done ? count : (machobaProg.vote[p.id] || 0);
        return { id: p.id, nickname: p.nickname, current: cur, total: count, done };
      });
  }

  // ============ Phase 전환 ============
  function computeNextPhase() {
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
    if (myVote) {
      if (leadAnswers) return "result";
      return "voted-waiting";
    }
    return "voting-popup";
  }

  // 라운드 시작 인트로 (라운드 번호 바뀌면 intro phase 진입)
  // setTimeout은 IntroScreen 컴포넌트 내부에서 처리 (stale closure 회피)
  const lastRoundRef = useRef(null);
  useEffect(() => {
    if (room.status !== "playing") return;
    if (lastRoundRef.current !== room.currentRound) {
      lastRoundRef.current = room.currentRound;
      setPhase("intro");
      setMyStepAnswers([]);
    }
  }, [room.currentRound, room.status]);

  // 통합 phase
  useEffect(() => {
    if (room.status !== "playing") return;
    if (phase === "intro") return;
    if (phase === "voting-confirm" || phase === "lead-confirm") return;
    const next = computeNextPhase();
    if (next !== phase) setPhase(next);
  }, [
    phase, room.status, isLead, leadAnswers, myVote,
    submittedVotesCount, nonLeadCount, currentResult?.revealed,
  ]);

  // ============ 액션 ============
  function handleStepAnswer(answer) {
    // 단계 초과 가드 (연타 시 안전장치)
    if (myStepAnswers.length >= count) return;
    const newAnswers = [...myStepAnswers, answer];
    setMyStepAnswers(newAnswers);
    // 진행도 Firebase 기록
    updateMachobaProgress(code, room.currentRound, myPlayerId, isLead ? "lead" : "vote", newAnswers.length);
    // 선플레이어인 경우 현재 보고 있는 질문 인덱스를 leadProgress에 기록 (일반 플레이어 화면 공유용)
    if (isLead) {
      // newAnswers.length === count면 모두 끝, 그 외엔 newAnswers.length가 다음에 볼 인덱스
      updateLeadProgress(code, room.currentRound, newAnswers.length);
    }
    if (newAnswers.length === count) {
      // 최종 확인 단계로
      setPhase(isLead ? "lead-confirm" : "voting-confirm");
    }
  }

  async function handleVoteConfirm() {
    if (submitting) return;
    setSubmitting(true);
    try {
      await submitMachobaVote(code, room.currentRound, myPlayerId, myStepAnswers);
      setPhase(leadAnswers ? "result" : "voted-waiting");
    } catch (e) {
      console.error(e);
      alert("투표 전송 실패");
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
  }

  async function handleLeadConfirm() {
    if (submitting) return;
    setSubmitting(true);
    try {
      await submitMachobaLeadAnswers(code, myStepAnswers);
      setPhase("result");
    } catch (e) {
      console.error(e);
      alert("전송 실패");
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
  }

  // 준비 체크
  async function handleMarkReadyReveal() {
    await markReady(code, room.currentRound, "reveal", myPlayerId);
  }

  async function handleMarkReadyNext() {
    await markReady(code, room.currentRound, "next", myPlayerId);
  }

  const isHost = (room.players?.[myPlayerId] || {}).isHost;
  const readyReveal = room.readyState?.[room.currentRound]?.reveal || {};
  const readyNext = room.readyState?.[room.currentRound]?.next || {};
  const readyRevealCount = Object.keys(readyReveal).length;
  const readyNextCount = Object.keys(readyNext).length;
  const totalPlayerCount = players.length;
  const myReadyReveal = !!readyReveal[myPlayerId];
  const myReadyNext = !!readyNext[myPlayerId];

  // 모두 reveal ready → 방장이 revealMachobaResult 호출
  useEffect(() => {
    if (!isHost) return;
    if (phase !== "result") return;
    if (currentResult?.revealed) return;
    if (readyRevealCount >= totalPlayerCount && totalPlayerCount > 0) {
      revealMachobaResult(code, room.currentRound);
    }
  }, [isHost, phase, readyRevealCount, totalPlayerCount, currentResult?.revealed]); // eslint-disable-line

  // 모두 next ready → 방장이 nextRound 호출 (중복 방지)
  const nextTriggeredRef = useRef({});
  useEffect(() => {
    if (!isHost) return;
    if (phase !== "reveal") return;
    if (readyNextCount >= totalPlayerCount && totalPlayerCount > 0) {
      const key = `${room.currentRound}`;
      if (nextTriggeredRef.current[key]) return;
      nextTriggeredRef.current[key] = true;
      nextRound(code);
    }
  }, [isHost, phase, readyNextCount, totalPlayerCount]); // eslint-disable-line

  // ============ 렌더 ============
  if (phase === "intro") {
    return <IntroScreen
      round={room.currentRound}
      totalRounds={room.totalRounds}
      leadPlayer={leadPlayer}
      players={players}
      count={count}
      onComplete={() => setPhase(computeNextPhase())}
    />;
  }

  if (phase === "lead-waiting" && isLead) {
    return <WaitingDark round={room.currentRound} totalRounds={room.totalRounds} votedCount={submittedVotesCount} totalCount={nonLeadCount} progressList={buildVoteProgressList()} />;
  }

  // 일반 플레이어 / 선 플레이어 모두 동일한 팝업 인터페이스
  if (phase === "voting-popup" || phase === "lead-answering") {
    const nextStep = myStepAnswers.length + 1;
    const question = questions[nextStep - 1];
    return (
      <>
        <PopupBackground leadPlayer={leadPlayer} round={room.currentRound} totalRounds={room.totalRounds} isLead={isLead} />
        <StepPopup
          open={true}
          currentStep={nextStep}
          totalSteps={count}
          question={question}
          previousAnswers={null}
          onAnswer={handleStepAnswer}
          targetName={leadPlayer?.nickname || ""}
          isLead={isLead}
        />
      </>
    );
  }

  // 최종 확인 화면
  if (phase === "voting-confirm" || phase === "lead-confirm") {
    return (
      <ConfirmView
        round={room.currentRound}
        totalRounds={room.totalRounds}
        leadPlayer={leadPlayer}
        questions={questions}
        myAnswers={myStepAnswers}
        isLead={isLead}
        onConfirm={isLead ? handleLeadConfirm : handleVoteConfirm}
        submitting={submitting}
      />
    );
  }

  if (phase === "voted-waiting" && !isLead) {
    const allVotersSubmitted = submittedVotesCount >= nonLeadCount && nonLeadCount > 0;
    const leadProgress = leadPlayer ? (machobaProg.lead[leadPlayer.id] || 0) : 0;
    // 선플레이어가 현재 보고 있는 질문 인덱스 (실시간 공유용)
    const leadCurrentStep = room.leadProgress?.[room.currentRound] ?? 0;
    return (
      <VotedWaiting
        round={room.currentRound}
        totalRounds={room.totalRounds}
        leadPlayer={leadPlayer}
        questions={questions}
        myAnswers={myStepAnswers}
        allVotersSubmitted={allVotersSubmitted}
        voteProgressList={buildVoteProgressList()}
        submittedVotesCount={submittedVotesCount}
        nonLeadCount={nonLeadCount}
        leadProgress={leadProgress}
        leadDone={!!leadAnswers}
        leadCurrentStep={leadCurrentStep}
        count={count}
        myPlayerId={myPlayerId}
      />
    );
  }

  if (phase === "result") {
    return (
      <ResultView
        room={room}
        leadPlayer={leadPlayer}
        questions={questions}
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

  if (phase === "reveal") {
    return (
      <RevealView
        room={room}
        players={players}
        leadPlayer={leadPlayer}
        questions={questions}
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

  return (
    <div style={{ ...containerStyle, justifyContent: "center", alignItems: "center" }}>
      <div style={{ color: colors.text3, fontSize: 13 }}>잠시만요...</div>
    </div>
  );
}

// ============================================
// 인트로
// ============================================
function IntroScreen({ round, totalRounds, leadPlayer, players, count, onComplete }) {
  // 마운트 시 2.5초 후 onComplete 호출 (stale closure 문제 회피)
  useEffect(() => {
    if (!onComplete) return;
    const t = setTimeout(() => onComplete(), 2500);
    return () => clearTimeout(t);
  }, [onComplete]);

  if (!leadPlayer) return null;
  return (
    <div style={{ ...containerStyle, alignItems: "center", justifyContent: "center", padding: 20 }}>
      <p style={{ fontSize: 11, color: colors.text3, letterSpacing: 1.2, margin: "0 0 6px", fontWeight: 600 }}>
        ROUND {round} / {totalRounds}
      </p>
      <p style={{ fontSize: 14, color: colors.text3, margin: "0 0 20px" }}>🎯 마쵸바 시간</p>

      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        padding: "28px 36px", borderRadius: radius.xl,
        background: colors.accentBg, border: `2px solid ${colors.accentBorder}`,
        marginBottom: 20, boxShadow: shadow.cardLift,
      }}>
        <Avatar nickname={leadPlayer.nickname} colorIndex={(players || []).findIndex((p) => p.id === leadPlayer.id)} size={72} style={{ marginBottom: 12 }} />
        <div style={{ fontSize: 24, fontWeight: 700, color: colors.accentDeep, marginBottom: 4 }}>
          {leadPlayer.nickname}
        </div>
        <div style={{ fontSize: 11, color: colors.accentText, fontWeight: 600 }}>🙈 선 플레이어</div>
      </div>

      <p style={{ fontSize: 13, color: colors.text2, textAlign: "center", lineHeight: 1.5, margin: "0 0 16px", maxWidth: 280 }}>
        {josa(leadPlayer.nickname, "을/를")} 향한 <strong>{count}개</strong>의 질문!<br />
        선 플레이어가 어떻게 답할지 맞춰봐요
      </p>
      <div style={{ fontSize: 11, color: colors.text3 }}>잠시 후 시작합니다...</div>
    </div>
  );
}

// ============================================
// 팝업 배경
// ============================================
function PopupBackground({ leadPlayer, round, totalRounds, isLead }) {
  return (
    <div style={{ ...containerStyle, padding: "14px 12px 16px", justifyContent: "center", opacity: 0.4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, fontSize: 11, color: colors.text3 }}>
        <span style={{ fontWeight: 600 }}>Round {round} / {totalRounds}</span>
        <span style={{ color: isLead ? colors.correctText : colors.accentText, fontWeight: 600 }}>
          🙈 {isLead ? "내가 선플레이어" : `선플레이어: ${leadPlayer?.nickname}`}
        </span>
      </div>
      <p style={{ textAlign: "center", fontSize: 14, fontWeight: 600 }}>
        {isLead ? "내 답변 입력 중..." : `${josa(leadPlayer?.nickname || "", "이/가")} 어떻게 답할지 예측 중...`}
      </p>
    </div>
  );
}

// ============================================
// 다크 대기 (선 플레이어용)
// ============================================
function WaitingDark({ round, totalRounds, votedCount, totalCount, progressList }) {
  const percent = totalCount > 0 ? (votedCount / totalCount) * 100 : 0;
  return (
    <div style={{ ...containerStyle, background: "#1A1A1A", color: "#FFFFFF", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <p style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", margin: "0 0 20px", letterSpacing: 1.2 }}>
        ROUND {round} / {totalRounds} · 당신은 선플레이어
      </p>
      <div style={{
        width: 80, height: 80, borderRadius: "50%", background: "rgba(255,255,255,0.08)",
        display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 18,
      }}>
        <span style={{ fontSize: 40 }}>🙈</span>
      </div>
      <p style={{ fontSize: 17, fontWeight: 700, margin: "0 0 6px", textAlign: "center", lineHeight: 1.4 }}>
        잠시만 기다려주세요!
      </p>
      <p style={{ fontSize: 12, opacity: 0.6, textAlign: "center", lineHeight: 1.5, margin: "0 0 20px", maxWidth: 260 }}>
        친구들이 당신의 답을 예측 중이에요
      </p>
      <div style={{ width: "100%", maxWidth: 240, padding: "12px 14px", borderRadius: radius.md, background: "rgba(255,255,255,0.08)", marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontSize: 11, opacity: 0.7 }}>완료</span>
          <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.95 }}>{votedCount} / {totalCount}</span>
        </div>
        <div style={{ height: 4, borderRadius: 100, background: "rgba(255,255,255,0.15)", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${percent}%`, background: colors.correctFill, borderRadius: 100, transition: "width 0.5s" }} />
        </div>
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
              <span style={{ fontSize: 12, fontWeight: 600, flex: 1, color: "#FFFFFF" }}>
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
    </div>
  );
}

// ============================================
// 최종 확인 (투표자, 선플레이어 공통)
// ============================================
function ConfirmView({ round, totalRounds, leadPlayer, questions, myAnswers, isLead, onConfirm, submitting }) {
  return (
    <div style={{ ...containerStyle, padding: "14px 12px 16px", justifyContent: "center" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, fontSize: 11, color: colors.text3 }}>
        <span style={{ fontWeight: 600 }}>Round {round} / {totalRounds}</span>
        <span style={{ color: isLead ? colors.correctText : colors.accentText, fontWeight: 600 }}>
          🙈 {isLead ? "내가 선플레이어" : `선플레이어: ${leadPlayer?.nickname}`}
        </span>
      </div>

      <div style={{ textAlign: "center", marginBottom: 12 }}>
        <p style={{ fontSize: 13, fontWeight: 700, margin: 0, color: colors.text1 }}>
          {isLead ? "🎯 나의 답변 확인" : `💭 내가 예상한 ${leadPlayer?.nickname}의 답변`}
        </p>
        <p style={{ fontSize: 10, color: colors.text3, margin: "4px 0 0" }}>
          맞다면 확정해주세요
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
        {questions.map((q, i) => (
          <AnswerRow key={i} index={i + 1} question={q} answer={myAnswers[i]} />
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
        {submitting ? "전송 중..." : isLead ? "✨ 답변 확정" : "✨ 투표 확정"}
      </button>
    </div>
  );
}

function AnswerRow({ index, question, answer, leadAnswer, showResult }) {
  const isYes = answer === "YES";
  const matched = showResult && answer === leadAnswer;
  const showAnswerColors = !showResult;

  return (
    <div style={{
      display: "flex", alignItems: "center",
      padding: "8px 10px", borderRadius: radius.md,
      background: matched ? colors.correctBg : showResult && !matched ? colors.wrongBg : colors.surface,
      border: matched ? `1.5px solid ${colors.correctFill}` : showResult && !matched ? `1.5px solid ${colors.wrongFill}` : `1px solid ${colors.border1}`,
      gap: 8,
    }}>
      <span style={{ fontSize: 10, color: colors.text3, fontWeight: 600, width: 14 }}>{index}</span>
      <span style={{ fontSize: 12, color: colors.text1, flex: 1, wordBreak: "keep-all" }}>{question}</span>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
        {showResult ? (
          <>
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <span style={{ fontSize: 9, color: colors.text3 }}>내 예측</span>
              <span style={{
                fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 100,
                background: isYes ? colors.correctFill : colors.wrongFill, color: "#FFFFFF",
              }}>
                {answer}
              </span>
            </div>
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <span style={{ fontSize: 9, color: colors.text3 }}>실제</span>
              <span style={{
                fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 100,
                background: leadAnswer === "YES" ? colors.correctFill : colors.wrongFill, color: "#FFFFFF",
              }}>
                {leadAnswer}
              </span>
              {matched && <span style={{ fontSize: 11, color: colors.correctFill }}>✓</span>}
            </div>
          </>
        ) : (
          <span style={{
            fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 100,
            color: "#FFFFFF",
            background: showAnswerColors ? (isYes ? colors.correctFill : colors.wrongFill) : colors.text3,
          }}>
            {answer}
          </span>
        )}
      </div>
    </div>
  );
}

// ============================================
// 투표 후 대기 (선 플레이어 답변 기다림)
// ============================================
function VotedWaiting({ round, totalRounds, leadPlayer, questions, myAnswers, allVotersSubmitted, voteProgressList, submittedVotesCount, nonLeadCount, leadProgress, leadDone, leadCurrentStep, count, myPlayerId }) {
  return (
    <div style={{ ...containerStyle, padding: "14px 12px 16px", justifyContent: "center" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, fontSize: 11, color: colors.text3 }}>
        <span style={{ fontWeight: 600 }}>Round {round} / {totalRounds}</span>
        <span style={{ color: colors.accentText, fontWeight: 600 }}>🙈 선플레이어: {leadPlayer?.nickname}</span>
      </div>

      {!allVotersSubmitted ? (
        <>
          <div style={{ textAlign: "center", marginBottom: 14 }}>
            <div style={{ fontSize: 32, marginBottom: 6 }}>⏳</div>
            <p style={{ fontSize: 14, fontWeight: 700, margin: 0, color: colors.text1 }}>
              예측 완료!
            </p>
            <p style={{ fontSize: 11, color: colors.text3, margin: "4px 0 0" }}>
              다른 친구들이 예측 중이에요
            </p>
            <div style={{ display: "inline-block", marginTop: 8, padding: "4px 14px", borderRadius: 100, background: colors.accentBg, fontSize: 12, fontWeight: 700, color: colors.accentDeep }}>
              완료 {submittedVotesCount} / {nonLeadCount}
            </div>
          </div>
          {voteProgressList && voteProgressList.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {voteProgressList.map((p) => {
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
        </>
      ) : (
        <>
          {/* 선플레이어가 답하는 중 - 현재 질문 실시간 공유 */}
          <div style={{ textAlign: "center", marginBottom: 12 }}>
            <p style={{ fontSize: 12, color: colors.accentDeep, fontWeight: 700, margin: 0 }}>
              🙈 {leadPlayer?.nickname} 답변 중...
            </p>
            <p style={{ fontSize: 10, color: colors.text3, margin: "2px 0 0" }}>
              {leadDone ? `${count}/${count}` : `${Math.min(leadCurrentStep + 1, count)} / ${count}`} · 같은 질문을 함께 봐요
            </p>
          </div>

          {/* 선플레이어가 지금 보고 있는 질문 - 크게 강조 */}
          {!leadDone && questions[leadCurrentStep] && (
            <div style={{
              padding: "20px 16px", borderRadius: radius.lg,
              background: colors.cardBg, border: `2px solid ${colors.cardBorderDeep}`,
              marginBottom: 14, textAlign: "center",
              boxShadow: shadow.cardLift,
            }}>
              <p style={{ fontSize: 10, color: colors.accentText, fontWeight: 700, margin: "0 0 6px" }}>
                지금 이 질문에 답하는 중
              </p>
              <p style={{ fontSize: 15, fontWeight: 700, color: colors.text1, margin: 0, lineHeight: 1.4, wordBreak: "keep-all" }}>
                {questions[leadCurrentStep]}
              </p>
            </div>
          )}

          {/* 내가 예측한 답변 목록 (작게, 회상용) */}
          <div style={{ marginTop: 8 }}>
            <p style={{ fontSize: 10, color: colors.text3, margin: "0 0 6px", fontWeight: 600 }}>
              💭 내 예측
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {questions.map((q, i) => (
                <MyGuessRow
                  key={i}
                  index={i + 1}
                  question={q}
                  answer={myAnswers[i]}
                  isCurrent={!leadDone && i === leadCurrentStep}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// 점선으로 내 예측 표시 (실제 결과 나오기 전 떨림)
function MyGuessRow({ index, question, answer, isCurrent }) {
  const isYes = answer === "YES";
  const color = isYes ? colors.correctFill : colors.wrongFill;
  return (
    <div style={{
      display: "flex", alignItems: "center",
      padding: "8px 10px", borderRadius: radius.md,
      background: isCurrent ? colors.accentBg : colors.surface,
      border: isCurrent ? `2px solid ${colors.accentText}` : `2px dashed ${color}`,
      gap: 8,
      opacity: isCurrent ? 1 : 0.85,
    }}>
      <span style={{ fontSize: 10, color: isCurrent ? colors.accentDeep : colors.text3, fontWeight: 700, width: 14 }}>{index}</span>
      <span style={{ fontSize: 11, color: colors.text2, flex: 1, wordBreak: "keep-all" }}>{question}</span>
      {isCurrent && <span style={{ fontSize: 9, fontWeight: 700, color: colors.accentText }}>← 지금</span>}
      <span style={{ fontSize: 10, fontWeight: 700, color }}>내 예측: {answer}</span>
    </div>
  );
}

// ============================================
// 결과 정리 (선 플레이어 답변 완료, 정답 공개 직전)
// ============================================
function ResultView({ room, leadPlayer, questions, leadAnswers, myAnswers, isLead, onMarkReady, isReady, readyCount, totalCount }) {
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

      {/* 선플레이어 본인 답변 목록 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 14 }}>
        {questions.map((q, i) => (
          <AnswerRow
            key={i}
            index={i + 1}
            question={q}
            answer={leadAnswers[i]}
          />
        ))}
      </div>

      <ReadyButton
        isReady={isReady}
        readyCount={readyCount}
        totalCount={totalCount}
        onClick={onMarkReady}
        actionLabel="🎉 정답자 공개"
        waitingLabel="정답자 공개"
      />
    </div>
  );
}

// ============================================
// 정답 공개 (모든 투표자의 점수 표시)
// ============================================
function RevealView({ room, players, leadPlayer, questions, leadAnswers, votes, myPlayerId, myAnswers, isLead, isLastRound, onMarkReady, isReady, readyCount, totalCount }) {
  const myVote = votes.find((v) => v.playerId === myPlayerId);
  const myMatchCount = myVote?.matchCount ?? 0;
  const count = questions.length;

  // 각 질문에 대해 YES 누른 사람들 / NO 누른 사람들 집계
  function getVotersForQuestion(qIdx, answer) {
    return votes
      .filter((v) => v.voteArray && v.voteArray[qIdx] === answer)
      .map((v) => players.find((p) => p.id === v.playerId))
      .filter(Boolean);
  }

  // 점수 기준 정렬
  const voterResults = [...votes]
    .map((v) => ({
      ...v,
      player: players.find((p) => p.id === v.playerId),
    }))
    .filter((v) => v.player)
    .sort((a, b) => (b.matchCount || 0) - (a.matchCount || 0));

  return (
    <div style={{ ...containerStyle, padding: "14px 12px 16px", justifyContent: "center" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, fontSize: 11, color: colors.text3 }}>
        <span style={{ fontWeight: 600 }}>Round {room.currentRound} / {room.totalRounds}</span>
        <span style={{ color: isLead ? colors.correctText : colors.accentText, fontWeight: 600 }}>
          🙈 {isLead ? "내가 선플레이어" : `선플레이어: ${leadPlayer?.nickname}`}
        </span>
      </div>

      <div style={{ textAlign: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 28, marginBottom: 4 }}>🎉</div>
        <p style={{ fontSize: 15, fontWeight: 700, margin: 0, color: colors.text1 }}>
          정답 공개!
        </p>
        {!isLead && (
          <p style={{ fontSize: 12, color: colors.accentText, margin: "4px 0 0", fontWeight: 700 }}>
            나는 {myMatchCount} / {count} 맞췄어요!
          </p>
        )}
      </div>

      {/* 질문별 정답 + 투표자 분포 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
        {questions.map((q, i) => {
          const correctAns = leadAnswers[i];
          const yesVoters = getVotersForQuestion(i, "YES");
          const noVoters = getVotersForQuestion(i, "NO");
          // 내 예측 (선플레이어가 아닌 경우)
          const myAns = !isLead ? (myAnswers?.[i]) : null;
          return (
            <QuestionResultRow
              key={i}
              index={i + 1}
              question={q}
              correctAns={correctAns}
              yesVoters={yesVoters}
              noVoters={noVoters}
              myPlayerId={myPlayerId}
              isLead={isLead}
              myAns={myAns}
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
              <span style={{ flex: 1, color: colors.text1 }}>{v.player.nickname}</span>
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
        waitingLabel={isLastRound ? "최종 결과 보기" : "다음 라운드"}
      />
    </div>
  );
}

// 질문 1개 + 정답 + 양쪽 투표자
function QuestionResultRow({ index, question, correctAns, yesVoters, noVoters, myPlayerId, isLead, myAns }) {
  return (
    <div style={{
      padding: "10px 12px",
      borderRadius: radius.md,
      background: colors.surface,
      border: `1px solid ${colors.border1}`,
    }}>
      {/* 질문 */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 10, color: colors.text3, fontWeight: 700, minWidth: 14, marginTop: 2 }}>{index}</span>
        <span style={{ fontSize: 12, color: colors.text1, flex: 1, wordBreak: "keep-all", fontWeight: 600, lineHeight: 1.4 }}>{question}</span>
      </div>

      {/* YES / NO 양쪽 (중립 보라, 선플 선택만 강조) */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <RevealVoterLine
          label="YES"
          voters={yesVoters}
          isLeadChoice={correctAns === "YES"}
          myPlayerId={myPlayerId}
          myAnswer={myAns}
          isLead={isLead}
        />
        <RevealVoterLine
          label="NO"
          voters={noVoters}
          isLeadChoice={correctAns === "NO"}
          myPlayerId={myPlayerId}
          myAnswer={myAns}
          isLead={isLead}
        />
      </div>
    </div>
  );
}

function RevealVoterLine({ label, voters, isLeadChoice, myPlayerId, myAnswer, isLead }) {
  // 우측 라벨 결정
  let rightLabel = null;
  if (isLead) {
    if (isLeadChoice) rightLabel = "✓ 내 답";
  } else {
    if (myAnswer === label && isLeadChoice) rightLabel = "✓ 정답";
  }

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "7px 9px",
      borderRadius: radius.sm,
      background: isLeadChoice ? colors.accentBg : colors.surface2,
      border: isLeadChoice ? `1.5px solid ${colors.accentText}` : `1px solid ${colors.border1}`,
    }}>
      <span style={{
        fontSize: 10, fontWeight: 800,
        padding: "2px 9px", borderRadius: 100,
        background: isLeadChoice ? colors.accentText : colors.border2,
        color: "#FFFFFF",
        minWidth: 36, textAlign: "center", flexShrink: 0,
      }}>
        {label}
      </span>
      {voters.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, flex: 1 }}>
          {(() => {
            // 내가 이 칸에 있으면 맨 앞으로 정렬
            const sorted = [...voters].sort((a, b) => {
              if (a.id === myPlayerId) return -1;
              if (b.id === myPlayerId) return 1;
              return 0;
            });
            return sorted.map((v, i) => {
              const isMe = v.id === myPlayerId;
              return (
                <span key={v.id} style={{
                  fontSize: 11,
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
        <span style={{ fontSize: 10, color: colors.text3, fontStyle: "italic", flex: 1 }}>
          선택자 없음
        </span>
      )}
      {rightLabel && (
        <span style={{ fontSize: 9, color: colors.accentText, fontWeight: 700, flexShrink: 0 }}>
          {rightLabel}
        </span>
      )}
    </div>
  );
}

// ============================================
// 준비 버튼 (모두 준비될 때까지 대기)
// ============================================
function ReadyButton({ isReady, readyCount, totalCount, onClick, actionLabel }) {
  const percent = totalCount > 0 ? (readyCount / totalCount) * 100 : 0;

  if (isReady) {
    return (
      <div
        style={{
          padding: "14px 16px",
          borderRadius: radius.lg,
          background: colors.surface,
          border: `1.5px solid ${colors.border1}`,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 12, color: colors.text2, fontWeight: 600, marginBottom: 8 }}>
          ⏳ 다른 친구들을 기다리는 중 · {readyCount}/{totalCount}
        </div>
        <div style={{ height: 4, borderRadius: 100, background: colors.surface2, overflow: "hidden" }}>
          <div
            style={{
              height: "100%",
              width: `${percent}%`,
              background: colors.correctFill,
              borderRadius: 100,
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
          width: "100%",
          padding: 13,
          borderRadius: radius.lg,
          background: colors.accentBg,
          color: colors.accentDeep,
          fontSize: 14,
          fontWeight: 700,
          border: "none",
          boxShadow: "0 2px 4px rgba(83,74,183,0.15)",
          cursor: "pointer",
          fontFamily: "inherit",
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
