import { describe, expect, it } from "vitest";
import { formatBytes, isSupported } from "./lib";

describe("biblioteca helpers", () => {
  it("muestra tamaños legibles", () => expect(formatBytes(1536)).toBe("1.5 KB"));
  it("reconoce los formatos del lector", () => {
    expect(isSupported("EPUB")).toBe(true);
    expect(isSupported("MOBI")).toBe(false);
  });
});
