import { expect, test } from "@playwright/test";

import {
  formatWeddingHubDateBadge,
  formatWeddingSettingsDate,
  getCoupleMark,
  getGuestFacingWeddingSettingsDisplay,
  getInviteSupportDisplayName,
  getInviteSupportFooterMark,
  getPublicPartnerNames,
  getWeddingHubDisplay,
  getWeddingSettingsDisplayText,
} from "../lib/wedding-settings-display";

test.describe("Wedding settings display", () => {
  test("builds guest-facing Invite display from Wedding settings", () => {
    const display = getGuestFacingWeddingSettingsDisplay({
      google_maps_url: "https://maps.example.test/place",
      partner_one_name: " Fredrik ",
      partner_two_name: "Matilda",
      spotify_playlist_url: "javascript:alert(1)",
      venue_address: "Regression Road 42",
      venue_area: null,
      venue_name: "Glass House",
      wedding_date: "2027-06-07T13:45:00.000Z",
    });

    expect(display.partnerNames.displayName).toBe("Fredrik & Matilda");
    expect(display.coupleMark).toBe("F & M");
    expect(display.coverDateTime).toEqual({
      dateText: "7 juni",
      dayText: "7",
      monthText: "juni",
      timeText: "kl. 15:45",
    });
    expect(display.coverVenueArea).toBe("Regression Road 42");
    expect(display.coverVenueName).toBe("Glass House");
    expect(display.mapsUrl).toBe("https://maps.example.test/place");
    expect(display.spotifyUrl).toBeNull();
    expect(display.weddingDate).toContain("2027");
    expect(display.weddingDate).toContain("15:45");
  });

  test("uses safe placeholders without inferring Public Wedding identity from Wedding name", () => {
    const partnerNames = getPublicPartnerNames({
      partner_one_name: null,
      partner_two_name: " Matilda ",
    });

    expect(partnerNames.displayName).toBe("Partner 1 & Matilda");
    expect(getCoupleMark(partnerNames)).toBe("♡");
    expect(
      getInviteSupportDisplayName({
        partner_one_name: null,
        partner_two_name: "Matilda",
      }),
    ).toBeNull();
    expect(
      getInviteSupportDisplayName({
        partner_one_name: "Fredrik",
        partner_two_name: "Matilda",
      }),
    ).toBe("Fredrik & Matilda");
    expect(getInviteSupportFooterMark("Fredrik & Matilda")).toBe("F & M");
    expect(getWeddingSettingsDisplayText("  ")).toBe("Kommer snart");
  });

  test("formats Wedding hub display in Stockholm and hides unsafe links", () => {
    expect(formatWeddingHubDateBadge("2027-06-06T22:30:00.000Z")).toBe(
      "7 JUNI",
    );
    expect(
      formatWeddingSettingsDate("2027-06-06T22:30:00.000Z", {
        fallback: "Wedding date not set",
      }),
    ).toContain("00:30");

    const display = getWeddingHubDisplay({
      name: "Legacy Wedding Title",
      partner_one_name: "Fredrik",
      partner_two_name: "Matilda",
      spotify_playlist_url: "ftp://spotify.example.test/list",
      wedding_date: "2027-06-06T22:30:00.000Z",
    });

    expect(display).toEqual({
      dateBadge: "7 JUNI",
      monogram: "F & M",
      spotifyEnabled: false,
      spotifyUrl: null,
    });
  });
});
