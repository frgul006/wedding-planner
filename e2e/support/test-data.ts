export const SEEDED_ADMIN = {
  email: "admin@example.com",
  password: "password123456",
} as const;

export const SEEDED_WEDDING_ID = "00000000-0000-0000-0000-000000000001";

export const SEEDED_GUESTS = {
  firstTimeRsvp: {
    id: "10000000-0000-0000-0000-000000000001",
    name: "Ada Lovelace",
    token: "local-ada-first-time-rsvp",
  },
  existingRsvp: {
    id: "10000000-0000-0000-0000-000000000003",
    name: "Alan Turing",
    token: "local-alan-existing-rsvp",
  },
} as const;
