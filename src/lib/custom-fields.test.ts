import { describe, expect, it } from "vitest";
import { buildCustomFieldsSchema, mergeCustomValues, parseOptions, slugifyKey, type FieldDef } from "./custom-fields";

const def = (p: Partial<FieldDef> & Pick<FieldDef, "key" | "type">): FieldDef => ({
  id: p.key,
  label: p.key,
  options: [],
  required: false,
  visibleByDefault: true,
  position: 0,
  archived: false,
  ...p,
});

describe("slugifyKey", () => {
  it("remove acentos e espaços", () => {
    expect(slugifyKey("Data de Vencimento")).toBe("data_de_vencimento");
    expect(slugifyKey("Cor / Tamanho!")).toBe("cor_tamanho");
  });
  it("evita duplicadas e reservadas", () => {
    expect(slugifyKey("Lote", ["lote"])).toBe("lote_2");
    expect(slugifyKey("Lote", ["lote", "lote_2"])).toBe("lote_3");
    expect(slugifyKey("SKU")).toBe("sku_campo");
    expect(slugifyKey("!!!")).toBe("campo");
  });
});

describe("parseOptions", () => {
  it("aceita vírgulas e linhas, sem duplicar", () => {
    expect(parseOptions("Azul, Verde\nazul\n  Preto ;")).toEqual(["Azul", "Verde", "Preto"]);
  });
});

describe("buildCustomFieldsSchema", () => {
  const defs = [
    def({ key: "vencimento", type: "DATE" }),
    def({ key: "lote", type: "TEXT", required: true, label: "Lote" }),
    def({ key: "peso", type: "NUMBER" }),
    def({ key: "importado", type: "BOOLEAN" }),
    def({ key: "cor", type: "SELECT", options: ["Azul", "Verde"] }),
    def({ key: "antigo", type: "TEXT", archived: true }),
  ];
  const schema = buildCustomFieldsSchema(defs);

  it("converte e limpa valores válidos", () => {
    const out = schema.parse({ vencimento: "2027-06-30", lote: " A1 ", peso: "1,5", importado: "on", cor: "Azul", antigo: "x", extra: 1 });
    expect(out).toEqual({ vencimento: "2027-06-30", lote: "A1", peso: 1.5, importado: true, cor: "Azul" });
  });

  it("remove opcionais vazios", () => {
    expect(schema.parse({ lote: "B2", vencimento: "", peso: "" })).toEqual({ lote: "B2" });
  });

  it("rejeita obrigatório vazio, data, número e opção inválidos", () => {
    const r = schema.safeParse({ lote: "", vencimento: "30/06/2027", peso: "abc", cor: "Roxo" });
    expect(r.success).toBe(false);
    const paths = r.error!.issues.map((i) => i.path[0]).sort();
    expect(paths).toEqual(["cor", "lote", "peso", "vencimento"]);
  });

  it("rejeita data que não existe no calendário", () => {
    expect(schema.safeParse({ lote: "A", vencimento: "2027-02-30" }).success).toBe(false);
  });
});

describe("mergeCustomValues", () => {
  it("preserva arquivados e remove ativos vazios", () => {
    const defs = [def({ key: "lote", type: "TEXT" }), def({ key: "velho", type: "TEXT", archived: true })];
    expect(mergeCustomValues({ lote: "A", velho: "guardado" }, {}, defs)).toEqual({ velho: "guardado" });
    expect(mergeCustomValues({ velho: "guardado" }, { lote: "B" }, defs)).toEqual({ velho: "guardado", lote: "B" });
  });
});
