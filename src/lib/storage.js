const KEY_PLAYER = "neomoya:player";
const KEY_NICKNAME = "neomoya:lastNickname";

export function savePlayer(p) {
  try {
    localStorage.setItem(KEY_PLAYER, JSON.stringify(p));
  } catch {}
}

export function loadPlayer() {
  try {
    const raw = localStorage.getItem(KEY_PLAYER);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearPlayer() {
  try {
    localStorage.removeItem(KEY_PLAYER);
  } catch {}
}

export function saveLastNickname(name) {
  try {
    localStorage.setItem(KEY_NICKNAME, name);
  } catch {}
}

export function loadLastNickname() {
  try {
    return localStorage.getItem(KEY_NICKNAME) || "";
  } catch {
    return "";
  }
}
