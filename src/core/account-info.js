export function isLoggedInNow() {
	if (typeof window.ServerIsLoggedIn === "function" && window.ServerIsLoggedIn()) return true;
	const p = window.Player;
	return !!(p && p.CharacterID && typeof p.MemberNumber === "number" && p.MemberNumber > 0);
}

export function getAccountInfo() {
	const loggedIn = isLoggedInNow();
	const p = window.Player;
	// After a disconnect BC shows Character/Relog and asks for the password again.
	// At that point ServerIsConnected can already be true while the session is not
	// authenticated yet, so do not treat the account as online.
	const authPending = window.CurrentScreen === "Relog" || window.CurrentScreen === "Login";
	const online = loggedIn && !authPending && window.ServerIsConnected === true;
	const name = loggedIn && p && typeof p.Name === "string" ? p.Name : "";
	const account = loggedIn && p && typeof p.AccountName === "string" ? p.AccountName : "";
	const memberNumber = loggedIn && p && typeof p.MemberNumber === "number" ? p.MemberNumber : null;
	let room = "";
	const inRoom = typeof window.ServerPlayerIsInChatRoom !== "function" || window.ServerPlayerIsInChatRoom();
	if (loggedIn && inRoom && window.ChatRoomData && typeof window.ChatRoomData.Name === "string") {
		room = window.ChatRoomData.Name.trim();
	}
	return { loggedIn, online, name, account, memberNumber, room };
}
