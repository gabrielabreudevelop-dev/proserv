import { describe, expect, it } from "vitest";
import { addDays, addMonthsISO, diffDaysISO, agoLabel, atLocal, formatDuration, formatLocalDate, formatLocalDateTime, localParts, localRange, longDate, weekStart, weekdayShort } from "./time";

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

describe("datas relativas", () => {
  const now = new Date("2025-04-30T15:00:00Z"); // 12:00 em Brasília
  it("conta dias no calendário local", () => {
    expect(agoLabel("2025-04-30T03:30:00Z", now)).toBe("hoje"); // 00:30 local do mesmo dia
    expect(agoLabel("2025-04-30T02:30:00Z", now)).toBe("ontem"); // 23:30 local do dia anterior
    expect(agoLabel("2025-04-18T12:00:00Z", now)).toBe("há 12 dias");
    expect(agoLabel("2025-01-15T12:00:00Z", now)).toBe("há 3 meses");
    expect(agoLabel("2023-04-01T12:00:00Z", now)).toBe("há 2 anos");
  });
  it("formata no fuso do negócio", () => {
    expect(formatLocalDate("2025-03-03T02:00:00Z")).toBe("02/03/2025");
    expect(formatLocalDateTime("2025-03-03T12:00:00Z")).toBe("03/03/2025 às 09:00");
  });
});

describe("meses no calendário", () => {
  it("soma meses e respeita o fim do mês", () => {
    expect(addMonthsISO("2026-05-05", 6)).toBe("2026-11-05");
    expect(addMonthsISO("2026-08-15", 6)).toBe("2027-02-15");
    expect(addMonthsISO("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsISO("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonthsISO("2026-12-10", 12)).toBe("2027-12-10");
  });
  it("conta dias entre datas", () => {
    expect(diffDaysISO("2026-11-06", "2026-11-13")).toBe(7);
    expect(diffDaysISO("2026-11-06", "2026-11-01")).toBe(-5);
  });
});
