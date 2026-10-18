import assert from "node:assert/strict";
import { test } from "node:test";
import {
  containsPhrase, normalizeKeywordText, selectWinningRule, tokenizeKeywordText,
  type CommentCandidate, type CommentRule,
} from "./comment-keyword-matcher.ts";

const comment = (overrides: Partial<CommentCandidate> = {}): CommentCandidate => ({
  assetId: "ig_1", postId: "post_1", text: "Hola! Quiero la GUÍA por favor",
  occurredAt: "2026-10-18T12:00:00Z", isOwn: false, isDeleted: false, ...overrides,
});
const rule = (overrides: Partial<CommentRule> = {}): CommentRule => ({
  id: "rule_b", status: "active", priority: 10, assetId: "ig_1", postIds: null,
  keywords: ["guía"], foldAccents: false, activatedAt: "2026-10-18T00:00:00Z", ...overrides,
});

test("normalization applies NFKC, trim and casefold, with optional accent folding", () => {
  assert.equal(normalizeKeywordText("  ＧＵÍＡ ", { foldAccents: false }), "guía");
  assert.equal(normalizeKeywordText("Guía", { foldAccents: true }), "guia");
  assert.deepEqual(tokenizeKeywordText("¡Quiero-la guía!!", { foldAccents: false }), ["quiero", "la", "guía"]);
});

test("keywords match whole words or contiguous phrases, never substrings or regex", () => {
  const tokens = tokenizeKeywordText("quiero la guia gratis", { foldAccents: true });
  assert.equal(containsPhrase(tokens, ["guia"]), true);
  assert.equal(containsPhrase(tokens, ["guia", "gratis"]), true);
  assert.equal(containsPhrase(tokens, ["la", "gratis"]), false);
  assert.equal(containsPhrase(tokenizeKeywordText("guiado", { foldAccents: true }), ["guia"]), false);
  assert.equal(selectWinningRule(comment({ text: "a.*b" }), [rule({ keywords: [".*"] })]).status, "skipped");
});

test("accent folding is opt-in per rule", () => {
  const plain = comment({ text: "mandame la guia" });
  assert.equal(selectWinningRule(plain, [rule()]).status, "skipped");
  assert.deepEqual(selectWinningRule(plain, [rule({ foldAccents: true })]),
    { status: "matched", ruleId: "rule_b", keyword: "guía" });
});

test("own, deleted, empty and historical comments never trigger", () => {
  assert.deepEqual(selectWinningRule(comment({ isOwn: true }), [rule()]), { status: "skipped", reason: "own_comment" });
  assert.deepEqual(selectWinningRule(comment({ isDeleted: true }), [rule()]), { status: "skipped", reason: "deleted" });
  assert.deepEqual(selectWinningRule(comment({ text: "  " }), [rule()]), { status: "skipped", reason: "no_text" });
  const old = comment({ occurredAt: "2026-10-17T23:59:59Z" });
  assert.deepEqual(selectWinningRule(old, [rule()]), { status: "skipped", reason: "no_rule" });
});

test("only active rules on the same asset and post apply", () => {
  for (const status of ["draft", "paused", "archived"] as const) {
    assert.equal(selectWinningRule(comment(), [rule({ status })]).status, "skipped");
  }
  assert.equal(selectWinningRule(comment(), [rule({ assetId: "ig_2" })]).status, "skipped");
  assert.equal(selectWinningRule(comment(), [rule({ postIds: ["post_9"] })]).status, "skipped");
  assert.equal(selectWinningRule(comment(), [rule({ postIds: ["post_1"] })]).status, "matched");
  assert.equal(selectWinningRule(comment({ postId: null }), [rule({ postIds: ["post_1"] })]).status, "skipped");
});

test("exactly one deterministic winner: priority, then id, regardless of input order", () => {
  const rules = [rule({ id: "rule_c", priority: 5 }), rule({ id: "rule_a", priority: 5 }), rule({ id: "rule_0", priority: 20 })];
  const forward = selectWinningRule(comment(), rules);
  const reverse = selectWinningRule(comment(), [...rules].reverse());
  assert.deepEqual(forward, { status: "matched", ruleId: "rule_a", keyword: "guía" });
  assert.deepEqual(reverse, forward);
  const nonMatchingFirst = [rule({ id: "rule_a", priority: 1, keywords: ["precio"] }), rule({ id: "rule_z", priority: 9 })];
  assert.deepEqual(selectWinningRule(comment(), nonMatchingFirst), { status: "matched", ruleId: "rule_z", keyword: "guía" });
});
