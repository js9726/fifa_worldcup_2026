import type { FuturesSettlementBasis } from "./types";

export type ParticipantFuturesEventType = "match_result_90" | "match_advance" | "round_of_16_outsider";

export type ParticipantFuturesTemplate = {
  type: ParticipantFuturesEventType;
  label: string;
  help: string;
  needsColdOption?: boolean;
};

export const PARTICIPANT_FUTURES_TEMPLATES: ParticipantFuturesTemplate[] = [
  {
    type: "match_result_90",
    label: "90-min result: home / draw / away",
    help: "Three-way result with the draw as the grey area."
  },
  {
    type: "match_advance",
    label: "To qualify / advance",
    help: "Full-match advancement, including extra time and penalties if needed."
  },
  {
    type: "round_of_16_outsider",
    label: "Reach Round of 16 + cold option",
    help: "Two match teams plus one controlled outsider country.",
    needsColdOption: true
  }
];

export function buildParticipantFuturesTemplate({
  type,
  homeCountry,
  awayCountry,
  coldCountry
}: {
  type: ParticipantFuturesEventType;
  homeCountry: string;
  awayCountry: string;
  coldCountry?: string | null;
}) {
  switch (type) {
    case "match_result_90":
      return {
        title: `${homeCountry} v ${awayCountry}: 90-min result`,
        marketType: "match_1x2",
        settlementBasis: "ninety_minutes" as FuturesSettlementBasis,
        options: [`${homeCountry} win`, "Draw", `${awayCountry} win`],
        settlementNote: "Settled on the 90-minute score only."
      };
    case "match_advance":
      return {
        title: `${homeCountry} v ${awayCountry}: who advances?`,
        marketType: "match_advance",
        settlementBasis: "advance_winner" as FuturesSettlementBasis,
        options: [`${homeCountry} advances`, `${awayCountry} advances`],
        settlementNote: "Settled by who qualifies, including extra time and penalties."
      };
    case "round_of_16_outsider": {
      const outsider = String(coldCountry ?? "").trim();
      return {
        title: `Round of 16 race: ${homeCountry}, ${awayCountry}, ${outsider || "outsider"}`,
        marketType: "stage_qualifier",
        settlementBasis: "manual" as FuturesSettlementBasis,
        options: [
          `${homeCountry} reaches Round of 16`,
          `${awayCountry} reaches Round of 16`,
          `${outsider || "Outsider"} reaches Round of 16`
        ],
        settlementNote: "Admin settles this once the Round of 16 field is confirmed."
      };
    }
    default:
      return null;
  }
}

export function participantFuturesTemplateFor(type: unknown) {
  return PARTICIPANT_FUTURES_TEMPLATES.find((template) => template.type === type) ?? null;
}
