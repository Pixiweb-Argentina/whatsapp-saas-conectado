/**
 * Pure comment → rule matcher for Instagram comment-to-guide rules (F4-T3.2).
 * No regex comes from users: keywords are compared as whole normalized words or phrases.
 */

export interface KeywordOptions { foldAccents: boolean }

export interface CommentCandidate {
  assetId: string;
  postId: string | null;
  text: string;
  occurredAt: string;
  isOwn: boolean;
  isDeleted: boolean;
}

export interface CommentRule {
  id: string;
  status: "draft" | "active" | "paused" | "archived";
  priority: number;
  assetId: string;
  /** null = every post of the asset; otherwise only these posts/reels. */
  postIds: string[] | null;
  keywords: string[];
  foldAccents: boolean;
  /** Comments older than the activation are history and never trigger. */
  activatedAt: string;
}

export type CommentMatch =
  | { status: "matched"; ruleId: string; keyword: string }
  | { status: "skipped"; reason: "own_comment" | "deleted" | "no_text" | "no_rule" };

const WORD = /[\p{L}\p{N}]+/gu;

export function normalizeKeywordText(text: string, options: KeywordOptions): string {
  const base = text.normalize("NFKC").trim().toLowerCase();
  return options.foldAccents ? base.normalize("NFD").replace(/\p{M}+/gu, "").normalize("NFC") : base;
}

export function tokenizeKeywordText(text: string, options: KeywordOptions): string[] {
  return normalizeKeywordText(text, options).match(WORD) ?? [];
}

/** True when every keyword token appears contiguously, as whole words, in the comment. */
export function containsPhrase(tokens: readonly string[], phrase: readonly string[]): boolean {
  if (phrase.length === 0 || phrase.length > tokens.length) return false;
  for (let start = 0; start + phrase.length <= tokens.length; start += 1) {
    if (phrase.every((word, offset) => tokens[start + offset] === word)) return true;
  }
  return false;
}

function firstMatchingKeyword(text: string, rule: CommentRule): string | null {
  const options = { foldAccents: rule.foldAccents };
  const tokens = tokenizeKeywordText(text, options);
  return rule.keywords.find((keyword) => containsPhrase(tokens, tokenizeKeywordText(keyword, options))) ?? null;
}

function appliesTo(rule: CommentRule, comment: CommentCandidate): boolean {
  if (rule.status !== "active" || rule.assetId !== comment.assetId) return false;
  if (Date.parse(comment.occurredAt) < Date.parse(rule.activatedAt)) return false;
  return rule.postIds === null || (comment.postId !== null && rule.postIds.includes(comment.postId));
}

function byPriority(a: CommentRule, b: CommentRule): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Exactly one winner: lowest priority number, then lowest id. Order of input never matters. */
export function selectWinningRule(comment: CommentCandidate, rules: readonly CommentRule[]): CommentMatch {
  if (comment.isOwn) return { status: "skipped", reason: "own_comment" };
  if (comment.isDeleted) return { status: "skipped", reason: "deleted" };
  if (!comment.text.trim()) return { status: "skipped", reason: "no_text" };
  for (const rule of rules.filter((item) => appliesTo(item, comment)).sort(byPriority)) {
    const keyword = firstMatchingKeyword(comment.text, rule);
    if (keyword !== null) return { status: "matched", ruleId: rule.id, keyword };
  }
  return { status: "skipped", reason: "no_rule" };
}
