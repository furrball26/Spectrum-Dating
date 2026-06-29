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
