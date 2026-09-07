import { describe, it, expect } from "vitest";
import { csvField, toCsv } from "@/lib/extraction/csv";

describe("csvField", () => {
  it("leaves an ordinary value alone", () => {
    expect(csvField("412")).toBe("412");
  });

  it("quotes and doubles embedded quotes", () => {
    expect(csvField('she said "yes"')).toBe('"she said ""yes"""');
  });

  it("quotes a value containing a comma or a newline", () => {
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField("a\nb")).toBe('"a\nb"');
  });

  it("neutralises a formula without mangling the value", () => {
    // A negative effect size is a real value that Excel would otherwise run.
    expect(csvField("-0.42")).toBe('"\t-0.42"');
    expect(csvField("=SUM(A1:A9)")).toBe('"\t=SUM(A1:A9)"');
  });

  it("renders null and undefined as empty", () => {
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
  });
});

describe("toCsv", () => {
  it("joins rows with CRLF, as RFC 4180 requires", () => {
    expect(
      toCsv([
        ["a", "b"],
        ["c", "d"],
      ]),
    ).toBe("a,b\r\nc,d");
  });

  it("handles an empty table", () => {
    expect(toCsv([])).toBe("");
  });
});
