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
//             ninetyHome, ninetyAway, extraHome, extraAway, duration,
//             overallWinner }  // overallWinner: "HOME"|"AWAY"|"DRAW"|null
export function settleForAccepter(offer, fixture) {
  if (offer.market === "winner") {
    let winnerCountry = null;

    if (offer.settlementBasis === "advance_winner") {
      if (fixture.overallWinner === "HOME") winnerCountry = fixture.homeCountry;
      else if (fixture.overallWinner === "AWAY") winnerCountry = fixture.awayCountry;
      else if (fixture.overallWinner === "DRAW") winnerCountry = null;
      else return null; // no decided winner recorded yet
    } else if (offer.settlementBasis === "after_extra_time") {
      const score = scoreAfterExtraTime(fixture);
      if (!score) return null;
      winnerCountry = winnerFromScore(score.home, score.away, fixture);
    } else {
      if (fixture.ninetyHome == null || fixture.ninetyAway == null) return null;
      winnerCountry = winnerFromScore(fixture.ninetyHome, fixture.ninetyAway, fixture);
    }

    // Creator backs creatorSide; the accepter backs the other team.
    if (winnerCountry == null) return { result: "void", deltaFactor: 0 };
    if (winnerCountry === offer.creatorSide) return { result: "loss", deltaFactor: -1 };
    return { result: "win", deltaFactor: 1 };
  }

  if (offer.market === "asian_handicap") {
    if (offer.settlementBasis === "extra_time" && fixture.duration === "REGULAR") {
      return { result: "void", deltaFactor: 0 };
    }

    const basisScore = offer.settlementBasis === "extra_time" ? scoreExtraTimeOnly(fixture) : scoreNinetyMinutes(fixture);
    if (!basisScore) return null;
    const scoreHome = basisScore.home;
    const scoreAway = basisScore.away;

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

function winnerFromScore(home, away, fixture) {
  if (home == null || away == null) return null;
  if (home > away) return fixture.homeCountry;
  if (away > home) return fixture.awayCountry;
  return null;
}

function scoreNinetyMinutes(fixture) {
  if (fixture.ninetyHome == null || fixture.ninetyAway == null) return null;
  return { home: fixture.ninetyHome, away: fixture.ninetyAway };
}

function scoreAfterExtraTime(fixture) {
  const ninety = scoreNinetyMinutes(fixture);
  if (!ninety) return null;

  if (fixture.duration === "REGULAR") return ninety;

  if (fixture.extraHome != null && fixture.extraAway != null) {
    return {
      home: ninety.home + fixture.extraHome,
      away: ninety.away + fixture.extraAway
    };
  }

  // If the match ended after extra time and the provider did not split the
  // extra-time goals, fullTime is still a safe 120-minute score. Do not use it
  // for penalty shootouts, because some providers fold penalties into fullTime.
  if (fixture.duration === "EXTRA_TIME" && fixture.fullHome != null && fixture.fullAway != null) {
    return { home: fixture.fullHome, away: fixture.fullAway };
  }

  return null;
}

function scoreExtraTimeOnly(fixture) {
  if (fixture.extraHome != null && fixture.extraAway != null) {
    return { home: fixture.extraHome, away: fixture.extraAway };
  }

  if (
    fixture.duration === "EXTRA_TIME" &&
    fixture.fullHome != null &&
    fixture.fullAway != null &&
    fixture.ninetyHome != null &&
    fixture.ninetyAway != null
  ) {
    return {
      home: fixture.fullHome - fixture.ninetyHome,
      away: fixture.fullAway - fixture.ninetyAway
    };
  }

  return null;
}
