import { useState, useEffect, useMemo, useRef } from "react";
import { submitVote, submitAnswer, revealResult, nextRound, markReady } from "../lib/room";
import {
  getDestination,
  getCardIndexAtLevel,
  getAnswerSequence,
  josa,
} from "../lib/game";
import Avatar from "../components/Avatar";
import Pyramid from "../components/Pyramid";
import StepPopup from "../components/StepPopup";
import AnswerSequence from "../components/AnswerSequence";
import { colors, radius, shadow, containerStyle } from "../lib/theme";

export default function OdiyaPlay({ room, code, myPlayerId, leadPlayer, players }) {
  const [phase, setPhase] = useState("intro");

  // 투표자가 단계별로 입력한 답변들 (로컬 상태, 확정 시에 destination으로 변환)
  // 형식: [{ level, question, answer }]
  const [myStepAnswers, setMyStepAnswers] = useState([]);
  const [voteSubmitting, setVoteSubmitting] = useState(false);

  const isLead = room.currentLeadPlayerId === myPlayerId;
  const depth = room.depth || room.pyramid?.depth || 3;

  const currentVotes = useMemo(() => {
    const v = (room.votes || {})[room.currentRound] || {};
    return Object.entries(v).map(([pid, data]) => ({
      playerId: pid,
      vote: data.vote,
      isCorrect: data.isCorrect,
    }));
  }, [room.votes, room.currentRound]);

  const currentResult = (room.results || {})[room.currentRound];
  const myVote = currentVotes.find((v) => v.playerId === myPlayerId);
  const nonLeadCount = players.length - 1;
  const submittedVotesCount = currentVotes.length;

  // ============ Phase 전환 (단순화) ============
  const answersLen = (room.pyramid?.answers || []).length;
  // 게임 종료는 라우터(GamePlay)에서 처리

  // 다음 phase 계산 함수 (즉시 호출 가능)
  function computeNextPhase() {
    if (currentResult?.revealed) return "reveal";
    if (answersLen >= depth) return "result";
    if (isLead) {
      if (answersLen === 0) {
        if (submittedVotesCount >= nonLeadCount && nonLeadCount > 0) {
          return "lead-answering";
        }
        return "lead-waiting";
      }
      return "lead-answering";
    }
    if (myVote) {
      if (answersLen > 0) return "watching";
      return "voted-waiting";
    }
    return "voting-popup";
  }

  // 라운드 시작 인트로 (라운드 변경 시) - 깜빡임 방지 버전
  useEffect(() => {
    if (room.status !== "playing") return;
    if ((room.pyramid?.answers || []).length === 0) {
      setPhase("intro");
      setMyStepAnswers([]);
      const t = setTimeout(() => {
        // intro 끝났을 때 즉시 적절한 phase 계산 후 한 번에 set
        setPhase(computeNextPhase());
      }, 2500);
      return () => clearTimeout(t);
    }
  }, [room.currentRound, room.status]); // eslint-disable-line

  // 통합 phase 결정 - intro/voting-confirm 동안은 건드리지 않음
  useEffect(() => {
    if (room.status !== "playing") return;
    if (phase === "intro") return;
    if (phase === "voting-confirm") return;

    const next = computeNextPhase();
    if (next !== phase) setPhase(next);
  }, [
    phase,
    room.status,
    answersLen,
    depth,
    isLead,
    myVote,
    submittedVotesCount,
    nonLeadCount,
    currentResult?.revealed,
  ]);

  // ============ 액션 ============

  // 투표자 단계별 답변
  function handleVoteStep(answer) {
    const nextLevel = myStepAnswers.length + 1;
    if (nextLevel > depth) return;
    const cardIdx = getCardIndexAtLevel(myStepAnswers, nextLevel);
    const question = room.pyramid.levels[nextLevel - 1][cardIdx];
    const newAnswers = [
      ...myStepAnswers,
      { level: nextLevel, question, answer },
    ];
    setMyStepAnswers(newAnswers);
    if (newAnswers.length === depth) {
      setPhase("voting-confirm"); // 최종 확인 화면으로
    }
  }

  // 투표 확정
  async function handleVoteConfirm() {
    if (voteSubmitting) return;
    const dest = getDestination(myStepAnswers);
    if (!dest) return;
    setVoteSubmitting(true);
    try {
      await submitVote(code, room.currentRound, myPlayerId, dest);
      // 명시적 전환
      setPhase(answersLen > 0 ? "watching" : "voted-waiting");
    } catch (e) {
      console.error("Vote submit failed:", e);
      setVoteSubmitting(false);
      alert("투표 전송 실패. 다시 시도해주세요.");
      return;
    }
    setVoteSubmitting(false);
  }

  // 선 플레이어 답변
  async function handleLeadAnswer(answer) {
    if (!isLead) return;
    // 단계 초과 가드 (연타 시 안전장치)
    if (answersLen >= depth) return;
    await submitAnswer(code, answer);
  }

  // 준비 체크 - 본인만 ready 표시
  async function handleMarkReadyReveal() {
    await markReady(code, room.currentRound, "reveal", myPlayerId);
  }

  async function handleMarkReadyNext() {
    await markReady(code, room.currentRound, "next", myPlayerId);
  }

  // 자동 트리거: 모두 ready 되면 방장이 다음 단계로 진행
  const isHost = (room.players?.[myPlayerId] || {}).isHost;
  const readyReveal = room.readyState?.[room.currentRound]?.reveal || {};
  const readyNext = room.readyState?.[room.currentRound]?.next || {};

  // 실제 방에 있는 플레이어만 카운트 (떠난 플레이어 ready 제외)
  const activePlayerIds = players.map((p) => p.id);
  const readyRevealActive = activePlayerIds.filter((id) => readyReveal[id]);
  const readyNextActive = activePlayerIds.filter((id) => readyNext[id]);
  const readyRevealCount = readyRevealActive.length;
  const readyNextCount = readyNextActive.length;
  const totalPlayerCount = players.length;
  const myReadyReveal = !!readyReveal[myPlayerId];
  const myReadyNext = !!readyNext[myPlayerId];

  // 모두 reveal ready → 방장이 revealResult 호출
  useEffect(() => {
    if (!isHost) return;
    if (phase !== "result") return;
    if (currentResult?.revealed) return;
    if (readyRevealCount === totalPlayerCount && totalPlayerCount > 0) {
      revealResult(code, room.currentRound);
    }
  }, [isHost, phase, readyRevealCount, totalPlayerCount, currentResult?.revealed]); // eslint-disable-line

  // 모두 next ready → 방장이 nextRound 호출 (중복 방지)
  const nextTriggeredRef = useRef({});
  useEffect(() => {
    if (!isHost) return;
    if (phase !== "reveal") return;
    if (readyNextCount === totalPlayerCount && totalPlayerCount > 0) {
      const key = `${room.currentRound}`;
      if (nextTriggeredRef.current[key]) return;
      nextTriggeredRef.current[key] = true;
      nextRound(code);
    }
  }, [isHost, phase, readyNextCount, totalPlayerCount]); // eslint-disable-line

  // ============ 렌더 ============
  // final 은 라우터(GamePlay)에서 처리

  if (phase === "intro") {
    return (
      <RoundIntro
        round={room.currentRound}
        totalRounds={room.totalRounds}
        leadPlayer={leadPlayer}
        players={players}
        depth={depth}
      />
    );
  }

  // 선 플레이어가 다른 투표자를 기다리는 화면
  if (phase === "lead-waiting" && isLead) {
    return (
      <LeadWaitingScreen
        round={room.currentRound}
        totalRounds={room.totalRounds}
        votedCount={submittedVotesCount}
        totalCount={nonLeadCount}
      />
    );
  }

  // 투표자: 단계별 팝업으로 답변 중
  if (phase === "voting-popup" && !isLead) {
    const nextLevel = myStepAnswers.length + 1;
    const cardIdx = getCardIndexAtLevel(myStepAnswers, nextLevel);
    const question = room.pyramid.levels[nextLevel - 1][cardIdx];
    return (
      <>
        <VotingBackground leadPlayer={leadPlayer} round={room.currentRound} totalRounds={room.totalRounds} />
        <StepPopup
          open={true}
          currentStep={nextLevel}
          totalSteps={depth}
          question={question}
          previousAnswers={myStepAnswers.slice(0, nextLevel - 1)}
          onAnswer={handleVoteStep}
          targetName={leadPlayer?.nickname || ""}
          isLead={false}
        />
      </>
    );
  }

  // 투표자: 최종 확인 화면
  if (phase === "voting-confirm" && !isLead) {
    return (
      <VotingConfirm
        room={room}
        leadPlayer={leadPlayer}
        myAnswers={myStepAnswers}
        onConfirm={handleVoteConfirm}
        submitting={voteSubmitting}
      />
    );
  }

  // 투표자: 투표 후 대기 (선 플레이어 답변 시작 전)
  if (phase === "voted-waiting" && !isLead) {
    return (
      <VotedWaitingScreen
        round={room.currentRound}
        totalRounds={room.totalRounds}
        leadPlayer={leadPlayer}
        myAnswers={myStepAnswers}
        votedCount={submittedVotesCount}
        totalCount={nonLeadCount}
      />
    );
  }

  // 투표자: 선 플레이어 답변 시청 (내 예측 경로 점선 표시)
  if (phase === "watching" && !isLead) {
    return (
      <WatchingScreen
        room={room}
        leadPlayer={leadPlayer}
        depth={depth}
        myAnswers={myStepAnswers}
      />
    );
  }

  // 선 플레이어: 단계별 답변 (팝업)
  if ((phase === "lead-answering" || phase === "voting-popup") && isLead) {
    // 선 플레이어는 모든 투표 완료 후 답변 시작
    if (submittedVotesCount < nonLeadCount && nonLeadCount > 0) {
      return (
        <LeadWaitingScreen
          round={room.currentRound}
          totalRounds={room.totalRounds}
          votedCount={submittedVotesCount}
          totalCount={nonLeadCount}
        />
      );
    }
    // 답변 시작
    const nextLevel = answersLen + 1;
    if (nextLevel > depth) {
      // 답변 완료, 결과 대기
      return <div style={{ ...containerStyle, justifyContent: "center", alignItems: "center" }}>잠시만요...</div>;
    }
    const cardIdx = getCardIndexAtLevel(room.pyramid.answers || [], nextLevel);
    const question = room.pyramid.levels[nextLevel - 1][cardIdx];
    return (
      <>
        <LeadAnsweringBackground room={room} depth={depth} />
        <StepPopup
          open={true}
          currentStep={nextLevel}
          totalSteps={depth}
          question={question}
          previousAnswers={null}
          onAnswer={handleLeadAnswer}
          targetName=""
          isLead={true}
        />
      </>
    );
  }

  // 다른 플레이어: 선 플레이어 답변 시청
  if (phase === "answering" && !isLead) {
    return <WatchingScreen room={room} leadPlayer={leadPlayer} depth={depth} myAnswers={myStepAnswers} />;
  }

  if (phase === "result") {
    return (
      <ResultView
        room={room}
        leadPlayer={leadPlayer}
        result={currentResult}
        depth={depth}
        myPlayerId={myPlayerId}
        myAnswers={myStepAnswers}
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
        result={currentResult}
        votes={currentVotes}
        depth={depth}
        myPlayerId={myPlayerId}
        isLastRound={room.currentRound >= room.totalRounds}
        onMarkReady={handleMarkReadyNext}
        isReady={myReadyNext}
        readyCount={readyNextCount}
        totalCount={totalPlayerCount}
      />
    );
  }

  // Fallback: phase 가 어디에도 매칭 안 되면 로딩 표시
  return (
    <div style={{ ...containerStyle, justifyContent: "center", alignItems: "center" }}>
      <div style={{ color: colors.text3, fontSize: 13 }}>잠시만요...</div>
    </div>
  );
}

// ============================================
// 라운드 인트로
// ============================================
function RoundIntro({ round, totalRounds, leadPlayer, players, depth }) {
  if (!leadPlayer) return null;
  return (
    <div style={{ ...containerStyle, alignItems: "center", justifyContent: "center", padding: 20 }}>
      <p style={{ fontSize: 11, color: colors.text3, letterSpacing: 1.2, margin: "0 0 6px", fontWeight: 600 }}>
        ROUND {round} / {totalRounds}
      </p>
      <p style={{ fontSize: 14, color: colors.text3, margin: "0 0 20px" }}>✨ 이번 차례는</p>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "28px 36px",
          borderRadius: radius.xl,
          background: colors.accentBg,
          border: `2px solid ${colors.accentBorder}`,
          marginBottom: 20,
          boxShadow: shadow.cardLift,
        }}
      >
        <Avatar nickname={leadPlayer.nickname} colorIndex={(players || []).findIndex((p) => p.id === leadPlayer.id)} size={72} style={{ marginBottom: 12 }} />
        <div style={{ fontSize: 24, fontWeight: 700, color: colors.accentDeep, marginBottom: 4 }}>
          {leadPlayer.nickname}
        </div>
        <div style={{ fontSize: 11, color: colors.accentText, fontWeight: 600 }}>🙈 선 플레이어</div>
      </div>

      <p
        style={{
          fontSize: 13,
          color: colors.text2,
          textAlign: "center",
          lineHeight: 1.5,
          margin: "0 0 16px",
          maxWidth: 260,
        }}
      >
        {josa(leadPlayer.nickname, "이/가")} 어떤 답을 할지<br />모두 함께 맞춰봐요 🎯
      </p>
      <div
        style={{
          padding: "6px 12px",
          borderRadius: 100,
          background: colors.surface3,
          fontSize: 11,
          color: colors.text3,
          marginBottom: 16,
        }}
      >
        {depth}단계 피라미드
      </div>
      <div style={{ fontSize: 11, color: colors.text3 }}>잠시 후 시작합니다...</div>
    </div>
  );
}

// ============================================
// 공통 헤더 (둥근 라운드 표시)
// ============================================
function Header({ round, totalRounds, leadName, mode }) {
  const isLead = mode === "lead";
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, fontSize: 11, color: colors.text3 }}>
      <span style={{ fontWeight: 600 }}>Round {round} / {totalRounds}</span>
      <span style={{ color: isLead ? colors.correctText : colors.accentText, fontWeight: 600 }}>
        🙈 {isLead ? "내가 선플레이어" : `선플레이어: ${leadName}`}
      </span>
    </div>
  );
}

// ============================================
// 투표자: 팝업 배경 (블러)
// ============================================
function VotingBackground({ leadPlayer, round, totalRounds }) {
  return (
    <div style={{ ...containerStyle, padding: "14px 12px 16px", justifyContent: "center" }}>
      <Header round={round} totalRounds={totalRounds} leadName={leadPlayer?.nickname} mode="vote" />
      <div style={{ textAlign: "center", marginBottom: 14, opacity: 0.4 }}>
        <p style={{ fontSize: 14, fontWeight: 600, color: colors.text1, margin: 0 }}>
          {josa(leadPlayer?.nickname || "", "이/가")} 어디를 선택할지 맞춰보세요
        </p>
      </div>
    </div>
  );
}

// ============================================
// 선 플레이어: 팝업 배경 (피라미드 살짝 보임)
// ============================================
function LeadAnsweringBackground({ room, depth }) {
  return (
    <div style={{ ...containerStyle, padding: "14px 12px 16px", justifyContent: "center", opacity: 0.4 }}>
      <Header round={room.currentRound} totalRounds={room.totalRounds} mode="lead" />
      <div style={{ textAlign: "center", marginBottom: 14 }}>
        <p style={{ fontSize: 14, fontWeight: 600, color: colors.text1, margin: 0 }}>
          내가 답할 차례
        </p>
      </div>
      <Pyramid pyramid={room.pyramid} mode="answering-lead" />
    </div>
  );
}

// ============================================
// 투표자: 최종 확인 화면
// ============================================
function VotingConfirm({ room, leadPlayer, myAnswers, onConfirm, submitting }) {
  if (!room.pyramid || !leadPlayer) return null;
  // myAnswers를 포함한 가상의 pyramid를 만들어서 피라미드 컴포넌트에 표시
  const pyramidWithMyPath = {
    ...room.pyramid,
    answers: myAnswers,
  };
  const sequence = getAnswerSequence(myAnswers);

  return (
    <div style={{ ...containerStyle, padding: "14px 12px 16px", justifyContent: "center" }}>
      <Header round={room.currentRound} totalRounds={room.totalRounds} leadName={leadPlayer.nickname} mode="vote" />

      <div style={{ textAlign: "center", marginBottom: 14 }}>
        <p style={{ fontSize: 13, fontWeight: 700, margin: 0, color: colors.text1 }}>
          💭 내가 예상한 {leadPlayer.nickname}의 답변
        </p>
        <p style={{ fontSize: 10, color: colors.text3, margin: "4px 0 0" }}>
          아래 경로가 맞다면 확정해주세요
        </p>
      </div>

      <Pyramid pyramid={pyramidWithMyPath} mode="final-confirm" myAnswers={myAnswers} />

      <div style={{ marginTop: 14, marginBottom: 14 }}>
        <AnswerSequence answers={sequence} targetName={leadPlayer.nickname} />
      </div>

      <button
        onClick={onConfirm}
        disabled={submitting}
        style={{
          padding: 13,
          borderRadius: radius.lg,
          background: `linear-gradient(180deg, ${colors.correctFillLight} 0%, ${colors.correctFill} 100%)`,
          color: "#FFFFFF",
          fontSize: 14,
          fontWeight: 700,
          border: "none",
          boxShadow: shadow.button,
          cursor: submitting ? "default" : "pointer",
          fontFamily: "inherit",
          opacity: submitting ? 0.7 : 1,
        }}
      >
        {submitting ? "전송 중..." : "✨ 투표 확정"}
      </button>
    </div>
  );
}

// ============================================
// 투표자: 투표 후 대기
// ============================================
function VotedWaitingScreen({ round, totalRounds, leadPlayer, myAnswers, votedCount, totalCount }) {
  const sequence = getAnswerSequence(myAnswers);
  return (
    <div style={{ ...containerStyle, padding: "14px 12px 16px", justifyContent: "center", alignItems: "stretch" }}>
      <Header round={round} totalRounds={totalRounds} leadName={leadPlayer?.nickname} mode="vote" />

      <div style={{ textAlign: "center", marginBottom: 14 }}>
        <div style={{ fontSize: 36, marginBottom: 8 }}>✅</div>
        <p style={{ fontSize: 15, fontWeight: 700, margin: 0, color: colors.text1 }}>
          투표 완료!
        </p>
        <p style={{ fontSize: 11, color: colors.text3, margin: "4px 0 0" }}>
          다른 친구들의 투표를 기다리는 중...
        </p>
      </div>

      <div style={{ marginBottom: 14 }}>
        <AnswerSequence answers={sequence} targetName={leadPlayer?.nickname || ""} hint="결과는 잠시 후 공개됩니다" />
      </div>

      <div
        style={{
          padding: "10px 14px",
          borderRadius: radius.md,
          background: colors.surface,
          border: `1px solid ${colors.border1}`,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 11, color: colors.text3, marginBottom: 6 }}>
          👥 투표 진행
        </div>
        <div style={{ height: 4, borderRadius: 100, background: colors.surface2, overflow: "hidden", marginBottom: 6 }}>
          <div
            style={{
              height: "100%",
              width: `${totalCount > 0 ? (votedCount / totalCount) * 100 : 0}%`,
              background: colors.correctFill,
              borderRadius: 100,
              transition: "width 0.5s",
            }}
          />
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, color: colors.text2 }}>
          {votedCount} / {totalCount}
        </div>
      </div>
    </div>
  );
}

// ============================================
// 선 플레이어 대기
// ============================================
function LeadWaitingScreen({ round, totalRounds, votedCount, totalCount }) {
  const percent = totalCount > 0 ? (votedCount / totalCount) * 100 : 0;
  return (
    <div
      style={{
        ...containerStyle,
        background: "#1A1A1A",
        color: "#FFFFFF",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <p style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", margin: "0 0 24px", letterSpacing: 1.2 }}>
        ROUND {round} / {totalRounds} · 당신은 선 플레이어
      </p>

      <div
        style={{
          width: 96,
          height: 96,
          borderRadius: "50%",
          background: "rgba(255,255,255,0.08)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 24,
          position: "relative",
        }}
      >
        <span style={{ fontSize: 48 }}>🙈</span>
        <div
          style={{
            position: "absolute",
            bottom: -4,
            right: -4,
            width: 32,
            height: 32,
            borderRadius: "50%",
            background: colors.wrongFill,
            border: "3px solid #1A1A1A",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#FFFFFF",
            fontWeight: "bold",
            fontSize: 18,
          }}
        >
          ✕
        </div>
      </div>

      <p style={{ fontSize: 18, fontWeight: 700, margin: "0 0 8px", textAlign: "center", lineHeight: 1.4 }}>
        옆 사람 화면<br />훔쳐보지 마세요!
      </p>
      <p style={{ fontSize: 13, opacity: 0.6, textAlign: "center", lineHeight: 1.5, margin: "0 0 32px", maxWidth: 260 }}>
        친구들이 당신이 어떤 답을 할지<br />몰래 투표하고 있어요
      </p>

      <div style={{ width: "100%", maxWidth: 220, padding: "14px 16px", borderRadius: radius.md, background: "rgba(255,255,255,0.08)", marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 11, opacity: 0.7 }}>투표 진행</span>
          <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.95 }}>
            {votedCount} / {totalCount}
          </span>
        </div>
        <div style={{ height: 4, borderRadius: 100, background: "rgba(255,255,255,0.15)", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${percent}%`, background: colors.correctFill, borderRadius: 100, transition: "width 0.5s" }} />
        </div>
      </div>

      <p style={{ fontSize: 11, opacity: 0.4, textAlign: "center" }}>
        투표가 끝나면 자동으로<br />다음 화면으로 넘어갑니다
      </p>
    </div>
  );
}

// ============================================
// 투표자: 선 플레이어 답변 시청
// ============================================
function WatchingScreen({ room, leadPlayer, depth, myAnswers }) {
  const answersLen = (room.pyramid?.answers || []).length;
  return (
    <div style={{ ...containerStyle, padding: "14px 12px 16px", justifyContent: "center" }}>
      <Header round={room.currentRound} totalRounds={room.totalRounds} leadName={leadPlayer?.nickname} mode="vote" />

      <div style={{ textAlign: "center", marginBottom: 14 }}>
        <p style={{ fontSize: 14, fontWeight: 700, margin: 0, color: colors.text1 }}>
          🙈 {josa(leadPlayer?.nickname || "", "이/가")} 답하는 중...
        </p>
        <p style={{ fontSize: 11, color: colors.text3, margin: "4px 0 0" }}>
          {answersLen} / {depth} 단계 · 점선은 내 예측이에요
        </p>
      </div>

      <Pyramid pyramid={room.pyramid} mode="watching" myAnswers={myAnswers} />
    </div>
  );
}

// ============================================
// 결과 정리 (선 플레이어 답변 완료)
// ============================================
function ResultView({ room, leadPlayer, result, depth, myPlayerId, myAnswers, onMarkReady, isReady, readyCount, totalCount }) {
  if (!room.pyramid || !leadPlayer) return null;
  const answers = room.pyramid.answers || [];
  const sequence = getAnswerSequence(answers);
  const isLead = leadPlayer.id === myPlayerId;

  return (
    <div style={{ ...containerStyle, padding: "14px 12px 16px", justifyContent: "center" }}>
      <Header round={room.currentRound} totalRounds={room.totalRounds} leadName={leadPlayer.nickname} mode={isLead ? "lead" : "vote"} />

      <div style={{ textAlign: "center", marginBottom: 14 }}>
        <p style={{ fontSize: 14, fontWeight: 700, margin: 0, color: colors.text1 }}>
          {isLead ? "✓ 내 답변 완료" : `✓ ${leadPlayer.nickname}의 답변 완료`}
        </p>
        {!isLead && myAnswers && myAnswers.length > 0 && (
          <p style={{ fontSize: 10, color: colors.text3, margin: "4px 0 0" }}>
            점선은 내가 예측한 경로
          </p>
        )}
      </div>

      <Pyramid
        pyramid={room.pyramid}
        mode={!isLead && myAnswers && myAnswers.length > 0 ? "watching" : "result"}
        myAnswers={myAnswers}
      />

      <div style={{ marginTop: 14, marginBottom: 14 }}>
        <AnswerSequence
          answers={sequence}
          targetName={leadPlayer.nickname}
          isLead={isLead}
          hint={isLead ? "친구들의 예측을 확인해보세요" : "이 경로를 맞춘 친구가 +1점!"}
        />
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
// 정답 공개
// ============================================
function RevealView({ room, players, leadPlayer, result, votes, depth, myPlayerId, isLastRound, onMarkReady, isReady, readyCount, totalCount }) {
  if (!result || !leadPlayer || !room.pyramid) return null;

  const correctVoters = votes.filter((v) => v.vote === result.destination);
  const wrongVoters = votes.filter((v) => v.vote !== result.destination);
  const isLead = leadPlayer.id === myPlayerId;

  return (
    <div style={{ ...containerStyle, padding: "14px 12px 16px", justifyContent: "center" }}>
      <Header round={room.currentRound} totalRounds={room.totalRounds} leadName={leadPlayer.nickname} mode={isLead ? "lead" : "vote"} />

      <div style={{ textAlign: "center", marginBottom: 14 }}>
        <div style={{ fontSize: 30, marginBottom: 4 }}>🎉</div>
        <p style={{ fontSize: 15, fontWeight: 700, margin: 0, color: colors.text1 }}>
          정답 공개!
        </p>
      </div>

      {/* 정답자 */}
      <div
        style={{
          padding: "12px 14px",
          borderRadius: radius.lg,
          background: colors.correctBg,
          border: `2px solid ${colors.correctFill}`,
          marginBottom: 10,
          boxShadow: "0 2px 6px rgba(29,158,117,0.15)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: colors.correctText, letterSpacing: 0.5 }}>
            ✅ 정답자 (+1점)
          </span>
        </div>
        {correctVoters.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {correctVoters.map((v) => {
              const player = players.find((p) => p.id === v.playerId);
              if (!player) return null;
              return (
                <div
                  key={v.playerId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 10px 4px 4px",
                    borderRadius: 100,
                    background: "#FFFFFF",
                    boxShadow: shadow.sm,
                  }}
                >
                  <Avatar nickname={player.nickname} colorIndex={players.findIndex((p) => p.id === player.id)} size={22} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: colors.correctDeep }}>
                    {player.nickname}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: colors.correctText, fontStyle: "italic" }}>
            아무도 못 맞췄어요 🥲
          </div>
        )}
      </div>

      {/* 오답자 */}
      {wrongVoters.length > 0 && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: radius.lg,
            background: colors.surface,
            border: `1px solid ${colors.border1}`,
            marginBottom: 12,
          }}
        >
          <div style={{ fontSize: 10, color: colors.text3, marginBottom: 4 }}>
            아쉽지만 못 맞춘 친구
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {wrongVoters.map((v) => {
              const player = players.find((p) => p.id === v.playerId);
              if (!player) return null;
              return (
                <span
                  key={v.playerId}
                  style={{
                    fontSize: 11,
                    color: colors.text3,
                    padding: "2px 8px",
                    borderRadius: 100,
                    background: colors.surface2,
                  }}
                >
                  {player.nickname}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* 점수 미리보기 */}
      <div
        style={{
          padding: "10px 12px",
          borderRadius: radius.md,
          background: colors.surface,
          border: `1px solid ${colors.border1}`,
          marginBottom: 12,
        }}
      >
        <p style={{ fontSize: 11, color: colors.text3, margin: "0 0 6px", fontWeight: 600 }}>
          🏆 현재 점수
        </p>
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", rowGap: 4, fontSize: 12, color: colors.text1 }}>
          {[...players]
            .sort((a, b) => (b.score || 0) - (a.score || 0))
            .map((p) => (
              <span key={p.id} style={{ marginRight: 8 }}>
                {p.nickname} <strong style={{ fontWeight: 700, color: colors.correctText }}>{p.score || 0}</strong>
              </span>
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


// ============================================
// 준비 버튼 (모두 준비될 때까지 대기)
// ============================================
function ReadyButton({ isReady, readyCount, totalCount, onClick, actionLabel, waitingLabel }) {
  const percent = totalCount > 0 ? (readyCount / totalCount) * 100 : 0;

  if (isReady) {
    // 본인이 이미 준비됨 → 진행률만 표시
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

  // 아직 준비 안됨 → 액션 버튼
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
