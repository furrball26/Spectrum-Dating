import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'http://localhost:5173';

export function setupSocketIO(httpServer, db) {
  const io = new Server(httpServer, {
    cors: { origin: ALLOWED_ORIGIN, methods: ['GET', 'POST'] },
  });

  // Auth middleware — validate JWT on every connection
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Unauthorized'));
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      socket.userId = payload.sub;
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
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

    // Client joins a specific conversation room (e.g. when opening a thread)
    socket.on('join_conversation', (convId) => {
      // Verify membership before joining
      const conv = db.prepare(
        'SELECT user_a_id, user_b_id FROM conversations WHERE id = ?'
      ).get(convId);
      if (conv && (conv.user_a_id === userId || conv.user_b_id === userId)) {
        socket.join(`conv:${convId}`);
      }
    });

    socket.on('disconnect', () => {
      // socket.io handles room cleanup automatically
    });
  });

  return io;
}
