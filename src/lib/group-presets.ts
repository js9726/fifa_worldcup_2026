export type PoolAssignmentPreset = {
  name: string;
  teams: string[];
};

export const WALPLUS_GROUP_NAME = "WALPLUS World Cup 2026";
export const WALPLUS_GROUP_SLUG = "walplus-world-cup-2026";

export const WALPLUS_GROUP_ASSIGNMENTS: PoolAssignmentPreset[] = [
  { name: "Ada", teams: ["England", "Senegal", "Panama", "Scotland", "Iraq"] },
  { name: "Jie Sheng", teams: ["Turkiye", "Ecuador", "Ghana", "Belgium", "Switzerland"] },
  { name: "Li Anne", teams: ["France", "Australia", "Korea Republic", "South Africa", "Algeria"] },
  { name: "Yo", teams: ["Germany", "Croatia", "Norway", "Bosnia and Herzegovina", "Cape Verde"] },
  { name: "Irene", teams: ["Argentina", "Colombia", "Egypt", "Czechia", "DR Congo"] },
  { name: "Keith", teams: ["Spain", "Iran", "Austria", "Tunisia", "Jordan"] },
  { name: "Vyanne", teams: ["Netherlands", "Morocco", "Canada", "Ivory Coast", "Qatar"] },
  { name: "Keon", teams: ["Portugal", "Uruguay", "USA", "Paraguay", "Saudi Arabia"] },
  { name: "Bernard", teams: ["Brazil", "Japan", "Mexico", "Sweden", "Uzbekistan"] }
];
