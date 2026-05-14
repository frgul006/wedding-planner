import { buildPublicUrl, type PublicUrlOptions } from "./public-url";
import { WEDDING_HUB_PATH } from "./wedding-hub";

export function getWeddingHubUrl(options?: PublicUrlOptions) {
  return buildPublicUrl(WEDDING_HUB_PATH, options);
}
