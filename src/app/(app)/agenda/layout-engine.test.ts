import { describe, expect, it } from "vitest";
import { placeBlocks, snap } from "./layout-engine";

const at = (h: number, m = 0) => h * 60 + m;

describe("placeBlocks", () => {
  it("blocos sem sobreposição ocupam a largura toda", () => {
    const r = placeBlocks([
      { id: "a", start: at(8), end: at(9) },
      { id: "b", start: at(9), end: at(10) }, // encostado, não sobrepõe
    ]);
    expect(r.get("a")).toEqual({ id: "a", lane: 0, lanes: 1 });
    expect(r.get("b")).toEqual({ id: "b", lane: 0, lanes: 1 });
  });

  it("sobrepostos dividem em faixas e reaproveitam faixa livre", () => {
    const r = placeBlocks([
      { id: "a", start: at(8), end: at(10) },
      { id: "b", start: at(8, 30), end: at(9) },
      { id: "c", start: at(9), end: at(9, 30) }, // cabe na faixa de b
      { id: "d", start: at(9, 15), end: at(11) },
    ]);
    expect(r.get("a")!.lane).toBe(0);
    expect(r.get("b")!.lane).toBe(1);
    expect(r.get("c")!.lane).toBe(1);
    expect(r.get("d")!.lane).toBe(2);
    expect(new Set([...r.values()].map((p) => p.lanes))).toEqual(new Set([3]));
  });

  it("grupos separados no tempo não se afetam", () => {
    const r = placeBlocks([
      { id: "a", start: at(8), end: at(9) },
      { id: "b", start: at(8), end: at(9) },
      { id: "c", start: at(14), end: at(15) },
    ]);
    expect(r.get("c")).toEqual({ id: "c", lane: 0, lanes: 1 });
    expect(r.get("a")!.lanes).toBe(2);
  });

  it("snap arredonda para baixo", () => {
    expect(snap(at(9, 44), 30)).toBe(at(9, 30));
  });
});
