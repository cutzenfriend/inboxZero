import { describe, expect, it } from "vitest";
import { computeSurfaceDate, parseSubject } from "../src/parse.js";

// fixed "now" for deterministic tests
const today = new Date(2026, 6, 2); // 2026-07-02

describe("parseSubject", () => {
  it("parses DD.MM.YYYY dates", () => {
    expect(parseSubject("@01.03.2027 File tax return", today)).toEqual({
      title: "File tax return",
      due: "2027-03-01",
      leadDays: null,
    });
  });

  it("parses year-less future dates → this year", () => {
    expect(parseSubject("@24.12. Buy presents", today)).toEqual({
      title: "Buy presents",
      due: "2026-12-24",
      leadDays: null,
    });
  });

  it("parses year-less past dates → next year", () => {
    expect(parseSubject("@01.03. Taxes", today)?.due).toBe("2027-03-01");
  });

  it("today counts as this year", () => {
    expect(parseSubject("@02.07. Due today", today)?.due).toBe("2026-07-02");
  });

  it("parses ISO dates", () => {
    expect(parseSubject("@2026-09-15 Change tires", today)).toEqual({
      title: "Change tires",
      due: "2026-09-15",
      leadDays: null,
    });
  });

  it("parses lead days directly after the date", () => {
    expect(parseSubject("@01.03.2027 5d File tax return", today)).toEqual({
      title: "File tax return",
      due: "2027-03-01",
      leadDays: 5,
    });
  });

  it("allows the date in the middle of the subject", () => {
    expect(parseSubject("File tax @01.03.2027 return", today)).toEqual({
      title: "File tax return",
      due: "2027-03-01",
      leadDays: null,
    });
  });

  it("number-plus-d in the title is not a lead time unless right after the date", () => {
    const r = parseSubject("@01.03.2027 Reserve room 5d", today);
    expect(r?.leadDays).toBeNull();
    expect(r?.title).toBe("Reserve room 5d");
  });

  it("no @ date → null (LLM case)", () => {
    expect(parseSubject("Change tires by next Tuesday", today)).toBeNull();
  });

  it("invalid date → null", () => {
    expect(parseSubject("@31.02.2027 Nonsense", today)).toBeNull();
  });

  it("empty title → null", () => {
    expect(parseSubject("@01.03.2027", today)).toBeNull();
    expect(parseSubject("@01.03.2027 3d", today)).toBeNull();
  });

  it("email addresses do not trigger the grammar", () => {
    expect(parseSubject("Reply to foo@bar.de", today)).toBeNull();
  });
});

describe("computeSurfaceDate", () => {
  it("subtracts lead days", () => {
    expect(computeSurfaceDate("2026-07-10", 3, today)).toBe("2026-07-07");
  });

  it("past → today (send immediately)", () => {
    expect(computeSurfaceDate("2026-07-03", 5, today)).toBe("2026-07-02");
  });

  it("month boundary", () => {
    expect(computeSurfaceDate("2026-08-02", 5, today)).toBe("2026-07-28");
  });
});
