import { describe, expect, it } from "vitest";

import { executablePath } from "../../src/config/executablePath";

describe("executablePath", () => {
  const roots = ["/home/taha/.cache/majordomo/reading/qauth", "/home/taha/work/other"];

  it("keeps a bare command name for PATH resolution", () => {
    expect(executablePath("jj", "jj", roots)).toBe("jj");
    expect(executablePath("  jj-next  ", "jj", roots)).toBe("jj-next");
    expect(executablePath(undefined, "jj", roots)).toBe("jj");
    expect(executablePath("", "jj", roots)).toBe("jj");
  });

  it("keeps an absolute path outside every workspace folder", () => {
    expect(executablePath("/usr/bin/jj", "jj", roots)).toBe("/usr/bin/jj");
    expect(executablePath("/home/taha/.local/bin/jj", "jj", roots)).toBe("/home/taha/.local/bin/jj");
  });

  it("refuses a relative path — a checkout must not choose the binary", () => {
    expect(executablePath("./bin/jj", "jj", roots)).toBe("jj");
    expect(executablePath("bin/jj", "jj", roots)).toBe("jj");
    expect(executablePath("../jj", "jj", roots)).toBe("jj");
  });

  it("refuses an absolute path inside a workspace folder, however spelled", () => {
    expect(executablePath("/home/taha/.cache/majordomo/reading/qauth/tools/jj", "jj", roots)).toBe("jj");
    expect(executablePath("/home/taha/work/other/../other/jj", "jj", roots)).toBe("jj");
    expect(executablePath("/home/taha/.cache/majordomo/reading/qauth", "jj", roots)).toBe("jj");
  });

  it("does not confuse a sibling directory that shares a prefix", () => {
    expect(executablePath("/home/taha/work/other-tools/jj", "jj", roots)).toBe("/home/taha/work/other-tools/jj");
  });
});
