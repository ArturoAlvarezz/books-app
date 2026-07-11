import { describe, expect, it } from "vitest";
import { comparePages, formatBytes, isSupported } from "./lib";

describe("biblioteca helpers", () => {
  it("muestra tamaños legibles", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1048576)).toBe("5.0 MB");
    expect(formatBytes(2 * 1073741824)).toBe("2.0 GB");
  });

  it("reconoce los formatos del lector", () => {
    expect(isSupported("EPUB")).toBe(true);
    expect(isSupported("epub")).toBe(true);
    expect(isSupported("MOBI")).toBe(false);
  });

  it("ordena páginas de cómic con números naturales", () => {
    const pages = ["page10.jpg", "page2.jpg", "page1.jpg"];
    expect([...pages].sort(comparePages)).toEqual(["page1.jpg", "page2.jpg", "page10.jpg"]);
  });
});
