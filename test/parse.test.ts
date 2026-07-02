import { describe, expect, it } from "vitest";
import { computeSurfaceDate, parseSubject } from "../src/parse.js";

// Fixe "Gegenwart" für deterministische Tests
const today = new Date(2026, 6, 2); // 2026-07-02

describe("parseSubject", () => {
  it("parst deutsches Datum mit Jahr", () => {
    expect(parseSubject("@01.03.2027 Steuererklärung einreichen", today)).toEqual({
      title: "Steuererklärung einreichen",
      due: "2027-03-01",
      leadDays: null,
    });
  });

  it("parst jahrloses Datum in der Zukunft → dieses Jahr", () => {
    expect(parseSubject("@24.12. Geschenke kaufen", today)).toEqual({
      title: "Geschenke kaufen",
      due: "2026-12-24",
      leadDays: null,
    });
  });

  it("parst jahrloses Datum in der Vergangenheit → nächstes Jahr", () => {
    expect(parseSubject("@01.03. Steuer", today)?.due).toBe("2027-03-01");
  });

  it("heute zählt als dieses Jahr", () => {
    expect(parseSubject("@02.07. Heute fällig", today)?.due).toBe("2026-07-02");
  });

  it("parst ISO-Datum", () => {
    expect(parseSubject("@2026-09-15 Reifen wechseln", today)).toEqual({
      title: "Reifen wechseln",
      due: "2026-09-15",
      leadDays: null,
    });
  });

  it("parst Vorlauf direkt nach dem Datum", () => {
    expect(parseSubject("@01.03.2027 5d Steuererklärung", today)).toEqual({
      title: "Steuererklärung",
      due: "2027-03-01",
      leadDays: 5,
    });
  });

  it("Datum darf auch mitten im Betreff stehen", () => {
    expect(parseSubject("Steuererklärung @01.03.2027 einreichen", today)).toEqual({
      title: "Steuererklärung einreichen",
      due: "2027-03-01",
      leadDays: null,
    });
  });

  it("Zahl-plus-d im Titel ist kein Vorlauf, wenn nicht direkt nach dem Datum", () => {
    const r = parseSubject("@01.03.2027 Raum 5d reservieren", today);
    expect(r?.leadDays).toBeNull();
    expect(r?.title).toBe("Raum 5d reservieren");
  });

  it("kein @-Datum → null (LLM-Fall)", () => {
    expect(parseSubject("Reifen wechseln bis nächsten Dienstag", today)).toBeNull();
  });

  it("ungültiges Datum → null", () => {
    expect(parseSubject("@31.02.2027 Unsinn", today)).toBeNull();
  });

  it("leerer Titel → null", () => {
    expect(parseSubject("@01.03.2027", today)).toBeNull();
    expect(parseSubject("@01.03.2027 3d", today)).toBeNull();
  });

  it("E-Mail-Adressen lösen die Grammatik nicht aus", () => {
    expect(parseSubject("Antwort an foo@bar.de schicken", today)).toBeNull();
  });
});

describe("computeSurfaceDate", () => {
  it("zieht Vorlauftage ab", () => {
    expect(computeSurfaceDate("2026-07-10", 3, today)).toBe("2026-07-07");
  });

  it("Vergangenheit → heute (sofort senden)", () => {
    expect(computeSurfaceDate("2026-07-03", 5, today)).toBe("2026-07-02");
  });

  it("Monatsgrenze", () => {
    expect(computeSurfaceDate("2026-08-02", 5, today)).toBe("2026-07-28");
  });
});
