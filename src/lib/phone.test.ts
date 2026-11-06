import { describe, expect, it } from "vitest";
import { formatPhone, isValidPhone, normalizePhone, whatsappUrl } from "./phone";

describe("telefone", () => {
  it("normaliza o que a pessoa digitou", () => {
    expect(normalizePhone("(11) 99100-7919")).toBe("11991007919");
    expect(normalizePhone("+55 11 99100 7919")).toBe("11991007919");
    expect(normalizePhone("  ")).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });

  it("valida o tamanho", () => {
    expect(isValidPhone("11991007919")).toBe(true);
    expect(isValidPhone("1134567890")).toBe(true);
    expect(isValidPhone("34567890")).toBe(true);
    expect(isValidPhone("1234")).toBe(false);
    expect(isValidPhone(null)).toBe(true);
  });

  it("formata celular, fixo e sem DDD", () => {
    expect(formatPhone("11991007919")).toBe("(11) 99100-7919");
    expect(formatPhone("1134567890")).toBe("(11) 3456-7890");
    expect(formatPhone("991007919")).toBe("99100-7919");
    expect(formatPhone(null)).toBe("");
  });

  it("WhatsApp só para celular com DDD", () => {
    expect(whatsappUrl("11991007919")).toBe("https://wa.me/5511991007919");
    expect(whatsappUrl("1134567890")).toBeNull();
    expect(whatsappUrl("991007919")).toBeNull();
  });
});
