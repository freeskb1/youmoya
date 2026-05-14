import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { leaveRoom, restartGame, returnToWaiting } from "../lib/room";
import { calculateSoulmate } from "../lib/game";
import { clearPlayer } from "../lib/storage";
import Avatar from "../components/Avatar";
import OdiyaPlay from "./OdiyaPlay";
import MachobaPlay from "./MachobaPlay";
import NeomoyaPlay from "./NeomoyaPlay";
import { colors, radius, shadow, containerStyle } from "../lib/theme";

export default function GamePlay({ room, code, myPlayerId }) {
  const navigate = useNavigate();

  const players = useMemo(() => {
    return Object.entries(room.players || {})
      .map(([id, p]) => ({ id, ...p }))
      .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
  }, [room.players]);

  const leadPlayer = players.find((p) => p.id === room.currentLeadPlayerId);
  const isHost = (room.players?.[myPlayerId] || {}).isHost;

  // 모든 votes 수집 (소울메이트 계산용)
  const allVotes = useMemo(() => {
    const out = [];
    const v = room.votes || {};
    const results = room.results || {};
    for (const round in v) {
      const r = parseInt(round, 10);
      const result = results[r];
      // 라운드의 마쵸바 문제 수 (있으면)
      // 라운드의 문제 수 (마쵸바: questions, 너모야: scenarios)
      const machobaCount = (result?.questions?.length) || (result?.scenarios?.length) || 0;
      for (const pid in v[round]) {
        const voteData = v[round][pid];
        out.push({
          round: r,
          playerId: pid,
          // 오디야: isCorrect (true/false) — 라운드 1개 = 1문제로 카운트
          // 마쵸바: matchCount (0~N), totalQuestions (라운드 내 총 문제 수)
          isCorrect: voteData.isCorrect === true,
          matchCount: typeof voteData.matchCount === "number" ? voteData.matchCount : null,
          totalQuestions: machobaCount,
        });
      }
    }
    return out;
  }, [room.votes, room.results]);

  async function handleLeaveFinal() {
    if (players.find((p) => p.id === myPlayerId)) {
      await leaveRoom(code, myPlayerId);
    }
    clearPlayer();
    navigate("/");
  }

  async function handleRestart() {
    await restartGame(code);
  }

  async function handleReturnToWaiting() {
    await returnToWaiting(code);
  }

  // 게임 종료 → 최종 결과
  if (room.status === "finished") {
    // 너모야 재미 모드는 자체 결과 화면 사용
    if (room.gameMode === "neomoya" && room.neomoyaSubMode === "fun") {
      return (
        <NeomoyaPlay
          room={room}
          code={code}
          myPlayerId={myPlayerId}
          leadPlayer={null}
          players={players}
          isHost={isHost}
          onRestart={handleRestart}
          onReturnToWaiting={handleReturnToWaiting}
          onFinish={async () => {
            if (players.find((p) => p.id === myPlayerId)) {
              await leaveRoom(code, myPlayerId);
            }
            clearPlayer();
            navigate("/", { replace: true });
          }}
        />
      );
    }
    return (
      <FinalResult
        players={players}
        myPlayerId={myPlayerId}
        results={room.results || {}}
        allVotes={allVotes}
        totalRounds={room.totalRounds}
        isHost={isHost}
        onLeave={handleLeaveFinal}
        onRestart={handleRestart}
        onReturnToWaiting={handleReturnToWaiting}
      />
    );
  }

  // 모드별 분기
  const gameMode = room.gameMode || "odiya";
  if (gameMode === "machoba") {
    return (
      <MachobaPlay
        room={room}
        code={code}
        myPlayerId={myPlayerId}
        leadPlayer={leadPlayer}
        players={players}
      />
    );
  }

  if (gameMode === "neomoya") {
    return (
      <NeomoyaPlay
        room={room}
        code={code}
        myPlayerId={myPlayerId}
        leadPlayer={leadPlayer}
        players={players}
        onFinish={async () => {
          if (players.find((p) => p.id === myPlayerId)) {
            await leaveRoom(code, myPlayerId);
          }
          clearPlayer();
          navigate("/", { replace: true });
        }}
      />
    );
  }

  return (
    <OdiyaPlay
      room={room}
      code={code}
      myPlayerId={myPlayerId}
      leadPlayer={leadPlayer}
      players={players}
    />
  );
}

// ============================================
// 최종 결과 (모드 공통)
// ============================================
function FinalResult({ players, myPlayerId, results, allVotes, totalRounds, isHost, onLeave, onRestart, onReturnToWaiting }) {
  const sortedPlayers = [...players].sort((a, b) => (b.score || 0) - (a.score || 0));
  const winner = sortedPlayers[0];

  const myLeadRounds = Object.entries(results)
    .filter(([, r]) => r.leadPlayerId === myPlayerId)
    .map(([round]) => parseInt(round, 10));

  const soulmate = calculateSoulmate(myPlayerId, myLeadRounds, allVotes);
  // ranking 에 player 정보 붙이기
  const soulmateRanking = soulmate.ranking
    .map((entry) => ({ ...entry, player: players.find((p) => p.id === entry.playerId) }))
    .filter((entry) => entry.player);
  const worstEntry = soulmate.worst
    ? { ...soulmate.worst, player: players.find((p) => p.id === soulmate.worst.playerId) }
    : null;

  return (
    <div style={{ ...containerStyle, padding: "16px 12px 16px", justifyContent: "center" }}>
      <div style={{ textAlign: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 36, marginBottom: 4 }}>🎊</div>
        <p style={{ fontSize: 11, color: colors.text3, letterSpacing: 1.2, margin: "0 0 2px", fontWeight: 600 }}>GAME OVER</p>
        <p style={{ fontSize: 18, fontWeight: 700, color: colors.text1, margin: 0 }}>
          전체 {totalRounds}라운드 완료
        </p>
      </div>

      {/* 우승자 */}
      <div
        style={{
          position: "relative",
          padding: "20px 16px",
          borderRadius: radius.lg,
          textAlign: "center",
          marginBottom: 14,
          background: colors.cardBg,
          border: `2px solid ${colors.cardBorderDeep}`,
          boxShadow: shadow.cardLift,
        }}
      >
        <div style={{
          position: "absolute", top: -10, left: "50%",
          transform: "translateX(-50%)",
          padding: "3px 12px", borderRadius: 100,
          fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
          background: colors.cardAccent, color: colors.cardTextDeep,
        }}>
          👑 WINNER
        </div>
        <div style={{ fontSize: 36, marginBottom: 4 }}>🏆</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: colors.cardTextDeep, marginBottom: 2 }}>
          {winner?.nickname || "?"}
        </div>
        <div style={{ fontSize: 13, color: colors.cardText, fontWeight: 600 }}>{winner?.score || 0}점 획득</div>
      </div>

      {/* 나를 잘 맞춘 사람 톱3 */}
      {soulmateRanking.length > 0 ? (
        <div style={{
          padding: "14px", borderRadius: radius.lg, marginBottom: 10,
          background: colors.pinkBg, border: `1px solid ${colors.pinkBorder}`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
            <span style={{ fontSize: 14 }}>💝</span>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.3, color: colors.pinkText }}>
              나를 잘 맞춘 사람 TOP {soulmateRanking.length}
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {soulmateRanking.map((entry, idx) => {
              const medals = ["🥇", "🥈", "🥉"];
              return (
                <div key={entry.playerId} style={{ display: "flex", alignItems: "center" }}>
                  <div style={{ fontSize: 20, marginRight: 8, width: 24, textAlign: "center" }}>
                    {medals[idx] || ""}
                  </div>
                  <Avatar nickname={entry.player.nickname} colorIndex={players.findIndex((p) => p.id === entry.playerId)} size={32} style={{ marginRight: 10 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: colors.pinkDeep }}>
                      {entry.player.nickname}
                    </div>
                    <div style={{ fontSize: 10, color: colors.pinkText }}>
                      {entry.total}개 중 {entry.correctCount}개 일치
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : myLeadRounds.length > 0 ? (
        <div style={{
          padding: "18px 14px", borderRadius: radius.lg, marginBottom: 10,
          background: colors.surface, border: `1px dashed ${colors.border2}`,
          textAlign: "center",
        }}>
          <div style={{ fontSize: 28, marginBottom: 6 }}>🌀</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: colors.text1, marginBottom: 2 }}>
            나를 맞춘 사람이 없네요
          </div>
          <div style={{ fontSize: 11, color: colors.text3 }}>당신은 미스터리한 사람!</div>
        </div>
      ) : null}

      {/* 나를 가장 모르는 사람 (꼴찌) - 4명 이상일 때만 */}
      {worstEntry && worstEntry.player && (
        <div style={{
          padding: "10px 14px", borderRadius: radius.lg, marginBottom: 14,
          background: colors.surface2, border: `1px solid ${colors.border1}`,
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <div style={{ fontSize: 22 }}>🤔</div>
          <Avatar nickname={worstEntry.player.nickname} colorIndex={players.findIndex((p) => p.id === worstEntry.playerId)} size={28} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: colors.text3, marginBottom: 1 }}>
              나를 가장 모르는 사람
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: colors.text1 }}>
              {worstEntry.player.nickname}
              <span style={{ fontSize: 10, color: colors.text3, fontWeight: 400, marginLeft: 6 }}>
                {worstEntry.total}개 중 {worstEntry.correctCount}개 일치
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 순위 */}
      <div style={{ marginBottom: 14 }}>
        <p style={{ fontSize: 11, color: colors.text3, margin: "0 0 8px", paddingLeft: 4, letterSpacing: 0.3, fontWeight: 600 }}>
          🏅 전체 순위
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {sortedPlayers.map((p, idx) => {
            const isMe = p.id === myPlayerId;
            return (
              <div key={p.id} style={{
                display: "flex", alignItems: "center",
                padding: "10px 12px", borderRadius: radius.md,
                ...(isMe
                  ? { background: colors.accentBg, border: `1px solid ${colors.accentBorder}` }
                  : { background: colors.surface, border: `1px solid ${colors.border1}` }),
              }}>
                <span style={{
                  fontSize: 13, fontWeight: 700, width: 22,
                  color: isMe ? colors.accentText : colors.text3,
                }}>
                  {idx + 1}
                </span>
                <Avatar nickname={p.nickname} colorIndex={players.findIndex((pp) => pp.id === p.id)} size={28} style={{ marginRight: 10, marginLeft: 4 }} />
                <div style={{
                  flex: 1, fontSize: 13, color: colors.text1,
                  fontWeight: isMe ? 700 : 500,
                }}>
                  {p.nickname}
                  {isMe && <span style={{ fontSize: 10, color: colors.accentText, marginLeft: 4 }}>나</span>}
                </div>
                <span style={{ fontSize: 13, color: colors.text1, fontWeight: 700 }}>
                  {p.score || 0}점
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 액션 버튼 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {isHost && (
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
        )}
        {isHost && (
          <button
            onClick={onReturnToWaiting}
            style={{
              padding: 12, borderRadius: radius.lg,
              background: colors.surface,
              color: colors.text2, fontSize: 13, fontWeight: 600,
              border: `1.5px solid ${colors.border2}`,
              cursor: "pointer", fontFamily: "inherit",
              boxShadow: shadow.sm,
            }}
          >
            ⚙️ 모드 바꿔서 다시하기
          </button>
        )}
        <button
          onClick={onLeave}
          style={{
            padding: 11, borderRadius: radius.lg,
            background: "transparent",
            color: colors.text3, fontSize: 12, fontWeight: 500,
            border: `1px solid ${colors.border1}`,
            cursor: "pointer", fontFamily: "inherit",
          }}
        >
          {isHost ? "방 나가기" : "🏠 홈으로"}
        </button>
        {!isHost && (
          <p style={{ fontSize: 10, color: colors.text3, textAlign: "center", margin: 0 }}>
            방장이 다시 시작하면 자동으로 참여돼요
          </p>
        )}
      </div>
    </div>
  );
}
