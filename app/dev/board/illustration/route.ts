// DEV ONLY: a small test picture for /dev/board?scene=image (E1, issue #152), in place of a
// saved fal illustration.
//   ?kind=ok        test.jpg (480 x 320)
//   ?kind=broken    200, but the bytes aren't an image (the board hides it)
// 404s in production unless in fake mode (app/dev/devOnly.ts).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { devPagesEnabled } from "../../devOnly";

const NOT_FOUND = () => new Response("Not found", { status: 404 });

export async function GET(request: Request): Promise<Response> {
  if (!(await devPagesEnabled())) return NOT_FOUND();
  const kind = new URL(request.url).searchParams.get("kind") ?? "ok";
  const headers = { "Content-Type": "image/jpeg", "Cache-Control": "no-store" };
  switch (kind) {
    case "ok":
      return new Response(
        await readFile(
          path.join(process.cwd(), "app/dev/board/illustration/test.jpg"),
        ),
        { headers },
      );
    case "broken":
      return new Response("this is not a picture", { headers });
    default:
      return NOT_FOUND();
  }
}
