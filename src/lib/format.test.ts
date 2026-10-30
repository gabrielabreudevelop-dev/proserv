import { describe, expect, it } from "vitest";
import { formatBRL, formatDateISO, parseDecimalInput } from "./format";

describe("parseDecimalInput", () => {
  it.each([
    ["3,50", "3.50"],
    ["1.234,56", "1234.56"],
    ["1234.56", "1234.56"],
    ["R$ 12,00", "12.00"],
    ["007", "7"],
    ["-2,5", "-2.5"],
    [10, "10"],
  ])("%s → %s", (input, expected) => {
    expect(parseDecimalInput(input)).toBe(expected);
  });

  it.each(["", "abc", "1,2,3", "1.2.3", null, undefined])("rejeita %s", (input) => {
    expect(parseDecimalInput(input)).toBeNull();
  });
});

describe("formatação", () => {
  it("formata moeda e data em pt-BR", () => {
    expect(formatBRL("1234.5").replace(/\s/g, " ")).toBe("R$ 1.234,50");
    expect(formatDateISO("2027-06-30")).toBe("30/06/2027");
  });
});
