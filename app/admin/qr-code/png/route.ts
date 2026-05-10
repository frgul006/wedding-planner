import QRCode from "qrcode";

import { requireActiveAdminProfile } from "@/lib/admin-auth";
import { getWeddingHubUrl } from "@/lib/wedding-hub";

export const runtime = "nodejs";

export async function GET(request: Request) {
  await requireActiveAdminProfile();

  const url = new URL(request.url);
  const hubUrl = getWeddingHubUrl(request.url);
  const png = await QRCode.toBuffer(hubUrl, {
    color: {
      dark: "#15130f",
      light: "#f1eadc",
    },
    errorCorrectionLevel: "M",
    margin: 3,
    type: "png",
    width: 1200,
  });
  const disposition = url.searchParams.get("download") === "1" ? "attachment" : "inline";

  return new Response(new Uint8Array(png), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `${disposition}; filename="wedding-hub-qr.png"`,
      "Content-Type": "image/png",
    },
  });
}
