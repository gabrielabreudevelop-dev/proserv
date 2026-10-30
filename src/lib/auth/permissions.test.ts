import { describe, expect, it } from "vitest";
import { can, parseRoles } from "./permissions";
import { navFor } from "@/lib/nav";

const hrefs = (role: string) => navFor(role).flatMap((s) => s.items.map((i) => i.href));

describe("parseRoles", () => {
  it("separa múltiplos cargos e ignora desconhecidos", () => {
    expect(parseRoles("admin, gerente,xyz")).toEqual(["admin", "gerente"]);
    expect(parseRoles(null)).toEqual([]);
  });
});

describe("can()", () => {
  it("admin e gerente veem o financeiro", () => {
    expect(can("admin", "financeiro", "ver")).toBe(true);
    expect(can("gerente", "financeiro", "lancar")).toBe(true);
  });

  it("vendedor registra venda mas não cancela nem vê financeiro", () => {
    expect(can("vendedor", "venda", "registrar")).toBe(true);
    expect(can("vendedor", "venda", "cancelar")).toBe(false);
    expect(can("vendedor", "financeiro", "ver")).toBe(false);
    expect(can("vendedor", "produto", "editar")).toBe(false);
  });

  it("prestador só vê a própria agenda e serviços", () => {
    expect(can("prestador", "agenda", "ver")).toBe(true);
    expect(can("prestador", "agenda", "verTodas")).toBe(false);
    expect(can("prestador", "produto", "ver")).toBe(false);
  });

  it("sem cargo não pode nada", () => {
    expect(can("", "produto", "ver")).toBe(false);
    expect(can(undefined, "dashboardProdutos", "ver")).toBe(false);
  });

  it("cargos combinados somam permissões", () => {
    expect(can("vendedor,prestador", "agenda", "ver")).toBe(true);
    expect(can("vendedor,prestador", "venda", "registrar")).toBe(true);
  });
});

describe("menu por cargo", () => {
  it("cada cargo vê só o seu menu", () => {
    expect(hrefs("admin")).toEqual([
      "/dashboard", "/produtos", "/vendas", "/servicos", "/agenda", "/financeiro", "/config/usuarios",
    ]);
    expect(hrefs("gerente")).toEqual(["/dashboard", "/produtos", "/vendas", "/servicos", "/agenda", "/financeiro"]);
    expect(hrefs("vendedor")).toEqual(["/dashboard", "/produtos", "/vendas"]);
    expect(hrefs("prestador")).toEqual(["/dashboard", "/servicos", "/agenda"]);
  });
});
