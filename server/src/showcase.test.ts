import { describe, expect, it } from "vitest";

import { modeOf, titleOf } from "./showcase";

describe("showcase names", () => {
  it("treats low-poly names as 3D", () => {
    expect(modeOf("ArbitricaLowPoly")).toBe("3d");
    expect(modeOf("lowpoly")).toBe("3d");
    expect(modeOf("ExcelDashLaunch")).toBe("2d");
  });

  it("makes readable titles", () => {
    expect(titleOf("ExcelDashLaunch")).toBe("Excel Dash");
    expect(titleOf("OhMyBugLaunch")).toBe("Oh My Bug");
    expect(titleOf("ArbitricaLowPoly")).toBe("Arbitrica");
    expect(titleOf("v2-Xlaunch")).toBe("V2 Xlaunch");
    expect(titleOf("xlaunch-launch")).toBe("Xlaunch");
    expect(titleOf("xlaunch-square-ad")).toBe("Xlaunch square ad");
    expect(titleOf("lowpoly")).toBe("Low poly");
    expect(titleOf("HireID")).toBe("HireID");
    expect(titleOf("thecall lowpoly")).toBe("Thecall");
    expect(modeOf("ep2 lowpoly")).toBe("3d");
    expect(titleOf("HireIDLaunch")).toBe("HireID");
    expect(titleOf("ReSOLowPoly")).toBe("ReSO");
  });
});
