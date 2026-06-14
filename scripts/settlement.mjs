// Pure peer-to-peer bet settlement helpers. No I/O — safe to unit-test.
//
// Bets are even money (1:1) on the line. ledgerDelta is expressed from the
// ACCEPTER's point of view; the creator's delta is the negative of it (the
// leaderboard already mirrors it that way).

// Map an Asian-Handicap adjusted margin to an outcome.
// adjusted is (your goals - their goals + your line); always a multiple of 0.25.
export function ahOutcome(adjusted) {
  const a = Math.round(adjusted * 100) / 100;
  if (a >= 0.5) return "win";
  if (a === 0.25) return "half_win";
  if (a === 0) return "push";
  if (a === -0.25) return "half_loss";
  return "loss";
}

// Returns { result, deltaFactor } for the accepter, or null when there is not
// enough information to settle (caller should leave the bet pending).
//   result     : "win" | "loss" | "half_win" | "half_loss" | "void"
//   deltaFactor: multiply by the stake to get the accepter's ledger delta
//
// offer   : { market, creatorSide, settlementBasis, handicapTeam, handicapLine }
// fixture : { homeCountry, awayCountry, fullHome, fullAway,
//             ninetyHome, ninetyAway, overallWinner }  // overallWinner: "HOME"|"AWAY"|"DRAW"|null
export function settleForAccepter(offer, fixture) {
  if (offer.market === "winner") {
    let winnerCountry = null;

    if (offer.settlementBasis === "advance_winner") {
      if (fixture.overallWinner === "HOME") winnerCountry = fixture.homeCountry;
      else if (fixture.overallWinner === "AWAY") winnerCountry = fixture.awayCountry;
      else if (fixture.overallWinner === "DRAW") winnerCountry = null;
      else return null; // no decided winner recorded yet
    } else {
      if (fixture.ninetyHome == null || fixture.ninetyAway == null) return null;
      if (fixture.ninetyHome > fixture.ninetyAway) winnerCountry = fixture.homeCountry;
      else if (fixture.ninetyAway > fixture.ninetyHome) winnerCountry = fixture.awayCountry;
      else winnerCountry = null; // draw
    }

    // Creator backs creatorSide; the accepter backs the other team.
    if (winnerCountry == null) return { result: "void", deltaFactor: 0 };
    if (winnerCountry === offer.creatorSide) return { result: "loss", deltaFactor: -1 };
    return { result: "win", deltaFactor: 1 };
  }

  if (offer.market === "asian_handicap") {
    const useFull = offer.settlementBasis === "advance_winner";
    const scoreHome = useFull ? fixture.fullHome : fixture.ninetyHome;
    const scoreAway = useFull ? fixture.fullAway : fixture.ninetyAway;
    if (scoreHome == null || scoreAway == null || offer.handicapTeam == null || offer.handicapLine == null) {
      return null;
    }

    const teamGoals = offer.handicapTeam === fixture.homeCountry ? scoreHome : scoreAway;
    const otherGoals = offer.handicapTeam === fixture.homeCountry ? scoreAway : scoreHome;
    // Creator sits on handicapTeam at handicapLine; the accepter is the mirror.
    const adjustedCreator = teamGoals - otherGoals + offer.handicapLine;
    const outcome = ahOutcome(-adjustedCreator);

    switch (outcome) {
      case "win":
        return { result: "win", deltaFactor: 1 };
      case "half_win":
        return { result: "half_win", deltaFactor: 0.5 };
      case "push":
        return { result: "void", deltaFactor: 0 };
      case "half_loss":
        return { result: "half_loss", deltaFactor: -0.5 };
      default:
        return { result: "loss", deltaFactor: -1 };
    }
  }

  return null;
}
