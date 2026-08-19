/**
 * Deterministic presentation strings.
 *
 * Names are derived from a stable hash of (seed, eventId, group ordinal) rather
 * than from the PRNG stream, so changing the search algorithm does not reshuffle
 * every group name.
 */

import { stableHash } from "./prng";

const ADJECTIVES: readonly string[] = [
  "Signal", "Lantern", "Compass", "Orbit", "Cobalt", "Amber", "Velvet", "Quartz",
  "Ember", "Nimbus", "Copper", "Iris", "Solar", "Tidal", "Nova", "Aurora",
  "Cinder", "Marble", "Echo", "Prism", "Harbour", "Kite", "Meridian", "Saffron",
  "Terrace", "Vantage", "Willow", "Zephyr", "Basalt", "Clover", "Drift", "Fable",
];

const NOUNS: readonly string[] = [
  "Architects", "Cartographers", "Wanderers", "Foxes", "Lighthouses", "Comets",
  "Gardeners", "Navigators", "Storytellers", "Machinists", "Beacons", "Otters",
  "Alchemists", "Pioneers", "Kestrels", "Ensembles", "Rovers", "Clockmakers",
  "Divers", "Ronin", "Lynxes", "Falcons", "Cartwrights", "Sailmakers",
  "Glassblowers", "Astronomers", "Foragers", "Weavers", "Tinkerers", "Nomads",
  "Cyclists", "Stargazers",
];

const ICEBREAKERS: readonly string[] = [
  "Everyone share the last thing that made you laugh out loud.",
  "What is one thing you assumed about college that turned out to be wrong?",
  "Name a song you would put on if this group had an anthem.",
  "What is the most useless skill you are weirdly good at?",
  "If your group had to run a stall at the college fest, what would it sell?",
  "Share one place on campus you have not found yet but want to.",
  "What is your go-to order at a canteen you have just discovered?",
  "Describe your week so far using only three words.",
  "What is one thing you want to try this year that scares you a little?",
  "Which of you woke up earliest today, and how did that go?",
  "Share a photo you would use as your group's team logo.",
  "What is the strangest piece of advice a relative gave you about college?",
  "If the group had one shared superpower, what should it be?",
  "Name a hobby you dropped and might pick up again.",
  "What is something you are hoping someone in this chat also likes?",
  "Pick a fictional character each of you would trust to plan a trip.",
];

export function makeGroupCode(ordinal: number, totalGroups: number): string {
  const width = Math.max(3, String(totalGroups).length);
  return `CREW-${String(ordinal).padStart(width, "0")}`;
}

export function makeTemporaryId(seed: string, eventId: string, ordinal: number): string {
  const hash = stableHash(`${seed}|${eventId}|group|${ordinal}`);
  return `tmp_${ordinal.toString(36)}_${hash.toString(36)}`;
}

/**
 * Picks an adjective/noun pair. `used` is mutated to guarantee uniqueness
 * within a single run; collisions walk forward through the noun list, then the
 * adjective list, then fall back to a numeric suffix.
 */
export function makeGroupName(
  seed: string,
  eventId: string,
  ordinal: number,
  used: Set<string>,
): string {
  const hash = stableHash(`${seed}|${eventId}|name|${ordinal}`);
  const adjectiveStart = hash % ADJECTIVES.length;
  const nounStart = Math.floor(hash / ADJECTIVES.length) % NOUNS.length;

  for (let a = 0; a < ADJECTIVES.length; a += 1) {
    for (let n = 0; n < NOUNS.length; n += 1) {
      const adjective = ADJECTIVES[(adjectiveStart + a) % ADJECTIVES.length] as string;
      const noun = NOUNS[(nounStart + n) % NOUNS.length] as string;
      const candidate = `${adjective} ${noun}`;
      if (!used.has(candidate)) {
        used.add(candidate);
        return candidate;
      }
    }
  }

  const fallback = `${ADJECTIVES[adjectiveStart] as string} ${NOUNS[nounStart] as string} ${ordinal}`;
  used.add(fallback);
  return fallback;
}

export function pickIcebreaker(seed: string, eventId: string, ordinal: number): string {
  const hash = stableHash(`${seed}|${eventId}|icebreaker|${ordinal}`);
  return ICEBREAKERS[hash % ICEBREAKERS.length] as string;
}

export const namingPoolSizes = {
  adjectives: ADJECTIVES.length,
  nouns: NOUNS.length,
  icebreakers: ICEBREAKERS.length,
  uniqueNames: ADJECTIVES.length * NOUNS.length,
} as const;
