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

  io.on('connection', (socket) => {
    const userId = socket.userId;

    // Join personal room — for match notifications and DM delivery
    socket.join(`user:${userId}`);

    // Join conversation rooms for all this user's active conversations
    const convos = db.prepare(`
      SELECT id FROM conversations
      WHERE (user_a_id = ? AND archived_by_a = 0)
         OR (user_b_id = ? AND archived_by_b = 0)
    `).all(userId, userId);
    convos.forEach(c => socket.join(`conv:${c.id}`));

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
