export interface MetrixTournament {
  0: string; // event id
  1: string; // title with arrow
  2: number; // latitude
  3: number; // longitude
  4: string; // start date
  7: string; // location with arrow
}

export interface OfficialTournament {
  event_id: number;
  event_name: string;
  location_latitude: string;
  location_longitude: string;
  location: string;
  num_attendees: number;
  spots: number;
  status: number;
  timestamp_end: number;
  timestamp_registration_phase: number;
  timestamp_start: number;
  title_picture_path: string;
  website_external: string;
}

export interface RelatedTournament {
  id: number;
  round: string;
}

export interface TournamentOutput {
  title: string;
  link: string;
  location: string;
  station?: string;
  coords: {
    lat: number | null;
    lng: number | null;
  };
  badge?: string;
  dates: {
    startTournament: string | Date | null;
    endTournament?: string | Date | null;
    startRegistration?: string | Date | null;
  };
  spots?: {
    overall: number;
    used: number;
  };
  round?: string;
  event_id?: number;
  relatedTournaments?: RelatedTournament[];
}

export interface TournamentPlayer {
  waitlisted: boolean;
  pdgaId: number | null;
  gtId: number | null;
  name: string;
}

export interface TournamentWithPlayers extends TournamentOutput {
  event_id: number;
  our_players: TournamentPlayer[];
}

export interface TournamentRegistrationPhase {
  name: string;
  start: string | null;
  end: string | null;
  capacity: number | null;
}

export interface TournamentMoney {
  amount: number;
  currency: string;
}

export interface TournamentDivision {
  name: string;
  abbreviation: string | null;
  capacity: number | null;
  registered: number | null;
  fee: TournamentMoney | null;
}

export interface TournamentFile {
  name: string;
  url: string;
}

export interface TournamentResult {
  division: string;
  player: string;
  rank: number | null;
  score: string | null;
  rating: number | null;
}

export interface TournamentDetail {
  id: number;
  title: string;
  organizer: string | null;
  director: string | null;
  venue: string | null;
  location: string | null;
  station: string | null;
  coords: { lat: number | null; lng: number | null };
  link: string;
  externalLinks: string[];
  startDate: string | null;
  endDate: string | null;
  series: string | null;
  registrationPhases: TournamentRegistrationPhase[];
  eligibility: string | null;
  format: string | null;
  rounds: string[];
  courseHoles: number | null;
  capacity: number | null;
  registered: number | null;
  divisions: TournamentDivision[];
  fees: TournamentMoney | null;
  prizeMoney: TournamentMoney | null;
  files: TournamentFile[];
  description: string | null;
  results: TournamentResult[];
}

export interface Rating {
  firstName: string;
  lastName: string;
  rating: number;
  ratingChange: 1 | -1 | null;
  divisionCount: number;
  gtNumber: number;
  division: string;
  lastRound: Date;
  roundCount: number;
  rank: number;
  divisionRank: number;
  link: string;
  club: string;
}

export interface Round {
  roundNumber: number;
  rating: number;
  division: string;
  holes: number | null;
  inRating: boolean;
}

export interface PlayerTournament {
  tournamentId: OfficialTournament['event_id'] | null;
  pdgaEventId: number | null;
  name: string;
  series: string;
  startDate: string;
  endDate: string;
  rounds: Round[];
}

export interface Player {
  name: string;
  gtNumber: number;
  club: string;
  tournaments: PlayerTournament[];
  historicRatings: HistoricRating[];
}

export interface HistoricRating {
  date: string;
  rating: number;
}
