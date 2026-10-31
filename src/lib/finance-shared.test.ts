import { describe, expect, it } from "vitest";
import { currentMonth, monthLabel, monthRange, shiftMonth, todayISO } from "./finance-shared";

describe("períodos no fuso de São Paulo", () => {
  it("mês começa à meia-noite de Brasília (03:00 UTC)", () => {
    const { from, to } = monthRange("2026-10");
    expect(from.toISOString()).toBe("2026-10-01T03:00:00.000Z");
    expect(to.toISOString()).toBe("2026-11-01T03:00:00.000Z");
  });
  it("dezembro vira o ano", () => {
    expect(monthRange("2026-12").to.toISOString()).toBe("2027-01-01T03:00:00.000Z");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2027-01", -1)).toBe("2026-12");
  });
  it("31/10 às 22h em Brasília ainda é outubro (já é novembro em UTC)", () => {
    const late = new Date("2026-11-01T01:00:00Z");
    expect(currentMonth(late)).toBe("2026-10");
    expect(todayISO(late)).toBe("2026-10-31");
  });
  it("rótulo em português", () => {
    expect(monthLabel("2026-10")).toBe("Outubro de 2026");
  });
});
