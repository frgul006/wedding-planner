import { expect, test } from "@playwright/test";

import {
  estimateSmsSegments,
  getInviteSmsFirstName,
  renderInviteSmsTemplate,
  validateInviteSmsTemplate,
} from "../lib/invite-sms-template";

test.describe("Invite SMS template", () => {
  test("requires first-name and invite-link placeholders", () => {
    expect(validateInviteSmsTemplate({
      sampleInviteUrl: "https://example.test/invite/sample",
      template: "Hej {{first_name}}!",
    })).toMatchObject({ status: "missing-link" });
    expect(validateInviteSmsTemplate({
      sampleInviteUrl: "https://example.test/invite/sample",
      template: "Hej {{guest_name}}! {{invite_link}}",
    })).toMatchObject({ status: "missing-first-name" });
    expect(validateInviteSmsTemplate({
      sampleInviteUrl: "https://example.test/invite/sample",
      template: "Hej {{first_name}}! {{inviteLink}} {{invite_link}}",
    })).toMatchObject({
      status: "unknown-placeholder",
      unknownPlaceholders: ["{{inviteLink}}"],
    });
  });

  test("renders first word and estimates GSM/Unicode SMS segments", () => {
    const template = "Hej {{first_name}}! Här är länken: {{invite_link}}";
    const inviteUrl = "https://wedding.example/invite/abc";
    const message = renderInviteSmsTemplate({
      firstName: getInviteSmsFirstName("Ada Lovelace"),
      inviteUrl,
      template,
    });

    expect(message).toBe("Hej Ada! Här är länken: https://wedding.example/invite/abc");
    expect(estimateSmsSegments(message)).toMatchObject({
      encoding: "gsm-7",
      segments: 1,
    });
    expect(estimateSmsSegments(`${message} 💍`)).toMatchObject({
      encoding: "unicode",
      segments: 1,
    });
  });
});
