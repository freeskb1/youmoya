// 광배월드(허브)에서 넘어온 쿼리 읽기
// ?room=4821&sid=...&uid=...&name=...&host=1&hub=...
// hub.js 는 defer 라 window.KWANGBBAN 이 늦을 수 있으므로 location.search 를 직접 읽는다.
export function readHubParams() {
  if (typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search);
  const room = q.get("room");
  const sid = q.get("sid");
  const hub = q.get("hub");
  if (!room || !sid || !hub) return null;
  if (!/^[0-9]{4}$/.test(room)) return null;
  const name = (q.get("name") || "").trim().slice(0, 8) || "플레이어";
  return {
    room,
    sid,
    hub,
    code: `h${room}`,
    uid: q.get("uid") || "",
    name,
    host: q.get("host") === "1",
  };
}
