import { describe, expect, it } from "vitest";
import { addDays, atLocal, formatDuration, localParts, localRange, longDate, weekStart, weekdayShort } from "./time";

describe("horário de Brasília", () => {
  it("converte ida e volta", () => {
    const d = atLocal("2026-10-30", "14:30");
    expect(d.toISOString()).toBe("2026-10-30T17:30:00.000Z");
    expect(localParts(d)).toEqual({ date: "2026-10-30", time: "14:30", minutes: 870 });
  });
  it("23h em Brasília ainda é o mesmo dia", () => {
    expect(localParts(new Date("2026-11-01T02:00:00Z")).date).toBe("2026-10-31");
  });
  it("dia local vai de 03:00 UTC a 03:00 UTC", () => {
    const { from, to } = localRange("2026-10-30");
    expect([from.toISOString(), to.toISOString()]).toEqual(["2026-10-30T03:00:00.000Z", "2026-10-31T03:00:00.000Z"]);
  });
  it("semana começa na segunda", () => {
    expect(weekStart("2026-10-30")).toBe("2026-10-26"); // sexta → segunda
    expect(weekStart("2026-11-01")).toBe("2026-10-26"); // domingo → segunda anterior
    expect(weekStart("2026-10-26")).toBe("2026-10-26");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("rótulos em português", () => {
    expect(weekdayShort("2026-10-30")).toBe("sex");
    expect(longDate("2026-10-30")).toBe("Sexta-feira, 30 de outubro");
    expect(formatDuration(90)).toBe("1 h 30 min");
    expect(formatDuration(60)).toBe("1 h");
    expect(formatDuration(45)).toBe("45 min");
  });
});
