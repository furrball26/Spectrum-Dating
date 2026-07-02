// Per-request context factory -- replaces any global state pattern.
// Each request gets a fresh ctx with db access and the authenticated user (if any).
export function createRequestContext(req, db) {
  return {
    db,
    userId: req.user?.id ?? null,
  };
}

export function contextMiddleware(db) {
  return (req, _res, next) => {
    req.ctx = createRequestContext(req, db);
    next();
  };
}
