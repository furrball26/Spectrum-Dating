import { Server } from 'socket.io';
import { verifyToken } from '../middleware/auth.js';

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'http://localhost:5173';

export function setupSocketIO(httpServer, db) {
  const io = new Server(httpServer, {
    cors: { origin: ALLOWED_ORIGIN, methods: ['GET', 'POST'] },
  });

  // Auth middleware — validate JWT (incl. version/suspension) on every connection
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Unauthorized'));
    const userId = verifyToken(token);
    if (!userId) return next(new Error('Unauthorized'));
    socket.userId = userId;
    next();
  });

  // Defense-in-depth: true iff a block exists in EITHER direction between the
  // pair. Mirrors the HTTP message-send gate so a blocked pair can never share a
  // socket room (and thus never live-receive each other's events).
  const blockExists = (a, b) => !!db.prepare(
    `SELECT 1 FROM blocks
     WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)
     LIMIT 1`
  ).get(a, b, b, a);

  io.on('connection', (socket) => {
    const userId = socket.userId;

    // Join personal room — for match notifications and DM delivery
    socket.join(`user:${userId}`);

    // Join conversation rooms for all this user's active conversations, skipping
    // any conversation with a user this member has blocked (or been blocked by).
    const convos = db.prepare(`
      SELECT id, user_a_id, user_b_id FROM conversations
      WHERE (user_a_id = ? AND archived_by_a = 0)
         OR (user_b_id = ? AND archived_by_b = 0)
    `).all(userId, userId);
    convos.forEach(c => {
      const otherId = c.user_a_id === userId ? c.user_b_id : c.user_a_id;
      if (!blockExists(userId, otherId)) socket.join(`conv:${c.id}`);
    });

    // Client joins a specific conversation room (e.g. when opening a thread).
    // Wrapped in try/catch — a malformed payload must NEVER crash the process.
    socket.on('join_conversation', (payload) => {
      try {
        // Frontend emits { conversationId }; also tolerate a bare string id.
        const convId = typeof payload === 'string' ? payload : payload?.conversationId;
        if (!convId || typeof convId !== 'string') return;
        const conv = db.prepare(
          'SELECT user_a_id, user_b_id FROM conversations WHERE id = ?'
        ).get(convId);
        if (conv && (conv.user_a_id === userId || conv.user_b_id === userId)) {
          // Defense-in-depth: refuse (and proactively leave) if a block exists
          // between the pair — mirror the HTTP send gate so a block fully severs
          // the live channel.
          const otherId = conv.user_a_id === userId ? conv.user_b_id : conv.user_a_id;
          if (blockExists(userId, otherId)) {
            socket.leave(`conv:${convId}`);
            return;
          }
          socket.join(`conv:${convId}`);
        }
      } catch (e) {
        console.error('[socket] join_conversation failed:', e.message);
      }
    });

    socket.on('disconnect', () => {
      // socket.io handles room cleanup automatically
    });
  });

  return io;
}

// Force-disconnect every live socket belonging to a user. Called when a user is
// suspended or their token_version is bumped (sign-out / password reset), so an
// ALREADY-OPEN connection can't keep live-receiving room events until it happens
// to reconnect. The per-connection io.use() auth only runs at connect time, so
// without this a suspended user keeps receiving new_message/new_match events on
// their existing socket. Best-effort and defensive — never throws.
export function disconnectUser(io, userId) {
  if (!io || !userId) return;
  try {
    const room = io.sockets.adapter.rooms.get(`user:${userId}`);
    if (!room) return;
    for (const socketId of [...room]) {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) socket.disconnect(true);
    }
  } catch (e) {
    console.error('[socket] disconnectUser failed:', e?.message);
  }
}
