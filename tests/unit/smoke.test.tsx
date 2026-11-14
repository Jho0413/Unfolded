import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Home from "@/app/page";

describe("smoke", () => {
  it("renders the home page heading", () => {
    expect(renderToStaticMarkup(<Home />)).toContain("<h1>Whiteboard</h1>");
  });
});
