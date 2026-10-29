import { useState, useEffect } from "react";
import { createHubRoom, joinHubRoom, subscribeRoom } from "../lib/room";
import { savePlayer, saveLastNickname } from "../lib/storage";
import { ensureSignedIn } from "../lib/firebase";
import { colors, containerStyle } from "../lib/theme";

// 광배월드에서 넘어온 경우: 첫 화면/닉네임/방 만들기·참가를 건너뛰고 바로 대기실로.
// params: readHubParams() 결과, onDone(code): 입장 완료 후 호출
export default function HubEntry({ params, onDone }) {
  const [status, setStatus] = useState(params.host ? "creating" : "connecting");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let unsub = null;
    const { code, sid, name, uid, host } = params;

    function finish(playerId) {
      if (cancelled) return;
      savePlayer({ playerId, roomCode: code, nickname: name });
      saveLastNickname(name);
      onDone(code);
    }

    async function run() {
      try {
        await ensureSignedIn();
        if (cancelled) return;

        if (host) {
          const { playerId } = await createHubRoom(code, name, sid, uid);
          finish(playerId);
          return;
        }

        // 멤버: hubSid 가 맞는 방이 생길 때까지 기다렸다가 입장
        let joining = false;
        unsub = subscribeRoom(code, async (room) => {
          if (cancelled || joining) return;
          if (!room || room.hubSid !== sid) {
            setStatus("waiting");
            return;
          }
          joining = true;
          setStatus("joining");
          try {
            const result = await joinHubRoom(code, name, uid);
            if (cancelled) return;
            if (result.error) {
              joining = false;
              setStatus("waiting");
              return;
            }
            if (unsub) {
              unsub();
              unsub = null;
            }
            finish(result.playerId);
          } catch (e) {
            console.error(e);
            joining = false;
            if (!cancelled) setError("입장에 실패했어요. 새로고침 해주세요.");
          }
        });
      } catch (e) {
        console.error(e);
        if (!cancelled) setError("연결에 실패했어요. 새로고침 해주세요.");
      }
    }

    run();
    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [params, onDone]);

  let message = "입장하는 중...";
  if (status === "creating") message = "방을 만드는 중...";
  if (status === "waiting") message = "방장을 기다리는 중…";
  if (error) message = error;

  return (
    <div style={{ ...containerStyle, alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: error ? "#E24B4A" : colors.text1, marginBottom: 6 }}>
          {message}
        </div>
        {status === "waiting" && !error && (
          <div style={{ fontSize: 12, color: colors.text3 }}>
            방장이 게임에 들어오면 자동으로 입장해요
          </div>
        )}
      </div>
    </div>
  );
}
