// E12 — ONE shared socket.io connection for the whole authed session.
//
// Before this module there were TWO live socket.io connections per user: an
// app-level "badge" socket (App.jsx) and a per-conversation socket
// (ConversationScreen.jsx) that tore itself down and reconnected on every thread
// switch. Both auto-joined ALL of the user's `conv:<id>` rooms at connect time
// (see server/src/socket/index.js), so each connection redundantly received the
// same `new_message` stream. This module collapses that to a single connection
// that App.jsx owns (connect on auth, disconnect on logout) and that any
// component can subscribe to without clobbering another's handlers.
//
// Design notes:
//  - socket.io-client is loaded via a DYNAMIC import inside connectSocket so it
//    stays off the logged-out critical bundle (both old call sites deliberately
//    kept it off the main chunk; this preserves that).
//  - Handlers are stored in per-event Sets and fanned out by our own dispatch, so
//    multiple subscribers to the same event never overwrite each other and each
//    unsubscribes independently (socket.io's own .off(event) would remove ALL
//    listeners for that event — exactly the clobber we must avoid).
//  - Room membership is server-managed: the server auto-joins every active conv
//    room at connect and has NO `leave_conversation` handler, so scoping a render
//    to the open thread is done by (a) filtering on payload.conversationId and
//    (b) unregistering the component's handlers on unmount — NOT by leaving rooms.

// socket.io events we bridge from the live socket into our own dispatch.
const BRIDGED_EVENTS = [
  "new_message",
  "new_match",
  "message_deleted",
  "reaction_update",
  "conversation_archived",
];

// Internal pseudo-events for connection lifecycle (subscribed via
// subscribeConnection, never emitted by the server).
const CONNECT = "__connect__";
const DISCONNECT = "__disconnect__";
const CONNECT_ERROR = "__connect_error__";

let socket = null;
let connecting = false; // true while the client chunk is loading / io() is racing
let currentToken = null;

// event name -> Set<handler>. Persists across connects; components own their
// own add/remove via effect cleanup.
const handlers = new Map();

function dispatch(event, payload) {
  const set = handlers.get(event);
  if (!set) return;
  // Iterate a copy so a handler that unsubscribes mid-dispatch can't skip peers.
  for (const fn of [...set]) {
    try {
      fn(payload);
    } catch (e) {
      // A throwing subscriber must never take down the socket or its siblings.
      console.error(`[socket] handler for ${event} threw:`, e);
    }
  }
}

// Register a handler for a server event (or a connection pseudo-event). Returns
// an unsubscribe function — call it in effect cleanup. Safe to have many
// handlers per event; each is tracked independently.
export function onSocket(event, fn) {
  let set = handlers.get(event);
  if (!set) {
    set = new Set();
    handlers.set(event, set);
  }
  set.add(fn);
  return () => {
    const s = handlers.get(event);
    if (s) s.delete(fn);
  };
}

// Subscribe to connection status. fn(connected:boolean) is called immediately
// with the current state, then on every (re)connect / disconnect / connect_error.
// Returns an unsubscribe function.
export function subscribeConnection(fn) {
  const onC = () => fn(true);
  const onD = () => fn(false);
  const offs = [
    onSocket(CONNECT, onC),
    onSocket(DISCONNECT, onD),
    onSocket(CONNECT_ERROR, onD),
  ];
  fn(isSocketConnected());
  return () => offs.forEach((off) => off());
}

// Connect once for this session. Idempotent: repeat calls with the SAME token
// are no-ops; a call with a DIFFERENT token tears down the old connection first
// (login-as-someone-else on the same page load). `opts.ioFactory` injects a fake
// io() for unit tests so the real client is never loaded there.
export function connectSocket(token, baseUrl, opts = {}) {
  if (!token || !baseUrl) return;
  if (currentToken === token && (socket || connecting)) return;
  if (socket || connecting) disconnectSocket();

  currentToken = token;
  connecting = true;

  const load = opts.ioFactory
    ? Promise.resolve({ io: opts.ioFactory })
    : import("socket.io-client");

  load
    .then(({ io }) => {
      // A disconnect (logout) or a token switch may have raced ahead of the
      // async import — bail so we never leak a stale connection.
      if (currentToken !== token) return;
      socket = io(baseUrl, { auth: { token }, transports: ["websocket"] });
      for (const ev of BRIDGED_EVENTS) {
        socket.on(ev, (payload) => dispatch(ev, payload));
      }
      socket.on("connect", () => dispatch(CONNECT));
      socket.on("disconnect", () => dispatch(DISCONNECT));
      socket.on("connect_error", () => dispatch(CONNECT_ERROR));
      connecting = false;
    })
    .catch(() => {
      // Import / connect failed (offline, chunk error, 503 in the sandbox). The
      // app degrades gracefully; realtime just won't fire this session.
      connecting = false;
    });
}

// Tear the shared connection down (logout / auth:expired). Handlers are left
// registered — a subsequent connectSocket reuses them — because components
// manage their own subscription lifecycles.
export function disconnectSocket() {
  currentToken = null;
  connecting = false;
  if (socket) {
    try {
      socket.disconnect();
    } catch {
      /* ignore */
    }
    socket = null;
  }
}

// Join a conversation's room. Emits the same `join_conversation` event the old
// per-conversation socket did (idempotent server-side). The server already
// auto-joins every active conv room at connect and, for rooms created later in
// the session, pulls sockets in via joinConversationRoom(); this explicit emit
// mirrors the previous client behavior and re-asserts the join after a reconnect.
export function joinConversation(conversationId) {
  if (!conversationId) return;
  if (socket && socket.connected) {
    socket.emit("join_conversation", { conversationId });
  }
}

// Leave a conversation's room. The server has NO `leave_conversation` handler
// and manages room membership itself (it drops a socket from a room on block —
// server BE-5 — and on disconnect), so there is no event to emit here. Scoping a
// component's rendering to the open thread is done by unregistering its handlers
// and by filtering on payload.conversationId, NOT by leaving the room. Kept for
// API symmetry and forward-compat if the server gains an explicit leave.
export function leaveConversation(conversationId) {
  if (!conversationId) return;
  // Intentionally a no-op emit-wise; see comment above.
}

export function isSocketConnected() {
  return !!(socket && socket.connected);
}

// Test-only: reset module singleton state between cases.
export function __resetForTest() {
  socket = null;
  connecting = false;
  currentToken = null;
  handlers.clear();
}
