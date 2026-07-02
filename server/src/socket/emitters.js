// All emitter functions receive the io instance as first arg.
// Events follow platform rules: no typing indicators, no read receipts, no raw timestamps.

export function emitNewMessage(io, conversationId, message) {
  // message shape: { id, senderId, body, deleted, timeGroup }
  io.to(`conv:${conversationId}`).emit('new_message', {
    conversationId,
    message,
  });
}

export function emitMessageDeleted(io, conversationId, messageId) {
  io.to(`conv:${conversationId}`).emit('message_deleted', {
    conversationId,
    messageId,
  });
}

export function emitReactionUpdate(io, conversationId, messageId, reactions) {
  // reactions: array of { emoji, count, userReacted }
  io.to(`conv:${conversationId}`).emit('reaction_update', {
    conversationId,
    messageId,
    reactions,
  });
}

export function emitNewMatch(io, userIdA, userIdB, matchId) {
  // Notify both parties of a new mutual match
  const payload = { matchId };
  io.to(`user:${userIdA}`).emit('new_match', payload);
  io.to(`user:${userIdB}`).emit('new_match', payload);
}

export function emitConversationArchived(io, conversationId, archivedByUserId) {
  // Only the archiver needs to know — used to update their list in real-time
  io.to(`user:${archivedByUserId}`).emit('conversation_archived', { conversationId });
}

// Join BOTH parties' currently-open sockets to a conversation's room the moment
// the conversation is created. The badge socket only auto-joins `conv:<id>`
// rooms at CONNECT time (see socket/index.js), so a conversation created later
// in a live session would never receive `new_message` until the client
// reconnects/reloads. socketsJoin on the personal `user:<id>` rooms (joined at
// connect) pulls every live socket for each user into the new room. Best-effort
// and defensive — a missing io or a socket-adapter error must never break the
// HTTP request that created the conversation.
export function joinConversationRoom(io, conversationId, userIdA, userIdB) {
  if (!io || !conversationId) return;
  try {
    const room = `conv:${conversationId}`;
    io.in(`user:${userIdA}`).socketsJoin(room);
    io.in(`user:${userIdB}`).socketsJoin(room);
  } catch (e) {
    console.error('[socket] joinConversationRoom failed:', e?.message);
  }
}
