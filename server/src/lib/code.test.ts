import { describe, expect, it } from "vitest";
import { extractJson } from "./code";

describe("extractJson", () => {
  it("reads a fenced object", () => {
    expect(extractJson('here:\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
  });
  it("reads a bare object with chatter", () => {
    expect(extractJson('Sure! {"a": {"b": 2}} done')).toEqual({ a: { b: 2 } });
  });
  it("throws when there is no object", () => {
    expect(() => extractJson("nope")).toThrow();
  });
  it("ignores text after a complete object (the 'non-whitespace after JSON' retries)", () => {
    expect(extractJson('{"format": "versus", "lines": [{"text": "a } b"}]}\n\nNote: I chose versus because {it fits}.')).toEqual({ format: "versus", lines: [{ text: "a } b" }] });
  });
  it("takes the first object when the model repeats itself", () => {
    expect(extractJson('{"a": 1}\n{"a": 2}')).toEqual({ a: 1 });
  });
  it("handles braces and escaped quotes inside strings", () => {
    expect(extractJson('Result: {"t": "say \\"hi\\" {not json}", "n": [1, {"x": "]"}]}')).toEqual({ t: 'say "hi" {not json}', n: [1, { x: "]" }] });
  });
  it("repairs trailing commas and smart quotes", () => {
    expect(extractJson('{"a": [1, 2,], \u201Cb\u201D: 3,}')).toEqual({ a: [1, 2], b: 3 });
  });
  it("skips a broken block and uses a valid one later", () => {
    expect(extractJson('draft: {"a": 1 "b": 2}\nfinal: {"a": 1, "b": 2}')).toEqual({ a: 1, b: 2 });
  });
  it("prefers a fenced block over prose that contains braces", () => {
    expect(extractJson('I will use {curly} words.\n```json\n{"ok": true}\n```\ntrailing')).toEqual({ ok: true });
  });
  it("still throws on genuinely broken output", () => {
    expect(() => extractJson('{"a": 1, "b": ')).toThrow();
  });
});
