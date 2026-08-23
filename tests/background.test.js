"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadBackground() {
  let listener;
  const calls = [];
  const chrome = {
    runtime: {
      onMessage: {
        addListener(callback) {
          listener = callback;
        },
      },
    },
    tabs: {
      sendMessage(...args) {
        calls.push(args);
        return Promise.resolve();
      },
    },
  };

  const source = fs.readFileSync(
    path.join(__dirname, "..", "background.js"),
    "utf8",
  );
  vm.runInNewContext(source, { chrome });
  return { calls, listener };
}

test("relays a YouTube caption only to the Khan top frame", () => {
  const { calls, listener } = loadBackground();
  listener(
    { type: "KST_YOUTUBE_CAPTION", text: "hello" },
    {
      tab: { id: 7 },
      frameId: 12,
      url: "https://www.youtube.com/embed/example",
    },
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 7);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][1])), {
    type: "KST_CAPTION",
    text: "hello",
    sourceFrameId: 12,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][2])), { frameId: 0 });
});

test("relays translated text back to the exact YouTube frame", () => {
  const { calls, listener } = loadBackground();
  listener(
    {
      type: "KST_RENDER_CAPTION",
      frameId: 12,
      enabled: true,
      mode: "bilingual",
      original: "hello",
      translated: "你好",
    },
    {
      tab: { id: 7 },
      frameId: 0,
      url: "https://www.khanacademy.org/math/algebra/v/example",
    },
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 7);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][1])), {
    type: "KST_PLAYER_RENDER",
    enabled: true,
    mode: "bilingual",
    original: "hello",
    translated: "你好",
  });
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][2])), { frameId: 12 });
});

test("rejects a render relay from a non-Khan page", () => {
  const { calls, listener } = loadBackground();
  listener(
    {
      type: "KST_RENDER_CAPTION",
      frameId: 12,
      enabled: true,
      original: "private page text",
      translated: "translated",
    },
    {
      tab: { id: 7 },
      frameId: 0,
      url: "https://example.com/",
    },
  );

  assert.equal(calls.length, 0);
});

test("manifest requests only storage and scoped content-script access", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"),
  );

  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(
    manifest.content_scripts.some((script) =>
      script.matches.some((match) => match.includes("khanacademy.org")),
    ),
    true,
  );
});
