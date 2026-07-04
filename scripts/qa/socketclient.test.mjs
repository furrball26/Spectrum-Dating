// E12 — unit coverage for the shared socket client's MANAGEMENT logic.
//
// The real socket is never exercised here (it can't be integration-tested in
// this sandbox — the harness stubs socket.io with 503). What we CAN verify in
// isolation, and what the consolidation hinges on, is: connect-once dedup,
// handler register/unregister with independent fan-out (no clobber), the
// join_conversation emit, and disconnect teardown. connectSocket takes an
// injected ioFactory so no real client is loaded.
//
// Run: node --test scripts/qa/socketclient.test.mjs   (from the repo root)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  connectSocket,
  disconnectSocket,
  onSocket,
  joinConversation,
  isSocketConnected,
  __resetForTest,
} from "../../src/socketClient.js";

// Minimal fake matching the slice of the socket.io client we use.
function makeFakeSocket() {
  const listeners = new Map();
  return {
    connected: true,
    emits: [],
    disconnected: false,
    on(event, fn) {
      listeners.set(event, fn);
    },
    emit(event, payload) {
      this.emits.push({ event, payload });
    },
    disconnect() {
      this.disconnected = true;
      this.connected = false;
    },
    // test helper: drive a server event
    __fire(event, payload) {
      const fn = listeners.get(event);
      if (fn) fn(payload);
    },
  };
}

function factoryFor(fake) {
  return () => fake;
}

test("connectSocket opens exactly one connection and dedups same-token calls", async () => {
  __resetForTest();
  let built = 0;
  const fake = makeFakeSocket();
  const factory = () => {
    built += 1;
    return fake;
  };
  connectSocket("tok-1", "http://x", { ioFactory: factory });
  await Promise.resolve();
  await Promise.resolve();
  // Repeat calls with the same token must NOT build a second socket.
  connectSocket("tok-1", "http://x", { ioFactory: factory });
  connectSocket("tok-1", "http://x", { ioFactory: factory });
  await Promise.resolve();
  assert.equal(built, 1, "only one io() connection for a stable token");
  assert.equal(isSocketConnected(), true);
  disconnectSocket();
  assert.equal(fake.disconnected, true, "disconnectSocket tears the socket down");
});

test("a different token tears down the old connection and builds a new one", async () => {
  __resetForTest();
  const fakeA = makeFakeSocket();
  const fakeB = makeFakeSocket();
  connectSocket("tok-A", "http://x", { ioFactory: factoryFor(fakeA) });
  await Promise.resolve();
  connectSocket("tok-B", "http://x", { ioFactory: factoryFor(fakeB) });
  await Promise.resolve();
  assert.equal(fakeA.disconnected, true, "old connection is severed");
  assert.equal(isSocketConnected(), true, "new connection is live");
  disconnectSocket();
});

test("multiple handlers on the same event both fire and unsubscribe independently", async () => {
  __resetForTest();
  const fake = makeFakeSocket();
  connectSocket("tok", "http://x", { ioFactory: factoryFor(fake) });
  await Promise.resolve();

  const seenA = [];
  const seenB = [];
  const offA = onSocket("new_message", (p) => seenA.push(p));
  onSocket("new_message", (p) => seenB.push(p));

  fake.__fire("new_message", { conversationId: "c1", message: { id: "m1" } });
  assert.equal(seenA.length, 1, "handler A fired");
  assert.equal(seenB.length, 1, "handler B fired (not clobbered by A)");

  // Removing A must leave B intact — the clobber bug we are guarding against.
  offA();
  fake.__fire("new_message", { conversationId: "c1", message: { id: "m2" } });
  assert.equal(seenA.length, 1, "A no longer fires after unsubscribe");
  assert.equal(seenB.length, 2, "B keeps firing");
  disconnectSocket();
});

test("a throwing handler does not stop its siblings", async () => {
  __resetForTest();
  const fake = makeFakeSocket();
  connectSocket("tok", "http://x", { ioFactory: factoryFor(fake) });
  await Promise.resolve();
  const seen = [];
  onSocket("new_message", () => { throw new Error("boom"); });
  onSocket("new_message", (p) => seen.push(p));
  fake.__fire("new_message", { conversationId: "c1", message: { id: "m1" } });
  assert.equal(seen.length, 1, "sibling still received the event");
  disconnectSocket();
});

test("joinConversation emits join_conversation on the connected socket", async () => {
  __resetForTest();
  const fake = makeFakeSocket();
  connectSocket("tok", "http://x", { ioFactory: factoryFor(fake) });
  await Promise.resolve();
  joinConversation("conv-123");
  const joins = fake.emits.filter((e) => e.event === "join_conversation");
  assert.equal(joins.length, 1);
  assert.deepEqual(joins[0].payload, { conversationId: "conv-123" });
  disconnectSocket();
});

test("join is a no-op when the socket is not connected (no crash)", async () => {
  __resetForTest();
  const fake = makeFakeSocket();
  fake.connected = false;
  connectSocket("tok", "http://x", { ioFactory: factoryFor(fake) });
  await Promise.resolve();
  joinConversation("conv-x"); // must not throw
  assert.equal(fake.emits.length, 0, "nothing emitted while disconnected");
  disconnectSocket();
});
